import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import recorder_memory_worker as worker


class RecorderMemoryWorkerTests(unittest.TestCase):
    def test_build_request_preserves_owner_source_and_speaker(self):
        record = {
            "owner_org_id": "org-a", "owner_user_id": "alice",
            "device_sn": "CB08",
            "payload": [{"segment_id": "s1", "start_ts": 10, "end_ts": 11}],
            "result": {"results": [{"segment_id": "s1", "text": "你好", "speaker": "spk_0"}]},
        }
        request = worker.build_ingest_requests(record)[0]
        self.assertEqual(request["orgId"], "org-a")
        self.assertEqual(request["userId"], "alice")
        self.assertEqual(request["segmentId"], "s1")
        self.assertEqual(request["speaker"], "spk_0")

    def test_cursor_state_prevents_replaying_acked_segment(self):
        with tempfile.TemporaryDirectory() as directory:
            state = worker.WorkerState(Path(directory) / "state.sqlite3")
            self.assertFalse(state.done("org-a", "alice", "s1"))
            state.mark_done("org-a", "alice", "s1")
            self.assertTrue(state.done("org-a", "alice", "s1"))
            self.assertFalse(state.done("org-a", "bob", "s1"))
            self.assertFalse(state.processed("org-a", "alice", "s1"))
            state.mark_processed("org-a", "alice", ["s1"])
            self.assertTrue(state.processed("org-a", "alice", "s1"))

    def test_unowned_history_is_quarantined_without_blocking_owned_segments(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcript = root / "records.jsonl"
            transcript.write_text("\n".join([
                json.dumps({"result": {"results": [{"segment_id": "legacy", "text": "unknown owner"}]}}),
                json.dumps({
                    "owner_org_id": "org-a", "owner_user_id": "alice", "device_sn": "CB08",
                    "result": {"results": [{"segment_id": "s1", "text": "owned"}]},
                }),
            ]) + "\n")
            state = worker.WorkerState(root / "state.sqlite3")
            with patch.object(worker, "_post", return_value=200), \
                    patch.object(worker, "_post_process", return_value=200):
                self.assertEqual(worker.run_once(root, state), (1, 1))
                self.assertEqual(worker.run_once(root, state), (0, 0))

    def test_processing_uses_recent_context_and_marks_only_new_segments(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcript = root / "records.jsonl"
            transcript.write_text(json.dumps({
                "owner_org_id": "org-a", "owner_user_id": "alice", "device_sn": "CB08",
                "result": {"results": [
                    {"segment_id": "old", "start_ts": 100, "end_ts": 101, "text": "上下文", "speaker": "self"},
                    {"segment_id": "new", "start_ts": 150, "end_ts": 151, "text": "新内容", "speaker": "self"},
                ]},
            }) + "\n")
            state = worker.WorkerState(root / "state.sqlite3")
            state.mark_done("org-a", "alice", "old")
            state.mark_processed("org-a", "alice", ["old"])
            process = unittest.mock.Mock(return_value=200)
            with patch.object(worker, "_post", return_value=200), patch.object(worker, "_post_process", process):
                self.assertEqual(worker.run_once(root, state), (1, 0))
            payload = process.call_args.args[0]
            self.assertEqual([row["segmentId"] for row in payload["segments"]], ["old", "new"])
            self.assertEqual([row["isNew"] for row in payload["segments"]], [False, True])
            self.assertTrue(state.processed("org-a", "alice", "new"))


if __name__ == "__main__":
    unittest.main()
