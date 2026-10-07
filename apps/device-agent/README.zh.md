# dsh-device-agent

[English](README.md) | 中文

本机 Device Plane 代理只接受由 DSH Server 签发且尚未消费的操作许可；浏览器与桌面 Adapter 必须在本机用户的操作系统授权范围内运行。

首期 Adapter 包含 Cua（桌面）、agent-browser（隔离浏览器 Profile）以及 Playwright MCP（兼容模式）。代理不会上传 Cookie、密码、剪贴板或完整屏幕录像，只回传有界的操作摘要和证据哈希。

构建并启动：

```bash
pnpm --filter @deepseek-ai/dsh-device-agent bundle
node apps/device-agent/lib/bin.js --server https://your-dsh-host
```

随后打开 **数字员工 → 我的设备 → 连接此电脑**。配对通过 loopback 自动完成，无需填写设备 ID 或密钥。

对同一挑战与设备重复确认配对会成功，且不会重新启动连接。并发的相同请求共用一次保存；不同设备返回 HTTP 409。保存失败返回 HTTP 503 与 `pairing_completion_failed`，可再次重试。每次确认仍要求请求来自配置的 DSH 来源且挑战匹配。

`GET /v1/status` 只允许配置的 DSH 来源访问。它返回协议与代理版本、操作系统、是否已保存此服务器的连接、浏览器安装情况、SDK 导入状态，以及现有 macOS 辅助功能与屏幕录制授权。SDK 的 `ready` 仅表示导入成功，不表示桌面操作已获授权。此只读检查不会启动驱动、请求授权、截取屏幕，也不返回设备标识、身份密钥、挑战、本地路径或环境变量值。非 macOS 的权限状态为 `unsupported`；探测失败返回 `unknown` 或 `failed` 与安全诊断码。状态提供方缺失或失败时返回 HTTP 503 与 `diagnostics_unavailable`。

Loopback 请求体上限为 1 MiB，超限返回 HTTP 413。配对确认要求 JSON 内容类型，其他媒体类型返回 HTTP 415。
