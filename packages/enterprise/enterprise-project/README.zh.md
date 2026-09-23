---
description: "PostgreSQL 支撑的项目治理实体：组织范围内、按成员准入的项目空间，带可见性、成员与以 archived 为终态的生命周期，供需要在企业部署中持久化项目状态的组合方使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-project

[English](README.md) | 中文

## 概述

`dsh-enterprise-project` 在 PostgreSQL 中持久化企业项目治理实体：一个组织范围内、按成员准入的项目空间，包含名称、目标、工作区路径、可选的团队定义绑定、列表可见性、显式成员关系，以及以 archived 为终态的生命周期。它在组合方提供的 `PostgresDatabase` 句柄上暴露 `ctx.enterpriseProjects` Cordis 服务，并以自己的迁移单元拥有带版本的 `projects` 与 `project_members` 模式。按员工界面规范，项目是按成员准入的空间：列表可见性永远不能替代成员行。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当组合需要把项目治理状态放在企业 PostgreSQL 部署旁边时挂载本插件。组合插件以编程方式传入其共享的企业 `PostgresDatabase` 句柄；仓储在首次使用时惰性迁移项目表，数据库生命周期由组合方拥有。

### 何时选择

当项目治理需要与组织、运营与审计记录同处一个 PostgreSQL 部署时选择本包。`organizations` 外键目标来自企业身份模式，因此组合方必须在第一次项目调用前运行 `migrateEnterpriseIdentityPostgres`。

### 最小配置

| 字段 | 默认 | 含义 |
|---|---|---|
| `database` | 必填 | 支撑 `projects` 与 `project_members` 表的 PostgreSQL 句柄 |

`create` 以 `TypeError` 拒绝空名称、空目标、空创建者与相对 `workspacePath`，在 `resolveCreateProjectSpec` 中把可见性默认值显式解析为 'organization'，并在同一事务中把创建者插入为第一个 'user' 成员。`archive` 只允许 active 到 archived；archived 是终态，除读取外的所有变更都会拒绝。对未知 id、其他组织与非成员，`requireMember` 返回 undefined 且不泄露存在性。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

### 设计概念

`EnterpriseProjectService` 是 `EnterpriseProjectStore` 结构契约之上的薄门面：它校验输入、铸造品牌化 UUID id、显式解析可见性默认值、过滤列表，并把守 `requireMember`。`EnterpriseProjectRepository` 拥有每一条 SQL 语句、行锁下的状态守卫，以及对 `state`、`visibility`、`principal_type` 做闭集校验的行解析。列表可见性在解析后的行上求值，与运营包的团队定义读取守卫一致，而不是把谓词下推进 SQL；被过滤的集合是一个组织的项目。

### 源码地图

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config`、`apply`、服务供给与公共再导出 |
| [`src/types.ts`](src/types.ts) | 领域类型、`EnterpriseProjects` 接口与 `ctx.enterpriseProjects` 键声明 |
| [`src/service.ts`](src/service.ts) | `EnterpriseProjectService`：校验、id 铸造、可见性解析与过滤、成员门禁 |
| [`src/repository.ts`](src/repository.ts) | `EnterpriseProjectRepository`：全部 SQL、状态守卫与闭集行解析 |
| [`src/schema.ts`](src/schema.ts) | 带版本的 `projects` 与 `project_members` 模式及 `migrateEnterpriseProject` 迁移单元 |
| [`src/ids.ts`](src/ids.ts) | 品牌化 `ProjectId` 构造器 |
| — | 不发布运行时不变量伴生模块。仓储是唯一权威：每个项目与成员观察都流经同一批 SQL 语句，不存在可发散的独立观察（[包不变量规则](../../AGENTS.md)）。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面。它们从本实体延伸到生产组合与相邻的企业接缝。

- [企业 PostgreSQL 组合](../enterprise-postgres/README.zh.md) — 拥有共享连接池与本包引用的身份模式的生产适配器组合。
- [员工账号](../employee-account/README.zh.md) — 以 SQLite 支撑的员工实体，其账号 id 作为 'employee' 成员主体出现。
- [企业运营](../../operations/enterprise-operations/README.zh.md) — 团队定义所在，项目的 `teamDefinitionId` 指向其 id。

-----

<a id="model-experience"></a>
## 模型体验

### 项目治理持久化

#### 模型看到什么

不直接看到任何内容。本服务不注册提示段、工具模式或提供方请求；读取 `ctx.enterpriseProjects` 的组合消费方拥有项目、成员或可见性数据的任何模型可见用途。

#### Token 影响

零直接 token。模型可见用途由组合消费方拥有。

#### KV Cache 影响

在此仓储层没有影响。本服务不改变任何模型请求，因此不会使命中的前缀缓存失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

这些限制界定了本服务何时不适配或需要组合方支持。

- **工作区绑定只是存储的路径** — 服务把 `workspacePath` 保存为不透明的绝对字符串，不做任何注册表查询；通过 `workspaceRegistry.ensure` 与 `attachSession` 把项目绑定到活工作区属于消费方流程。
- **可见性是自包含的简化** — 列表可见性存储在项目行上并在服务内求值，不与治理 `resource_policies` 表共享；'restricted' 表示 `allowedUserIds` 加创建者，'administrator' 角色绕过过滤，且没有部门范围。
- **团队定义引用没有外键** — `teamDefinitionId` 是普通列，因为团队定义位于按 `(org_id, team_id)` 建键的运营模式中；引用检查属于组合方流程。
- **归档归属由调用方拥有** — `archive` 接受 actor id 仅用于校验；存储只记录 `archived_at` 而不记录归档主体，审计轨迹留在调用方。
- **列表过滤在读取之后运行** — `list` 读取一个组织的全部项目并在服务内过滤；项目集合非常大的组织需要把可见性谓词下推进 SQL 后才支持分页。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

- `apply` 通过 `ctx.provide('enterpriseProjects', service)` 把服务注册为插件 fiber 拥有的生命周期 effect；`Config.database` 是以编程方式传递的不可序列化句柄，与 `dsh-employee-account` 的 `Config.database` 一致。
- 仓储沿用运营包团队控制模式：`initialize()` 把首次使用时的一次 `migrateEnterpriseProject` 记忆化，因此急切组合也可以在启动期间调用迁移而不产生额外开销。
- 按规范 §6.4，成员关系刻意不由可见性蕴含：`requireMember` 把 'user' 行按 `principal.userId` 匹配、'employee' 行按 `principal.employeeId` 匹配，员工绝不是用户，因此一个主体永远不会同时匹配两种行。
- 测试使用 `tests/memory-postgres.ts` 中按语句建键的内存 `PostgresDatabase` 替身；真实 PostgreSQL 套件在没有 `DSH_TEST_POSTGRES_URL` 时自跳过，与 `dsh-enterprise-operations` 一致。

</details>
