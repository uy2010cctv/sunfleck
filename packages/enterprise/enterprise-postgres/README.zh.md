---
description: "PostgreSQL composition and lifecycle provider for DSH Enterprise。"
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-postgres`

[English](README.md) | 中文

## 概述

PostgreSQL composition and lifecycle provider for DSH Enterprise。

## 目录

- [包详情](#package-details)
- [开发备注](#dev-note)

-----

<a id="package-details"></a>
## 包详情

DSH 企业版生产 PostgreSQL 组合包：维护一个有界 `pg.Pool`，启动时验证连接，并初始化身份、Session、员工目录、运营、项目、协作面目录和 pgvector 知识库表；所有适配器共享事务感知数据库封装。项目服务支持完整的成员门禁生命周期；协作面目录读取按组织隔离的持久列表行。

Operations 通过认证网关写入的组织范围 `enterprise_session_workspaces` 绑定确认工作记录所指的 Session。即使 Session 日志位于独立的 V4 PostgreSQL 数据库，该引用仍有效；新工作记录不再用主库中的旧 `dsh_session_headers` 表授权。

提供方不会将凭据、连接字符串或游标密钥写入 PostgreSQL 或 DSH Session 事件。部署方从 Secret Manager 提供 `connectionString` 和至少 32 字节且包含至少 8 个不同字节值的稳定 `cursorSigningKey`，并负责连接池大小、TLS、备份和数据库角色权限。企业 CLI Overlay 使用 HMAC-SHA256 和域标签 `dsh-enterprise-catalog/cursor-signing/v1` 从 `DSH_ENTERPRISE_MASTER_KEY` 派生游标密钥，不会将凭据加密密钥字节直接传给目录。

## Model Experience

### 企业持久化组合

#### What the model sees

无。`enterprisePostgres` 组合 Host 所有的 repository，不注册 Prompt、工具或模型调用。

#### Token effect

零 Token；连接与 schema 工作发生在 Agent 请求组装之前。

#### KV Cache effect

无；provider 请求缓存不属于数据库组合。

## 已知限制与暂缓事项

- 浏览器 Host API 仍需应用组合层暴露员工目录和运营方法，本包只提供持久服务。
- 既有协作面目录保留名册读取能力。协作仓库增加按成员授权的群聊和频道持久化，由企业控制器负责原生会话路由；员工收件箱和令牌入站投递仍需要单独装配的运行时。
- 旧 SQLite Session 日志迁移到 PostgreSQL 仍需独立的受控迁移操作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

协作创建重试使用按创建者隔离的确定性标识，并在事务中比较已保存值。协作持久化通过带事务锁的递增版本保存显式人员成员、已发布员工引用、频道话题和原生 Session 绑定。企业控制器负责成员与工作区授权后的原生会话路由；员工收件箱和令牌入站投递仍需要独立装配的服务。
