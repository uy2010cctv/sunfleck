"""outbox.py 的单元测试 —— 纯标准库，不写 SUNFLECK、不发网络请求。"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
import unittest

from outbox import BadRecordId, Outbox, OutboxError


class OutboxTestBase(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp(prefix="outbox-test-")
        self.box = Outbox(self.root)

    def tearDown(self):
        shutil.rmtree(self.root, ignore_errors=True)


class TestPutAndGet(OutboxTestBase):

    def test_put_then_get_roundtrip(self):
        rid = self.box.put({"results": [{"text": "你好"}]}, meta={"device_sn": "SN1"})
        rec = self.box.get(rid)
        self.assertEqual(rec["id"], rid)
        self.assertEqual(rec["payload"]["results"][0]["text"], "你好")
        self.assertEqual(rec["meta"]["device_sn"], "SN1")

    def test_unicode_is_not_escaped_on_disk(self):
        # 中文转写必须原样可读，便于用 cat 排障
        rid = self.box.put({"text": "会议记录"})
        with open(os.path.join(self.root, f"{rid}.json"), encoding="utf-8") as fh:
            raw = fh.read()
        self.assertIn("会议记录", raw)

    def test_no_leftover_temp_files_after_put(self):
        self.box.put({"a": 1})
        leftovers = [n for n in os.listdir(self.root) if n.startswith(".")]
        self.assertEqual(leftovers, [])

    def test_ids_are_unique_even_within_same_millisecond(self):
        ids = {self.box.put({"i": i}) for i in range(50)}
        self.assertEqual(len(ids), 50)


class TestList(OutboxTestBase):

    def test_list_is_time_ascending(self):
        a = self.box.put({"n": 1})
        time.sleep(0.02)
        b = self.box.put({"n": 2})
        ids = [i.id for i in self.box.list()]
        self.assertEqual(ids, [a, b])

    def test_since_filters_older_items(self):
        self.box.put({"n": 1})
        time.sleep(0.05)
        cutoff = time.time()
        time.sleep(0.02)
        newer = self.box.put({"n": 2})
        ids = [i.id for i in self.box.list(since=cutoff)]
        self.assertEqual(ids, [newer])

    def test_limit_caps_result(self):
        for i in range(5):
            self.box.put({"i": i})
        self.assertEqual(len(self.box.list(limit=2)), 2)

    def test_ignores_foreign_and_temp_files(self):
        self.box.put({"ok": True})
        open(os.path.join(self.root, "README.txt"), "w").close()
        open(os.path.join(self.root, ".half-written.tmp"), "w").close()
        self.assertEqual(len(self.box.list()), 1)          # 不因异物报错

    def test_stats_reports_pending(self):
        self.box.put({"a": 1})
        self.box.put({"b": 2})
        s = self.box.stats()
        self.assertEqual(s["pending"], 2)
        self.assertGreater(s["bytes"], 0)
        self.assertLess(s["oldest_ts"], s["newest_ts"] + 1)


class TestAck(OutboxTestBase):

    def test_ack_removes_item(self):
        rid = self.box.put({"x": 1})
        self.assertTrue(self.box.ack(rid))
        self.assertEqual(self.box.list(), [])
        with self.assertRaises(OutboxError):
            self.box.get(rid)

    def test_ack_is_idempotent(self):
        rid = self.box.put({"x": 1})
        self.assertTrue(self.box.ack(rid))
        self.assertFalse(self.box.ack(rid))                # 第二次不再存在

    def test_ack_only_removes_target(self):
        a = self.box.put({"a": 1})
        b = self.box.put({"b": 2})
        self.box.ack(a)
        self.assertEqual([i.id for i in self.box.list()], [b])


class TestPathTraversal(OutboxTestBase):
    """出件箱 id 来自网络请求，必须严格校验，否则可读写任意文件。"""

    def test_rejects_traversal_and_absolute_ids(self):
        for bad in ("../../etc/passwd", "/etc/passwd", "..", "a/b",
                    "1737000000123-1a2b3c4d/../../x", "", None):
            with self.assertRaises(BadRecordId):
                self.box.get(bad)          # type: ignore[arg-type]

    def test_rejects_ids_that_do_not_match_format(self):
        # 时间戳位数不对、hex 长度不对、大小写不对，一律拒绝
        for bad in ("123-1a2b3c4d", "1737000000123-1A2B3C4D",
                    "1737000000123-1a2b3c4", "1737000000123_1a2b3c4d"):
            with self.assertRaises(BadRecordId):
                self.box.ack(bad)

    def test_rejects_traversal_on_ack_too(self):
        # ack 会 unlink，穿越漏洞危害更大，必须同样拦住
        with self.assertRaises(BadRecordId):
            self.box.ack("../../etc/passwd")


class TestCorruption(OutboxTestBase):

    def test_corrupt_file_raises_clear_error(self):
        rid = self.box.put({"x": 1})
        with open(os.path.join(self.root, f"{rid}.json"), "w") as fh:
            fh.write("{ not json")
        with self.assertRaises(OutboxError) as ctx:
            self.box.get(rid)
        self.assertIn("corrupt", str(ctx.exception))

    def test_missing_file_raises_clear_error(self):
        with self.assertRaises(OutboxError) as ctx:
            self.box.get("1737000000123-1a2b3c4d")
        self.assertIn("not found", str(ctx.exception))

    def test_put_rejects_oversized_record(self):
        big = {"blob": "x" * (9 * 1024 * 1024)}
        with self.assertRaises(OutboxError):
            self.box.put(big)


if __name__ == "__main__":
    unittest.main(verbosity=2)
