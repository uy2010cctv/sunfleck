# dsh-device-agent

本机 Device Plane 代理。它只接受由 DSH Server 签发且尚未消费的操作许可；浏览器与桌面 Adapter 必须在本机用户授权范围内运行。

首期 Adapter：`cua`（桌面）、`agent-browser`（隔离浏览器 Profile）、`playwright-mcp`（兼容模式）。

代理不得上传 Cookie、密码、剪贴板或完整屏幕录像；只回传操作摘要、哈希化证据和经用户同意的截图。
