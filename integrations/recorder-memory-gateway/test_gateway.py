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

    def test_speaker_profile_id_is_stable_and_does_not_expose_owner(self):
        identity = self.registry[hashlib.sha256(self.token.encode()).hexdigest()]
        profile_id = gateway.speaker_profile_id(identity)
        self.assertEqual(profile_id, gateway.speaker_profile_id(identity))
        self.assertEqual(len(profile_id), 64)
        self.assertNotIn("alice", profile_id)

    def test_asr_payload_replaces_phone_supplied_speaker_owner(self):
        identity = self.registry[hashlib.sha256(self.token.encode()).hexdigest()]
        payload = gateway.with_server_identity({"speaker_profile_id": "attacker", "segments": []}, identity)
        self.assertEqual(payload["speaker_profile_id"], gateway.speaker_profile_id(identity))

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

    def test_segment_ledger_replays_same_payload_and_rejects_conflict(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = gateway.SegmentLedger(Path(directory) / "ledger.sqlite3")
            first = {"segment_id": "s1", "pcm_b64": "YWJj", "start_ts": 1, "end_ts": 2}
            result = {"text": "你好", "start_ts": 1, "end_ts": 2}
            self.assertIsNone(ledger.get("org-a", "alice", "s1", first))
            ledger.put("org-a", "alice", "s1", first, result)
            self.assertEqual(ledger.get("org-a", "alice", "s1", first), result)
            with self.assertRaises(gateway.IdempotencyConflict):
                ledger.get("org-a", "alice", "s1", {**first, "pcm_b64": "eA=="})

    def test_transcript_archive_does_not_store_pcm_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            path = gateway.append_transcript(
                Path(directory), self.registry[next(iter(self.registry))], "20260920",
                {"device_sn": "CB08", "segments": [{"segment_id": "s1", "pcm_b64": "secret-audio", "start_ts": 1, "end_ts": 2}]},
                {"results": [{"segment_id": "s1", "text": "private"}]}, received_at=1.0,
            )
            record = json.loads(path.read_text().strip())
            self.assertNotIn("pcm_b64", record["payload"][0])
            self.assertEqual(record["payload"][0]["audio_sha256"], hashlib.sha256(b"secret-audio").hexdigest())

    def test_bound_recorder_credential_is_stored_under_server_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            registry = Path(directory) / "users.json"
            registry.write_text(json.dumps({"version": 1, "tokens": []}))
            gateway.store_bound_identity(
                registry, credential="device-secret", org_id="org-a", user_id="alice",
                display_name="Alice", device_sn="SD-1",
            )
            saved = json.loads(registry.read_text())
            self.assertEqual(saved["tokens"][0]["token_sha256"], hashlib.sha256(b"device-secret").hexdigest())
            self.assertEqual(saved["tokens"][0]["device_sns"], ["SD-1"])
            self.assertNotIn("device-secret", registry.read_text())


if __name__ == "__main__":
    unittest.main()
