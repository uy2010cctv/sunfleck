"""ASR 后端抽象：FunASR/Paraformer 与 faster-whisper 可切换。

为什么做这层：两者的结果结构、时间单位、置信度语义都不同，
HTTP 接口和下游（出件箱 → 记忆卡片）不应该关心用的是哪个模型。

设计要点：
  * `normalize_funasr_result()` 是**纯函数**，可脱离模型单测——
    时间单位（毫秒 vs 秒）、sentence_info 嵌套、缺字段这些坑都在这里。
  * 后端只负责「音频 → 规整结果」；出件箱、鉴权、路由都在 app.py。
  * FunASR 的说话人标签是**聚类编号**，不是真实身份，命名上就体现出来。
"""

from __future__ import annotations

import logging
import io
import json
import struct
import time
import uuid
import wave
from typing import Any, Dict, List, Optional
from urllib.request import Request, urlopen

log = logging.getLogger("asr.backend")

SAMPLE_RATE = 16_000


# ---------------------------------------------------------------------------
# FunASR 结果规整（纯函数，可单测）
# ---------------------------------------------------------------------------

def _ms_to_s(value: Any) -> Optional[float]:
    """FunASR 的时间戳单位是**毫秒**，统一换成秒。非法值返回 None。"""
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f < 0:
        return None
    return round(f / 1000.0, 3)


def _speaker_label(raw: Any) -> Optional[str]:
    """把 cam++ 的聚类编号规整成显式标签。

    注意：FunASR 的 spk 是**聚类编号**（0/1/2…），只在同一次识别内一致，
    不代表真实身份，也不保证跨文件对应同一个人。所以刻意保留 spk_ 前缀，
    避免下游误当成"人名"。
    """
    if raw is None or raw == "":
        return None
    return f"spk_{raw}"


def normalize_funasr_result(items: Any, offset_s: float = 0.0,
                            audio_seconds: Optional[float] = None,
                            infer_seconds: Optional[float] = None) -> Dict[str, Any]:
    """把 FunASR 的 generate() 返回规整成我们的统一结构。

    统一结构::

        {
          "text": str,
          "segments": [{"start","end","text","speaker"}],   # 秒，相对整段音频起点 + offset
          "language": str,
          "duration": float,
          "infer_seconds": float,
          "rtf": float|None,
          "confidence": None,        # FunASR 不提供逐段置信度
          "speakers": [str],         # 出现过的聚类标签
        }

    兼容三种返回形态：
      1. 带 sentence_info（配了 vad+punc / sentence_timestamp=True）——首选
      2. 只有 text + timestamp（逐字/词毫秒对）——不做字符对齐，退化为整段一条
      3. 只有 text
    """
    if items is None:
        items = []
    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list):
        raise ValueError(f"unexpected FunASR result type: {type(items).__name__}")

    texts: List[str] = []
    segments: List[Dict[str, Any]] = []
    speakers: List[str] = []

    for item in items:
        if not isinstance(item, dict):
            continue
        text = (item.get("text") or "").strip()
        if text:
            texts.append(text)

        sentence_info = item.get("sentence_info")
        if isinstance(sentence_info, list) and sentence_info:
            for sent in sentence_info:
                if not isinstance(sent, dict):
                    continue
                sent_text = (sent.get("text") or "").strip()
                if not sent_text:
                    continue
                start = _ms_to_s(sent.get("start"))
                end = _ms_to_s(sent.get("end"))
                speaker = _speaker_label(sent.get("spk"))
                if speaker and speaker not in speakers:
                    speakers.append(speaker)
                segments.append({
                    "start": None if start is None else round(start + offset_s, 3),
                    "end": None if end is None else round(end + offset_s, 3),
                    "text": sent_text,
                    "speaker": speaker,
                })
        elif text:
            # 没有句子级切分：不要拿 timestamp 去硬对字符（官方文档明确警告
            # 标点/归一化后不是一对一），退化成整段一条，至少时间不撒谎。
            segments.append({
                "start": round(offset_s, 3),
                "end": (round(offset_s + audio_seconds, 3)
                        if audio_seconds is not None else None),
                "text": text,
                "speaker": None,
            })

    result: Dict[str, Any] = {
        "text": "".join(texts),
        "segments": segments,
        "language": "zh",
        "duration": round(audio_seconds, 3) if audio_seconds is not None else None,
        "infer_seconds": round(infer_seconds, 3) if infer_seconds is not None else None,
        "rtf": (round(infer_seconds / audio_seconds, 3)
                if infer_seconds is not None and audio_seconds else None),
        # FunASR 不返回 avg_logprob 之类的逐段置信度：宁可为 None，
        # 也不要编一个假分数让下游误判。
        "confidence": None,
        "speakers": speakers,
    }
    return result


