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
            self.addCleanup(state.close)
            self.assertFalse(state.done("org-a", "alice", "s1"))
            state.mark_done("org-a", "alice", "s1")
            self.assertTrue(state.done("org-a", "alice", "s1"))
            self.assertFalse(state.done("org-a", "bob", "s1"))
            self.assertFalse(state.processed("org-a", "alice", "s1"))
            state.mark_processed("org-a", "alice", ["s1"])
            self.assertTrue(state.processed("org-a", "alice", "s1"))

    def test_legacy_ack_is_replayed_once_into_the_new_index(self):
        with tempfile.TemporaryDirectory() as directory:
            state = worker.WorkerState(Path(directory) / "state.sqlite3")
            self.addCleanup(state.close)
            payload = {"orgId": "org-a", "userId": "alice", "segmentId": "s1",
                       "startTs": 1, "endTs": 2, "text": "legacy", "speaker": "unknown"}
            state.mark_done("org-a", "alice", "s1")
            state.remember(payload)
            self.assertEqual([row["segmentId"] for row in state.pending_ingest()], ["s1"])
            state.mark_indexed("org-a", "alice", "s1")
            self.assertEqual(state.pending_ingest(), [])

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
            self.addCleanup(state.close)
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
            self.addCleanup(state.close)
            state.mark_done("org-a", "alice", "old")
            state.mark_indexed("org-a", "alice", "old")
            state.mark_processed("org-a", "alice", ["old"])
            process = unittest.mock.Mock(return_value=200)
            with patch.object(worker, "_post", return_value=200), patch.object(worker, "_post_process", process):
                self.assertEqual(worker.run_once(root, state), (1, 0))
            payload = process.call_args.args[0]
            self.assertEqual([row["segmentId"] for row in payload["segments"]], ["old", "new"])
            self.assertEqual([row["isNew"] for row in payload["segments"]], [False, True])
            self.assertTrue(state.processed("org-a", "alice", "new"))

    def test_backlog_marks_only_segments_in_the_submitted_window(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            rows = [
                {"segment_id": f"s{i:02d}", "start_ts": i * 10, "end_ts": i * 10 + 5,
                 "text": f"segment {i}", "speaker": "self"}
                for i in range(50)
            ]
            (root / "records.jsonl").write_text(json.dumps({
                "owner_org_id": "org-a", "owner_user_id": "alice", "device_sn": "CB08",
                "result": {"results": rows},
            }) + "\n")
            state = worker.WorkerState(root / "state.sqlite3")
            self.addCleanup(state.close)
            process = unittest.mock.Mock(return_value=200)
            with patch.object(worker, "_post", return_value=200), patch.object(worker, "_post_process", process):
                worker.run_once(root, state)
            submitted = {row["segmentId"] for row in process.call_args.args[0]["segments"] if row["isNew"]}
            self.assertGreater(len(submitted), 0)
            self.assertLessEqual(len(submitted), 40)
            for row in rows:
                self.assertEqual(state.processed("org-a", "alice", row["segment_id"]), row["segment_id"] in submitted)

    def test_second_poll_reads_only_lines_appended_after_the_file_cursor(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            transcript = root / "records.jsonl"
            def record(segment_id):
                return json.dumps({
                    "owner_org_id": "org-a", "owner_user_id": "alice", "device_sn": "CB08",
                    "result": {"results": [{"segment_id": segment_id, "start_ts": 1, "end_ts": 2,
                                              "text": segment_id, "speaker": "self"}]},
                }) + "\n"
            transcript.write_text(record("s1"))
            state = worker.WorkerState(root / "state.sqlite3")
            self.addCleanup(state.close)
            original = worker.build_ingest_requests
            build = unittest.mock.Mock(side_effect=original)
            with patch.object(worker, "build_ingest_requests", build), \
                    patch.object(worker, "_post", return_value=200), \
                    patch.object(worker, "_post_process", return_value=200):
                worker.run_once(root, state)
                self.assertEqual(build.call_count, 1)
                worker.run_once(root, state)
                self.assertEqual(build.call_count, 1)
                with transcript.open("a") as stream:
                    stream.write(record("s2"))
                worker.run_once(root, state)
                self.assertEqual(build.call_count, 2)


if __name__ == "__main__":
    unittest.main()
