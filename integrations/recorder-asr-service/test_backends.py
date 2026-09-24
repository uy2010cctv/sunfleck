"""backends.py 的单元测试 —— 纯标准库，不需要 funasr / faster-whisper / torch。

重点覆盖 FunASR 结果规整：毫秒→秒、sentence_info 嵌套、说话人标签、
缺字段退化。这些是接真实模型前最容易出错、又完全能离线验证的部分。
"""

from __future__ import annotations

import unittest

from backends import (
    FasterWhisperBackend,
    FunAsrBackend,
    OnlineAsrBackend,
    _ms_to_s,
    _speaker_label,
    attach_segment_metadata,
    build_backend,
    estimate_logprob_confidence,
    normalize_funasr_result,
)


class TestMsToS(unittest.TestCase):
    def test_converts_milliseconds_to_seconds(self):
        self.assertEqual(_ms_to_s(0), 0.0)
        self.assertEqual(_ms_to_s(1500), 1.5)
        self.assertEqual(_ms_to_s("2500"), 2.5)

    def test_rejects_invalid_values(self):
        for bad in (None, "", "abc", -1, -0.5):
            self.assertIsNone(_ms_to_s(bad), bad)


class TestSpeakerLabel(unittest.TestCase):
    def test_prefixes_cluster_ids(self):
        # 刻意加 spk_ 前缀：FunASR 的 spk 是聚类编号，不是人名
        self.assertEqual(_speaker_label(0), "spk_0")
        self.assertEqual(_speaker_label("1"), "spk_1")

    def test_missing_speaker_is_none(self):
        self.assertIsNone(_speaker_label(None))
        self.assertIsNone(_speaker_label(""))

    def test_segment_metadata_keeps_stable_id_and_sentence_speakers(self):
        row = attach_segment_metadata(
            {"text": "你好", "segments": [{"start": 0.1, "end": 0.8, "text": "你好", "speaker": "spk_1"}]},
            segment_id="seg-1", start_ts=100.0, end_ts=101.0, device_sn="CB08",
        )
        self.assertEqual(row["segment_id"], "seg-1")
        self.assertEqual(row["start_ts"], 100.0)
        self.assertEqual(row["speaker"], "spk_1")
        self.assertEqual(row["speakers"], ["spk_1"])


class TestNormalizeWithSentenceInfo(unittest.TestCase):

    def _raw(self):
        return [{
            "key": "utt1",
            "text": "今天先过一下录音卡片这条线周五之前把接口定下来",
            "sentence_info": [
                {"start": 0, "end": 3200, "text": "今天先过一下录音卡片这条线", "spk": 0},
                {"start": 3200, "end": 6500, "text": "周五之前把接口定下来", "spk": 1},
            ],
        }]

    def test_converts_ms_to_seconds(self):
        r = normalize_funasr_result(self._raw(), audio_seconds=6.5, infer_seconds=0.7)
        self.assertEqual(len(r["segments"]), 2)
        self.assertEqual(r["segments"][0]["start"], 0.0)
        self.assertEqual(r["segments"][0]["end"], 3.2)
        self.assertEqual(r["segments"][1]["start"], 3.2)
        self.assertEqual(r["segments"][1]["end"], 6.5)

    def test_offset_shifts_all_timestamps(self):
        r = normalize_funasr_result(self._raw(), offset_s=1_700_000_000.0,
                                    audio_seconds=6.5, infer_seconds=0.7)
        self.assertAlmostEqual(r["segments"][0]["start"], 1_700_000_000.0, places=3)
        self.assertAlmostEqual(r["segments"][1]["end"], 1_700_000_006.5, places=3)

    def test_speakers_are_collected_and_deduplicated(self):
        r = normalize_funasr_result(self._raw(), audio_seconds=6.5)
        self.assertEqual(r["speakers"], ["spk_0", "spk_1"])

        self.assertEqual(r["segments"][1]["speaker"], "spk_1")

    def test_no_speaker_model_yields_none(self):
        raw = [{"text": "只有文字", "sentence_info": [
            {"start": 0, "end": 1000, "text": "只有文字"}]}]
        r = normalize_funasr_result(raw, audio_seconds=1.0)
        self.assertIsNone(r["segments"][0]["speaker"])
        self.assertEqual(r["speakers"], [])

    def test_rtf_is_computed(self):
        r = normalize_funasr_result(self._raw(), audio_seconds=10.0, infer_seconds=1.5)
        self.assertEqual(r["rtf"], 0.15)

    def test_confidence_is_none_because_funasr_does_not_provide_it(self):
        # 宁可 None 也不编一个假分数，否则下游的"低置信保留音频"策略会失效
        r = normalize_funasr_result(self._raw(), audio_seconds=6.5)
        self.assertIsNone(r["confidence"])

    def test_empty_sentence_is_skipped(self):
        raw = [{"text": "有内容的", "sentence_info": [
            {"start": 0, "end": 500, "text": "   "},
            {"start": 500, "end": 900, "text": "有内容的"},
        ]}]
        r = normalize_funasr_result(raw, audio_seconds=0.9)
        self.assertEqual(len(r["segments"]), 1)
        self.assertEqual(r["segments"][0]["text"], "有内容的")


