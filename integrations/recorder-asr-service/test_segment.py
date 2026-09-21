"""segment.py 的单元测试 —— 纯标准库，不需要模型/网络/第三方包。

运行：  python3 -m unittest -v test_segment
或      python3 test_segment.py
"""

from __future__ import annotations

import array
import math
import unittest

from segment import (
    BYTES_PER_SAMPLE_FRAME,
    FRAME_MS,
    PACKET_BYTES,
    SAMPLE_RATE,
    ProtocolError,
    SegmentAssembler,
    VadConfig,
    is_usable_segment,
    pcm16_rms,
    split_opus_packet,
    wav_header,
)


# --------------------------------------------------------------------------
# 合成信号工具
# --------------------------------------------------------------------------

def silence(ms: int) -> bytes:
    n = int(SAMPLE_RATE * ms / 1000)
    return b"\x00\x00" * n


def tone(ms: int, freq: float = 440.0, amp: int = 6000) -> bytes:
    n = int(SAMPLE_RATE * ms / 1000)
    a = array.array("h", (int(amp * math.sin(2 * math.pi * freq * i / SAMPLE_RATE)) for i in range(n)))
    return a.tobytes()


def frames(pcm: bytes, frame_ms: int = FRAME_MS):
    """把 PCM 切成与 SDK 实时流同节奏的帧（默认 20ms/帧）。"""
    step = int(SAMPLE_RATE * frame_ms / 1000) * 2
    for i in range(0, len(pcm) - step + 1, step):
        yield pcm[i:i + step]


def run_frames(asm: SegmentAssembler, pcm: bytes, bookmarks: set = frozenset()):
    """喂流，返回闭合的段；bookmarks 是"第几帧打重点标记"的集合。"""
    out = []
    for idx, f in enumerate(frames(pcm)):
        out.extend(asm.push(f, bookmarked=idx in bookmarks))
    return out


# --------------------------------------------------------------------------
# 1. 协议层：160 字节包 → 4×40 字节帧
# --------------------------------------------------------------------------

class TestOpusPacketSplit(unittest.TestCase):
    def test_splits_into_four_40_byte_frames_in_order(self):
        packet = bytes(range(256))[:PACKET_BYTES]
        frames_out = split_opus_packet(packet)
        self.assertEqual(len(frames_out), 4)
        self.assertTrue(all(len(f) == 40 for f in frames_out))
        # 顺序与内容必须原样保留，不能被重排或补零
        self.assertEqual(b"".join(frames_out), packet)

    def test_rejects_wrong_length_instead_of_padding(self):
        # 静默补齐会把丢包伪装成"正常音频"，必须报错
        with self.assertRaises(ProtocolError):
            split_opus_packet(b"\x00" * (PACKET_BYTES - 1))
        with self.assertRaises(ProtocolError):
            split_opus_packet(b"\x00" * (PACKET_BYTES + 1))

    def test_20ms_frame_matches_documented_byte_count(self):
        # 手册：单帧 20ms / 40 字节 → 1 秒约 50 帧
        self.assertEqual(len(tone(FRAME_MS)), BYTES_PER_SAMPLE_FRAME)


# --------------------------------------------------------------------------
# 2. WAV / RMS 工具
# --------------------------------------------------------------------------

class TestWavAndRms(unittest.TestCase):
    def test_wav_header_fields(self):
        h = wav_header(16000)          # 1 秒
        self.assertEqual(len(h), 44)
        self.assertEqual(h[0:4], b"RIFF")
        self.assertEqual(h[8:12], b"WAVE")
        self.assertEqual(int.from_bytes(h[24:28], "little"), SAMPLE_RATE)
        self.assertEqual(int.from_bytes(h[22:24], "little"), 1)     # mono
        self.assertEqual(int.from_bytes(h[34:36], "little"), 16)    # 16-bit
        # data 段 = 16000 样本 × 2 字节
        self.assertEqual(int.from_bytes(h[40:44], "little"), 32000)

    def test_rms_orders_silence_below_tone(self):
        self.assertEqual(pcm16_rms(silence(100)), 0.0)
        self.assertGreater(pcm16_rms(tone(100)), 1000)

    def test_rms_handles_empty_and_odd_length(self):
        self.assertEqual(pcm16_rms(b""), 0.0)
        self.assertEqual(pcm16_rms(b"\x01"), 0.0)   # 单字节不成样本，不应抛错


# --------------------------------------------------------------------------
# 3. VAD 分段
# --------------------------------------------------------------------------

