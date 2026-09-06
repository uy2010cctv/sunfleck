# Agent Note：Web 已认证恢复页面

状态：已实现

[English](2026-09-06-web-authenticated-recovery-page.md) | 中文

## 问题

缺失或过期的浏览器 cookie 会在 Web Client 挂载前收到纯文本 401，客户端启动失败也只显示原因而没有恢复操作。终态 Host 传输失败可能让应用保持可见，但根级没有恢复控件。

## 决策

`BrowserAuth` 会为未认证的 index 请求返回自包含的 401 HTML 文档。该文档说明认证失败，要求操作者重新打开 `dsh web` 打印的 URL，并且只重试当前文档。它不包含启动令牌，也不能生成令牌。进程范围的启动令牌仍是短生命周期；绑定 authority 的签名 cookie 仍是唯一的重启恢复凭据。

无框架启动页增加显式重试，重新加载精确的文档 URL。应用挂载后，`AppWebEntry` 观察终态 `ctx.connection.state === 'disconnected'`，并在 React 渲染器外放置重连提示。重连调用现有的 `ctx.connection.reconnect()` 命令，不卸载选中的路由、Workspace、Session 或应用拥有的草稿状态。

## 考虑过的替代方案

**持久化启动令牌。** 不予采纳，因为启动能力不能成为可重用的浏览器凭据。既有签名 cookie 能在不延长令牌生命周期的情况下跨 Host 重启保留有效会话。

**向未认证请求提供正常应用。** 不予采纳，因为 BrowserAuth 建立会话之前 bundle 和 RPC 会变得可访问。静态恢复文档不执行认证操作。

**传输中断时重新加载页面。** 不予采纳，因为重新加载会丢失内存中的路由和选中状态。重连控件保留已挂载应用，并把载体恢复委托给既有 Connection controller。

## 后果

过期的浏览器会话仍要求操作者从 `dsh web` 获取当前启动 URL；恢复页不能独立完成认证。具有有效签名 cookie 的 Host 重启可正常重新加载，而终态传输丢失会显示重连操作，不削弱 Host 或 Origin 检查。

## 测试

BrowserAuth 测试验证不含令牌的 401 恢复输出，并保留 cookie、令牌轮换、篡改、过期和 authority 检查。client-web 测试验证启动重试行为及断开传输提示：它会保留已有挂载内容再执行重连。frontend-static 组合测试验证被服务的 401 文档。
