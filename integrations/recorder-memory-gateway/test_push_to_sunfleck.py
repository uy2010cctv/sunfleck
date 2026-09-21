import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import push_to_sunfleck as push
import json
import tempfile


class MemoryCardOwnershipTests(unittest.TestCase):
    def test_gateway_record_requires_and_preserves_owner(self):
        payload = {
            "owner_org_id": "org-a",
            "owner_user_id": "alice",
            "owner_display_name": "Alice",
            "result": {"results": [{"start_ts": 1, "end_ts": 2, "text": "private note"}]},
        }
        owner, transcript = push.extract_owned_payload(payload)
        utterances = push.load_utterances(transcript)
        _, card = push.render_card("1970-01-01 00:00", utterances, owner)
        self.assertIn("owner_org_id: org-a", card)
        self.assertIn("owner_user_id: alice", card)

    def test_unowned_transcript_fails_closed(self):
        with self.assertRaises(ValueError):
            push.extract_owned_payload({"results": []})

    def test_jsonl_incremental_windows_merge_without_overwrite(self):
        first = {
            "owner_org_id": "org-a", "owner_user_id": "alice", "owner_display_name": "Alice",
            "result": {"results": [{"segment_id": "s1", "start_ts": 100, "end_ts": 101, "text": "第一句"}]},
        }
        second = {
            "owner_org_id": "org-a", "owner_user_id": "alice", "owner_display_name": "Alice",
            "result": {"results": [{"segment_id": "s2", "start_ts": 110, "end_ts": 111, "text": "第二句"}]},
        }
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "transcripts.jsonl"
            source.write_text(json.dumps(first, ensure_ascii=False) + "\n" + json.dumps(second, ensure_ascii=False) + "\n")
            out = Path(directory) / "cards"
            self.assertEqual(push.main(["--in", str(source), "--out-dir", str(out)]), 0)
            cards = list(out.rglob("*.md"))
            self.assertEqual(len(cards), 1)
            content = cards[0].read_text()
            self.assertIn("第一句", content)
            self.assertIn("第二句", content)

    def test_incremental_write_is_idempotent(self):
        record = {
            "owner_org_id": "org-a", "owner_user_id": "alice",
            "result": {"results": [{"segment_id": "s1", "start_ts": 100, "end_ts": 101, "text": "同一句"}]},
        }
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "one.json"
            source.write_text(json.dumps(record, ensure_ascii=False))
            out = Path(directory) / "cards"
            push.main(["--in", str(source), "--out-dir", str(out)])
            push.main(["--in", str(source), "--out-dir", str(out)])
            content = next(out.rglob("*.md")).read_text()
            self.assertEqual(content.count("同一句"), 1)


if __name__ == "__main__":
    unittest.main()
