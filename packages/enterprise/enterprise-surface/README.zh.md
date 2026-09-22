---
description: "企业渠道用户与持久员工之间的会话 surface 注册表与入站投递，把一条已认证的私信送入员工的锚定会话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-surface

[English](README.md) | 中文

## 概述

`dsh-enterprise-surface` 持有企业渠道用户与持久员工之间的持久 dm surface，并把已认证的入站消息投递进员工的锚定会话。它暴露 `ctx.surfaces`：`ensureDm` 返回每个用户-员工对唯一的 dm surface，且至多创建一次锚定会话；`deliverToEmployee` 把每条入箱消息注入会话，使其落入会话日志，否则将收件行标记失败；`stickyEmployee` 解析 actor key 绑定的员工。P0 仅提供 dm 一种 kind；锚定会话的 preset 来自显式的 `defaultAgentPreset` 配置。组合方提供已迁移的数据库与 agent-host 服务；全部 SQL 留在 employee store 中。

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

当入站桥接要把已认证的渠道消息转化为员工工作时挂载本插件。桥接方解析或确保 dm surface，然后携带来源 actor 与消息文本调用 `deliverToEmployee`。

### 何时选择

当同一进程已经承载员工的 Agent 运时时选择本包：投递向活跃的锚定会话注入消息，因此没有进程内 Agent 的组合无法完成投递。surface 与收件的持久化都在企业身份数据库中，因此通过 `@deepseek-ai/dsh-enterprise-postgres` 把企业数据持久化到 PostgreSQL 的组合需要先有 PostgreSQL 后端的实现。

### 最小配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `database` | 必填 | 承载 surface 与收件行的已迁移企业身份数据库 |
| `defaultAgentPreset` | 必填 | 本注册表创建的每个锚定会话所组合的 Agent preset |

服务读取 `ctx.employeeAccounts`、`ctx.agents`、`ctx.agentDefaultModel`、`ctx.agentPresets`、`ctx.sessionTitle`、`ctx.sessions` 与 `ctx.workspaceRegistry`，在 `inject` 中声明。`ensureDm` 拒绝未知员工与属于其他组织的员工；`deliverToEmployee` 复查 surface 与员工的组织配对，当消息未落入会话日志时先把已认领的收件行标记失败再向调用方抛出。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

### 设计概念

`DmSurfaceRegistry` 是三个权威之上的薄协调者：employee store 持有持久的 `surfaces` 与 `employee_inbox` 行，`ctx.employeeAccounts` 持有账号事实与收件入队，锚定会话日志持有消息持久性。`ensureDm` 经 store 幂等的 `ensureSurface`（`UNIQUE(user_id, employee_id)`）生成 surface 行，按 webhook 会话运行时的同一形态创建锚定会话——workspace 取员工 `homeWorkspacePath`，会话标题取员工显示名，header meta 记录 `agentPreset` 与 `cwd`，创建时的模型选择被固定到首个持久请求头为止——创建成功后才把会话 id 附着到 surface 行，失败的尝试由下一次调用重试。`deliverToEmployee` 用 `claim(employeeId, 1)` 按创建顺序认领，直到本次调用入队的行被投递；每行作为 steering 输入提交（运行中的会话在最近的 step 边界消费，空闲的会话开启新回合），随后 flush 会话并在日志记录了该消息——已追加，或仍在收件箱拼接投影中待处理（取消拼接会将其移出）——时确认落地。已认领行上的任何失败都会调用 store 的 `failInboxItem` 并向调用方抛出。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config`、`inject`、`apply`、服务提供与公共再导出 |
| [`src/types.ts`](src/types.ts) | 领域类型、`EnterpriseSurfaces` 接口、`surface-message` 来源声明与 `ctx.surfaces` 键声明 |
| [`src/dm.ts`](src/dm.ts) | `DmSurfaceRegistry`：surface 幂等、锚定会话创建与按序收件投递 |
| — | 不发布运行时 invariant 伴生模块。本注册表只有一个权威：每一条持久观察要么是经 employee store 的 SQL 写入的行，要么是锚定会话自身日志中的事件，不存在能够分叉的独立观察（[包 invariant 规则](../../AGENTS.md)）。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面。

- [员工账号](../employee-account/README.zh.md) — 本注册表读取账号、粘性绑定与收件队列所经过的 `ctx.employeeAccounts` 服务。
- [企业身份](../../identity/enterprise-identity/README.zh.md) — 本注册表直接调用其 `ensureSurface`、`attachSurfaceSession` 与 `failInboxItem` 的 store 模块。
- [Webhook 会话运行时](../../webhook/webhook/README.zh.md) — 锚定会话遵循的会话创建形态。

-----

<a id="model-experience"></a>
## 模型体验

### 入站私信投递

#### 模型看到什么

每条已投递的收件项对应一条 user 角色消息，承载消息文本；其 `surface-message` 来源把 surface、收件项 id 与来源 actor 记录在持久日志上。注册表自身不注册任何 prompt 段或工具 schema，锚定会话的 prompt 来自配置的 agent preset。

#### Token 影响

每条消息的投递文本进入员工会话一次，外加会话为其记录的来源框架。

#### KV Cache 影响

每次投递扩展会话尾部；不改写已缓存前缀。

## 已知限制与延期工作

这些限制界定了本注册表何时不适用或需要组合方支持。

- **P0 仅提供 dm 一种 kind** — surface kind 并集闭合于 `'dm'`；群渠道与其他 kind 等待需求。
- **`defaultAgentPreset` 是显式配置** — P0 直接从配置字段解析 preset；release 到 profile 的解析属于目录 release 流程，已延期。
- **投递要求锚定会话在进程内活跃** — 注册表经 `ctx.agents` 查找会话，未活跃时快速失败；重启后锚定会话的冷恢复已延期。
- **投递为一次认领** — 未持久落地的消息被标记失败并报告给调用方；重投策略属于组合流程。
- **单进程写入者** — surface 创建与认领后置失败是单连接上的 check-then-act 对，仅在当前单连接用法下原子（[防御模式](../../../docs/defensive-patterns.zh.md)）。
- **渠道接线属于部署证据** — WeCom 等已认证的入站渠道不属于本包；就绪状态由在本注册表之后组合、持有传输认证的桥接来表达。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

- 计划形态的同步签名变成了 `Promise<Surface>` 与 `Promise<InboxItemId>`：会话创建（`ctx.agents.create`、`ctx.workspaceRegistry.create`、`ctx.agentPresets.resolve`）与持久落地 flush 是异步的，且 `deliverToEmployee` 必须把投递失败交回调用方。
- 溯源信息（`originSurface`、`originActor`）经由可合并扩展的 `MessageSourceMap`（`surface-message` kind）携带——即 webhook 模板的溯源通道——因为 `SessionHeader` 没有自由 meta 字段；`agentPreset` 走受支持的 header meta 字段。
- 注册表按员工维度认领（`claim(employeeId, 1)`）并投递到该 surface 的锚定会话，直到自己的行被投递；P0 员工只有一个 dm surface，多 surface 员工到达时需要按 surface 认领。
- 测试参照 `packages/experimental/enterprise-team-runtime/tests/runtime.spec.ts`，经 `ctx.provide` 在真实 `Context` 上挂载 fake agent host；fake 会话同步追加，使落地检查面对真实的事件形态。

</details>
