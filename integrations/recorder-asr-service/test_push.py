"""push_to_sunfleck.py 的单元测试 —— 纯标准库，不写任何知识库。

运行：python3 -m unittest -v test_push
"""

from __future__ import annotations

import json
import os
import time
import unittest
from datetime import datetime

from push_to_sunfleck import (
    Utterance,
    dedupe,
    group_windows,
    load_utterances,
    main,
    render_card,
    window_key,
)

# 2026-09-18 09:12:03 本地时间
T0 = datetime(2026, 9, 18, 9, 12, 3).timestamp()


class TestLoadUtterances(unittest.TestCase):

    def test_reads_app_py_results_shape(self):
        payload = {"results": [
            {"start_ts": T0, "end_ts": T0 + 3, "text": " 你好 ", "confidence": 0.9},
            {"start_ts": T0 + 4, "end_ts": T0 + 6, "text": "", "confidence": 0.5},
        ]}
        utts = load_utterances(payload)
        self.assertEqual(len(utts), 1)                  # 空文本被丢弃
        self.assertEqual(utts[0].text, "你好")           # 首尾空白被清理
        self.assertEqual(utts[0].start_ts, T0)

    def test_relative_seconds_are_offset_by_anchor(self):
        payload = {"anchor_ts": T0, "segments": [
            {"start": 1.5, "end": 3.0, "text": "第一句"},
            {"start": 5.0, "end": 6.0, "text": "第二句"},
        ]}
        utts = load_utterances(payload)
        self.assertEqual(len(utts), 2)
        self.assertAlmostEqual(utts[0].start_ts, T0 + 1.5, places=3)
        self.assertAlmostEqual(utts[1].start_ts, T0 + 5.0, places=3)

    def test_bare_list_and_single_object(self):
        self.assertEqual(len(load_utterances([{"start_ts": T0, "text": "a"}])), 1)
        self.assertEqual(len(load_utterances({"start_ts": T0, "text": "a"})), 1)

    def test_output_is_time_sorted(self):
        utts = load_utterances([
            {"start_ts": T0 + 10, "text": "后"},
            {"start_ts": T0 + 1, "text": "前"},
        ])
        self.assertEqual([u.text for u in utts], ["前", "后"])

    def test_rejects_unknown_shape(self):
        with self.assertRaises(ValueError):
            load_utterances("nonsense")


class TestDedupe(unittest.TestCase):
    def test_collapses_identical_text_at_same_time(self):
        # 实时流与文件回补重叠时会重复投递同一句
        utts = [Utterance(T0, T0 + 2, "重复的句子"),
                Utterance(T0, T0 + 2, "重复的句子"),
                Utterance(T0 + 3, T0 + 4, "另一句")]
        self.assertEqual(len(dedupe(utts)), 2)

    def test_collapses_near_duplicate_from_dual_path(self):
        # 关键场景：流式与回补两条路给出的时间戳差几百毫秒，也要折叠
        utts = [Utterance(T0, T0 + 2, "同一句话"),
                Utterance(T0 + 0.4, T0 + 2.4, "同一句话")]
        self.assertEqual(len(dedupe(utts)), 1)

    def test_keeps_same_text_at_different_times(self):
        # 同一句话在不同时间说两次是真实信息，不能折叠
        utts = [Utterance(T0, T0 + 2, "好的"), Utterance(T0 + 60, T0 + 62, "好的")]
        self.assertEqual(len(dedupe(utts)), 2)

    def test_keeps_repeat_just_outside_tolerance(self):
        # 边界：刚好超过容忍窗口就必须保留，否则会吃掉真实的重复发言
        utts = [Utterance(T0, T0 + 1, "好"), Utterance(T0 + 0.8, T0 + 1.8, "好")]
        self.assertEqual(len(dedupe(utts, tolerance_s=0.75)), 2)

    def test_different_text_near_in_time_is_kept(self):
        utts = [Utterance(T0, T0 + 1, "第一句"), Utterance(T0 + 0.2, T0 + 1.2, "第二句")]
        self.assertEqual(len(dedupe(utts)), 2)


class TestWindowing(unittest.TestCase):
    def test_window_key_aligns_to_boundary(self):
        k = window_key(datetime(2026, 9, 18, 9, 47, 30).timestamp(), 30)
        self.assertEqual(k, "2026-09-18 09:30")

    def test_groups_crossing_hour(self):
        utts = [Utterance(datetime(2026, 9, 18, 9, 59, 0).timestamp(), 0, "a"),
                Utterance(datetime(2026, 9, 18, 10, 1, 0).timestamp(), 0, "b")]
        self.assertEqual(len(group_windows(utts, 30)), 2)


