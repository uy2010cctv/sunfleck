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


class WorkerState:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS completed_v2(org_id TEXT NOT NULL, user_id TEXT NOT NULL, segment_id TEXT NOT NULL, completed_at REAL NOT NULL, PRIMARY KEY(org_id, user_id, segment_id))")
            db.execute("CREATE TABLE IF NOT EXISTS quarantined(source_hash TEXT PRIMARY KEY, reason TEXT NOT NULL, quarantined_at REAL NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS processed_v1(org_id TEXT NOT NULL, user_id TEXT NOT NULL, segment_id TEXT NOT NULL, processed_at REAL NOT NULL, PRIMARY KEY(org_id, user_id, segment_id))")

    def done(self, org_id: str, user_id: str, segment_id: str) -> bool:
        with sqlite3.connect(self.path) as db:
            return db.execute(
                "SELECT 1 FROM completed_v2 WHERE org_id=? AND user_id=? AND segment_id=?",
                (org_id, user_id, segment_id),
            ).fetchone() is not None

    def mark_done(self, org_id: str, user_id: str, segment_id: str) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT OR IGNORE INTO completed_v2(org_id, user_id, segment_id, completed_at) VALUES(?,?,?,?)",
                (org_id, user_id, segment_id, time.time()),
            )

    def is_quarantined(self, source_hash: str) -> bool:
        with sqlite3.connect(self.path) as db:
            return db.execute("SELECT 1 FROM quarantined WHERE source_hash=?", (source_hash,)).fetchone() is not None

    def quarantine(self, source_hash: str, reason: str) -> None:
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT OR IGNORE INTO quarantined(source_hash, reason, quarantined_at) VALUES(?,?,?)",
                (source_hash, reason[:500], time.time()),
            )

    def processed(self, org_id: str, user_id: str, segment_id: str) -> bool:
        with sqlite3.connect(self.path) as db:
            return db.execute(
                "SELECT 1 FROM processed_v1 WHERE org_id=? AND user_id=? AND segment_id=?",
                (org_id, user_id, segment_id),
            ).fetchone() is not None

    def mark_processed(self, org_id: str, user_id: str, segment_ids: list[str]) -> None:
        with sqlite3.connect(self.path) as db:
            db.executemany(
                "INSERT OR IGNORE INTO processed_v1(org_id, user_id, segment_id, processed_at) VALUES(?,?,?,?)",
                [(org_id, user_id, segment_id, time.time()) for segment_id in segment_ids],
            )


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
    by_owner: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for path in sorted(transcript_dir.glob("**/*.jsonl")):
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            source_hash = hashlib.sha256(line.encode("utf-8")).hexdigest()
            if state.is_quarantined(source_hash):
                continue
            try:
                record = json.loads(line)
                payloads = build_ingest_requests(record)
            except (json.JSONDecodeError, ValueError) as error:
                state.quarantine(source_hash, str(error))
                failed += 1
                continue
            for payload in payloads:
                owner = (payload["orgId"], payload["userId"])
                by_owner.setdefault(owner, []).append(payload)
                if not state.done(*owner, payload["segmentId"]):
                    try:
                        status = _post(payload)
                        if status not in (200, 202):
                            raise RuntimeError(f"DSH recorder route returned {status}")
                        state.mark_done(*owner, payload["segmentId"])
                        sent += 1
                    except Exception:
                        failed += 1
    for (org_id, user_id), rows in by_owner.items():
        pending = [row for row in rows if state.done(org_id, user_id, row["segmentId"])
                   and not state.processed(org_id, user_id, row["segmentId"])]
        if not pending:
            continue
        newest = max(float(row.get("endTs") or 0) for row in pending)
        context = [row for row in rows if newest - 120 <= float(row.get("endTs") or 0) <= newest]
        new_ids = {row["segmentId"] for row in pending}
        process_payload = {
            "orgId": org_id, "userId": user_id,
            "segments": [{
                "segmentId": row["segmentId"], "startTs": row.get("startTs"), "endTs": row.get("endTs"),
                "text": row["text"], "speaker": row.get("speaker") or "unknown",
                "isNew": row["segmentId"] in new_ids,
            } for row in context[-40:]],
        }
        try:
            if _post_process(process_payload) not in (200, 202):
                raise RuntimeError("DSH recorder processing route failed")
            state.mark_processed(org_id, user_id, list(new_ids))
        except Exception:
            failed += 1
    return sent, failed


def main() -> None:
    while True:
        sent, failed = run_once()
        if sent or failed:
            print(f"[recorder-memory] sent={sent} failed={failed}", flush=True)
        time.sleep(float(os.environ.get("RECORDER_MEMORY_POLL_SECONDS", "1")))


if __name__ == "__main__":
    main()
