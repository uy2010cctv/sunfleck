"""Mac mini 上的本地 ASR 服务：录音卡片 → 文字。

设计取舍（重要，别照抄网上的"流式 Whisper"示例）：

  faster-whisper 是**分段（segment）批处理**引擎，不是流式引擎。它没有
  "边听边说"的增量解码能力。所谓"实时"在工程上只能这样做：

      手机端 VAD 切出语音段（典型 2–15 秒） → 按段 POST → 每段几秒内返回文字

  端到端延迟 ≈ 段长 + 识别耗时。对 15 秒段、M2 上 large-v3-turbo 约
  0.1–0.3×实时率，实测延迟大约 2–6 秒。这已经足够"准实时"，
  而且比维护一个长连接流式管道稳定得多：单段失败重传即可。

  如果业务真的要求"1 秒内出字"，那不是换个参数能解决的，需要换成
  支持增量解码的模型（如 Conformer/Parakeet 类流式 ASR）。本服务的
  架构留了 /v1/stream 作为可替换接口，但默认推荐 /v1/transcribe_segments。

运行（在 Mac mini 上）：
    pip install -r requirements.txt
    uvicorn app:app --host 0.0.0.0 --port 8765

M2 提示：faster-whisper 走 CTranslate2，只吃 CPU + Accelerate，
**用不到 M2 的 GPU**。同等模型下 mlx-whisper（Apple MLX）通常快 2–4 倍。
见 README.md 的选型对比。
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import logging
import os
import threading
import time
import wave
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import numpy as np
except ImportError:  # pragma: no cover
    np = None  # type: ignore

try:
    from fastapi import (
        Depends,
        FastAPI,
        File,
        Header,
        HTTPException,
        UploadFile,
        WebSocket,
        WebSocketDisconnect,
    )
    from fastapi.responses import JSONResponse
    from pydantic import BaseModel, Field
except ImportError:  # pragma: no cover
    raise SystemExit("需要 fastapi/uvicorn/pydantic：pip install -r requirements.txt")

# 纯逻辑核心（无第三方依赖，已单测）
from auth import extract_supplied_token, token_ok  # noqa: E402
from backends import OnlineAsrBackend, attach_segment_metadata, build_backend  # noqa: E402
from online_cam import OnlineCamClient  # noqa: E402
from outbox import BadRecordId, Outbox, OutboxError  # noqa: E402
from runtime_config import RuntimeConfigStore, RuntimeValidationError  # noqa: E402
from speaker_profile import ProfileStore, cosine_similarity  # noqa: E402
from segment import (  # noqa: E402
    SAMPLE_RATE,
    Segment,
    SegmentAssembler,
    VadConfig,
    is_usable_segment,
    pcm16_rms,
)

log = logging.getLogger("asr")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ---------------------------------------------------------------------------
# 配置（全部可用环境变量覆盖，方便在 Mac mini 上用 launchd 托管）
# ---------------------------------------------------------------------------

# 后端选择：funasr（默认，中文更强更快）或 faster-whisper
BACKEND = os.environ.get("ASR_BACKEND", "funasr").strip().lower()
# FunASR 参数
FUNASR_MODEL = os.environ.get("ASR_FUNASR_MODEL", "paraformer-zh")
FUNASR_HUB = os.environ.get("ASR_FUNASR_HUB", "ms")
VAD_MODEL = os.environ.get("ASR_VAD_MODEL", "fsmn-vad")
PUNC_MODEL = os.environ.get("ASR_PUNC_MODEL", "ct-punc")
# 说话人分离模型。设为 cam++ 后 sentence_info 会带 spk 聚类标签。
# ⚠️ 那是**聚类编号**不是真实身份，跨文件不保证一致。
SPK_MODEL = os.environ.get("ASR_SPK_MODEL", "").strip()
# 通用参数
DEVICE = os.environ.get("ASR_DEVICE", "cpu")
MODEL_SIZE = os.environ.get("ASR_MODEL", "large-v3-turbo")   # 仅 faster-whisper 用
COMPUTE_TYPE = os.environ.get("ASR_COMPUTE_TYPE", "int8")    # 仅 faster-whisper 用
LANGUAGE = os.environ.get("ASR_LANGUAGE", "zh")
BEAM_SIZE = int(os.environ.get("ASR_BEAM_SIZE", "1"))
NCPU = int(os.environ.get("ASR_NCPU", "4"))
HOTWORDS_FILE = os.environ.get("ASR_HOTWORDS", "hotwords.txt")
MAX_CONCURRENCY = int(os.environ.get("ASR_MAX_CONCURRENCY", "1"))
# 共享密钥。留空 = 不校验（仅建议本地开发时这样）。见 auth.py 的说明。
AUTH_TOKEN = os.environ.get("ASR_AUTH_TOKEN", "").strip()
# 出件箱目录。设置后，每次识别结果都会落盘并等待 47 侧 Agent 拉取。
# 不设置则该功能关闭（主链路不受影响）。
OUTBOX_DIR = os.environ.get("ASR_OUTBOX_DIR", "").strip()
SPEAKER_PROFILE_DIR = os.environ.get("ASR_SPEAKER_PROFILE_DIR", "").strip()
SPEAKER_PROFILE_MODEL = os.environ.get(
    "ASR_SPEAKER_PROFILE_MODEL", "iic/speech_campplus_sv_zh-cn_16k-common"
).strip()
SPEAKER_MATCH_THRESHOLD = float(os.environ.get("ASR_SPEAKER_MATCH_THRESHOLD", "0.72"))
RUNTIME_CONFIG_PATH = Path(os.environ.get(
    "ASR_RUNTIME_CONFIG", str(Path.home() / ".recorder-asr" / "runtime.json")
)).expanduser()

app = FastAPI(title="Recorder Local ASR", version="1.1")

_outbox = Outbox(OUTBOX_DIR) if OUTBOX_DIR else None
_speaker_profiles = ProfileStore(Path(SPEAKER_PROFILE_DIR)) if SPEAKER_PROFILE_DIR else None

_backend = None
_backend_lock = threading.Lock()
_speaker_embedding_model = None
_speaker_embedding_lock = threading.Lock()
_runtime_store = RuntimeConfigStore(RUNTIME_CONFIG_PATH)
_runtime_state = "stopped"
_runtime_error: Optional[str] = None
_runtime_asr_ready = False
_runtime_cam_ready = False
_runtime_cam_client: Optional[OnlineCamClient] = None
_runtime_active_revision: Optional[int] = None
# FastASR / CTranslate2 的模型实例都不是为并行 infer 设计的：
# 并发调用会争抢内部状态并显著变慢。用信号量串行化，宁可排队也不要错。
_infer_sem = threading.Semaphore(MAX_CONCURRENCY)
_stats = {"segments": 0, "audio_seconds": 0.0, "infer_seconds": 0.0, "errors": 0}


def require_token(
    x_auth_token: Optional[str] = Header(default=None, alias="X-Auth-Token"),
    authorization: Optional[str] = Header(default=None, alias="Authorization"),
) -> None:
    """FastAPI 依赖：校验共享密钥。

    `/health` 故意不设此依赖，留作存活探针；其余端点全部要求 token。
    未配置 ASR_AUTH_TOKEN 时放行，但 `/health` 会报 `auth: false` 以示区别。
    """
    supplied = extract_supplied_token(x_auth_token, authorization)
    if not token_ok(supplied, AUTH_TOKEN):
        raise HTTPException(401, "invalid or missing token")


# ---------------------------------------------------------------------------
# 热词与后端加载
# ---------------------------------------------------------------------------

def _hotword_terms() -> List[str]:
    """读取术语表（人名/项目名/专有名词）。

    这是解决"远场 + 专业术语识别差"最省力的一招，比换更大的模型划算。
    两个后端对热词的格式要求不同，所以这里只返回词表，由各自格式化。
    """
    if not HOTWORDS_FILE or not os.path.exists(HOTWORDS_FILE):
        return []
    try:
        with open(HOTWORDS_FILE, "r", encoding="utf-8") as fh:
            return [ln.strip() for ln in fh if ln.strip() and not ln.startswith("#")][:200]
    except OSError:
        return []


def _funasr_hotword_string() -> Optional[str]:
    """FunASR（paraformer-zh）要**单数 hotword**、空格分隔。

    官方文档明确 hotword / hotwords / language 不是可互换的通用选项。
    """
    terms = _hotword_terms()
    return " ".join(terms) if terms else None


def _whisper_prompt() -> Optional[str]:
    """faster-whisper 用 initial_prompt 句子形式。"""
    terms = _hotword_terms()
    return ("以下是可能出现的专有名词：" + "、".join(terms) + "。") if terms else None


def get_backend():
    """按配置构造并缓存后端。未知后端名会抛错（不静默回退）。"""
    global _backend
    if _backend is None:
        with _backend_lock:
            if _backend is None:
                t0 = time.time()
                _backend = build_backend(
                    BACKEND,
                    model=FUNASR_MODEL if BACKEND == "funasr" else MODEL_SIZE,
                    device=DEVICE,
                    ncpu=NCPU,
                    hub=FUNASR_HUB,
                    vad_model=VAD_MODEL,
                    punc_model=PUNC_MODEL,
                    spk_model=SPK_MODEL,
                    compute_type=COMPUTE_TYPE,
                    language=LANGUAGE,
                    beam_size=BEAM_SIZE,
                    hotwords=_funasr_hotword_string() if BACKEND == "funasr" else _whisper_prompt(),
                )
                _backend.load()
                log.info("backend %s loaded in %.1fs", _backend.name, time.time() - t0)
    return _backend


def start_runtime() -> Dict[str, Any]:
    """Load the saved ASR/CAM selection, then atomically publish it for inference."""
    global _backend, _speaker_embedding_model, _runtime_state, _runtime_error
    global _runtime_asr_ready, _runtime_cam_ready, _runtime_cam_client, _runtime_active_revision
    config = _runtime_store.snapshot()
    _runtime_state = "starting"
    _runtime_error = None
    try:
        asr = config["asr"]
        credentials = config.get("credentials") or {}
        if asr["mode"] == "online":
            candidate_backend = OnlineAsrBackend(
                asr["endpoint"], credentials["asrCredential"], asr["model"]
            )
        else:
            kind = "faster-whisper" if "whisper" in asr["model"].lower() else "funasr"
            candidate_backend = build_backend(
                kind,
                model=asr["model"], device=DEVICE, ncpu=NCPU, hub=FUNASR_HUB,
                vad_model=VAD_MODEL, punc_model=PUNC_MODEL,
                spk_model=config["cam"]["model"] if config["cam"]["enabled"] and config["cam"]["mode"] == "local" else None,
                compute_type=COMPUTE_TYPE, language=LANGUAGE, beam_size=BEAM_SIZE,
                hotwords=_funasr_hotword_string() if kind == "funasr" else _whisper_prompt(),
            )
        candidate_backend.load()

        if asr["mode"] == "online":
            candidate_backend.transcribe(np.zeros(SAMPLE_RATE, dtype="float32"))

        cam = config["cam"]
        candidate_cam = None
        candidate_speaker_model = None
        if cam["enabled"] and cam["mode"] == "online":
            candidate_cam = OnlineCamClient(cam["endpoint"], credentials["camCredential"], cam["model"])
            candidate_cam.embedding(np.zeros(SAMPLE_RATE, dtype="float32"))
        elif cam["enabled"]:
            from funasr import AutoModel
            candidate_speaker_model = AutoModel(
                model=cam["model"], hub=FUNASR_HUB, device=DEVICE,
                ncpu=NCPU, disable_update=True,
            )
        with _backend_lock:
            _backend = candidate_backend
        with _speaker_embedding_lock:
            _speaker_embedding_model = candidate_speaker_model
            _runtime_cam_client = candidate_cam
        _runtime_asr_ready = True
        _runtime_cam_ready = bool(cam["enabled"])
        _runtime_active_revision = config["revision"]
        _runtime_state = "running"
    except Exception as exc:
        _runtime_asr_ready = False
        _runtime_cam_ready = False
        _runtime_state = "error"
        _runtime_error = str(exc)
        raise
    return runtime_view()


def runtime_view() -> Dict[str, Any]:
    return _runtime_store.view(
        state=_runtime_state, asr_ready=_runtime_asr_ready,
        cam_ready=_runtime_cam_ready, active_revision=_runtime_active_revision, error=_runtime_error,
    )


def get_speaker_embedding_model():
    """Load the independent CAM++ verification model used for owner matching."""
    global _speaker_embedding_model
    if _speaker_embedding_model is None:
        with _speaker_embedding_lock:
            if _speaker_embedding_model is None:
                config = _runtime_store.snapshot()["cam"]
                model_id = config["model"] if config["mode"] == "local" else SPEAKER_PROFILE_MODEL
                from funasr import AutoModel
                _speaker_embedding_model = AutoModel(
                    model=model_id, hub=FUNASR_HUB, device=DEVICE,
                    ncpu=NCPU, disable_update=True,
                )
    return _speaker_embedding_model


def speaker_embedding(audio) -> list[float]:
    """Extract one flattened CAM++ embedding from 16 kHz mono float audio."""
    if _runtime_cam_client is not None:
        return _runtime_cam_client.embedding(audio)
    model = get_speaker_embedding_model()
    with _infer_sem:
        rows = model.generate(input=audio, fs=SAMPLE_RATE)
    value = rows[0].get("spk_embedding") if rows else None
    if value is None:
        raise RuntimeError("CAM++ returned no speaker embedding")
    if hasattr(value, "detach"):
        value = value.detach().cpu().numpy()
    if hasattr(value, "reshape"):
        value = value.reshape(-1)
    result = [float(item) for item in value]
    if not result:
        raise RuntimeError("CAM++ returned an empty speaker embedding")
    return result


# ---------------------------------------------------------------------------
# 音频解码
# ---------------------------------------------------------------------------

def wav_bytes_to_float32(data: bytes):
    """WAV → float32 mono @16k。只接受 16-bit PCM，拒绝重采样（避免静默变调）。"""
    if np is None:
        raise HTTPException(503, "numpy 未安装")
    with wave.open(io.BytesIO(data), "rb") as wf:
        if wf.getsampwidth() != 2:
            raise HTTPException(400, f"只支持 16-bit PCM WAV，收到 {wf.getsampwidth() * 8}-bit")
        if wf.getframerate() != SAMPLE_RATE:
            raise HTTPException(400, f"只支持 {SAMPLE_RATE}Hz，收到 {wf.getframerate()}Hz")
        n_ch = wf.getnchannels()
        raw = wf.readframes(wf.getnframes())
    arr = np.frombuffer(raw, dtype="<i2").astype("float32") / 32768.0
    if n_ch > 1:
        arr = arr.reshape(-1, n_ch).mean(axis=1)      # 多声道就地下混
    return arr


def pcm16_b64_to_float32(b64: str):
    if np is None:
        raise HTTPException(503, "numpy 未安装")
    try:
        raw = base64.b64decode(b64, validate=True)
    except Exception as exc:
        raise HTTPException(400, f"pcm_b64 解码失败: {exc}") from exc
    return np.frombuffer(raw, dtype="<i2").astype("float32") / 32768.0


# ---------------------------------------------------------------------------
# 核心识别
# ---------------------------------------------------------------------------

def transcribe_array(audio, offset_s: float = 0.0) -> Dict[str, Any]:
    """识别一段 float32 mono @16k，返回统一结构（见 backends.normalize_funasr_result）。

    串行化：两个后端都不适合并行 infer，宁可排队也不要错。
    """
    backend = get_backend()
    with _infer_sem:
        result = backend.transcribe(audio, offset_s=offset_s)
    audio_s = len(audio) / SAMPLE_RATE
    _stats["segments"] += 1
    _stats["audio_seconds"] += audio_s
    _stats["infer_seconds"] += result.get("infer_seconds") or 0.0
    return result


def estimate_confidence(result: Dict[str, Any]) -> Optional[float]:
    """置信度。由后端提供；FunASR 不提供逐段置信度，因此会是 None。

    宁可 None 也不要编一个假分数——下游用它决定"要不要留音频备查"，
    假分数会让这个策略静默失效。
    """
    return result.get("confidence")



# ---------------------------------------------------------------------------
# 请求模型
# ---------------------------------------------------------------------------

class SegmentIn(BaseModel):
    """一个 VAD 语音段。时间戳由**手机**给出（设备墙钟），不是相对秒数。"""
    start_ts: float = Field(..., description="Unix 秒，语音段起点")
    end_ts: float = Field(..., description="Unix 秒，语音段终点")
    segment_id: str = Field(default="", max_length=200, description="客户端稳定段 ID")
    pcm_b64: str = Field(..., description="16kHz/mono/int16 LE 原始 PCM 的 base64")
    bookmarked: bool = False


class TranscribeBatchIn(BaseModel):
    segments: List[SegmentIn]
    device_sn: Optional[str] = None
    speaker_profile_id: Optional[str] = Field(default=None, max_length=512)


class SpeakerEnrollIn(BaseModel):
    profile_id: str = Field(..., min_length=1, max_length=512)
    pcm_b64: str = Field(..., min_length=1)


class SpeakerDeleteIn(BaseModel):
    profile_id: str = Field(..., min_length=1, max_length=512)


class RuntimeConfigureIn(BaseModel):
    expectedRevision: int
    asr: Dict[str, Any]
    cam: Dict[str, Any]
    credentials: Dict[str, str] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    """存活探针。**故意不加 token**，便于监控；因此只暴露非敏感元信息。"""
    return {
        "ok": True,
        "auth": bool(AUTH_TOKEN),
        "outbox": _outbox.stats() if _outbox is not None else None,
        "backend": BACKEND,
        "model": FUNASR_MODEL if BACKEND == "funasr" else MODEL_SIZE,
        "device": DEVICE,
        "vad_model": VAD_MODEL if BACKEND == "funasr" else "whisper-builtin",
        "punc_model": PUNC_MODEL if BACKEND == "funasr" else None,
        "speaker_model": SPK_MODEL or None,
        "speaker_profiles": _speaker_profiles is not None,
        "language": LANGUAGE,
        "backend_loaded": _backend is not None,
        "hotwords": bool(_hotword_terms()),
    }


@app.get("/metrics", dependencies=[Depends(require_token)])
def metrics():
    s = dict(_stats)
    s["avg_rtf"] = round(s["infer_seconds"] / s["audio_seconds"], 3) if s["audio_seconds"] else None
    return s


@app.get("/v1/admin/runtime", dependencies=[Depends(require_token)])
def recorder_runtime_status():
    """Return redacted ASR/CAM configuration and active runtime status."""
    return runtime_view()


@app.post("/v1/admin/runtime/configure", dependencies=[Depends(require_token)])
def recorder_runtime_configure(body: RuntimeConfigureIn):
    """Persist a revisioned configuration without disrupting the active models."""
    try:
        _runtime_store.save(body.model_dump())
        return runtime_view()
    except RuntimeValidationError as exc:
        raise HTTPException(409 if "revision" in str(exc) else 400, str(exc)) from exc


@app.post("/v1/admin/runtime/start", dependencies=[Depends(require_token)])
def recorder_runtime_start():
    """Load or hot-reload the saved ASR/CAM configuration."""
    try:
        return start_runtime()
    except Exception as exc:
        raise HTTPException(503, f"recorder runtime start failed: {exc}") from exc


@app.post("/v1/transcribe", dependencies=[Depends(require_token)])
async def transcribe_file(file: UploadFile = File(...)):
    """整文件识别（补录/回填用：设备里的历史录音）。"""
    data = await file.read()
    if len(data) > 200 * 1024 * 1024:
        raise HTTPException(413, "文件过大，请分段")
    try:
        audio = wav_bytes_to_float32(data)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"WAV 解析失败: {exc}") from exc
    return transcribe_array(audio)


@app.post("/v1/transcribe_segments", dependencies=[Depends(require_token)])
def transcribe_segments(body: TranscribeBatchIn):
    """主路径：手机端 VAD 切好的语音段批量送识别。

    返回的 start/end 是设备墙钟（Unix 秒），可直接用于记忆时间轴。
    """
    results = []
    for seg in body.segments:
        segment_id = seg.segment_id.strip() or "legacy-" + hashlib.sha256(
            f"{seg.start_ts}|{seg.end_ts}|{seg.pcm_b64}".encode("utf-8")
        ).hexdigest()[:32]
        try:
            audio = pcm16_b64_to_float32(seg.pcm_b64)
        except HTTPException as exc:
            results.append({"segment_id": segment_id, "start_ts": seg.start_ts, "end_ts": seg.end_ts,
                            "error": exc.detail, "text": ""})
            _stats["errors"] += 1
            continue
        if len(audio) == 0:
            continue
        try:
            r = transcribe_array(audio, offset_s=0.0)
        except Exception as exc:                     # 单段失败不影响整批
            log.exception("segment failed")
            _stats["errors"] += 1
            results.append({"segment_id": segment_id, "start_ts": seg.start_ts, "end_ts": seg.end_ts,
                            "error": str(exc), "text": ""})
            continue
        row = {
            **attach_segment_metadata(
                r,
                segment_id=segment_id,
                start_ts=seg.start_ts,
                end_ts=seg.end_ts,
                device_sn=body.device_sn,
            ),
            "bookmarked": seg.bookmarked,
        }
        if _speaker_profiles is not None and body.speaker_profile_id and row.get("text"):
            profile = _speaker_profiles.load(body.speaker_profile_id)
            if profile is not None and len(audio) >= SAMPLE_RATE:
                try:
                    score = cosine_similarity(speaker_embedding(audio), profile.embedding)
                    row["speaker_cluster"] = row.get("speaker")
                    row["speaker_score"] = round(score, 4)
                    match_threshold = float(_runtime_store.snapshot()["cam"]["matchThreshold"])
                    if score >= match_threshold:
                        row["speaker"] = "self"
                        row["speakers"] = ["self"]
                    else:
                        row["speaker"] = "unknown"
                        row["speakers"] = []
                except Exception:
                    log.exception("speaker profile match failed")
        results.append(row)

    # 出件箱：47 侧的 Agent 会通过同一条反向隧道来拉取。
    # 这里只负责"产出文本"，Mac 上不保存任何 SUNFLECK 凭据。
    if _outbox is not None:
        recorded = [r for r in results if r.get("text")]
        if recorded:
            try:
                _outbox.put({"results": recorded}, meta={"device_sn": body.device_sn})
            except Exception:
                # 出件箱写失败不能影响本次识别结果返回，否则手机端会重传音频
                log.exception("outbox put failed")

    return {"results": results}


@app.post("/v1/speaker/enroll", dependencies=[Depends(require_token)])
def enroll_speaker(body: SpeakerEnrollIn):
    if _speaker_profiles is None:
        raise HTTPException(503, "speaker profiles disabled")
    audio = pcm16_b64_to_float32(body.pcm_b64)
    duration = len(audio) / SAMPLE_RATE
    if duration < 20 or duration > 90:
        raise HTTPException(400, "speaker enrollment requires 20 to 90 seconds of audio")
    embedding = speaker_embedding(audio)
    profile = _speaker_profiles.save(body.profile_id, [embedding])
    return {"status": "enrolled", "sample_count": profile.sample_count, "audio_seconds": round(duration, 2)}


@app.post("/v1/speaker/delete", dependencies=[Depends(require_token)])
def delete_speaker(body: SpeakerDeleteIn):
    if _speaker_profiles is None:
        raise HTTPException(503, "speaker profiles disabled")
    return {"deleted": _speaker_profiles.delete(body.profile_id)}


# ---------------------------------------------------------------------------
# 出件箱（供 47 侧拉取；无凭据，只靠隧道打通）
# ---------------------------------------------------------------------------

@app.get("/outbox", dependencies=[Depends(require_token)])
def outbox_list(since: Optional[float] = None, limit: Optional[int] = None):
    if _outbox is None:
        raise HTTPException(404, "outbox disabled (set ASR_OUTBOX_DIR)")
    return {
        "items": [asdict(i) for i in _outbox.list(since=since, limit=limit)],
        "stats": _outbox.stats(),
    }


@app.get("/outbox/{record_id}", dependencies=[Depends(require_token)])
def outbox_get(record_id: str):
    if _outbox is None:
        raise HTTPException(404, "outbox disabled")
    try:
        return _outbox.get(record_id)
    except BadRecordId as exc:
        raise HTTPException(400, str(exc)) from exc
    except OutboxError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/outbox/{record_id}/ack", dependencies=[Depends(require_token)])
def outbox_ack(record_id: str):
    """47 侧确认已成功写入知识库后调用，删除该条目。"""
    if _outbox is None:
        raise HTTPException(404, "outbox disabled")
    try:
        return {"acked": _outbox.ack(record_id)}
    except BadRecordId as exc:
        raise HTTPException(400, str(exc)) from exc


@app.websocket("/v1/stream")
async def stream(ws: WebSocket):
    """可选的真流式入口：客户端持续推 PCM，服务端做 VAD。

    协议：客户端发二进制帧（16kHz/mono/int16），服务端返回 JSON 事件。
    首帧可以发 `{"anchor_ts": <unix秒>}` 的文本控制帧来对齐墙钟。

    鉴权：WebSocket 不走 HTTP 依赖注入那条路，这里显式校验 header。
    未授权时在 accept 之前 close —— 客户端会收到 HTTP 403，而不是一个
    已建立又立刻断开的连接。
    """
    bad_token = not token_ok(
        extract_supplied_token(ws.headers.get("x-auth-token"), ws.headers.get("authorization")),
        AUTH_TOKEN,
    )
    if bad_token:
        await ws.close()          # 未 accept 即关闭 → 403
        return
    await ws.accept()
    asm = SegmentAssembler(VadConfig())
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if (text := msg.get("text")) is not None:
                import json
                try:
                    ctl = json.loads(text)
                except ValueError:
                    continue
                if "anchor_ts" in ctl:
                    asm.anchor(float(ctl["anchor_ts"]))
                    await ws.send_json({"type": "anchored", "ts": ctl["anchor_ts"]})
                continue
            data = msg.get("bytes")
            if not data:
                continue
            try:
                for seg in asm.push(data):
                    if not is_usable_segment(seg):
                        continue
                    audio = np.frombuffer(seg.pcm, dtype="<i2").astype("float32") / 32768.0
                    r = transcribe_array(audio)
                    await ws.send_json({
                        "type": "final",
                        "start_ts": seg.start_ts,
                        "end_ts": seg.end_ts,
                        "text": r["text"],
                        "confidence": estimate_confidence(r),
                        "bookmarked": seg.bookmarked,
                    })
            except Exception as exc:
                _stats["errors"] += 1
                await ws.send_json({"type": "error", "message": str(exc)})
    except WebSocketDisconnect:
        pass
    finally:
        for seg in asm.flush():
            if is_usable_segment(seg):
                try:
                    audio = np.frombuffer(seg.pcm, dtype="<i2").astype("float32") / 32768.0
                    r = transcribe_array(audio)
                    await ws.send_json({"type": "final", "start_ts": seg.start_ts,
                                        "end_ts": seg.end_ts, "text": r["text"]})
                except Exception:
                    pass
        try:
            await ws.close()
        except Exception:
            pass


@app.on_event("startup")
def _warmup():
    """预热：首次会加载权重/编译图并下载模型，别让用户的第一句话等它。

    预热失败**不阻止服务启动**：这样 /health 仍可用，
    你能从日志和 /health 的 backend_loaded 判断问题出在哪。
    """
    if os.environ.get("ASR_WARMUP", "1") == "1":
        try:
            start_runtime()
            transcribe_array(np.zeros(SAMPLE_RATE, dtype="float32"))
            log.info("warmup done")
        except Exception:
            log.exception("warmup failed (service still starts; see /health)")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("ASR_HOST", "0.0.0.0"),
                port=int(os.environ.get("ASR_PORT", "8765")))