class TestRenderCard(unittest.TestCase):
    def test_frontmatter_and_timestamps(self):
        utts = [Utterance(T0, T0 + 3, "讨论了排期"),
                Utterance(T0 + 10, T0 + 12, "确认周五给初稿")]
        title, body = render_card("2026-09-18 09:00", utts)
        self.assertIn("2026-09-18 09:00", title)
        self.assertTrue(body.startswith("---"))
        self.assertIn("layer: raw", body)
        self.assertIn("utterances: 2", body)
        self.assertIn("09:12:03", body)
        self.assertIn("讨论了排期", body)

    def test_low_confidence_is_flagged(self):
        _, body = render_card("2026-09-18 09:00",
                              [Utterance(T0, T0 + 2, "听不清的话", confidence=0.42)])
        self.assertIn("低置信", body)

    def test_bookmark_section_appears_only_when_present(self):
        plain = render_card("2026-09-18 09:00", [Utterance(T0, T0 + 2, "普通")])[1]
        marked = render_card("2026-09-18 09:00",
                             [Utterance(T0, T0 + 2, "重要", bookmarked=True)])[1]
        self.assertNotIn("⭐ 重点标记", plain)
        self.assertIn("⭐ 重点标记", marked)

    def test_empty_text_never_produces_a_card(self):
        # load_utterances 已过滤空文本；这里确认渲染层也不会产出空壳
        utts = load_utterances({"results": [{"start_ts": T0, "text": "   "}]})
        self.assertEqual(utts, [])


class TestCliDryRun(unittest.TestCase):
    """--dry-run 必须完全不碰网络。"""

    def test_dry_run_prints_and_exits_zero(self):
        payload = {"results": [
            {"start_ts": T0, "end_ts": T0 + 2, "text": "测试一句话"},
        ]}
        import contextlib
        import io as _io
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump(payload, fh)
            path = fh.name
        buf = _io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = main(["--in", path, "--dry-run"])
        self.assertEqual(rc, 0)
        out = buf.getvalue()
        self.assertIn("测试一句话", out)
        self.assertIn("09:00", out)

    def test_missing_base_id_without_dry_run_is_rejected(self):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump({"results": [{"start_ts": T0, "end_ts": T0 + 1, "text": "x"}]}, fh)
            path = fh.name
        with self.assertRaises(SystemExit):
            main(["--in", path])          # 既没 --out-dir 也没 --base-id


class TestCliOutDir(unittest.TestCase):
    """--out-dir 是推荐路径：只落文件、绝不发网络请求。"""

    def _payload_file(self, obj):
        import tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as fh:
            json.dump(obj, fh)
        return fh.name

    def test_writes_card_file_with_safe_name(self):
        import tempfile
        out = tempfile.mkdtemp(prefix="cards-")
        path = self._payload_file({"results": [
            {"start_ts": T0, "end_ts": T0 + 2, "text": "落地成卡片"}]})
        rc = main(["--in", path, "--out-dir", out])
        self.assertEqual(rc, 0)
        files = os.listdir(out)
        self.assertEqual(len(files), 1)
        # 文件名里不能有空格或冒号，否则跨平台/命令行引用会出问题
        self.assertNotIn(" ", files[0])
        self.assertNotIn(":", files[0])
        self.assertTrue(files[0].endswith(".md"))
        body = open(os.path.join(out, files[0]), encoding="utf-8").read()
        self.assertIn("落地成卡片", body)
        self.assertIn("layer: raw", body)

    def test_accepts_outbox_envelope(self):
        """outbox 的 {"payload": {"results": [...]}} 外层包装要能直接喂进来。"""
        import tempfile
        out = tempfile.mkdtemp(prefix="cards-")
        path = self._payload_file({"id": "x", "payload": {"results": [
            {"start_ts": T0, "end_ts": T0 + 1, "text": "来自出件箱"}]}})
        rc = main(["--in", path, "--out-dir", out])
        self.assertEqual(rc, 0)
        body = open(os.path.join(out, os.listdir(out)[0]), encoding="utf-8").read()
        self.assertIn("来自出件箱", body)

    def test_out_dir_creates_missing_directory(self):
        import tempfile
        nested = os.path.join(tempfile.mkdtemp(prefix="cards-"), "a", "b")
        path = self._payload_file({"results": [
            {"start_ts": T0, "end_ts": T0 + 1, "text": "嵌套目录"}]})
        self.assertEqual(main(["--in", path, "--out-dir", nested]), 0)
        self.assertTrue(os.path.isdir(nested))


if __name__ == "__main__":
    unittest.main(verbosity=2)
