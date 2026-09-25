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

协作 Schema 第 2 版在保留第 1 版群聊和原生 Session 绑定的同时增加房间事件日志。每条记录保存完整的 NIP-01 签名事件、组织与房间身份、作者绑定、线程根、请求标识和可选的原生 Session 游标。追加和读取时均重新验签，篡改存储内容会被拒绝。PostgreSQL 分配有序的 `BIGINT` 序号，接口用十进制字符串传递。相同作者和语义内容的请求或来源重试复用首条事件；改动内容的重试冲突。企业控制器在调用带索引的读取和全文搜索前检查当前房间成员身份与工作区权限。独立的公钥绑定表保留人类、数字员工或服务身份的首个公钥；私钥保留在凭据服务。签名任务事件可建立初始负责人，并通过比较更新把任务移交给另一名员工。

协作 Schema 第 3 版增加持久投递发件箱。签名事件的 `dsh-target` 和 `dsh-route` 标签与事件在同一事务中生成目标记录。服务身份请求 Bot 时保存已授权的人类请求者，追加时要求其仍为房间成员。Worker 用有界租约和隔离令牌领取目标；完成或释放必须持有原令牌，租约过期后可在重启后恢复。签名 Bot 交接只有在任务所有权成功转移的事务内才生成目标投递。投递 Worker 在完成前重新检查当前成员身份、工作区权限和原生投递回执。

频道工作流 Schema 独立于签名房间版本，保存不可变的 YAML 修订版、触发回执、待办人类决策和定时发生记录。定时事件先在 PostgreSQL 排队再推进下一次执行时间，由一个工作进程租用；未确认时可重试，每个动作使用稳定的步骤编号。房间搜索同时使用带索引的全文检索和 Unicode 子串匹配，使较短中文词可命中较长消息。

工作流 Schema 第 4 版为执行与审批续跑加上租约令牌，将人类消息触发与签名房间事件一同落库，并让已提交审批可在重启后恢复。单调迁移保留旧版本记录。

工作流 Schema 第 5 版还在每条人类房间触发记录上固定工作流编号与修订版。管理员之后修改 YAML，重放仍读取当时的不可变版本。签名的请求标签与持久化幂等字段必须一致；追加和读取时都会校验事件哈希与 Schnorr 签名。

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
