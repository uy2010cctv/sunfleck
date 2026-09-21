#!/usr/bin/env python3
"""Authenticated recorder gateway with server-owned per-user transcript isolation."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

LISTEN = ("0.0.0.0", int(os.environ.get("RECORDER_GATEWAY_PORT", "18765")))
UPSTREAM = os.environ.get("RECORDER_ASR_UPSTREAM", "http://127.0.0.1:8765/v1/transcribe_segments")
SPEAKER_ENROLL_UPSTREAM = os.environ.get(
    "RECORDER_SPEAKER_ENROLL_UPSTREAM", UPSTREAM.rsplit("/v1/", 1)[0] + "/v1/speaker/enroll"
)
REGISTRY_PATH = Path(os.environ.get("RECORDER_TOKEN_REGISTRY", "/home/recorder/users.json"))
TRANSCRIPT_DIR = Path(os.environ.get("RECORDER_TRANSCRIPT_DIR", "/home/recorder/transcripts"))
LEDGER_PATH = Path(os.environ.get("RECORDER_SEGMENT_LEDGER", str(TRANSCRIPT_DIR / "segment-ledger.sqlite3")))
ASR_TOKEN = os.environ.get("ASR_AUTH_TOKEN", "").strip()
DSH_BINDING_UPSTREAM = os.environ.get("DSH_RECORDER_BINDING_UPSTREAM", "http://127.0.0.1:3081/device-agent/v1/recorder/bind")
DSH_BINDING_TOKEN = os.environ.get("DSH_RECORDER_BINDING_TOKEN", "").strip()
DSH_RECORDER_ADMIN_TOKEN = os.environ.get("DSH_RECORDER_ADMIN_TOKEN", "").strip()
ASR_RUNTIME_UPSTREAM = os.environ.get("RECORDER_ASR_RUNTIME_UPSTREAM", UPSTREAM.rsplit("/v1/", 1)[0] + "/v1/admin/runtime")
MAX_BODY = 8 * 1024 * 1024
IDENTIFIER = re.compile(r"^[A-Za-z0-9._:-]{1,200}$")


class Unauthorized(Exception):
    pass


class Forbidden(Exception):
    pass


class IdempotencyConflict(Exception):
    """A stable segment id was reused for different audio."""


def _segment_id(segment: dict) -> str:
    supplied = str(segment.get("segment_id", "")).strip()
    if supplied:
        if not IDENTIFIER.fullmatch(supplied):
            raise ValueError("segment_id must be a safe stable identifier")
        return supplied
    material = {
        "device_sn": segment.get("device_sn"),
        "start_ts": segment.get("start_ts"),
        "end_ts": segment.get("end_ts"),
        "pcm_b64": segment.get("pcm_b64"),
    }
    return "seg-" + hashlib.sha256(json.dumps(material, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:32]


def _segment_fingerprint(segment: dict) -> str:
    return hashlib.sha256(json.dumps(segment, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class SegmentLedger:
    """Durable per-user idempotency ledger for transcript segments."""

    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS segment (org_id TEXT NOT NULL, user_id TEXT NOT NULL, segment_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY(org_id, user_id, segment_id))")

    def get(self, org_id: str, user_id: str, segment_id: str, segment: dict) -> dict | None:
        fingerprint = _segment_fingerprint(segment)
        with sqlite3.connect(self.path) as db:
            row = db.execute("SELECT fingerprint, result_json FROM segment WHERE org_id=? AND user_id=? AND segment_id=?", (org_id, user_id, segment_id)).fetchone()
        if row is None:
            return None
        if row[0] != fingerprint:
            raise IdempotencyConflict(f"segment_id already belongs to different content: {segment_id}")
        return json.loads(row[1])

    def put(self, org_id: str, user_id: str, segment_id: str, segment: dict, result: dict) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT OR REPLACE INTO segment(org_id,user_id,segment_id,fingerprint,result_json) VALUES(?,?,?,?,?)", (org_id, user_id, segment_id, _segment_fingerprint(segment), json.dumps(result, ensure_ascii=False, sort_keys=True)))


_registry_lock = threading.Lock()


def store_bound_identity(path: Path, *, credential: str, org_id: str, user_id: str,
                         display_name: str, device_sn: str) -> None:
    """Atomically persist one DSH-attested recorder credential without plaintext secrets."""
    digest = hashlib.sha256(credential.encode("utf-8")).hexdigest()
    with _registry_lock:
        data = json.loads(path.read_text(encoding="utf-8"))
        rows = data.get("tokens")
        if data.get("version") != 1 or not isinstance(rows, list):
            raise ValueError("recorder token registry must be version 1")
        for row in rows:
            if device_sn in row.get("device_sns", []) and (row.get("org_id"), row.get("user_id")) != (org_id, user_id):
                raise IdempotencyConflict("recorder is already assigned to another user")
        existing = next((row for row in rows if row.get("token_sha256") == digest), None)
        if existing is None:
            rows.append({
                "token_sha256": digest, "org_id": org_id, "user_id": user_id,
                "display_name": display_name or user_id, "device_sns": [device_sn],
            })
        else:
            existing["device_sns"] = list(dict.fromkeys([*existing.get("device_sns", []), device_sn]))
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.chmod(0o600)
        temporary.replace(path)


@dataclass(frozen=True)
class Identity:
    org_id: str
    user_id: str
    display_name: str
    device_sns: tuple[str, ...]


def speaker_profile_id(identity: Identity) -> str:
    """Return a stable opaque owner id for the local speaker-profile service."""
    return hashlib.sha256(f"{identity.org_id}\0{identity.user_id}".encode()).hexdigest()


def with_server_identity(payload: dict, identity: Identity) -> dict:
    """Replace every caller-provided speaker owner with the authenticated owner."""
    return {**payload, "speaker_profile_id": speaker_profile_id(identity)}


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
    archived_segments = []
    for segment in payload.get("segments", []):
        if not isinstance(segment, dict):
            continue
        archived = dict(segment)
        audio = archived.pop("pcm_b64", None)
        if isinstance(audio, str):
            archived["audio_sha256"] = hashlib.sha256(audio.encode("utf-8")).hexdigest()
        archived_segments.append(archived)
    record = {
        "received_at": time.time() if received_at is None else received_at,
        "owner_org_id": identity.org_id,
        "owner_user_id": identity.user_id,
        "owner_display_name": identity.display_name,
        "device_sn": payload.get("device_sn"),
        "payload": archived_segments,
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


def admin_token_ok(supplied: str | None, expected: str = DSH_RECORDER_ADMIN_TOKEN) -> bool:
    if supplied is None or not expected:
        return False
    left, right = supplied.encode(), expected.encode()
    return len(left) == len(right) and hmac.compare_digest(left, right)


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
        elif self.path == "/v1/admin/runtime":
            self._proxy_runtime("GET", "")
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:
        if not rate_ok(self.client_address[0]):
            self._json(429, {"error": "rate limited"})
            return
        if self.path == "/v1/bind_recorder":
            self._bind_recorder()
            return
        if self.path == "/v1/speaker/enroll":
            self._enroll_speaker()
            return
        if self.path == "/v1/admin/runtime/configure":
            self._proxy_runtime("POST", "/configure")
            return
        if self.path == "/v1/admin/runtime/start":
            self._proxy_runtime("POST", "/start")
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
            segments = payload.get("segments")
            if not isinstance(segments, list) or any(not isinstance(item, dict) for item in segments):
                raise ValueError("segments must be a list of objects")
            normalized_segments = []
            for segment in segments:
                normalized = dict(segment)
                normalized["segment_id"] = _segment_id(normalized)
                normalized_segments.append(normalized)
            payload["segments"] = normalized_segments
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

        ledger = SegmentLedger(LEDGER_PATH)
        cached: dict[str, dict] = {}
        pending: list[dict] = []
        try:
            for segment in payload["segments"]:
                segment_id = segment["segment_id"]
                previous = ledger.get(identity.org_id, identity.user_id, segment_id, segment)
                if previous is None:
                    pending.append(segment)
                else:
                    cached[segment_id] = previous
        except IdempotencyConflict as error:
            self._json(409, {"error": str(error)})
            return

        if not pending:
            self._json(200, {"results": [cached[item["segment_id"]] for item in payload["segments"]]})
            return

        upstream_payload = with_server_identity(payload, identity)
        upstream_payload["segments"] = pending
        upstream_body = json.dumps(upstream_payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            UPSTREAM,
            data=upstream_body,
            method="POST",
            headers={"content-type": "application/json", "X-Auth-Token": ASR_TOKEN},
        )
        try:
            with urllib.request.urlopen(request, timeout=130) as response:
                response_body = response.read()
                code = response.status
            result = json.loads(response_body.decode("utf-8", "replace"))
            upstream_results = result.get("results", [])
            if not isinstance(upstream_results, list):
                raise ValueError("upstream results must be a list")
            for index, segment in enumerate(pending):
                if index >= len(upstream_results):
                    break
                row = dict(upstream_results[index])
                row["segment_id"] = segment["segment_id"]
                row.setdefault("device_sn", device_sn)
                cached[segment["segment_id"]] = row
                ledger.put(identity.org_id, identity.user_id, segment["segment_id"], segment, row)
            result = {"results": [cached[item["segment_id"]] for item in payload["segments"] if item["segment_id"] in cached]}
            append_transcript(TRANSCRIPT_DIR, identity, time.strftime("%Y%m%d"), {**payload, "segments": pending}, result)
        except IdempotencyConflict as error:
            self._json(409, {"error": str(error)})
            return
        except Exception as error:
            self._json(502, {"error": f"upstream: {error}"})
            return
        self._json(code, result)

    def _enroll_speaker(self) -> None:
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > MAX_BODY:
                raise ValueError("body size invalid")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("body must be an object")
            device_sn = str(payload.get("device_sn", ""))
            pcm_b64 = payload.get("pcm_b64")
            if not isinstance(pcm_b64, str) or not pcm_b64:
                raise ValueError("pcm_b64 is required")
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
        request_body = json.dumps({
            "profile_id": speaker_profile_id(identity), "pcm_b64": pcm_b64,
        }, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            SPEAKER_ENROLL_UPSTREAM, data=request_body, method="POST",
            headers={"content-type": "application/json", "X-Auth-Token": ASR_TOKEN},
        )
        try:
            with urllib.request.urlopen(request, timeout=130) as response:
                result = json.loads(response.read().decode("utf-8", "replace"))
                self._json(response.status, result)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:500]
            self._json(error.code, {"error": detail})
        except Exception as error:
            self._json(502, {"error": f"upstream: {error}"})

    def _proxy_runtime(self, method: str, suffix: str) -> None:
        if not admin_token_ok(self.headers.get("X-DSH-Recorder-Admin-Token")):
            self._json(401, {"error": "recorder admin authentication failed"})
            return
        body = None
        if method == "POST":
            try:
                length = int(self.headers.get("content-length", "0"))
            except ValueError:
                length = 0
            if length <= 0 or length > 64 * 1024:
                self._json(413, {"error": "body size invalid"})
                return
            body = self.rfile.read(length)
        request = urllib.request.Request(
            ASR_RUNTIME_UPSTREAM + suffix, data=body, method=method,
            headers={"content-type": "application/json", "X-Auth-Token": ASR_TOKEN},
        )
        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                value = json.loads(response.read().decode("utf-8", "replace"))
                self._json(response.status, value)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:500]
            self._json(error.code, {"error": detail})
        except Exception as error:
            self._json(502, {"error": f"upstream: {error}"})

    def _bind_recorder(self) -> None:
        if not DSH_BINDING_TOKEN:
            self._json(503, {"error": "recorder binding unavailable"})
            return
        try:
            length = int(self.headers.get("content-length", "0"))
            if length <= 0 or length > 64 * 1024:
                raise ValueError("body size invalid")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            if not isinstance(payload, dict):
                raise ValueError("body must be an object")
            request_body = json.dumps({
                "code": payload.get("code"),
                "recorderSerial": payload.get("device_sn"), "relayPublicKey": payload.get("relay_public_key"),
                "deviceName": payload.get("device_name") or "录音卡",
            }, ensure_ascii=False).encode("utf-8")
            request = urllib.request.Request(DSH_BINDING_UPSTREAM, data=request_body, method="POST", headers={
                "content-type": "application/json", "X-DSH-Recorder-Binding-Token": DSH_BINDING_TOKEN,
            })
            with urllib.request.urlopen(request, timeout=10) as response:
                result = json.loads(response.read().decode("utf-8"))
                code = response.status
            store_bound_identity(
                REGISTRY_PATH, credential=str(result["credential"]), org_id=str(result["orgId"]),
                user_id=str(result["userId"]), display_name=str(result.get("displayName", result["userId"])),
                device_sn=str(payload.get("device_sn", "")),
            )
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:500]
            self._json(error.code, {"error": detail})
            return
        except (KeyError, OSError, ValueError, json.JSONDecodeError) as error:
            self._json(400, {"error": str(error)})
            return
        self._json(code, {"recorder_id": result["recorderId"], "credential": result["credential"]})


def main() -> None:
    if not ASR_TOKEN:
        raise SystemExit("ASR_AUTH_TOKEN is required")
    load_token_registry()
    TRANSCRIPT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[gateway] listening on {LISTEN}, per-user transcripts -> {TRANSCRIPT_DIR}", flush=True)
    ThreadingHTTPServer(LISTEN, Handler).serve_forever()


if __name__ == "__main__":
    main()
