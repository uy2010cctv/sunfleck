"""ASR 服务的共享密钥校验（纯标准库，可单测）。

**为什么走 Tailscale 了还要加这一层**：Tailscale 保护的是网络路径，但同一个
tailnet 里的任何设备（包括以后加进来的手机、其他电脑）都能访问 8765 端口。
多一层 token 意味着"网络可达"不等于"可用"，也让轮换凭据和审计成为可能。

设计取舍：
  * 未配置 `ASR_AUTH_TOKEN` 时**不校验**——方便本地开发和首次联调，
    但 `/health` 会明确报出 auth 是否开启，避免"以为开了其实没开"。
  * 用 `hmac.compare_digest` 做常数时间比较，防止通过响应时间逐字节猜 token。
  * 同时接受 `X-Auth-Token` 与 `Authorization: Bearer`，方便手机端和 curl 各取所需。
"""

from __future__ import annotations

import hmac
from typing import Optional

TOKEN_HEADER = "x-auth-token"
BEARER_PREFIX = "bearer "


def extract_supplied_token(
    x_auth_token: Optional[str],
    authorization: Optional[str],
) -> Optional[str]:
    """从两种常见位置取出客户端提交的 token。取不到返回 None。"""
    if x_auth_token:
        token = x_auth_token.strip()
        if token:
            return token
    if authorization and authorization.lower().startswith(BEARER_PREFIX):
        token = authorization[len(BEARER_PREFIX):].strip()
        if token:
            return token
    return None


def token_ok(supplied: Optional[str], expected: Optional[str]) -> bool:
    """校验 token。`expected` 为空表示未启用校验，一律放行。"""
    expected = (expected or "").strip()
    if not expected:
        return True
    if not supplied:
        return False
    return hmac.compare_digest(supplied, expected)
