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

服务持久化不可变 Package 版本，将批准版本绑定到组织、部门或创建者私有的 Workspace 范围，并记录 revision 受控的评审和审计操作。共享部门 Workspace 中的私有版本仅创建者可见；创建者可将已保存版本提交部门审核，不改动或发布原私有版本。同一保存版本即使换用请求键也只产生一张审核单；退回后需提交新的不可变版本。部门审核只处理待审请求，发布到组织须先经部门批准。已启用版本再次启用、已停用绑定再次停用、已生效版本再次恢复，均不增加修订号。创建者可将 Plugin 归档到可恢复的回收站；归档会停止新 Session 的绑定，恢复后仍需显式启用。待审部门提交在批准前仅列给作者和部门负责人；组织发布后，即使源码版本创建于部门，组织成员也能在列表中看到该版本。包含私有绑定的 Session generation 不会返回给共享工作区的其他用户。同一 Plugin 若有多个作用范围的生效绑定，新 Session 只固定一个版本，优先顺序为会话、私有 Workspace、部门、组织。列表投影按作用范围只给私有所有者、部门负责人或组织管理员标记管理权限。私有绑定可回滚到同作用范围的旧版本；部门和组织绑定只能重新启用当前选中的已批准版本。Host 提供持久 PostgreSQL 组合，并在调用前强制认证主体。

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