def attach_segment_metadata(result: Dict[str, Any], *, segment_id: str,
                            start_ts: float, end_ts: float,
                            device_sn: Optional[str]) -> Dict[str, Any]:
    """Attach durable source metadata to one batch response row.

    The result keeps sentence-level speaker labels while exposing the first
    label as a convenient row-level value for cards and timeline views.
    """
    sentence_segments = result.get("segments") if isinstance(result.get("segments"), list) else []
    speakers = [str(item["speaker"]) for item in sentence_segments
                if isinstance(item, dict) and item.get("speaker")]
    row: Dict[str, Any] = {
        "segment_id": segment_id,
        "start_ts": start_ts,
        "end_ts": end_ts,
        "text": result.get("text", ""),
        "confidence": result.get("confidence"),
        "speaker": speakers[0] if speakers else None,
        "speakers": list(dict.fromkeys(speakers)),
        "segments": sentence_segments,
    }
    if device_sn is not None:
        row["device_sn"] = device_sn
    return row


# ---------------------------------------------------------------------------
# 后端实现
# ---------------------------------------------------------------------------

class FunAsrBackend:
    """FunASR AutoModel 后端（Paraformer-zh + 可选 VAD / 标点 / 说话人）。"""

    name = "funasr"

    def __init__(self, model: str = "paraformer-zh", device: str = "cpu",
                 ncpu: int = 4, hub: str = "ms",
                 vad_model: str = "fsmn-vad", punc_model: str = "ct-punc",
                 spk_model: Optional[str] = None,
                 max_segment_ms: int = 30_000,
                 hotwords: Optional[str] = None) -> None:
        self.model_id = model
        self.device = device
        self.ncpu = ncpu
        self.hub = hub
        self.vad_model = vad_model
        self.punc_model = punc_model
        self.spk_model = spk_model
        self.max_segment_ms = max_segment_ms
        self.hotwords = hotwords
        self._model = None

    def load(self) -> None:
        if self._model is not None:
            return
        from funasr import AutoModel  # 延迟导入：没装 funasr 也不该影响 faster-whisper 用户

        kwargs: Dict[str, Any] = {
            "model": self.model_id,
            "hub": self.hub,
            "device": self.device,
            "ncpu": self.ncpu,
            "disable_update": True,
        }
        if self.vad_model:
            kwargs["vad_model"] = self.vad_model
            kwargs["vad_kwargs"] = {"max_single_segment_time": self.max_segment_ms}
        if self.punc_model:
            kwargs["punc_model"] = self.punc_model
        if self.spk_model:
            kwargs["spk_model"] = self.spk_model

        log.info("loading FunASR: %s (device=%s, vad=%s, punc=%s, spk=%s)",
                 self.model_id, self.device, self.vad_model, self.punc_model, self.spk_model)
        self._model = AutoModel(**kwargs)

    def transcribe(self, audio, offset_s: float = 0.0) -> Dict[str, Any]:
        import time as _time
        self.load()
        audio_seconds = len(audio) / SAMPLE_RATE
        options: Dict[str, Any] = {
            "batch_size_s": 60,
            "sentence_timestamp": True,
        }
        if self.hotwords:
            # paraformer-zh 是**单数** hotword + 空格分隔（官方文档明确，
            # hotword/hotwords/language 不是可互换的通用选项）
            options["hotword"] = self.hotwords

        t0 = _time.time()
        # 传 numpy 数组时必须显式给 fs —— 数组没有采样率头信息
        items = self._model.generate(input=audio, fs=SAMPLE_RATE, **options)
        elapsed = _time.time() - t0
        return normalize_funasr_result(items, offset_s=offset_s,
                                       audio_seconds=audio_seconds,
                                       infer_seconds=elapsed)


