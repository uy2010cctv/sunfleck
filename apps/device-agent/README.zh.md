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
