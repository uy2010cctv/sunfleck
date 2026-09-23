---
description: "受治理的企业 Cordis Package、评审、绑定和产物服务。"
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-cordis

[English](README.md) | 中文

## 概述

`dsh-enterprise-cordis` 为一个企业保存受治理的 Cordis Package、评审、范围绑定、产物元数据与审计记录。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

服务持久化不可变 Package 版本，将批准版本绑定到组织、部门或创建者私有的 Workspace 范围，并记录 revision 受控的评审和审计操作。共享部门 Workspace 中的私有版本仅创建者可见；待审部门提交在批准前不会列给其他成员。组织发布后，即使源码版本创建于部门，组织成员也能在列表中看到该版本。Host 提供持久 PostgreSQL 组合，并在调用前强制认证主体。

## 模型体验

### 受治理扩展元数据

#### 模型可见内容

只有组合后的 Agent 工具或系统策略可以呈现已批准 Package 元数据。本包自身不添加 prompt、工具 schema 或 provider 请求。

#### Token 影响

直接 token 为零；模型可见的扩展说明由组合运行时负责。

#### KV Cache 影响

在此 repository 层没有影响。

## 已知限制与延期工作

- 产物存储已抽象；部署方存储和恶意内容扫描仍是独立集成。

<a id="dev-note"></a>
### 开发备注

无。
