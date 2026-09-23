---
description: "企业渠道用户与持久员工、群组或频道之间的会话 surface 注册表与入站投递，把一条已认证的消息送入锚定会话、有章程的团队 run 或组织记忆。"
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-surface

[English](README.md) | 中文

## 概述

`dsh-enterprise-surface` 持有企业渠道用户与持久员工、群组或频道之间的持久会话 surface，并把已认证的入站消息投递进服务它的锚定会话。它暴露 `ctx.surfaces`：`ensureDm` 返回每个用户-员工对唯一的 dm surface，且至多创建一次锚定会话；`deliverToEmployee` 把每条入箱消息注入会话，使其落入会话日志，否则将收件行标记失败；`ensureGroupSurface` 持久化群 surface 及其成员员工；`deliverToGroup` 把群消息路由到被提及成员各自的群会话，或注入有章程团队的活跃 run；`ensureChannelSurface` 持久化频道 surface 及其话题与应答策略、当值名册和成员；`deliverToChannel` 按提及与当值把频道消息路由进其话题的唯一会话，通过 `/done` 收束话题，或在仅接入频道上把公告提案进组织记忆；`stickyEmployee` 解析 actor key 绑定的员工；`listSurfaces`、`findSurface` 与 `findChannelByExternalKey` 把已存储的 surface 读回。锚定会话的 preset 来自显式的 `defaultAgentPreset` 配置。组合方提供已迁移的数据库与 agent-host 服务；全部 SQL 留在 employee store 中。

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

当入站桥接要把已认证的渠道消息转化为员工工作时挂载本插件。桥接方解析或确保 surface，然后携带来源 actor 与消息文本调用 `deliverToEmployee`，携带来源用户与文本调用 `deliverToGroup`，或携带来源用户、文本以及可选的被提及员工与从先前路由结果中固定的话题 id 调用 `deliverToChannel`。

### 何时选择

当同一进程已经承载员工的 Agent 运时时选择本包：投递向活跃的锚定会话注入消息，因此没有进程内 Agent 的组合无法完成投递。surface 与收件的持久化都在企业身份数据库中，因此通过 `@deepseek-ai/dsh-enterprise-postgres` 把企业数据持久化到 PostgreSQL 的组合需要先有 PostgreSQL 后端的实现。

### 最小配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `database` | 必填 | 承载 surface 与收件行的已迁移企业身份数据库 |
| `defaultAgentPreset` | 必填 | 本注册表创建的每个锚定会话所组合的 Agent preset |

服务读取 `ctx.employeeAccounts`、`ctx.agents`、`ctx.agentDefaultModel`、`ctx.agentPresets`、`ctx.sessionTitle`、`ctx.sessions` 与 `ctx.workspaceRegistry`，在 `inject` 中声明。团队式群还会按名称惰性读取 `enterpriseTeamControl` 与 `enterpriseTeamRuntimeDriver`；两者皆为可选，团队面未挂载时返回结构化的 `team-runtime-unavailable` 结果而非加载失败。仅接入频道按名称惰性读取 `enterprisePostgres` 身份 store；未挂载时公告返回结构化的 `memory-unavailable` 结果。`ensureDm` 拒绝未知员工与属于其他组织的员工；`deliverToEmployee` 复查 surface 与员工的组织配对，当消息未落入会话日志时先把已认领的收件行标记失败再向调用方抛出。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

### 设计概念

`DmSurfaceRegistry` 是三个权威之上的薄协调者：employee store 持有持久的 `surfaces` 与 `employee_inbox` 行，`ctx.employeeAccounts` 持有账号事实与收件入队，锚定会话日志持有消息持久性。`ensureDm` 经 store 幂等的 `ensureSurface`（`UNIQUE(user_id, employee_id)`）生成 surface 行，按 webhook 会话运行时的同一形态创建锚定会话——workspace 取员工 `homeWorkspacePath`，会话标题取员工显示名，header meta 记录 `agentPreset` 与 `cwd`，创建时的模型选择被固定到首个持久请求头为止——创建成功后才把会话 id 附着到 surface 行，失败的尝试由下一次调用重试。`deliverToEmployee` 用 `claim(employeeId, 1)` 按创建顺序认领，直到本次调用入队的行被投递；每行作为 steering 输入提交（运行中的会话在最近的 step 边界消费，空闲的会话开启新回合），随后 flush 会话并在日志记录了该消息——已追加，或仍在收件箱拼接投影中待处理（取消拼接会将其移出）——时确认落地。同一员工的并发投递在 promise 链上串行，认领保持队列顺序，且每条消息落入自己 surface 的会话；同一对的并发 `ensureDm` 调用共享一次会话创建。已认领行上的任何失败都会调用 store 的 `failInboxItem` 并向调用方抛出。

群投递加入第二种模式。`ensureGroupSurface` 以外部键或 id 为键，校验每个成员员工的组织归属，并经 store 的整体替换成员 API 存储成员集——ensure 阶段不创建会话。联邦式群把消息路由到显式提及的成员，或显示名以 @ 词元出现（大小写不敏感）的成员，并直接注入各成员自己的按员工绑定的群会话（`surface_sessions` 绑定，首次被提及时惰性创建）：群投递从不写员工收件行，收件保持 dm 专属。单个成员的失败记录在其目标上，批次其余部分照常落地。有章程的群（存在 `teamDefinitionId`）经运行时驱动的 `submitRunInput` 把文本提交进团队活跃 run，无活跃 run 时以 `source: 'channel'` 与稳定幂等键 `<surface id>:<origin user>` 启动一个 run。

