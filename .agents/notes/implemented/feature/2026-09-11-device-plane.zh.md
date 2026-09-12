# Agent Note：用户自有 Device Plane

Status: implemented

[English](2026-09-11-device-plane.md) | 中文

## 问题

多用户 DSH Host 不能在同一个共享服务器账号中安全运行浏览器和桌面自动化。操作必须在请求用户的电脑上执行，且不得在用户之间共享文件、Profile、Cookie、凭证或操作系统权限。

## 决策

服务端拥有设备注册、受范围约束的 Computer Use Run、类型化动作、一次性 Permit、防重放签名请求和持久结果。本机 `dsh-device-agent` 拥有 Ed25519 私钥、操作系统权限、Run 确认策略执行、Adapter 进程和证据生成。

浏览器与桌面执行保持分离。`agent-browser` 和 Playwright MCP 只接受类型化浏览器操作，Cua 只接受类型化桌面操作。线上协议禁止通用命令或任意模块路径。模型创建的 Run 默认使用 `delegated`：已授予范围内的控制仍消费一次性服务端 Permit 并记入审计，但不会对每个动作弹出本机确认。`confirm-each` 仍可配置，业务、沙箱和不可逆操作审批保持独立。结果不明的已领取动作绝不自动重放。Cua 返回 `session_ended` 则不同：本机 Agent 会重建该 Run 的命名桌面会话，并对同一个正在执行的操作最多重试一次，不创建新动作或 Permit。

普通入口为 **数字员工 → 我的电脑 → 连接此电脑**。配对使用本机 loopback Agent，只暴露公开身份。普通界面不显示设备 ID、密钥、Adapter 名称和 Permit 细节。用户可查看最近动作，并暂停、继续或终止活动 Run。

## 考虑过的替代方案

**在共享 DSH Server 上运行自动化。** 这会把多个用户的操作系统身份和浏览器 Profile 合并到一个信任边界，因此被拒绝。

**嵌入 Open Interpreter、OpenClaw 或其他完整 Agent 运行时。** DSH 会失去对权限和审计语义的权威，因此只集成可替换的底层执行 Adapter。

**向模型提供通用本机命令通道。** 任意命令无法在执行前可靠地完成策略检查，因此协议使用封闭操作词汇。

## 后果

该设计以独立本机进程、平台权限、Adapter 特定取消行为和每个操作系统的真机验证为成本，换取了用户、设备、Workspace 和 Session 隔离，以及持久证据与本机暂停、接管和终止控制。`delegated` 模式消除了重复弹窗，但不会扩大 Run 的企业授权范围。
