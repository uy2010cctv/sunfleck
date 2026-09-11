---
description: "配对设备、Computer Use Run、Permit 和动作证据的服务端持久权威。"
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-device-plane

[English](README.md) | 中文

## 概述

本包拥有 Device Plane 领域类型、动作策略、Ed25519 请求验证、防重放与 PostgreSQL 仓库。每条记录都按组织和用户隔离；Run 还同时绑定一台设备、一个 Workspace 和一个 Session。

## 目录

- [运行时契约](#runtime-contract)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

<a id="runtime-contract"></a>
## 运行时契约

浏览器永远不会获得设备私钥。本机 Agent 只能领取 Run 仍活动且 Permit 未过期的类型化动作。Permit 和已签名请求的 nonce 都只能使用一次。结果仅保留有界摘要与证据哈希，不保存不必要的屏幕内容。

<a id="dev-note"></a>
## 开发备注

参见 [Device Plane Agent Note](../../../.agents/notes/implemented/feature/2026-09-11-device-plane.zh.md)。

<a id="model-experience"></a>
## 模型体验

### 服务端权威

#### 模型看到什么

什么都看不到。这个服务端权威不直接贡献提示词或工具；`dsh-tool-computer-use` 拥有面向模型的固定操作词汇。

#### Token 影响

直接为零。只有消费工具的 schema、参数和有界结果摘要会进入模型上下文。

#### KV Cache 影响

无；仓库、策略和签名传输操作不组装也不发送模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 终止 Run 会阻止后续领取；已经执行的原生调用能否协作取消取决于 Adapter。
- 本包不存储屏幕快照流；未来的本机预览通道必须继续独立授权。
- macOS 是首个真实设备目标；Windows 和 Linux 仅保持协议兼容，尚未通过真机验证。
