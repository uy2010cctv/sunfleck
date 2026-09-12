# Agent Note：Cua 优先的 Computer Use 路由

状态：已实现

[English](2026-09-12-cua-primary-routing.md) | 中文

## 问题

DSH 宣称 Cua Driver 是桌面执行器，但实际只暴露屏幕尺寸观察。浏览器任务被强制通过 Agent Browser 或 Playwright，因此已登录的银行 SPA 可以导航，DOM 快照却会长时间停在 claimed。模型没有 Cua 窗口状态或控制动作可供切换。

## 决策

面向模型的 `computer_use` 工具现在优先展示 Cua 动作：可见窗口发现、精确窗口无障碍快照、经本机确认的 token/坐标点击，以及经本机确认的 token 文本输入。Agent Browser 保留为隔离浏览器启动和 DOM 后备；Playwright 保留为兼容后备。Cua 窗口快照不向服务器返回截图字节，只返回有界的无障碍树。

## 考虑过的替代方案

**所有浏览器操作直接走 Cua Browser Adapter。** 当前 Cua 运行时在没有厂商签名 Chromium 时会正确拒绝隔离启动，附加已有 Profile 又需要独立的 Host 授权集成。假装此路径可用只会再次产生不透明错误。

**向 DSH 上传整张桌面截图。** 这会暴露无关屏幕内容和登录二维码像素。原生无障碍快照已能解决当前定位问题，无需扩大隐私边界。

## 影响

可见用户 PC 工作可在 DOM 不可读的应用中通过 Cua 恢复，无需让用户口述每个菜单。每个目标都是精确进程/窗口对，控制仍受 Permit 和本机确认约束，过期元素 token 会安全失败。浏览器启动继续由独立 Adapter 负责。
