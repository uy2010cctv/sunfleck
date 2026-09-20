#!/usr/bin/env python3
"""Authenticated recorder gateway with server-owned per-user transcript isolation."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import threading
import time
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

LISTEN = ("0.0.0.0", int(os.environ.get("RECORDER_GATEWAY_PORT", "18765")))
UPSTREAM = os.environ.get("RECORDER_ASR_UPSTREAM", "http://127.0.0.1:8765/v1/transcribe_segments")
REGISTRY_PATH = Path(os.environ.get("RECORDER_TOKEN_REGISTRY", "/home/recorder/users.json"))
TRANSCRIPT_DIR = Path(os.environ.get("RECORDER_TRANSCRIPT_DIR", "/home/recorder/transcripts"))
ASR_TOKEN = os.environ.get("ASR_AUTH_TOKEN", "").strip()
MAX_BODY = 8 * 1024 * 1024
IDENTIFIER = re.compile(r"^[A-Za-z0-9._:-]{1,200}$")


class Unauthorized(Exception):
    pass


class Forbidden(Exception):
    pass


@dataclass(frozen=True)
class Identity:
    org_id: str
    user_id: str
    display_name: str
    device_sns: tuple[str, ...]


def load_token_registry(path: Path = REGISTRY_PATH) -> dict[str, Identity]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("version") != 1 or not isinstance(data.get("tokens"), list):
        raise ValueError("recorder token registry must be version 1")
    registry: dict[str, Identity] = {}
    for row in data["tokens"]:
        digest = str(row.get("token_sha256", "")).lower()
        org_id = str(row.get("org_id", ""))
        user_id = str(row.get("user_id", ""))
        if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
            raise ValueError("token_sha256 must be a lowercase SHA-256 hex digest")
        if not IDENTIFIER.fullmatch(org_id) or not IDENTIFIER.fullmatch(user_id):
            raise ValueError("org_id and user_id must be safe stable identifiers")
        devices = tuple(str(value) for value in row.get("device_sns", []))
        if not devices or any(not IDENTIFIER.fullmatch(value) for value in devices):
            raise ValueError("each recorder identity requires safe device_sns")
        if digest in registry:
            raise ValueError("duplicate recorder token digest")
        registry[digest] = Identity(
            org_id=org_id,
            user_id=user_id,
            display_name=str(row.get("display_name", user_id)),
            device_sns=devices,
        )
    return registry


def resolve_identity(token: str | None, registry: dict[str, Identity], device_sn: str) -> Identity:
    if token is None or token == "":
        raise Unauthorized("missing token")
    supplied = hashlib.sha256(token.encode("utf-8")).hexdigest()
    identity = next((value for digest, value in registry.items() if hmac.compare_digest(digest, supplied)), None)
    if identity is None:
        raise Unauthorized("invalid token")
    if device_sn not in identity.device_sns:
        raise Forbidden("device is not assigned to this user")
    return identity


def append_transcript(
    root: Path,
    identity: Identity,
    day: str,
    payload: dict,
    result: dict,
    *,
    received_at: float | None = None,
) -> Path:
    if not re.fullmatch(r"\d{8}", day):
        raise ValueError("day must be YYYYMMDD")
    target = root / identity.org_id / identity.user_id / f"{day}.jsonl"
    target.parent.mkdir(parents=True, exist_ok=True)
    record = {
        "received_at": time.time() if received_at is None else received_at,
        "owner_org_id": identity.org_id,
        "owner_user_id": identity.user_id,
        "owner_display_name": identity.display_name,
        "device_sn": payload.get("device_sn"),
        "payload": payload.get("segments", []),
        "result": result,
    }
    with target.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    return target


_rate: dict[str, list[float]] = defaultdict(list)
_rate_lock = threading.Lock()


def rate_ok(ip: str) -> bool:
    now = time.time()
    with _rate_lock:
        window = [stamp for stamp in _rate[ip] if now - stamp < 60]
        _rate[ip] = window
        if len(window) >= 60:
            return False
        window.append(now)
        return True


class Handler(BaseHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        pass

    def _json(self, code: int, value: dict) -> None:
        body = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json(200, {"ok": True, "upstream": UPSTREAM, "identity_registry": REGISTRY_PATH.exists()})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if not rate_ok(self.client_address[0]):
            self._json(429, {"error": "rate limited"})
            return
        if self.path != "/v1/transcribe_segments":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            self._json(413, {"error": "body size invalid"})
            return
        try:
            body = self.rfile.read(length)
            payload = json.loads(body.decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("body must be an object")
            device_sn = str(payload.get("device_sn", ""))
            identity = resolve_identity(self.headers.get("X-Auth-Token"), load_token_registry(), device_sn)
        except Unauthorized:
            self._json(401, {"error": "unauthorized"})
            return
        except Forbidden as error:
            self._json(403, {"error": str(error)})
            return
        except (ValueError, OSError, json.JSONDecodeError) as error:
            self._json(400, {"error": str(error)})
            return

        request = urllib.request.Request(
            UPSTREAM,
            data=body,
            method="POST",
            headers={"content-type": "application/json", "X-Auth-Token": ASR_TOKEN},
        )
        try:
            with urllib.request.urlopen(request, timeout=130) as response:
                response_body = response.read()
                code = response.status
            result = json.loads(response_body.decode("utf-8", "replace"))
            append_transcript(TRANSCRIPT_DIR, identity, time.strftime("%Y%m%d"), payload, result)
        except Exception as error:
            self._json(502, {"error": f"upstream: {error}"})
            return
        self._json(code, result)


def main() -> None:
    if not ASR_TOKEN:
        raise SystemExit("ASR_AUTH_TOKEN is required")
    load_token_registry()
    TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[gateway] listening on {LISTEN}, per-user transcripts -> {TRANSCRIPT_DIR}", flush=True)
    ThreadingHTTPServer(LISTEN, Handler).serve_forever()


if __name__ == "__main__":
    main()
