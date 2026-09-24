import unittest
import tempfile
from pathlib import Path

from speaker_profile import ProfileStore, average_embeddings, cosine_similarity, match_profile


class SpeakerProfileTests(unittest.TestCase):
    def test_cosine_similarity_and_unknown_threshold(self):
        self.assertAlmostEqual(cosine_similarity([1, 0], [1, 0]), 1.0)
        self.assertEqual(match_profile([1, 0], {"本人": [0, 1]}, threshold=0.8), "unknown")
        self.assertEqual(match_profile([1, 0], {"本人": [1, 0]}, threshold=0.8), "本人")

    def test_average_embeddings_normalizes_the_profile(self):
        profile = average_embeddings([[1.0, 0.0], [0.0, 1.0]])
        self.assertAlmostEqual(profile[0], 2 ** -0.5, places=6)
        self.assertAlmostEqual(profile[1], 2 ** -0.5, places=6)

    def test_profile_store_roundtrip_uses_hashed_owner_path(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ProfileStore(Path(directory))
            saved = store.save("org-a:user-a", [[1.0, 0.0], [0.9, 0.1]])
            self.assertEqual(saved.sample_count, 2)
            self.assertEqual(store.load("org-a:user-a"), saved)
            files = list(Path(directory).glob("*.json"))
            self.assertEqual(len(files), 1)
            self.assertNotIn("org-a", files[0].name)

    def test_profile_store_rejects_dimension_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ProfileStore(Path(directory))
            with self.assertRaises(ValueError):
                store.save("owner", [[1.0, 0.0], [1.0]])


if __name__ == "__main__":
    unittest.main()