class FasterWhisperBackend:
    """faster-whisper 后端（保留作为对照与兜底）。"""

    name = "faster-whisper"

    def __init__(self, model: str = "large-v3-turbo", device: str = "cpu",
                 compute_type: str = "int8", language: str = "zh",
                 beam_size: int = 1, hotwords: Optional[str] = None) -> None:
        self.model_id = model
        self.device = device
        self.compute_type = compute_type
        self.language = language
        self.beam_size = beam_size
        self.hotwords = hotwords
        self._model = None

    def load(self) -> None:
        if self._model is not None:
            return
        from faster_whisper import WhisperModel
        log.info("loading faster-whisper: %s (device=%s, compute=%s)",
                 self.model_id, self.device, self.compute_type)
        self._model = WhisperModel(self.model_id, device=self.device,
                                   compute_type=self.compute_type)

    def transcribe(self, audio, offset_s: float = 0.0) -> Dict[str, Any]:
        import time as _time
        self.load()
        audio_seconds = len(audio) / SAMPLE_RATE
        t0 = _time.time()
        segs, info = self._model.transcribe(
            audio,
            language=self.language,
            beam_size=self.beam_size,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 500},
            initial_prompt=self.hotwords,
            condition_on_previous_text=False,
        )
        out_segments = []
        for s in segs:
            text = (s.text or "").strip()
            if not text:
                continue
            out_segments.append({
                "start": round(s.start + offset_s, 3),
                "end": round(s.end + offset_s, 3),
                "text": text,
                "speaker": None,
                "no_speech_prob": round(getattr(s, "no_speech_prob", 0.0) or 0.0, 4),
                "avg_logprob": round(getattr(s, "avg_logprob", 0.0) or 0.0, 4),
            })
        elapsed = _time.time() - t0
        return {
            "text": "".join(x["text"] for x in out_segments),
            "segments": out_segments,
            "language": getattr(info, "language", self.language),
            "duration": round(audio_seconds, 3),
            "infer_seconds": round(elapsed, 3),
            "rtf": round(elapsed / audio_seconds, 3) if audio_seconds else None,
            "confidence": estimate_logprob_confidence(out_segments),
            "speakers": [],
        }


def _float_audio_to_wav(audio) -> bytes:
    """Encode normalized float audio as 16 kHz mono PCM WAV."""
    samples = bytearray()
    for value in audio:
        sample = max(-1.0, min(1.0, float(value)))
        samples.extend(struct.pack("<h", int(sample * 32767)))
    output = io.BytesIO()
    with wave.open(output, "wb") as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(SAMPLE_RATE)
        stream.writeframes(bytes(samples))
    return output.getvalue()


def _post_openai_audio(endpoint: str, credential: str, model: str, wav_data: bytes) -> dict[str, Any]:
    boundary = "----recorder-" + uuid.uuid4().hex
    body = bytearray()
    for name, value in (("model", model), ("response_format", "verbose_json")):
        body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    body.extend(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"audio.wav\"\r\nContent-Type: audio/wav\r\n\r\n".encode())
    body.extend(wav_data)
    body.extend(f"\r\n--{boundary}--\r\n".encode())
    request = Request(endpoint, data=bytes(body), method="POST", headers={
        "Authorization": f"Bearer {credential}",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Accept": "application/json",
    })
    with urlopen(request, timeout=60) as response:
        return json.loads(response.read())


