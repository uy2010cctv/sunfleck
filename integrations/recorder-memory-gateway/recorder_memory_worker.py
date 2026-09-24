#!/usr/bin/env python3
"""Durable bridge from gateway transcripts to the DSH private recorder route."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
import urllib.request
from pathlib import Path
from typing import Any

TRANSCRIPT_DIR = Path(os.environ.get("RECORDER_TRANSCRIPT_DIR", "/home/recorder/transcripts"))
DSH_URL = os.environ.get("DSH_RECORDER_URL", "http://127.0.0.1:3081/recorder-memory/ingest")
DSH_PROCESS_URL = os.environ.get("DSH_RECORDER_PROCESS_URL", DSH_URL.rsplit("/", 1)[0] + "/process")
DSH_TOKEN = os.environ.get("DSH_RECORDER_INGEST_TOKEN", "").strip()
STATE_PATH = Path(os.environ.get("RECORDER_MEMORY_STATE", "/home/recorder/recorder-memory-worker.sqlite3"))
CONTEXT_SECONDS = max(10.0, min(600.0, float(os.environ.get("RECORDER_MEMORY_CONTEXT_SECONDS", "120"))))
PROCESS_BATCH_SIZE = max(1, min(40, int(os.environ.get("RECORDER_MEMORY_PROCESS_BATCH_SIZE", "20"))))
INGEST_BATCH_SIZE = max(1, min(500, int(os.environ.get("RECORDER_MEMORY_INGEST_BATCH_SIZE", "100"))))


class WorkerState:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        with self.db:
            self.db.execute("CREATE TABLE IF NOT EXISTS completed_v2(org_id TEXT NOT NULL, user_id TEXT NOT NULL, segment_id TEXT NOT NULL, completed_at REAL NOT NULL, PRIMARY KEY(org_id, user_id, segment_id))")
            self.db.execute("CREATE TABLE IF NOT EXISTS quarantined(source_hash TEXT PRIMARY KEY, reason TEXT NOT NULL, quarantined_at REAL NOT NULL)")
            self.db.execute("CREATE TABLE IF NOT EXISTS processed_v1(org_id TEXT NOT NULL, user_id TEXT NOT NULL, segment_id TEXT NOT NULL, processed_at REAL NOT NULL, PRIMARY KEY(org_id, user_id, segment_id))")
            self.db.execute("CREATE TABLE IF NOT EXISTS indexed_v1(org_id TEXT NOT NULL, user_id TEXT NOT NULL, segment_id TEXT NOT NULL, indexed_at REAL NOT NULL, PRIMARY KEY(org_id,user_id,segment_id))")
            self.db.execute("CREATE TABLE IF NOT EXISTS processed_v2(org_id TEXT NOT NULL, user_id TEXT NOT NULL, segment_id TEXT NOT NULL, processed_at REAL NOT NULL, PRIMARY KEY(org_id,user_id,segment_id))")
            self.db.execute("CREATE TABLE IF NOT EXISTS source_cursor_v1(path TEXT PRIMARY KEY, byte_offset INTEGER NOT NULL, updated_at REAL NOT NULL)")
            self.db.execute("""CREATE TABLE IF NOT EXISTS segment_v1(
                org_id TEXT NOT NULL, user_id TEXT NOT NULL, segment_id TEXT NOT NULL,
                start_ts REAL NOT NULL, end_ts REAL NOT NULL, payload_json TEXT NOT NULL,
                PRIMARY KEY(org_id, user_id, segment_id))""")
            self.db.execute("CREATE INDEX IF NOT EXISTS idx_segment_v1_owner_time ON segment_v1(org_id,user_id,start_ts,segment_id)")

    def close(self) -> None:
        self.db.close()

    def __del__(self) -> None:
        try:
            self.db.close()
        except Exception:
            pass

    def done(self, org_id: str, user_id: str, segment_id: str) -> bool:
        return self.db.execute(
            "SELECT 1 FROM completed_v2 WHERE org_id=? AND user_id=? AND segment_id=?",
            (org_id, user_id, segment_id),
        ).fetchone() is not None

    def mark_done(self, org_id: str, user_id: str, segment_id: str) -> None:
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO completed_v2(org_id, user_id, segment_id, completed_at) VALUES(?,?,?,?)",
                (org_id, user_id, segment_id, time.time()),
            )

    def is_quarantined(self, source_hash: str) -> bool:
        return self.db.execute("SELECT 1 FROM quarantined WHERE source_hash=?", (source_hash,)).fetchone() is not None

    def quarantine(self, source_hash: str, reason: str) -> None:
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO quarantined(source_hash, reason, quarantined_at) VALUES(?,?,?)",
                (source_hash, reason[:500], time.time()),
            )

    def processed(self, org_id: str, user_id: str, segment_id: str) -> bool:
        return self.db.execute(
            "SELECT 1 FROM processed_v2 WHERE org_id=? AND user_id=? AND segment_id=?",
            (org_id, user_id, segment_id),
        ).fetchone() is not None

    def mark_processed(self, org_id: str, user_id: str, segment_ids: list[str]) -> None:
        with self.db:
            self.db.executemany(
                "INSERT OR IGNORE INTO processed_v2(org_id, user_id, segment_id, processed_at) VALUES(?,?,?,?)",
                [(org_id, user_id, segment_id, time.time()) for segment_id in segment_ids],
            )

    def mark_indexed(self, org_id: str, user_id: str, segment_id: str) -> None:
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO indexed_v1(org_id,user_id,segment_id,indexed_at) VALUES(?,?,?,?)",
                (org_id, user_id, segment_id, time.time()),
            )

    def source_offset(self, path: Path) -> int:
        row = self.db.execute("SELECT byte_offset FROM source_cursor_v1 WHERE path=?", (str(path),)).fetchone()
        return int(row[0]) if row is not None else 0

    def save_source_offset(self, path: Path, offset: int) -> None:
        with self.db:
            self.db.execute(
                "INSERT INTO source_cursor_v1(path,byte_offset,updated_at) VALUES(?,?,?) ON CONFLICT(path) DO UPDATE SET byte_offset=excluded.byte_offset,updated_at=excluded.updated_at",
                (str(path), offset, time.time()),
            )

    def remember(self, payload: dict[str, Any]) -> None:
        start_ts = float(payload.get("startTs") or 0)
        end_ts = float(payload.get("endTs") or start_ts)
        with self.db:
            self.db.execute(
                "INSERT OR IGNORE INTO segment_v1(org_id,user_id,segment_id,start_ts,end_ts,payload_json) VALUES(?,?,?,?,?,?)",
                (payload["orgId"], payload["userId"], payload["segmentId"], start_ts, end_ts,
                 json.dumps(payload, ensure_ascii=False, sort_keys=True)),
            )

    def owners(self) -> list[tuple[str, str]]:
        return [(str(row[0]), str(row[1])) for row in self.db.execute(
            "SELECT DISTINCT org_id,user_id FROM segment_v1 ORDER BY org_id,user_id"
        )]

    def pending_ingest(self, limit: int = 100) -> list[dict[str, Any]]:
        rows = self.db.execute("""SELECT s.payload_json FROM segment_v1 s
            LEFT JOIN indexed_v1 i ON i.org_id=s.org_id AND i.user_id=s.user_id AND i.segment_id=s.segment_id
            WHERE i.segment_id IS NULL ORDER BY s.start_ts,s.segment_id LIMIT ?""", (limit,)).fetchall()
        return [json.loads(str(row[0])) for row in rows]

    def pending_processing(self, org_id: str, user_id: str, limit: int = 20) -> list[dict[str, Any]]:
        rows = self.db.execute("""SELECT s.payload_json FROM segment_v1 s
            JOIN completed_v2 c ON c.org_id=s.org_id AND c.user_id=s.user_id AND c.segment_id=s.segment_id
            LEFT JOIN processed_v2 p ON p.org_id=s.org_id AND p.user_id=s.user_id AND p.segment_id=s.segment_id
            WHERE s.org_id=? AND s.user_id=? AND p.segment_id IS NULL
            ORDER BY s.start_ts,s.segment_id LIMIT ?""", (org_id, user_id, limit)).fetchall()
        return [json.loads(str(row[0])) for row in rows]

    def context(self, org_id: str, user_id: str, end_ts: float, seconds: float = 120, limit: int = 40) -> list[dict[str, Any]]:
        rows = self.db.execute("""SELECT payload_json FROM segment_v1
            WHERE org_id=? AND user_id=? AND end_ts>=? AND start_ts<=?
            ORDER BY start_ts DESC,segment_id DESC LIMIT ?""",
            (org_id, user_id, end_ts - seconds, end_ts, limit)).fetchall()
        return [json.loads(str(row[0])) for row in reversed(rows)]


def build_ingest_requests(record: dict[str, Any]) -> list[dict[str, Any]]:
    org_id = str(record.get("owner_org_id", "")).strip()
    user_id = str(record.get("owner_user_id", "")).strip()
    if not org_id or not user_id:
        raise ValueError("transcript record has no server-owned identity")
    payload_by_id = {str(item.get("segment_id")): item for item in record.get("payload", []) if isinstance(item, dict) and item.get("segment_id")}
    results = record.get("result", {}).get("results", [])
    out: list[dict[str, Any]] = []
    for result in results if isinstance(results, list) else []:
        if not isinstance(result, dict) or not str(result.get("text", "")).strip():
            continue
        segment_id = str(result.get("segment_id", "")).strip()
        if not segment_id:
            material = json.dumps([record.get("device_sn"), result.get("start_ts"), result.get("end_ts"), result.get("text")], ensure_ascii=False)
            segment_id = "legacy-" + hashlib.sha256(material.encode()).hexdigest()[:32]
        source = payload_by_id.get(segment_id, {})
        out.append({
            "orgId": org_id, "userId": user_id, "segmentId": segment_id,
            "startTs": result.get("start_ts", source.get("start_ts")),
            "endTs": result.get("end_ts", source.get("end_ts")),
            "text": str(result["text"]).strip(),
            "speaker": result.get("speaker") or "unknown",
            "speakers": result.get("speakers", []),
            "deviceSn": record.get("device_sn"),
        })
    return out


def _post(payload: dict[str, Any]) -> int:
    if not DSH_TOKEN:
        raise RuntimeError("DSH_RECORDER_INGEST_TOKEN is required")
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(DSH_URL, data=body, method="POST", headers={
        "content-type": "application/json", "X-Recorder-Ingest-Token": DSH_TOKEN,
    })
    with urllib.request.urlopen(req, timeout=5) as response:
        response.read()
        return response.status


def _post_process(payload: dict[str, Any]) -> int:
    if not DSH_TOKEN:
        raise RuntimeError("DSH_RECORDER_INGEST_TOKEN is required")
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(DSH_PROCESS_URL, data=body, method="POST", headers={
        "content-type": "application/json", "X-Recorder-Ingest-Token": DSH_TOKEN,
    })
    with urllib.request.urlopen(req, timeout=20) as response:
        response.read()
        return response.status


def run_once(transcript_dir: Path = TRANSCRIPT_DIR, state: WorkerState | None = None) -> tuple[int, int]:
    state = state or WorkerState(STATE_PATH)
    sent = failed = 0
    for path in sorted(transcript_dir.glob("**/*.jsonl")):
        size = path.stat().st_size
        offset = state.source_offset(path)
        if offset > size:
            offset = 0
        next_offset = offset
        with path.open("rb") as stream:
            stream.seek(offset)
            while True:
                line_start = stream.tell()
                raw = stream.readline()
                if raw == b"":
                    break
                if not raw.endswith(b"\n"):
                    stream.seek(line_start)
                    break
                try:
                    line = raw.decode("utf-8").strip()
                except UnicodeDecodeError as error:
                    state.quarantine(hashlib.sha256(raw).hexdigest(), str(error))
                    failed += 1
                    next_offset = stream.tell()
                    continue
                if line:
                    source_hash = hashlib.sha256(line.encode("utf-8")).hexdigest()
                    if not state.is_quarantined(source_hash):
                        try:
                            record = json.loads(line)
                            for payload in build_ingest_requests(record):
                                state.remember(payload)
                        except (json.JSONDecodeError, ValueError) as error:
                            state.quarantine(source_hash, str(error))
                            failed += 1
                next_offset = stream.tell()
        if next_offset != offset:
            state.save_source_offset(path, next_offset)

    for payload in state.pending_ingest(INGEST_BATCH_SIZE):
        owner = (payload["orgId"], payload["userId"])
        try:
            status = _post(payload)
            if status not in (200, 202):
                raise RuntimeError(f"DSH recorder route returned {status}")
            state.mark_done(*owner, payload["segmentId"])
            state.mark_indexed(*owner, payload["segmentId"])
            sent += 1
        except Exception:
            failed += 1

    for org_id, user_id in state.owners():
        pending = state.pending_processing(org_id, user_id, PROCESS_BATCH_SIZE)
        if not pending:
            continue
        first_start = float(pending[0].get("startTs") or 0)
        selected = [row for row in pending if float(row.get("startTs") or 0) <= first_start + CONTEXT_SECONDS]
        newest = max(float(row.get("endTs") or 0) for row in selected)
        context = state.context(org_id, user_id, newest, CONTEXT_SECONDS)
        new_ids = {row["segmentId"] for row in selected}
        process_payload = {
            "orgId": org_id, "userId": user_id,
            "segments": [{
                "segmentId": row["segmentId"], "startTs": row.get("startTs"), "endTs": row.get("endTs"),
                "text": row["text"], "speaker": row.get("speaker") or "unknown",
                "isNew": row["segmentId"] in new_ids,
            } for row in context],
        }
        try:
            if _post_process(process_payload) not in (200, 202):
                raise RuntimeError("DSH recorder processing route failed")
            state.mark_processed(org_id, user_id, list(new_ids))
        except Exception:
            failed += 1
    return sent, failed


def main() -> None:
    state = WorkerState(STATE_PATH)
    try:
        while True:
            sent, failed = run_once(state=state)
            if sent or failed:
                print(f"[recorder-memory] sent={sent} failed={failed}", flush=True)
            time.sleep(float(os.environ.get("RECORDER_MEMORY_POLL_SECONDS", "1")))
    finally:
        state.close()


if __name__ == "__main__":
    main()
