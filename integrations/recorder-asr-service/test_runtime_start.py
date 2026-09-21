import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import app
from runtime_config import RuntimeConfigStore


class FakeAsr:
    def __init__(self, fail=False):
        self.fail = fail
        self.loaded = False
        self.probed = False

    def load(self):
        self.loaded = True

    def transcribe(self, audio):
        self.probed = True
        if self.fail:
            raise RuntimeError("provider unavailable")
        return {"text": "", "segments": []}


class FakeCam:
    def __init__(self, *_args):
        self.probed = False

    def embedding(self, audio):
        self.probed = True
        return [1.0]


class RuntimeStartTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        app._runtime_store = RuntimeConfigStore(Path(self.temp.name) / "runtime.json")
        app._runtime_state = "stopped"
        app._runtime_error = None
        app._runtime_asr_ready = False
        app._runtime_cam_ready = False
        app._runtime_active_revision = None
        app._runtime_cam_client = None
        app._speaker_embedding_model = None

    def tearDown(self):
        self.temp.cleanup()

    def save_online(self):
        app._runtime_store.save({
            "expectedRevision": 0,
            "asr": {"mode": "online", "model": "whisper-1", "endpoint": "https://asr.example/v1/audio/transcriptions", "credentialRef": "asr/main"},
            "cam": {"enabled": True, "mode": "online", "model": "speaker-v1", "endpoint": "https://cam.example/embed", "credentialRef": "cam/main", "matchThreshold": 0.72},
            "credentials": {"asrCredential": "asr-secret", "camCredential": "cam-secret"},
        })

    def test_online_start_probes_both_providers_before_reporting_ready(self):
        self.save_online()
        asr = FakeAsr()
        cam = FakeCam()
        with patch.object(app, "OnlineAsrBackend", return_value=asr), patch.object(app, "OnlineCamClient", return_value=cam):
            view = app.start_runtime()
        self.assertTrue(asr.loaded)
        self.assertTrue(asr.probed)
        self.assertTrue(cam.probed)
        self.assertEqual(view["state"], "running")
        self.assertEqual(view["activeRevision"], 1)
        self.assertTrue(view["asrReady"])
        self.assertTrue(view["camReady"])
        self.assertNotIn("asr-secret", str(view))

    def test_failed_probe_keeps_previous_backend_and_active_revision(self):
        self.save_online()
        previous = object()
        app._backend = previous
        app._runtime_active_revision = 0
        with patch.object(app, "OnlineAsrBackend", return_value=FakeAsr(fail=True)):
            with self.assertRaisesRegex(RuntimeError, "provider unavailable"):
                app.start_runtime()
        self.assertIs(app._backend, previous)
        view = app.runtime_view()
        self.assertEqual(view["state"], "error")
        self.assertEqual(view["activeRevision"], 0)
        self.assertFalse(view["asrReady"])


if __name__ == "__main__":
    unittest.main()
