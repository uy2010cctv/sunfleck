import unittest

from online_cam import OnlineCamClient


class OnlineCamClientTest(unittest.TestCase):
    def test_embedding_protocol_and_float_validation(self):
        captured = {}

        def post(endpoint, credential, payload):
            captured.update(endpoint=endpoint, credential=credential, payload=payload)
            return {"embedding": [0.25, -0.5, 0.75]}

        client = OnlineCamClient("https://cam.example/embed", "secret", "speaker-v1", post=post)
        embedding = client.embedding([0.0] * 160)
        self.assertEqual(embedding, [0.25, -0.5, 0.75])
        self.assertEqual(captured["payload"]["sampleRate"], 16000)
        self.assertEqual(captured["payload"]["model"], "speaker-v1")
        self.assertTrue(captured["payload"]["pcm16Base64"])

    def test_empty_embedding_is_rejected(self):
        client = OnlineCamClient("https://cam.example/embed", "secret", "speaker-v1", post=lambda *_: {"embedding": []})
        with self.assertRaisesRegex(RuntimeError, "embedding"):
            client.embedding([0.0])


if __name__ == "__main__":
    unittest.main()
