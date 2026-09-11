# Agent Note：用户自有 Device Plane

Status: implemented

[English](2026-09-11-device-plane.md) | 中文

## 问题

多用户 DSH Host 不能在同一个共享服务器账号中安全运行浏览器和桌面自动化。操作必须在请求用户的电脑上执行，且不得在用户之间共享文件、Profile、Cookie、凭证或操作系统权限。

## 决策

服务端拥有设备注册、受范围约束的 Computer Use Run、类型化动作、一次性 Permit、防重放签名请求和持久结果。本机 `dsh-device-agent` 拥有 Ed25519 私钥、操作系统权限、本机确认、Adapter 进程和证据生成。

浏览器与桌面执行保持分离。`agent-browser` 和 Playwright MCP 只接受类型化浏览器操作，Cua 只接受类型化桌面操作。线上协议禁止通用命令或任意模块路径。默认 `confirm-each` 模式下，控制动作需本机确认。结果不明的已领取动作绝不自动重放。

普通入口为 **数字员工 → 我的电脑 → 连接此电脑**。配对使用本机 loopback Agent，只暴露公开身份。普通界面不显示设备 ID、密钥、Adapter 名称和 Permit 细节。用户可查看最近动作，并暂停、继续或终止活动 Run。

## 考虑过的替代方案

**在共享 DSH Server 上运行自动化。** 这会把多个用户的操作系统身份和浏览器 Profile 合并到一个信任边界，因此被拒绝。

**嵌入 Open Interpreter、OpenClaw 或其他完整 Agent 运行时。** DSH 会失去对权限和审计语义的权威，因此只集成可替换的底层执行 Adapter。

**向模型提供通用本机命令通道。** 任意命令无法在执行前可靠地完成策略检查，因此协议使用封闭操作词汇。

## 后果

该设计以独立本机进程、平台权限、Adapter 特定取消行为和每个操作系统的真机验证为成本，换取了用户、设备、Workspace 和 Session 隔离，以及持久证据与用户本机最终控制权。
