---
description: "持久数字员工账号、粘性 actor 绑定与私信收件队列，落在企业身份数据库上，供组合方选择、配置或调试持久员工。"
kind: "package-reference"
---

# @deepseek-ai/dsh-employee-account

[English](README.md) | 中文

## 概述

`dsh-employee-account` 在一个组织的企业身份数据库中持久化数字员工账号：以 archived 为终态的账号生命周期、actor 到员工的粘性绑定，以及每个员工的私信收件队列。它在一个由组合方提供的、已完成迁移的 SQLite `DatabaseSync` 句柄上暴露 `ctx.employeeAccounts` Cordis 服务，使员工身份在进程重启后依然存续，而不需要第二套持久化设施。当持久员工需要与组织、用户、会话共用身份存储时选择本包；全部 SQL 留在 `@deepseek-ai/dsh-enterprise-identity` 的 employee store 中。唯一必需的配置是一个已迁移的数据库句柄；输入校验、品牌化 id 生成与 archived 终态检查随服务提供。

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

当组合需要把持久员工账号放在企业身份数据库旁边时挂载本插件。常见路径：打开并迁移身份数据库，把句柄传给本插件，消费方通过 `ctx.employeeAccounts` 读取。

### 何时选择

当持久员工与组织、用户、审计记录同属一个数据库时选择本包。把企业数据持久化在 PostgreSQL 中的组合应改用 `@deepseek-ai/dsh-enterprise-postgres` 组合身份，并需要一套 PostgreSQL 后端实现。服务假设单一进程内写者：archived 检查与每次状态变更是同一连接上的一个 check-then-act 对，仅在当前单连接用法下原子（[防御式模式](../../../docs/defensive-patterns.zh.md)）。

### 最小配置

唯一的配置字段是一个活的 `DatabaseSync` 句柄，cordis.yml 行无法表达它。组合插件在自己的装配代码中以编程方式挂载本包——用 `migrateEnterpriseIdentity` 打开并迁移数据库，然后调用本包的 `apply(ctx, { database })`——并持有数据库生命周期。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `database` | 必填 | 服务读写的企业身份数据库（已完成迁移） |

`create` 在执行任何 SQL 之前拒绝空 `displayName`、空 `roleCard` 与相对路径 `homeWorkspacePath`（`TypeError`）；`setState` 拒绝对 archived 账号的任何变更，并在错误信息中带上当前状态；`claim` 将 `limit` 原样透传给 store；`resolveSessionActor` 返回锚定会话 surface 的记忆行为人：dm 为（用户, 员工）对，群会话为员工加 surface 的 `projectId`，频道话题会话仅有 `projectId`；无 surface 锚定时返回 undefined。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计理念

`EmployeeAccountService` 是 `@deepseek-ai/dsh-enterprise-identity` employee store 之上的薄封装：它校验输入、用 `randomUUID()` 生成品牌化 UUID id、把 store 行映射为领域值，并把每条语句委托给 store 模块。`enqueue` 先查询员工，因为收件行的 `orgId` 来自账号，且外键要求账号与私信 surface 已存在。外键约束是开启的：`migrateEnterpriseIdentity` 会在连接上设置 `PRAGMA foreign_keys = ON`，缺失的组织、surface 或员工会让插入大声失败。

### 源码地图

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config`、`apply`、服务提供与公共再导出 |
| [`src/types.ts`](src/types.ts) | 领域类型、`EmployeeAccounts` 接口，以及 `ctx.employeeAccounts` 键声明 |
| [`src/service.ts`](src/service.ts) | `EmployeeAccountService`：校验、id 生成，以及 store 之上的行到领域值映射 |
| [`src/ids.ts`](src/ids.ts) | 品牌化 `EmployeeId`、`SurfaceId`、`InboxItemId` 构造函数 |
| — | 不发布运行时 invariant 伴侣。服务只有单一权威：每个账号、绑定与收件观测都流经 `@deepseek-ai/dsh-enterprise-identity` 中同一批 SQL 语句，不存在可发散的独立观测（[包 invariant 规则](../../AGENTS.md)）。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面。它们从存储层走向生产组合与并发假设。

- [企业身份](../../identity/enterprise-identity/README.zh.md) — 本服务写入的 store 模块、schema 迁移与行类型。
- [企业 PostgreSQL 组合](../enterprise-postgres/README.zh.md) — 企业部署的生产 PostgreSQL 适配器组合。
- [防御式模式](../../../docs/defensive-patterns.zh.md) — 本服务继承的单写者 check-then-act 假设。

-----

<a id="model-experience"></a>
## 模型体验

### 员工账号持久化

#### 模型看到什么

无直接可见内容。服务不注册提示词段落、工具 schema 或 provider 请求；读取 `ctx.employeeAccounts` 的组合消费方持有账号、绑定或收件数据的任何模型可见使用。

#### Token 影响

零直接 token。模型可见使用由组合的消费方持有。

#### KV Cache 影响

在本仓库层为无。服务不改变任何模型请求，因此不会使已缓存前缀失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

这些限制说明本服务何时不合适，或何时需要组合方支持。

- **这里不管理私信 surface**——`enqueue` 要求 `surfaces` 行已存在；surface 创建与会话附着保留在身份 store 的 `ensureSurface` 与 `attachSurfaceSession` 及其组合流程中。
- **surface 与员工的组织一致性由调用方负责**——`enqueue` 记录 surface id 时不检查该 surface 行是否属于员工所在组织；身份 store 中 surface 的创建天然按组织划分，配对由组合流程持有。粘性绑定在本包内校验：`bindSticky` 拒绝绑定其他组织的员工。
- **收件投递是一次性认领**——`claim` 将条目标记为 delivered 且从不重试；把条目标记为 failed 是 store 的 `failInboxItem`，本服务不将其再导出，重投策略属于组合流程。
- **每个服务一种数据库引擎**——服务写入 `Config` 传入的 SQLite 身份数据库；PostgreSQL 部署通过 `@deepseek-ai/dsh-enterprise-postgres` 组合身份，不会从本包得到 employee-account 服务。
- **单一进程内写者**——archived 检查与每次状态变更是同一连接上的一个 check-then-act 对，仅在当前单连接用法下原子；多进程写者需要外部协调。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

- `apply` 通过 `ctx.provide('employeeAccounts', service)` 提供服务：provide 以本插件 fiber 持有的生命周期 effect 注册服务，因此卸载/重载循环会取消提供并干净地重新提供，挂载保持幂等。
- `Config.database` 必须已经跑过 `migrateEnterpriseIdentity`；组合方负责打开和关闭数据库，本包从不关闭它。采用这种显式句柄设计，是因为 `@deepseek-ai/dsh-enterprise-identity` 不在 Cordis context 上注册任何数据库服务——它是纯库外加 invariant 插件——没有句柄可供 `inject`。
- 测试环境与 schema 测试一致：内存 `DatabaseSync`、`migrateEnterpriseIdentity`，以及相同的组织/用户种子行。

</details>
