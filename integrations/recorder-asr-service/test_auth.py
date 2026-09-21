"""auth.py 的单元测试 —— 纯标准库。"""

from __future__ import annotations

import unittest

from auth import extract_supplied_token, token_ok


class TestExtractSuppliedToken(unittest.TestCase):

    def test_prefers_dedicated_header(self):
        self.assertEqual(extract_supplied_token("abc", "Bearer xyz"), "abc")

    def test_reads_bearer_header_case_insensitively(self):
        self.assertEqual(extract_supplied_token(None, "bearer xyz"), "xyz")
        self.assertEqual(extract_supplied_token(None, "BEARER xyz"), "xyz")

    def test_ignores_non_bearer_authorization(self):
        # Basic / Digest 之类不应被误当成我们的 token
        self.assertIsNone(extract_supplied_token(None, "Basic dXNlcjpwYXNz"))

    def test_returns_none_for_blank_inputs(self):
        self.assertIsNone(extract_supplied_token(None, None))
        self.assertIsNone(extract_supplied_token("", ""))
        self.assertIsNone(extract_supplied_token("   ", "Bearer   "))

    def test_strips_surrounding_whitespace(self):
        # 手机端复制粘贴很容易带入换行/空格，不该因此 401
        self.assertEqual(extract_supplied_token("  abc\n", None), "abc")
        self.assertEqual(extract_supplied_token(None, "Bearer  abc  "), "abc")


class TestTokenOk(unittest.TestCase):

    def test_unset_expected_disables_check(self):
        # 未配置 token 时一律放行，方便首次联调
        self.assertTrue(token_ok(None, None))
        self.assertTrue(token_ok(None, ""))
        self.assertTrue(token_ok("whatever", "   "))

    def test_matching_token_passes(self):
        self.assertTrue(token_ok("s3cret", "s3cret"))

    def test_missing_or_wrong_token_fails(self):
        self.assertFalse(token_ok(None, "s3cret"))
        self.assertFalse(token_ok("", "s3cret"))
        self.assertFalse(token_ok("s3cre", "s3cret"))
        self.assertFalse(token_ok("s3cret ", "s3cret"))   # token 内部不 strip

    def test_is_not_prefix_match(self):
        # 防"猜前缀"：任何非完整匹配都必须失败
        for guess in ("s", "s3", "s3cr", "s3cre", "s3cretx"):
            self.assertFalse(token_ok(guess, "s3cret"), guess)

    def test_empty_expected_string_with_whitespace_is_disabled(self):
        self.assertTrue(token_ok(None, "  "))


if __name__ == "__main__":
    unittest.main(verbosity=2)
