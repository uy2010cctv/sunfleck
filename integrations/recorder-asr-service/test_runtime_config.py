import json
import tempfile
import unittest
from pathlib import Path

from runtime_config import RuntimeConfigStore, RuntimeValidationError


class RuntimeConfigStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "runtime.json"
        self.store = RuntimeConfigStore(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def test_default_is_local_and_redacts_credentials(self):
        view = self.store.view()
        self.assertEqual(view["revision"], 0)
        self.assertEqual(view["asr"]["mode"], "local")
        self.assertEqual(view["cam"]["mode"], "local")
        self.assertNotIn("credentials", view)

    def test_save_persists_secret_but_view_only_reports_readiness(self):
        saved = self.store.save({
            "expectedRevision": 0,
            "asr": {"mode": "online", "model": "whisper-1", "endpoint": "https://asr.example/v1/audio/transcriptions", "credentialRef": "asr/main"},
            "cam": {"enabled": True, "mode": "online", "model": "speaker-v1", "endpoint": "https://cam.example/embed", "credentialRef": "cam/main", "matchThreshold": 0.81},
            "credentials": {"asrCredential": "asr-secret", "camCredential": "cam-secret"},
        })
        self.assertEqual(saved["revision"], 1)
        self.assertTrue(saved["credentialReady"])
        self.assertNotIn("asr-secret", json.dumps(saved))
        raw = json.loads(self.path.read_text())
        self.assertEqual(raw["credentials"]["asrCredential"], "asr-secret")
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_rejects_stale_revision_and_insecure_online_endpoint(self):
        with self.assertRaisesRegex(RuntimeValidationError, "HTTPS"):
            self.store.save({
                "expectedRevision": 0,
                "asr": {"mode": "online", "model": "x", "endpoint": "http://example.test/asr", "credentialRef": "asr/main"},
                "cam": {"enabled": False, "mode": "local", "model": "cam++", "matchThreshold": 0.72},
                "credentials": {"asrCredential": "secret"},
            })
        self.store.save({
            "expectedRevision": 0,
            "asr": {"mode": "local", "model": "paraformer-zh"},
            "cam": {"enabled": True, "mode": "local", "model": "cam++", "matchThreshold": 0.72},
            "credentials": {},
        })
        with self.assertRaisesRegex(RuntimeValidationError, "revision"):
            self.store.save({
                "expectedRevision": 0,
                "asr": {"mode": "local", "model": "paraformer-zh"},
                "cam": {"enabled": True, "mode": "local", "model": "cam++", "matchThreshold": 0.72},
                "credentials": {},
            })


if __name__ == "__main__":
    unittest.main()
