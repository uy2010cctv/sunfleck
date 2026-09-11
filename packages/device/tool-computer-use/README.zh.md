---
description: "在已认证用户的配对设备上执行固定操作的模型 Computer Use 工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-computer-use

[English](README.md) | 中文

## 概述

`computer_use` 将小型的模型可见词汇映射为类型化 Device Plane 动作。它在 Host 上解析 Session 发起人与 Workspace，选择该用户所有的在线设备，创建需确认的 Run，并仅返回已持久化的结果摘要和证据哈希。

## 目录

- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

<a id="dev-note"></a>
## 开发备注

参见 [Device Plane Agent Note](../../../.agents/notes/implemented/feature/2026-09-11-device-plane.zh.md)。

<a id="model-experience"></a>
## 模型体验

### Computer Use 工具

#### 模型看到什么

模型可使用屏幕尺寸、浏览器打开、快照、点击和填写。任意 Shell 参数、本机路径、浏览器 Profile、凭证和设备 ID 都不是工具参数。控制操作仍需本机确认。

#### Token 影响

工具启用时，固定 schema 产生稳定的请求成本。每次调用仅保留类型化参数和有界结果摘要；屏幕内容与本机凭证不进入模型历史。

#### KV Cache 影响

只要插件配置和工具可见性不变，schema 保持前缀稳定。动作结果只追加到历史，不改写之前的请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 桌面支持当前只暴露可安全验证连接的观察动作。
- 工具调用会选择最近在线的用户设备；显式多设备选择延后到用户选择器。
- 结果超时只报告已持久化的动作状态，绝不重试结果不明的外部操作。
