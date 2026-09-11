---
description: "用户配对电脑上执行受 Permit 约束的浏览器与桌面操作包索引。"
kind: "package-group"
---

# device/ — 用户配对电脑执行

[English](README.md) | 中文

## 概述

Device 包组提供面向模型的工具，将固定、受治理的操作提交给 Device Plane。服务端策略和持久记录保持权威，实际执行只发生在配对用户的本机 Device Agent。

## 包

| 包 | 职责 |
|---|---|
| [`tool-computer-use/`](tool-computer-use/README.zh.md) | 面向模型的固定操作映射和结果等待 |

## 相关文档

[设备执行平面子系统](../../docs/subsystems/device-plane.zh.md)定义配对、传输、执行和审计保证。

## 开发备注

无。