频道投递加入第三种模式。`ensureChannelSurface` 以与群相同的方式为 surface 作键，校验成员与当值员工的组织归属，并存储两项策略、去重后的当值名册与成员集。在交互式（`mention_duty`）频道上，`deliverToChannel` 按策略解析消息的话题——`/topic 标题` 创建指令话题，`thread` 在传输方未固定话题时以消息前 40 字为标题自动创建，`lane` 路由进唯一的频道级话题——路由到被提及成员或当值名册首位，并注入该话题的唯一会话：会话锚定到首个被路由员工的 home workspace，经按话题的串行尾至多创建一次（store 行携带 `session_id`，`topicBySession` 据此解析），后续参与者经其消息的 `originActor` 归属。`/done` 收束被寻址的开放话题，并向其活跃会话注入收束标记，store 行与会话日志因此都记录这次收束；终态话题回答 `already-settled`。在仅接入频道上不存在任何会话：经隐私门、截断后的公告成为一条组织范围的记忆提案，`invalid-text` 丢弃、`privacy-gated` 丢弃与 `intake-failed` 失败都以结构化结果返回。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config`、`inject`、`apply`、服务提供与公共再导出 |
| [`src/types.ts`](src/types.ts) | 领域类型、`EnterpriseSurfaces` 接口、`surface-message` 来源声明与 `ctx.surfaces` 键声明 |
| [`src/dm.ts`](src/dm.ts) | dm surface 幂等、锚定会话创建、按序收件投递与共享的按键串行尾 |
| [`src/group.ts`](src/group.ts) | `GroupSurfaceRegistry`：群 surface、联邦式成员路由与章程团队提交 |
| [`src/channel.ts`](src/channel.ts) | `ChannelSurfaceRegistry`：频道 surface、话题分区与 `/topic`–`/done` 指令、提及加当值路由以及公告接入 |
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

每条已投递的收件项或被注入的群提及对应一条承载消息文本的 user 角色消息；其 `surface-message` 来源把 surface 与来源 actor 记录在持久日志上，dm 投递还带收件项 id，路由的频道投递还带频道话题 id。章程团队提交会以一条 `team-run-message` 来源（记录 run、来源 surface 与 actor）的用户消息抵达 run 的 Lead。仅接入频道的消息完全不会抵达模型——它们成为经治理流程评审的记忆提案。注册表自身不注册任何 prompt 段或工具 schema，锚定会话的 prompt 来自配置的 agent preset。

#### Token 影响

每条消息的投递文本进入员工会话一次，外加会话为其记录的来源框架。

#### KV Cache 影响

每次投递扩展会话尾部；不改写已缓存前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

这些限制界定了本注册表何时不适用或需要组合方支持。

- **话题连续性由传输方持有** — 注册表从传输方依据先前路由结果固定的 `topicId` 解析话题；频道内按 actor 的会话状态跟踪延期到频道内核。
- **公告接入需要 PostgreSQL 身份 store** — 仅接入频道惰性读取 `enterprisePostgres`；纯 SQLite 组合对每条公告回答结构化的 `memory-unavailable` 结果而不作提案。
- **`defaultAgentPreset` 是显式配置** — P0 直接从配置字段解析 preset；release 到 profile 的解析属于目录 release 流程，已延期。
- **锚定会话不解析权限 preset** — 注册表只记录 agent preset，权限授予来自 preset 自身的配置；按 surface 的权限 preset 已延期。
- **投递要求锚定会话在进程内活跃** — 注册表经 `ctx.agents` 查找会话，未活跃时快速失败；重启后锚定会话的冷恢复已延期。
- **投递为一次认领** — 未持久落地的消息被标记失败并报告给调用方；重投策略属于组合流程。
- **挂起员工在会话活跃时仍接受投递** — 一次认领的收件模型延迟的是休眠而非挂起；对挂起员工阻断投递已延期。
- **单进程写入者** — surface 创建与认领后置失败是单连接上的 check-then-act 对，仅在当前单连接用法下原子（[防御模式](../../../docs/defensive-patterns.zh.md)）。
- **渠道接线属于部署证据** — WeCom 等已认证的入站渠道不属于本包；就绪状态由在本注册表之后组合、持有传输认证的桥接来表达。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

- 群路由规则：显式提及 id 仅在命名成员时生效；否则按 @ 词元匹配显示名（大小写不敏感，去除尾部标点）；无匹配返回结构化 `no-target` 而非抛出。团队控制失败以结构化结果返回，控制器可将其映射为 200。
- 频道契约：`/done` 的话题仅来自输入的 `topicId`（缺失或外部 id 是结构化 `no-topic` 结果）；话题会话锚定到首个被路由员工，后续参与者经 `originActor` 归属；按话题的串行尾让并发的首批消息共享一个会话，并在尾内重读存储的 `session_id`；收束标记尽力而为——store 行先行收束，标记失败仅告警。
- 计划形态的同步签名变成了 `Promise<Surface>` 与 `Promise<InboxItemId>`：会话创建（`ctx.agents.create`、`ctx.workspaceRegistry.create`、`ctx.agentPresets.resolve`）与持久落地 flush 是异步的，且 `deliverToEmployee` 必须把投递失败交回调用方。
- 溯源信息（`originSurface`、`originActor`）经由可合并扩展的 `MessageSourceMap`（`surface-message` kind）携带——即 webhook 模板的溯源通道——因为 `SessionHeader` 没有自由 meta 字段；`agentPreset` 走受支持的 header meta 字段。
- 注册表按员工维度认领（`claim(employeeId, 1)`）并投递到该 surface 的锚定会话，直到自己的行被投递；P0 员工只有一个 dm surface，多 surface 员工到达时需要按 surface 认领。
- 测试参照 `packages/experimental/enterprise-team-runtime/tests/runtime.spec.ts`，经 `ctx.provide` 在真实 `Context` 上挂载 fake agent host；fake 会话同步追加，使落地检查面对真实的事件形态。

</details>