class TestNormalizeFallbacks(unittest.TestCase):

    def test_text_without_sentence_info_becomes_single_span(self):
        # 没有句子级切分时不要拿 timestamp 硬对字符（官方文档明确警告不是一对一）
        raw = [{"text": "一整段话", "timestamp": [[0, 500], [500, 900], [900, 1200]]}]
        r = normalize_funasr_result(raw, offset_s=100.0, audio_seconds=1.2)
        self.assertEqual(len(r["segments"]), 1)
        self.assertEqual(r["segments"][0]["start"], 100.0)
        self.assertEqual(r["segments"][0]["end"], 101.2)
        self.assertEqual(r["segments"][0]["text"], "一整段话")

    def test_text_only_without_duration_has_open_end(self):
        r = normalize_funasr_result([{"text": "无时长信息"}], offset_s=5.0)
        self.assertIsNone(r["segments"][0]["end"])
        self.assertIsNone(r["duration"])

    def test_empty_input(self):
        for empty in ([], None, [{}], [{"text": "   "}]):
            r = normalize_funasr_result(empty)
            self.assertEqual(r["text"], "", repr(empty))
            self.assertEqual(r["segments"], [], repr(empty))

    def test_single_dict_is_wrapped(self):
        r = normalize_funasr_result({"text": "单个 dict"}, audio_seconds=1.0)
        self.assertEqual(r["text"], "单个 dict")

    def test_unexpected_type_raises(self):
        with self.assertRaises(ValueError):
            normalize_funasr_result("not a result")

    def test_non_dict_items_are_ignored(self):
        r = normalize_funasr_result([None, 42, {"text": "有效"}], audio_seconds=1.0)
        self.assertEqual(r["text"], "有效")


class TestBuildBackend(unittest.TestCase):

    def test_funasr_defaults(self):
        b = build_backend("funasr")
        self.assertIsInstance(b, FunAsrBackend)
        self.assertEqual(b.model_id, "paraformer-zh")
        self.assertEqual(b.vad_model, "fsmn-vad")
        self.assertEqual(b.punc_model, "ct-punc")
        self.assertIsNone(b.spk_model)          # 说话人默认关，按需开
        self.assertEqual(b.device, "cpu")

    def test_funasr_speaker_model_can_be_enabled(self):
        b = build_backend("funasr", spk_model="cam++")
        self.assertEqual(b.spk_model, "cam++")

    def test_whisper_aliases(self):
        for alias in ("faster-whisper", "faster_whisper", "whisper"):
            self.assertIsInstance(build_backend(alias), FasterWhisperBackend)

    def test_unknown_backend_raises_instead_of_silently_falling_back(self):
        # 静默回退会让"我以为在用 Paraformer"这种误判极难发现
        with self.assertRaises(ValueError) as ctx:
            build_backend("sensevoice-typo")
        self.assertIn("unknown ASR backend", str(ctx.exception))

    def test_case_and_whitespace_insensitive(self):
        self.assertIsInstance(build_backend("  FunASR "), FunAsrBackend)

    def test_online_asr_uses_openai_compatible_response(self):
        captured = {}

        def post(endpoint, credential, model, wav_data):
            captured.update(endpoint=endpoint, credential=credential, model=model, wav=wav_data)
            return {"text": "你好世界", "segments": [{"start": 0.0, "end": 0.5, "text": "你好世界"}]}

        backend = OnlineAsrBackend("https://example.test/v1/audio/transcriptions", "secret", "whisper-1", post=post)
        result = backend.transcribe([0.0] * 16_000)
        self.assertEqual(result["text"], "你好世界")
        self.assertIsNone(result["segments"][0]["speaker"])
        self.assertEqual(captured["credential"], "secret")
        self.assertTrue(captured["wav"].startswith(b"RIFF"))


class TestLogprobConfidence(unittest.TestCase):

    def test_high_logprob_gives_high_confidence(self):
        c = estimate_logprob_confidence([{"avg_logprob": -0.1}, {"avg_logprob": -0.2}])
        self.assertGreater(c, 0.85)

    def test_low_logprob_gives_low_confidence(self):
        c = estimate_logprob_confidence([{"avg_logprob": -1.5}])
        self.assertLess(c, 0.4)

    def test_no_logprob_returns_none(self):
        self.assertIsNone(estimate_logprob_confidence([{"text": "x"}]))

    def test_result_is_clamped_to_unit_interval(self):
        self.assertEqual(estimate_logprob_confidence([{"avg_logprob": -99}]), 0.0)
        self.assertEqual(estimate_logprob_confidence([{"avg_logprob": 99}]), 1.0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
