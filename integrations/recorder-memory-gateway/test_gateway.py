import hashlib
import json
import tempfile
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gateway


class GatewayIdentityTests(unittest.TestCase):
    def setUp(self):
        self.token = "alice-secret"
        self.registry = {
            hashlib.sha256(self.token.encode()).hexdigest(): gateway.Identity(
                org_id="org-a", user_id="alice", display_name="Alice", device_sns=("CB08",),
            )
        }

    def test_token_selects_server_owned_identity(self):
        identity = gateway.resolve_identity(self.token, self.registry, "CB08")
        self.assertEqual(identity.user_id, "alice")
        self.assertEqual(identity.org_id, "org-a")

    def test_wrong_token_and_foreign_device_fail_closed(self):
        with self.assertRaises(gateway.Unauthorized):
            gateway.resolve_identity("wrong", self.registry, "CB08")
        with self.assertRaises(gateway.Forbidden):
            gateway.resolve_identity(self.token, self.registry, "BOB-DEVICE")

    def test_transcripts_are_partitioned_by_org_and_user(self):
        with tempfile.TemporaryDirectory() as directory:
            path = gateway.append_transcript(
                Path(directory),
                self.registry[hashlib.sha256(self.token.encode()).hexdigest()],
                "20260920",
                {"device_sn": "CB08", "segments": []},
                {"results": [{"text": "private"}]},
                received_at=1.0,
            )
            self.assertEqual(path.relative_to(directory).as_posix(), "org-a/alice/20260920.jsonl")
            record = json.loads(path.read_text().strip())
            self.assertEqual(record["owner_user_id"], "alice")
            self.assertEqual(record["owner_org_id"], "org-a")


if __name__ == "__main__":
    unittest.main()
