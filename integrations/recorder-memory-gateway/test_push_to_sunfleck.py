import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import push_to_sunfleck as push


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


if __name__ == "__main__":
    unittest.main()