class OnlineAsrBackend:
    """OpenAI-compatible HTTPS audio transcription backend."""

    name = "online"

    def __init__(self, endpoint: str, credential: str, model: str, *, post=None) -> None:
        self.endpoint = endpoint
        self.credential = credential
        self.model_id = model
        self._post = post or _post_openai_audio

    def load(self) -> None:
        return None

    def transcribe(self, audio, offset_s: float = 0.0) -> Dict[str, Any]:
        wav_data = _float_audio_to_wav(audio)
        started = time.time()
        payload = self._post(self.endpoint, self.credential, self.model_id, wav_data)
        elapsed = time.time() - started
        text = str(payload.get("text") or "").strip()
        segments = []
        for value in payload.get("segments") or []:
            if not isinstance(value, dict) or not str(value.get("text") or "").strip():
                continue
            segments.append({
                "start": round(float(value.get("start", 0)) + offset_s, 3),
                "end": round(float(value.get("end", 0)) + offset_s, 3),
                "text": str(value["text"]).strip(),
                "speaker": None,
            })
        duration = len(audio) / SAMPLE_RATE
        if text and not segments:
            segments.append({"start": offset_s, "end": round(offset_s + duration, 3), "text": text, "speaker": None})
        return {
            "text": text,
            "segments": segments,
            "language": payload.get("language") or "zh",
            "duration": round(duration, 3),
            "infer_seconds": round(elapsed, 3),
            "rtf": round(elapsed / duration, 3) if duration else None,
            "confidence": None,
            "speakers": [],
        }


def estimate_logprob_confidence(segments: List[Dict[str, Any]]) -> Optional[float]:
    """把 faster-whisper 的 avg_logprob 映射成 0–1 粗分数。

    只有 faster-whisper 后端用得上；FunASR 没有对应字段，返回 None 更诚实。
    """
    vals = [s.get("avg_logprob") for s in segments
            if isinstance(s.get("avg_logprob"), (int, float))]
    if not vals:
        return None
    avg = sum(vals) / len(vals)
    return round(max(0.0, min(1.0, 1.0 + avg / 2.0)), 3)


# ---------------------------------------------------------------------------
# 工厂
# ---------------------------------------------------------------------------

SUPPORTED_BACKENDS = ("funasr", "faster-whisper")


def build_backend(kind: str, **kwargs):
    """按名字构造后端。未知名字**抛错**而不是静默回退——
    静默回退会让"我以为在用 Paraformer"这种误判很难发现。"""
    kind = (kind or "").strip().lower()
    if kind == "funasr":
        return FunAsrBackend(
            model=kwargs.get("model") or "paraformer-zh",
            device=kwargs.get("device") or "cpu",
            ncpu=int(kwargs.get("ncpu") or 4),
            hub=kwargs.get("hub") or "ms",
            vad_model=kwargs.get("vad_model", "fsmn-vad"),
            punc_model=kwargs.get("punc_model", "ct-punc"),
            spk_model=kwargs.get("spk_model") or None,
            max_segment_ms=int(kwargs.get("max_segment_ms") or 30_000),
            hotwords=kwargs.get("hotwords") or None,
        )
    if kind in ("faster-whisper", "faster_whisper", "whisper"):
        return FasterWhisperBackend(
            model=kwargs.get("model") or "large-v3-turbo",
            device=kwargs.get("device") or "cpu",
            compute_type=kwargs.get("compute_type") or "int8",
            language=kwargs.get("language") or "zh",
            beam_size=int(kwargs.get("beam_size") or 1),
            hotwords=kwargs.get("hotwords") or None,
        )
    raise ValueError(f"unknown ASR backend: {kind!r} (supported: {', '.join(SUPPORTED_BACKENDS)})")
