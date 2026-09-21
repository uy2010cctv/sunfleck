"""录音卡片 → 文字 的纯逻辑核心（无第三方依赖，可在任意 Python 3.9+ 上单测）。

职责边界：
  * 把 SDK 回调里的 160 字节 Opus 包切成 4 个 40 字节独立帧；
  * 用轻量能量 VAD 把连续 PCM 流切成"语音段"；
  * 维护"墙钟时间 ↔ 采样点"映射，使每段都能标注真实发生的时刻（不是相对秒数）。

本模块**不做** Opus 解码（需要 libopus），也**不做** ASR（在 Mac mini 上跑）。
它们由 app.py 调用，本模块只负责决定"把哪一段送去识别、这一段对应什么时间"。

之所以把它独立出来：这是整条链路里最容易出错、又完全不需要模型就能验证的部分。
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterator, List, Optional, Sequence

# ---------------------------------------------------------------------------
# 音频常量（来自《录音卡片 SDK 手册 V1.0》9.1 节，勿改）
# ---------------------------------------------------------------------------

SAMPLE_RATE = 16_000          # 16 kHz
CHANNELS = 1                  # 单声道
SAMPLE_WIDTH = 2              # int16
FRAME_MS = 20                 # 单帧 20 ms
FRAME_BYTES = 40              # 单帧 40 字节（Opus）
PACKET_FRAMES = 4             # 一包 4 帧
PACKET_BYTES = 160            # 一包 160 字节
PACKET_MS = 80                # 一包 80 ms

SAMPLES_PER_FRAME = SAMPLE_RATE * FRAME_MS // 1000        # 320
SAMPLES_PER_PACKET = SAMPLES_PER_FRAME * PACKET_FRAMES    # 1280
BYTES_PER_SAMPLE_FRAME = SAMPLES_PER_FRAME * SAMPLE_WIDTH # 640


class ProtocolError(ValueError):
    """收到的包不符合 SDK 约定的字节长度。"""


def split_opus_packet(packet: bytes) -> List[bytes]:
    """把 160 字节的实时流包切成 4 个 40 字节独立 Opus 帧。

    手册 9.2 明确："不可将整包直接送入解码器"。不足 160 字节时抛错而不是
    静默补齐——静默补齐会让丢包变成难以察觉的音质问题。
    """
    if len(packet) != PACKET_BYTES:
        raise ProtocolError(f"expected {PACKET_BYTES}-byte packet, got {len(packet)}")
    return [packet[i:i + FRAME_BYTES] for i in range(0, PACKET_BYTES, FRAME_BYTES)]


def wav_header(num_samples: int) -> bytes:
    """生成 16 kHz / 单声道 / 16-bit 的 44 字节 WAV 头。"""
    data_bytes = num_samples * SAMPLE_WIDTH
    byte_rate = SAMPLE_RATE * CHANNELS * SAMPLE_WIDTH
    return (
        b"RIFF" + (36 + data_bytes).to_bytes(4, "little") + b"WAVE"
        + b"fmt " + (16).to_bytes(4, "little")
        + (1).to_bytes(2, "little")                       # PCM
        + CHANNELS.to_bytes(2, "little")
        + SAMPLE_RATE.to_bytes(4, "little")
        + byte_rate.to_bytes(4, "little")
        + (CHANNELS * SAMPLE_WIDTH).to_bytes(2, "little")  # block align
        + (SAMPLE_WIDTH * 8).to_bytes(2, "little")         # bits per sample
        + b"data" + data_bytes.to_bytes(4, "little")
    )


def pcm16_rms(pcm: bytes) -> float:
    """int16 小端 PCM 的均方根。纯 stdlib 实现，避免为 VAD 引入 numpy。

    array 模块比 struct 循环快得多，且同样是标准库。
    """
    import array
    if not pcm:
        return 0.0
    samples = array.array("h")
    samples.frombytes(pcm[: len(pcm) // 2 * 2])
    if not samples:
        return 0.0
    # 先累加平方，最后开方，避免每点一次 float 除法
    acc = 0
    for s in samples:
        acc += s * s
    return (acc / len(samples)) ** 0.5


@dataclass
class VadConfig:
    """带迟滞的能量 VAD 参数。

    speech_rms 是"进入语音"的门槛，exit_rms 是"离开语音"的门槛，前者更高，
    形成迟滞，避免在门槛附近抖动导致碎片化分段。
    """
    speech_rms: float = 500.0
    exit_rms: float = 300.0
    min_speech_ms: int = 240        # 短于此的"语音"判为噪声丢弃
    min_silence_ms: int = 600       # 静音持续多久算一段结束
    max_segment_ms: int = 15_000    # 单段上限，防止长独白无限增长
    pad_ms: int = 200               # 段首尾各留一点，避免切掉字头字尾


@dataclass
class Segment:
    """一段连续语音，携带墙钟时间与采样点区间。"""
    start_ts: float          # Unix 秒（墙钟），对应第一帧
    end_ts: float            # Unix 秒，对应最后一帧结束
    pcm: bytes = b""         # 原始 PCM16 LE，供 ASR 直接使用
    speech_ms: int = 0
    bookmarked: bool = False  # 设备"重点标记"（协议实时转写 cmd 5）

    @property
    def duration_ms(self) -> int:
        return int(len(self.pcm) / SAMPLE_WIDTH / SAMPLE_RATE * 1000)

    def to_wav(self) -> bytes:
        return wav_header(len(self.pcm) // SAMPLE_WIDTH) + self.pcm


class SegmentAssembler:
    """把 PCM 帧流按静音边界组装成 Segment。

    使用方式（音频线程调用）::

        asm = SegmentAssembler(wall_clock_sync=1695028320.0)
        for pcm_frame in frames:                 # 每帧恰好 20 ms
            for seg in asm.push(pcm_frame):
                send_to_asr(seg)

    墙钟同步：调用 :meth:`anchor` 告诉它"此刻的采样点对应哪个 Unix 时间"。
    手册要求连接后必须 syncTime()，正是为了让这个映射可用。
    """

    def __init__(self, cfg: Optional[VadConfig] = None) -> None:
        self.cfg = cfg or VadConfig()
        self._anchor_ts: Optional[float] = None
        self._anchor_samples = 0
        self._samples_seen = 0              # 自 anchor 起累计采样点
        self._in_speech = False
        self._speech_start_ts: float = 0.0
        self._speech_pcm: List[bytes] = []
        self._trailing_silence_ms = 0
        self._speech_ms = 0
        self._bookmarked = False
        self._dropped_short = 0

    # -- 时间映射 ---------------------------------------------------------

    def anchor(self, unix_ts: float) -> None:
        """声明"当前采样位置对应 unix_ts"，并重置缓冲。

        每次 BLE 断连重连后都应重新 anchor——断连期间设备仍在录音，时间会漂。
        """
        self._anchor_ts = unix_ts
        self._anchor_samples = 0
        self._samples_seen = 0
        self._in_speech = False
        self._speech_pcm = []
        self._trailing_silence_ms = 0
        self._speech_ms = 0

    def _ts_of(self, sample_index: int) -> float:
        if self._anchor_ts is None:
            raise RuntimeError("anchor() must be called before ts mapping")
        return self._anchor_ts + (sample_index - self._anchor_samples) / SAMPLE_RATE

    # -- 主循环 -----------------------------------------------------------

    def push(self, pcm_frame: bytes, bookmarked: bool = False) -> List[Segment]:
        """喂入一帧 PCM16 LE（应为 20 ms = 640 字节），返回本次闭合的语音段。"""
        if len(pcm_frame) % SAMPLE_WIDTH:
            raise ProtocolError("pcm frame length must be a multiple of 2")
        if bookmarked:
            self._bookmarked = True

        rms = pcm16_rms(pcm_frame)
        frame_ms = int(len(pcm_frame) / SAMPLE_WIDTH / SAMPLE_RATE * 1000)
        out: List[Segment] = []

        if not self._in_speech:
            if rms >= self.cfg.speech_rms:
                self._in_speech = True
                self._speech_start_ts = self._ts_of(self._samples_seen)
                self._speech_pcm = [pcm_frame]
                self._speech_ms = frame_ms
                self._trailing_silence_ms = 0
            # 静音期：不缓存、不产数据 —— 这就是"无人说话不耗算力"
        else:
            self._speech_pcm.append(pcm_frame)
            self._speech_ms += frame_ms
            if rms < self.cfg.exit_rms:
                self._trailing_silence_ms += frame_ms
            else:
                self._trailing_silence_ms = 0

            ends_by_silence = self._trailing_silence_ms >= self.cfg.min_silence_ms
            ends_by_length = self._speech_ms >= self.cfg.max_segment_ms
            if ends_by_silence or ends_by_length:
                out.append(self._close(forced=ends_by_length))

        self._samples_seen += len(pcm_frame) // SAMPLE_WIDTH
        return out

    def _close(self, forced: bool) -> Segment:
        # 注意：_speech_ms 是"自语音开始以来的全部帧"，其中已包含尾部静音。
        # 真正有效的人声时长必须减去尾部静音，否则"一声短促的咔哒 + 长时间静音"
        # 会被算成一段很长的语音，反而逃过 min_speech_ms 的过滤。
        total_ms = self._speech_ms
        trailing_ms = self._trailing_silence_ms
        voiced_ms = max(0, total_ms - trailing_ms)

        pcm = b"".join(self._speech_pcm)
        if not forced:
            # 去掉尾部静音，只保留 voiced + pad_ms 的余量
            keep_ms = min(voiced_ms + self.cfg.pad_ms, total_ms)
            keep_samples = int(keep_ms * SAMPLE_RATE / 1000)
            pcm = pcm[: keep_samples * SAMPLE_WIDTH]

        too_short = voiced_ms < self.cfg.min_speech_ms
        start_ts = self._speech_start_ts
        end_ts = start_ts + voiced_ms / 1000.0

        seg = Segment(
            start_ts=start_ts,
            end_ts=end_ts,
            pcm=b"" if too_short else pcm,
            speech_ms=voiced_ms,
            bookmarked=self._bookmarked,
        )
        if too_short:
            self._dropped_short += 1

        self._in_speech = False
        self._speech_pcm = []
        self._speech_ms = 0
        self._trailing_silence_ms = 0
        self._bookmarked = False
        return seg

    def flush(self) -> List[Segment]:
        """流结束/断连时调用，吐出尚未闭合的段。"""
        if self._in_speech:
            return [self._close(forced=True)]
        return []

    # -- 观测 -------------------------------------------------------------

    @property
    def dropped_short_segments(self) -> int:
        return self._dropped_short


def iter_packets_to_frames(packets: Iterable[bytes]) -> Iterator[bytes]:
    """便捷生成器：把连续 160 字节包展开成 40 字节 Opus 帧序列。"""
    for p in packets:
        yield from split_opus_packet(p)


def is_usable_segment(seg: Segment) -> bool:
    """过短/被丢弃的段不进 ASR——省算力，也避免 Whisper 在噪声上产生幻觉。"""
    return bool(seg.pcm) and seg.speech_ms >= 240
