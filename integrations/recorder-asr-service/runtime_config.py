"""Persistent, redacted runtime configuration for recorder ASR and CAM."""

from __future__ import annotations

import json
import os
import tempfile
import threading
import time
from copy import deepcopy
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


class RuntimeValidationError(ValueError):
    """Raised when a runtime configuration cannot be applied safely."""


def default_config() -> dict[str, Any]:
    return {
        "revision": 0,
        "asr": {"mode": "local", "model": "paraformer-zh"},
        "cam": {"enabled": True, "mode": "local", "model": "cam++", "matchThreshold": 0.72},
        "credentials": {},
    }


def _online_valid(item: dict[str, Any], credential: str | None) -> bool:
    if item.get("mode") == "local":
        return True
    endpoint = str(item.get("endpoint") or "")
    reference = str(item.get("credentialRef") or "")
    parsed = urlparse(endpoint)
    return parsed.scheme == "https" and bool(parsed.netloc and reference and credential)


def validate_config(value: dict[str, Any]) -> None:
    if not isinstance(value.get("revision"), int) or value["revision"] < 0:
        raise RuntimeValidationError("runtime revision must be a non-negative integer")
    credentials = value.get("credentials") or {}
    for name in ("asr", "cam"):
        item = value.get(name)
        if not isinstance(item, dict) or item.get("mode") not in ("local", "online"):
            raise RuntimeValidationError(f"{name} mode must be local or online")
        model = item.get("model")
        if not isinstance(model, str) or not model.strip() or len(model) > 200:
            raise RuntimeValidationError(f"{name} model is required")
    if not _online_valid(value["asr"], credentials.get("asrCredential")):
        raise RuntimeValidationError("online ASR requires an HTTPS endpoint, Credential reference, and resolved credential")
    if value["cam"].get("enabled") and not _online_valid(value["cam"], credentials.get("camCredential")):
        raise RuntimeValidationError("online CAM requires an HTTPS endpoint, Credential reference, and resolved credential")
    threshold = value["cam"].get("matchThreshold")
    if not isinstance(threshold, (int, float)) or isinstance(threshold, bool) or not 0.5 <= threshold <= 0.99:
        raise RuntimeValidationError("CAM match threshold must be between 0.5 and 0.99")


class RuntimeConfigStore:
    """Revisioned JSON store whose public view never contains credential values."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._state = self._read()

    def _read(self) -> dict[str, Any]:
        if not self.path.exists():
            return default_config()
        value = json.loads(self.path.read_text(encoding="utf-8"))
        validate_config(value)
        return value

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return deepcopy(self._state)

    def view(self, *, state: str = "stopped", asr_ready: bool = False,
             cam_ready: bool = False, active_revision: int | None = None,
             error: str | None = None) -> dict[str, Any]:
        value = self.snapshot()
        credentials = value.pop("credentials", {})
        credential_ready = _online_valid(value["asr"], credentials.get("asrCredential")) and (
            not value["cam"].get("enabled") or _online_valid(value["cam"], credentials.get("camCredential"))
        )
        result = {
            **value,
            "state": state,
            "asrReady": asr_ready,
            "camReady": cam_ready,
            "credentialReady": credential_ready,
            "checkedAt": time.time(),
        }
        if active_revision is not None:
            result["activeRevision"] = active_revision
        if error:
            result["error"] = error
        return result

    def save(self, request: dict[str, Any]) -> dict[str, Any]:
        expected = request.get("expectedRevision")
        with self._lock:
            if expected != self._state["revision"]:
                raise RuntimeValidationError("runtime revision conflict; refresh before saving")
            candidate = {
                "revision": expected + 1,
                "asr": deepcopy(request.get("asr")),
                "cam": deepcopy(request.get("cam")),
                "credentials": deepcopy(request.get("credentials") or {}),
            }
            validate_config(candidate)
            self._write(candidate)
            self._state = candidate
        return self.view()

    def _write(self, value: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix="runtime-", suffix=".json", dir=self.path.parent)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                json.dump(value, stream, ensure_ascii=False, indent=2)
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, self.path)
            os.chmod(self.path, 0o600)
        except Exception:
            try:
                os.unlink(temporary)
            except FileNotFoundError:
                pass
            raise
