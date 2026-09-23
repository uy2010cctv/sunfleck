---
description: "企业 Cordis 运行时组合和面向 Agent 的持久化工具。"
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-cordis-runtime

[English](README.md) | 中文

## 概述

`dsh-enterprise-cordis-runtime` 在 Workspace 中恢复已批准的企业 Cordis generation，并向已授权 Agent 提供受治理的持久化操作。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

运行时解析 Session 所有者和企业 Workspace grant，固定 Session generation，恢复已批准的动态 Package。企业 Workspace 中成功执行 `cordis_define` 后，会为该所有者保存私有版本；激活和部门提交仍需显式操作。删除 Session 内的临时 Plugin 不会删除已保存版本。运行时不会把浏览器请求视为扩大 Package 范围的授权。

## 模型体验

### 已批准的动态能力

#### 模型可见内容

运行时只能让所选已批准动态 Package 的能力提供给当前 Agent。评审和存储元数据仍仅在 Host 可见。

#### Token 影响

只有在已批准 Package 向 Agent 组合贡献指令和 schema 时才消耗 token。

#### KV Cache 影响

固定的 Package generation 保持稳定组合顺序；缓存复用仍取决于 provider。

## 已知限制与延期工作

- 动态 Package 执行受 Host 组合提供的 sandbox 和能力策略限制。

<a id="dev-note"></a>
### 开发备注

无。
