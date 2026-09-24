"""Generic HTTPS CAM embedding client."""

from __future__ import annotations

import base64
import json
import math
import struct
from typing import Any
from urllib.request import Request, urlopen


def _post_json(endpoint: str, credential: str, payload: dict[str, Any]) -> dict[str, Any]:
    request = Request(endpoint, data=json.dumps(payload).encode(), method="POST", headers={
        "Authorization": f"Bearer {credential}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    })
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read())


class OnlineCamClient:
    """Calls an HTTPS endpoint that returns one speaker embedding vector."""

    def __init__(self, endpoint: str, credential: str, model: str, *, post=None) -> None:
        self.endpoint = endpoint
        self.credential = credential
        self.model = model
        self._post = post or _post_json

    def embedding(self, audio) -> list[float]:
        raw = b"".join(struct.pack("<h", int(max(-1.0, min(1.0, float(value))) * 32767)) for value in audio)
        response = self._post(self.endpoint, self.credential, {
            "model": self.model,
            "sampleRate": 16_000,
            "pcm16Base64": base64.b64encode(raw).decode(),
        })
        values = response.get("embedding")
        if not isinstance(values, list) or not values:
            raise RuntimeError("online CAM returned no embedding")
        result = [float(value) for value in values]
        if not all(math.isfinite(value) for value in result):
            raise RuntimeError("online CAM returned an invalid embedding")
        return result
