"""Small, explicit speaker-profile matcher for CAM++ embeddings."""

from __future__ import annotations

import math
import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping, Sequence


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    dot = sum(a * b for a, b in zip(left, right))
    norm_left = math.sqrt(sum(a * a for a in left))
    norm_right = math.sqrt(sum(b * b for b in right))
    if norm_left == 0 or norm_right == 0:
        return 0.0
    return dot / (norm_left * norm_right)


def match_profile(embedding: Sequence[float], profiles: Mapping[str, Sequence[float]], *, threshold: float = 0.72) -> str:
    best_label = "unknown"
    best_score = threshold
    for label, reference in profiles.items():
        score = cosine_similarity(embedding, reference)
        if score >= best_score:
            best_label, best_score = label, score
    return best_label


def average_embeddings(embeddings: Sequence[Sequence[float]]) -> list[float]:
    if not embeddings or not embeddings[0]:
        raise ValueError("at least one non-empty speaker embedding is required")
    dimensions = len(embeddings[0])
    if any(len(row) != dimensions for row in embeddings):
        raise ValueError("speaker embeddings must use one dimension")
    averaged = [sum(row[index] for row in embeddings) / len(embeddings) for index in range(dimensions)]
    norm = math.sqrt(sum(value * value for value in averaged))
    if norm == 0:
        raise ValueError("speaker profile cannot be a zero vector")
    return [value / norm for value in averaged]


@dataclass(frozen=True)
class SpeakerProfile:
    profile_id: str
    embedding: list[float]
    sample_count: int
    updated_at: float


class ProfileStore:
    """Owner-keyed CAM++ profiles stored in private, atomically replaced JSON files."""

    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        os.chmod(self.root, 0o700)

    def _path(self, profile_id: str) -> Path:
        if not profile_id or len(profile_id) > 512:
            raise ValueError("speaker profile id is required")
        return self.root / f"{hashlib.sha256(profile_id.encode()).hexdigest()}.json"

    def save(self, profile_id: str, embeddings: Sequence[Sequence[float]]) -> SpeakerProfile:
        profile = SpeakerProfile(profile_id, average_embeddings(embeddings), len(embeddings), time.time())
        path = self._path(profile_id)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps({
            "version": 1, "profile_id": profile.profile_id, "embedding": profile.embedding,
            "sample_count": profile.sample_count, "updated_at": profile.updated_at,
        }, separators=(",", ":")) + "\n")
        os.chmod(temporary, 0o600)
        temporary.replace(path)
        return profile

    def load(self, profile_id: str) -> SpeakerProfile | None:
        path = self._path(profile_id)
        if not path.exists():
            return None
        value = json.loads(path.read_text())
        if value.get("version") != 1 or value.get("profile_id") != profile_id:
            raise ValueError("speaker profile file is invalid")
        embedding = [float(item) for item in value.get("embedding", [])]
        if not embedding:
            raise ValueError("speaker profile embedding is empty")
        return SpeakerProfile(
            profile_id=profile_id, embedding=embedding,
            sample_count=int(value.get("sample_count", 0)), updated_at=float(value.get("updated_at", 0)),
        )

    def delete(self, profile_id: str) -> bool:
        path = self._path(profile_id)
        if not path.exists():
            return False
        path.unlink()
        return True