class TestSegmentAssembler(unittest.TestCase):

    def setUp(self):
        self.asm = SegmentAssembler(VadConfig())   # 默认参数
        self.asm.anchor(1_700_000_000.0)

    def test_silence_produces_nothing(self):
        # 用户需求：无人说话时不产数据、不吃算力
        segs = run_frames(self.asm, silence(5000))
        self.assertEqual(segs, [])
        self.assertEqual(self.asm.flush(), [])

    def test_one_utterance_between_silences(self):
        pcm = silence(300) + tone(1000) + silence(900)
        segs = run_frames(self.asm, pcm)
        self.assertEqual(len(segs), 1)
        seg = segs[0]
        # 段起点应是语音开始处（300ms 之后），允许一帧误差
        self.assertAlmostEqual(seg.start_ts, 1_700_000_000.0 + 0.3, delta=0.05)
        # 有效人声时长约 1s，不应把 900ms 静音算进去
        self.assertGreater(seg.speech_ms, 900)
        self.assertLess(seg.speech_ms, 1300)

    def test_short_blip_followed_by_long_silence_is_dropped(self):
        # 回归测试：曾把 trailing silence 计入 speech_ms，导致 60ms 的咔哒声
        # 因为后面跟了 1s 静音而被当成"1060ms 的语音"留存
        pcm = silence(200) + tone(60) + silence(1000)
        segs = run_frames(self.asm, pcm)
        self.assertEqual(len(segs), 1)
        self.assertEqual(segs[0].pcm, b"")              # 被丢弃
        self.assertFalse(is_usable_segment(segs[0]))
        self.assertEqual(self.asm.dropped_short_segments, 1)

    def test_utterance_then_blip_counts_correctly(self):
        pcm = silence(200) + tone(1000) + silence(800) + tone(60) + silence(1000)
        segs = run_frames(self.asm, pcm)
        self.assertEqual(len(segs), 2)
        self.assertTrue(is_usable_segment(segs[0]))
        self.assertFalse(is_usable_segment(segs[1]))

    def test_long_monologue_is_split_at_max_segment(self):
        cfg = VadConfig(max_segment_ms=3000)
        asm = SegmentAssembler(cfg)
        asm.anchor(1_700_000_000.0)
        segs = run_frames(asm, silence(100) + tone(10000))
        self.assertGreaterEqual(len(segs), 3)            # 10s / 3s
        for s in segs[:-1]:
            self.assertLessEqual(s.duration_ms, cfg.max_segment_ms + FRAME_MS * 2)
            self.assertTrue(is_usable_segment(s))

    def test_segments_do_not_overlap_and_advance(self):
        pcm = (silence(300) + tone(1000) + silence(900)) * 3
        segs = run_frames(self.asm, pcm)
        self.assertEqual(len(segs), 3)
        for a, b in zip(segs, segs[1:]):
            self.assertLessEqual(a.end_ts, b.start_ts)

    def test_trailing_silence_is_trimmed_from_pcm(self):
        # 段末应只保留 pad_ms 余量，而不是把整段静音都送进 ASR
        segs = run_frames(self.asm, silence(200) + tone(1000) + silence(1200))
        seg = segs[0]
        self.assertLess(seg.duration_ms, seg.speech_ms + 400)

    def test_flush_emits_open_segment(self):
        run_frames(self.asm, silence(200) + tone(800))
        segs = self.asm.flush()
        self.assertEqual(len(segs), 1)
        self.assertTrue(is_usable_segment(segs[0]))

    def test_bookmark_is_carried_onto_the_segment(self):
        # 设备"重点标记"（协议实时转写 cmd 5）应落到对应段上，供行为层优先处理
        segs = self.asm.push(tone(FRAME_MS), bookmarked=True)
        segs += run_frames(self.asm, tone(800) + silence(900))
        # 标记发生在段首，应归属这段
        self.assertTrue(any(s.bookmarked for s in segs))

    def test_requires_anchor_before_use(self):
        asm = SegmentAssembler()
        with self.assertRaises(RuntimeError):
            asm.push(tone(FRAME_MS))

    def test_reanchor_after_reconnect_keeps_timestamps_monotonic(self):
        # BLE 断连重连后时间会漂，重新 anchor 后新段的时间必须仍然合理
        run_frames(self.asm, silence(200) + tone(600) + silence(800))
        self.asm.anchor(1_700_000_120.0)
        segs = run_frames(self.asm, silence(200) + tone(600) + silence(800))
        self.assertEqual(len(segs), 1)
        self.assertAlmostEqual(segs[0].start_ts, 1_700_000_120.2, delta=0.05)


# --------------------------------------------------------------------------
# 4. 端到端：用真实包大小走一遍
# --------------------------------------------------------------------------

class TestEndToEndByteAccounting(unittest.TestCase):
    def test_one_second_of_packets_yields_expected_pcm(self):
        # 1 秒 = 12.5 个 80ms 包 → 用 800ms 校验字节换算不漂移
        asm = SegmentAssembler()
        asm.anchor(0.0)
        pcm = tone(800)
        self.assertEqual(len(pcm), 800 * SAMPLE_RATE // 1000 * 2)
        segs = run_frames(asm, pcm) + asm.flush()
        self.assertEqual(len(segs), 1)
        self.assertAlmostEqual(segs[0].duration_ms, 800, delta=FRAME_MS * 2)

    def test_wav_output_is_playable_container(self):
        asm = SegmentAssembler()
        asm.anchor(0.0)
        segs = run_frames(asm, tone(600) + silence(900))
        wav = segs[0].to_wav()
        self.assertEqual(wav[:4], b"RIFF")
        self.assertEqual(len(wav) - 44, len(segs[0].pcm))


if __name__ == "__main__":
    unittest.main(verbosity=2)
