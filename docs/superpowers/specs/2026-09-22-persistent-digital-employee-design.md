# 设计：SUNFLECK 持久化数字员工与五隔间记忆体系

- 状态：**待审核**（评审通过后按 `writing-plans` 流程拆解实施计划）
- 日期：2026-09-22
- 作者：Kris + ZCode 设计讨论
- 关联：[PRODUCT.md](../../../PRODUCT.md) · [DESIGN.md](../../../DESIGN.md) · [多组织租户笔记](../../../.agents/notes/implemented/architecture/2026-09-17-enterprise-multi-organization.md) · [录音笔设备绑定笔记](../../../.agents/notes/implemented/architecture/2026-09-21-user-scoped-recorder-device-binding.md)
- 原型图：[附录 B 索引](#附录-b原型图索引)（5 个可打开的 HTML 原型）

## 1. 背景与目标

SUNFLECK 已把 DSH 运行时投影为企业数字员工工作台：AgentPreset 是员工定义，Employee Release 是不可变发布，Session 是工作记录，SessionEvent 是审计事实源，北极星团队（EnterpriseTeamDefinition）提供章程化的 Lead/Doer/Verifier 协作，org/department 两级记忆提供审查制的组织知识。当前的根本限制：**员工只在被调用时存在**——没有独立于会话与 TeamRun 的身份、收件箱与记忆，群聊/频道/项目没有会话形态语义，员工之间没有共享上下文的正式通道。

本设计的目标：让数字员工成为**持久化的一等工作单元**——有名字、角色、独立记忆、运行时与工具；企业活动以四种交互形态展开（私聊、频道、项目工作区、群聊）；记忆按**企业 / 部门 / 项目 / Agent 私有 / 双边**五个隔间分层治理。成功标准沿用 PRODUCT.md：操作者能理解谁在工作、在做什么、用什么能力与权限、有什么证据——且员工越用越懂业务、经验能组织化沉淀。

## 2. 已定决策

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 员工持久化等级 | **方案 B：持久工作账户**。持久的是身份/收件箱/记忆/绑定，运行时惰性唤醒；不采用常驻进程（远期可加 daemon provider，不在本期） |
| D2 | 群聊拓扑 | **两档制**：无章程群 = 联邦式（每员工一 session，@路由）；有章程群 = 团队式（群即北极星团队，Lead 唯一入口）。可升降级 |
| D3 | 项目实体 | **一等治理实体**（首发只做数据模型与授权，UI 随 P2）：跨部门成员制容器，绑定 Workspace、记忆隔间、可选章程团队 |
| D4 | 双边记忆 L5 | **进首发范围**（与 L4 同期，共用记忆基础设施） |

## 3. 现状基线

已有（直接复用，路径为仓库内位置）：

- org/department 两级记忆：`enterprise_memories` 表（scope CHECK organization/department）、kind/status/reviewedBy/sourceDigest、隐私门 `inspectEnterpriseMemory`（`packages/identity/enterprise-identity/src/`）、LLM 自动写回 worker 与 `remember_business_knowledge` 工具（`packages/context/enterprise-memory-context/src/`）。
- 知识库三档可见性 + ACL + pgvector（`packages/knowledge/knowledge-pgvector/src/schema.ts`）。
- Employee Release 不可变版本化 + 资产绑定（sop/knowledge/skill/tool/model）+ 员工自主学习闭环（`packages/catalog/enterprise-catalog/src/`、`packages/context/enterprise-memory-context/src/learning.ts`）。
- AgentPreset isolate realm 隔离与会话级锁定（`packages/preset/agent-presets/src/mount.ts`）。
- 北极星团队全栈：章程（northStar/Lead/角色 roster/验证策略/注意力策略）、不可变修订、TeamRun（source 已含 `channel`）、决策队列、四级自治授权（`packages/operations/enterprise-operations/src/types.ts`）；运行时以 TeamId=根 SessionId、邮箱 queued-minus-delivered 恢复、任务板 CAS（`packages/experimental/agent-team/src/`、`packages/experimental/enterprise-team-runtime/src/`）。
- 渠道内核路由决策序：命令 → sticky → intent → default，全部约束在 binding.employeeIds 内（`packages/channel/channel-kernel/src/index.ts`）。
- 四层 AccessScope + visibility 授权、组织/部门树、一主多部门（`packages/governance/enterprise-governance/src/`、`packages/identity/enterprise-identity/src/schema.ts`）。
- webhook → Session 创建范式（`packages/webhook/webhook/src/session.ts`）与 goals/jobs/schedules/subagents/workflows 全套 Session 锚定能力。

缺口（本设计要补的）：

1. 员工无独立于会话/TeamRun 的持久身份与收件箱；sticky 绑定无持久存储。
2. channel kernel 无生产消费者：入站消息没有投递进（员工）Session 的桥。
3. 记忆只有 org/department 两级：无项目隔间、无 Agent 私有层、无双边层、无晋升与整合闭环。
4. 群聊/频道/项目无会话形态语义（无 surface、无多人拓扑、无群消息扇入/合并）。
5. 员工 credentials 无 per-employee 命名空间。

## 4. 总体架构

```text
┌────────────────────────────── SUNFLECK 企业工作台（Web/桌面） ──────────────────────────────┐
│  员工名册 · 员工详情(它知道什么) · 项目空间 · 团队/群聊 · 审批/决策 · 记忆治理 · My devices │
└───────────────▲────────────────────────────────────────────────────────────┬──────────────┘
                │ 治理面(RBAC/审计/凭据)                记忆治理视图           │
┌───────────────┴────────────────────────────────────────────────────────────▼──────────────┐
│  Enterprise Control Plane (PostgreSQL)                                                     │
│  employee_accounts · employee_inbox · sticky_bindings · surfaces · projects                │
│  enterprise_memories(五隔间) · team definitions/runs/decisions · grants · audit            │
└───────────────▲────────────────────────────────────────────────────────────┬──────────────┘
                │ 投递桥(delivery bridge)                                    │ 注入/写回/整合
┌───────────────┴───────────────┐                            ┌───────────────▼──────────────┐
│  Channel Plane                │                            │  Memory Seam (ctx.memory)    │
│  WeCom/飞书/钉钉/微信/Webhook  │                            │  读: 授权过滤→混合检索→预算    │
│  channel-kernel(路由决策序)    │                            │  写: writeback分流/工具直写    │
└───────────────┬───────────────┘                            │  整合: consolidation job      │
                │ Surface(kind: dm/group/channel/project)    └───────────────▲──────────────┘
┌───────────────▼────────────────────────────────────────────────────────────┴──────────────┐
│  DSH Runtime：EmployeeAccount → anchored Session(s) → agent-loop                           │
│  私聊=1:1 session · 群聊联邦=per-employee session · 群聊团队/项目=TeamRun(Lead入口)          │
│  运行时=Release.snapshot(profile/model/agentOptions)+isolate realm+资产工具+记忆工具+凭据   │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

分层职责一句话：渠道面负责把外部消息变成**已认证的企业意图**；控制面负责身份、授权、记忆、章程等**治理状态**；DSH 运行时负责**执行**并以 Session 日志为唯一事实源。治理面不复制运行时状态（投影而非第二引擎）。

## 5. 员工身份与生命周期

### 5.1 EmployeeAccount（新持久实体）

账号是员工的持久身份：`employeeId`、`orgId`、`displayName`、角色卡（对外一句话职责）、`activeReleaseId` 指针、生命周期状态、home Workspace、记忆根（按员工命名空间）、跨渠道收件箱。Release 机制完全不动：账号只持有 release 指针；员工升级 = 换指针，历史会话与审计保留旧 release 归因。员工主体沿用 `employeeServicePrincipal`（零角色、仅 releaseId+部门），新增 **per-employee credential 命名空间**：员工的凭据引用只解析到员工命名空间，永不继承任何人的浏览器或渠道凭据（PRODUCT.md 原则 9）。

### 5.2 状态机

```text
            ┌───────────┐  有 open turn / TeamRun / schedule 触发   ┌───────────┐
  创建/发布 ─▶│  dormant  │─────────────────────────────────────────▶│  active   │
            │(仅状态在)  │◀─────────────────────────────────────────┤(有运行时)  │
            └───────────┘        回合结束、无欠债                      └─────┬─────┘
                 ▲  suspend(管理员)                    写回/整合跑完         │
                 │                                          ▲             │
                 ▼                                          └── cooldown ─┘
             suspended   ── resume ──▶ dormant        (异步收尾，不占运行时)
                 │ archive(终态，只读)
                 ▼
             archived
```

"常驻感"来自三件事：收件箱永远存在（任何人任何渠道随时可投递）、schedules 永远有效（到点唤醒）、记忆跨会话连续。运行时是惰性的：dormant 状态零 Node 进程成本。

### 5.3 收件箱（employee_inbox）

员工级持久收件箱，每条目 = `inboxId, employeeId, surfaceId, originActor, payloadRef, state(queued/delivered/failed), attempts, createdAt/deliveredAt`。投递语义复用团队邮箱的 **queued-minus-delivered 恢复模型**：先落库后投递，目标 ack 后才标记；员工 dormant 时消息留箱，下次 active 时按序领取。它同时是渠道桥、Web 私聊、schedule 触发、webhook 的统一入站汇合点——所有入站路径只写 inbox，不直接开回合。

## 6. 交互形态：Conversation Surface

### 6.1 Surface 抽象

```text
Surface { surfaceId, orgId, kind: dm | group | channel | project,
          humans: userId[], employees: employeeId[],     // 参与者
          teamDefinitionId?,                             // 有章程群/项目团队 → 团队式
          projectId?,                                    // 项目形态
          compartmentId,                                 // 记忆隔间归属（见 §7）
          workspaceRef?, channelBindingRef?, state }     // 持久化于 surfaces 表
```

不变量：**凡进入 Surface 的消息必然落为 SessionEvent**（model-visible ⟺ logged）；扇入消息在事件 meta 带 `originActor`/`originSurface`，可回放、可审计。

| 形态 | 拓扑 | Session 映射 | 隔间 | sticky 语义 |
|---|---|---|---|---|
| dm 私聊 | 1 人 × 1 员工 | per-pair anchored session | 员工 L4 + 用户 L5 | actorKey→该员工 |
| group 无章程 | N 人 × M 员工 | per-employee session 联邦 | 群隔间（compartmentId 指向 surface 本身） | @/指派路由 |
| group 有章程 | N 人 × 章程团队 | TeamRun（Lead 入口） | 团队隔间 | binding=Lead |
| channel 频道 | 话题分区 + 当值员工 | 每话题懒建 anchored session | 频道隔间（话题共享） | @ 优先，否则当值员工（schedule 派生） |
| project 项目 | 成员制空间 | 空间内开 session 或 TeamRun | 项目隔间 L3 | 项目 Lead/默认员工 |

### 6.2 群聊两档（结合现有北极星团队）

第一档（联邦式，无章程）：入站消息按确定性规则路由——**被 @ 或被指派的员工应答，其余静默监听**（仅收共享转录摘要）。杜绝全员抢答（多智能体群聊的串扰与隐私越界红线）。员工各自在 release 工具/凭据范围内行动，各自写 L4；群级事实走 proposed → 审查进隔间。治理上是"个体行为集合"，证据链 = 各自 session 日志。

第二档（团队式，有章程）：群即团队，`group.teamDefinitionId` 指向 active 章程。

```text
群消息（WeCom/飞书/钉钉/Web 任意渠道）
  → channel-kernel.routeInbound（决策序: 命令→sticky→intent→default；团队 binding 只绑 Lead）
  → Lead anchored session（唯一入口，防多头应答）
  → 投递桥写 employee_inbox(Lead) → 唤醒/领取 → 若有活跃 TeamRun 则 attach，否则新建 run(source='channel')
  → Lead 拆任务 DAG → 邮箱派发 Doers（queued-minus-delivered）→ Verifier 按 verificationPolicy
  → 需人拍板 → TeamDecision(approval/handoff/clarification, assigneeUserId)
  → 群内回流：分工状态 / 证据卡片 / 待决事项 —— 而非每个 agent 的过程碎语
```

与现状的接缝：`EnterpriseTeamRun.source: 'console' | 'schedule' | 'channel'` 已预留 channel 来源，本设计只是把"channel → run"的投递桥接上；章程 roster ↔ 群成员双向同步（加人进群 = roster 增员带 roleId，`TeamActorRef` 已定义 human|agent 两种引用）；跨 run 记忆连续性由团队隔间补齐——今天 TeamRun 冷启动只带章程不带历史，有了隔间，新 run 开场 Lead 即可召回历史已验证结论与决策（对应 Generative Agents 的 reflection 产物落点）。

升降级：无章程群可一键"升章程"（从群成员生成 charter 草稿 → needs-charter → 人工编辑 → active）；章程 archived 后群退回联邦式，员工保留、仅失去 Lead 协调。

### 6.3 频道：组织装置而非会话片段

群聊回答"这群人这段时间怎么协作"，频道回答"这个长期事务如何被持续承接"。频道是**组织装置（fixture）**：生命周期以月/年计、成员可多至数百人、内容按话题分区。三个典型形态：值班/工单频道（持续有人来问，当值员工承接）、公告/制度频道（单向广播，员工只听不说）、部门/项目公开频道（比群聊正式的长期讨论区）。

```text
Channel (surface kind=channel, topicPolicy: thread|command|lane, respondPolicy, dutyScheduleId?)
  ├─ topic「9-22 工单 #881」──▶ anchored session（首次被路由时懒建）
  ├─ topic「续约口径答疑」   ──▶ anchored session
  └─ 当值路由: dutyScheduleId → ctx.schedules 派生"当前当值员工"（随窗口轮换）
```

**话题分区策略**（三档，channel 级 Config 可配，默认 thread+command）：

1. `thread`——provider 有原生话题/引用回复（飞书话题群、钉钉 thread）时 1:1 映射，不发明新分区；
2. `command`——扁平群（如 WeCom 群）用 `/topic 标题` 显式开话题；**不采用"首条消息自动开话题"**（寒暄与灌水会制造话题噪音），话题由首个被路由的 @ 或显式命令创建；
3. `lane`——每员工一条车道，用于员工值班频道：投递直接进当值车道。

**路由规则**（频道内替换 sticky 语义）：@ 或指派永远优先；未 @ 的消息由**当值员工**承接——当值由 `dutyScheduleId` 引用既有 schedules 运行时按窗口派生，sticky 退化为"同一当值窗口内同一话题续接同一员工"，避免换班后答非所接。多员工在频道内的共享转录摘要按 **topic 粒度批量 digest**（话题关闭或整点），不逐条扇出——大规模频道下控制额度与噪音。

**公告型频道是组织记忆的正式进水口**：`respondPolicy: ingest-only` 的频道里员工只听不说，公告消息经写回 worker 抽取 → proposed → 组织/部门记忆审查队列（制度更新、人事变动、产品发布天然是 org facts 的出生地）；隐私门照常拦截个人内容。普通频道的话题结论在话题 settled 时按隔间规则提案。

**话题生命周期**：`open → settled → archived`——当值员工或发起人 `/done` 显式落定，或 N 天无活动由 consolidation job 归档（天数走 Config）；落定与归档本身是可审计事件。话题内需要多员工协作时，可升级为章程团队 run（复用群聊的升降级路径）；频道绑定 project 时 compartment 直接指向项目隔间，成为项目公开讨论区。

### 6.4 项目

项目 = 成员制空间：空间内开的每个 session、每次 TeamRun、每个文件与记忆条目都归属项目隔间；项目群聊天然落在 §6.2 第二档（`projectId → teamDefinitionId?`），频道绑定项目即项目公开讨论区。实体的完整字段、授权规则与生命周期见 §10 数据模型与 §9 治理；工作台呈现见原型图 2。

## 7. 记忆体系：五隔间

### 7.1 隔间模型

```text
                      授权边界（谁在什么上下文里能读到）
┌────────────────────────────────────────────────────────────────────┐
│ L1 组织记忆   reviewed·全企业     enterprise_memories.scope=organization │ 已有
│ L2 部门记忆   reviewed·部门子树   scope=department + departmentId        │ 已有
│ L3 项目/团队  成员制·项目或群     scope=project + compartmentId          │ 新增
│ L4 员工私有   免审查·per-employee scope=agent + employeeId              │ 新增
│ L5 双边       user↔employee 对   scope=pair + (userId, employeeId)     │ 新增(D4)
└────────────────────────────────────────────────────────────────────┘
晋升流:  L4 ──promote_proposal──▶ L1/L2 proposed ──审查(approved)──▶ 生效
整合:  每隔间独立 consolidation(去重/合并/冲突/衰减/反思)  遗忘: 衰减→retired→归档(不物理删)
```

统一存储：五隔间共用 `enterprise_memories` 一张表（扩 scope CHECK + 新列），PG + pgvector 统一检索，治理视图统一呈现。L4 的"自编辑"通过**记忆工具**实现（模型经工具读写自己的命名空间，每次写入即 tool/call 事件入日志），不引入第二套文件存储；既保留 Letta/Anthropic memory tool 的自编辑体验，又让"它知道什么"视图与审计零额外成本。

各隔间的写入纪律：

- **L1/L2（审查制）**：唯一写入路径是 proposed → 人工 approved（复用现有状态机与 UI）。来源两种：员工 `promote_proposal` 提案、人工提交。PRODUCT.md 原则 6 不变：组织记忆是经审阅的业务证据，绝不由对话自动拼装。
- **L3（成员制）**：项目/团队成员（含员工主体）经写回 worker 或显式"记住这个"写入，状态直接 active 但全带 provenance；结项归档转只读。
- **L4（私有）**：turn 结束 writeback worker 默认落点（免审查、即时生效）；员工工具直写；容量与衰减由整合 job 治理。
- **L5（双边）**：仅该 (userId, employeeId) 对可读写；隐私门硬规则——**个人偏好永不晋升**至 L1/L2（`inspectEnterpriseMemory` 扩展一条 category）。

### 7.2 读取管线

```text
prompt 组装
  1 authorize    按当前会话授权上下文取可见隔间集：org ⊇(部门子树) ⊕(项目成员) ⊕(pair 关系) ⊕ 员工自身L4
  2 recall       混合检索: 向量(pgvector) + 关键词 + 时近/重要性分（Generative Agents 三因子）
  3 budget       maxEntries/maxChars 预算内择优（沿用 enterprise-memory-context 现有预算机制）
  4 label        注入时逐条标注证据来源: [组织记忆]/[部门记忆]/[项目记忆]/[我的笔记]/[张三的偏好]
  5 log          注入快照作为 request/context 事件落日志（见 §13 不变量）
```

排序按相关性分数混合，层级只用于授权过滤与同分 tie-break（最具体的证据优先），不是机械的层级拼接。

### 7.3 写回分流

turn 结束后 writeback worker（已有，两阶段抽取-更新，同构 Mem0）按条目判定落点：默认 → L4；判定为组织/部门级知识 → 生成 proposed 提案（`remember_business_knowledge` 现有工具语义保留）；pair 级偏好 → L5。人工显式"记住这个"即时写指定隔间。

### 7.4 整合与遗忘（consolidation job）

空闲期/夜间 per 隔间执行（schedules 承载）：去重合并、冲突解决（新事实覆盖旧事实，保留 provenance 链与 Zep 式有效期 `validFrom/invalidatedBy`）、按 访问时近×重要性 衰减、`retired` 归档（不物理删）、周期生成隔间摘要（digest 条目）、对 L4 做反思——把重复出现的私有经验生成晋升候选（对应 sleep-time compute / SCM / Generative Agents reflection）。所有整合操作本身是可审计事件。

## 8. 运行时与工具

每员工运行时 = `release.snapshot.profile`（modelRef/persona/agentOptions，已有）+ isolate realm（已有）+ 工具 = release 资产绑定（已有）+ **记忆工具集** + per-employee credentials（新）。记忆工具集（模型可见，schema 进 prompt 组装）：

- `memory_search(query, scopeFilter)` — 跨自身可见隔间检索（走 §7.2 管线）
- `memory_write(scope, content, kind)` — 只能写 L4；写 L3/L5 需当前会话在该隔间内
- `memory_read(entryIds)` / `memory_retire(entryIds)` — 读与自弃（ retire 仅限自己 L4/L5）
- `promote_proposal(targetScope, content, rationale)` — L4 → L1/L2 提案（进审查队列）

主动性：schedules 驱动晨报/巡检/跟进（到点写 inbox）；jobs 跑后台；渠道/webhook 入站唤醒。员工间协作只经 Surface/team session 的邮箱与任务板，**永不互访对方 L4**。

## 9. 治理与审计

- 每条记忆带 `sourceSessionId/sourceSeq/sourceDigest/reviewedBy/createdAt`，可检索可删除（用户请求删除 → 对应隔间条目 retired + 审计事件）。
- 员工详情页 **"它知道什么"** 视图：五隔间分页列出条目 + 来源 + 状态 + 最近访问，管理员可否决提案 / retire 条目（原型图 1）。这兑现 PRODUCT.md "with what evidence" 的成功标准，也是企业采购信任的关键界面。
- 授权矩阵沿用四层 AccessScope + visibility；新增 project compartment 的成员制判定；员工主体零角色原则不变。
- 渠道身份只是别名：canonical enterprise principal 才是动作主体（PRODUCT.md 既有结论），sticky_bindings 存的是"偏好路由"而非身份映射。

## 10. 数据模型（新增/变更清单）

新表（PostgreSQL，随 `enterprise-identity-postgres` / 新包迁移）：

```text
employee_accounts   (employee_id PK, org_id, display_name, role_card, active_release_id,
                     state, home_workspace_id, created_at, updated_at)
employee_inbox      (inbox_id PK, employee_id, surface_id, origin_actor, payload_ref,
                     state, attempts, created_at, delivered_at)
sticky_bindings     (binding_id PK, org_id, actor_key, surface_kind, employee_id, updated_at)
surfaces            (surface_id PK, org_id, kind, team_definition_id?, project_id?,
                     compartment_id, state, created_at,
                     topic_policy?[thread|command|lane],      -- channel 专属
                     respond_policy?[all|mention|duty|ingest_only],
                     duty_schedule_id?)                       -- channel 专属
channel_topics      (topic_id PK, surface_id, title, state[open|settled|archived],
                     session_id?, created_by, created_at, settled_at?)
surface_members     (surface_id, principal_type[user|employee], principal_id, role_id?)
projects            (project_id PK, org_id, name, goal, workspace_id, compartment_id,
                     team_definition_id?, state, visibility, allowed_user_ids?,
                     created_by, created_at, archived_at?)
project_members     (project_id, principal_type, principal_id, added_by, added_at)
```

变更表：

```text
enterprise_memories  scope CHECK ('organization','department') → + ('project','agent','pair')
                     + compartment_id? / agent_employee_id? / pair_user_id?
                     + importance real, last_access_at, valid_from?, invalidated_by?
                     （既有 organization/department 行为零迁移、语义不变）
```

session 侧不新增持久结构：Surface 归属、originActor/originSurface 记录在既有 SessionHeader.meta 与事件 envelope meta（与 `agentPreset` 锁定同模式）；若 envelope 需要新增成员，按既有的 `ignorable` 语义处理，不升 SESSION_FORMAT_VERSION。

## 11. 包级落地映射

新增包：

- `packages/enterprise/employee-account`：EmployeeAccount 注册表、收件箱、sticky 仓库、员工生命周期服务（`ctx.employeeAccounts`）。
- `packages/enterprise/enterprise-surface`：Surface 注册表 + **投递桥**（channel kernel → inbox → anchored session，套 webhook `createWebhookSession` 范式）（`ctx.surfaces`）。
- `packages/enterprise/enterprise-project`：项目实体、成员制授权、隔间生命周期（`ctx.enterpriseProjects`）。

变更包：

- `packages/identity/enterprise-identity(-postgres)`：schema 扩展（§10）+ memory-policy 扩 L5 隐私门。
- `packages/context/enterprise-memory-context`：读管线授权过滤/来源标注、写回分流、consolidation job、`ctx.memory` seam 化（现 inject 配置升级为 Service Definition/Provider/Consumer 三角色，符合能力接缝规范）。
- `packages/channel/channel-kernel`：暴露 `routeInbound` 给投递桥消费者（无内核语义变更）。
- `packages/api/enterprise-controller`：员工账户/收件箱/Surface/项目/记忆治理的 HTTP+RPC 端点（全部过企业安全覆盖）。
- `packages/client/ui-enterprise-workbench`：员工详情（记忆视图）、项目空间、群聊两档卡片、晋升审查队列。
- `packages/experimental/enterprise-team-runtime`：run 的 `source='channel'` 路径接通 + 开场隔间召回注入。

明确不做：不改 agent-loop；不动 session 格式版本；Workspace 语义不变（项目只引用）；组织记忆审查制不变。

## 12. 分期计划

- **P0 员工存在**：employee_accounts + inbox + sticky 仓库；投递桥打通 Web 私聊与一个渠道（WeCom）；员工详情页基础视图。验收：外部渠道私聊 → 员工 session 回复 → 日志可回放。
- **P1 员工学习**：记忆 seam 五隔间（L4/L5 与 L1/L2/L3 同表不同 scope）；记忆工具集；writeback 分流；隐私门扩展；"它知道什么"视图。验收：同一员工跨会话表现出私有经验；提案进审查队列。
- **P2 协作形态**：Surface 全量（群聊两档 + 频道话题/当值路由/公告进水口 + 项目数据模型/授权 + 北极星团队接入）；团队隔间；项目空间 UI。验收：有章程群从外部渠道一条消息跑通 Lead→Doer→Verifier→决策回流；值班频道 @ 与当值两条路由均可达且话题落定可审计。
- **P3 组织飞轮**：consolidation job + 晋升流 UI + 隔间摘要 + 衰减归档。验收：项目结项后教训可晋升部门记忆并可在新会话被召回。

## 13. 不变量与验证

- **Model-visible ⟺ logged**：记忆注入走 `request/context` 事件落日志（架构既有机制）；员工记忆写入是 tool/call；写回源头是 session 日志自身且新条目携带 sourceSession/seq——整链路可从日志重建，运行时不变量断言之上再加 memory 注入与日志一致的检查。
- **投影而非第二引擎**：Surface/项目/收件箱都是控制面治理数据，执行状态永远以 Session 日志为权威；员工详情与项目空间一律从日志+记忆库投影，不缓存运行态。
- 测试策略（仓库规范）：新工具与 surface 事件进 keyless recorded-session 快照；记忆管线单测覆盖五隔间授权矩阵（含越权用例）；投递桥用 channel-kernel 现有测试基建做幂等/恢复用例；Host/Client 双面 typecheck + 100% 覆盖率门禁照常。

## 14. 开放问题（不阻塞评审，实施前定）

1. 员工凭证命名空间的加密与轮换细节（沿企业凭据 AES-256-GCM 现状还是引入 KMS 抽象）。
2. L5 双边记忆在多渠道别名下的 pair 归并（同一 canonical user 多渠道账号）。
3. consolidation job 的默认档期、频道话题归档天数等租户级可配置项的默认值（不改协议常量，全部走 Config）。

## 15. 附录 A：论文与工业实践映射

| 设计点 | 来源 | 采纳方式 |
|---|---|---|
| 两阶段抽取-更新写回 | Mem0 (ECAI 2025, arXiv:2504.19413) | writeback worker 已同构，扩为五隔间分流 |
| 时序知识图谱/事实有效期 | Zep/Graphiti (arXiv:2501.13956) | L1-L3 冲突解决引入 validFrom/invalidatedBy（轻量版） |
| 自编辑记忆 | Letta/MemGPT；Anthropic memory tool | L4 经记忆工具自编辑，存储结构化统一治理 |
| 分层注入 + 空闲整合 | ChatGPT 四层记忆/"Dreaming" | §7.2 注入预算 + §7.4 consolidation |
| 多用户权限感知共享 | Collaborative Memory (arXiv:2505.18279) | 隔间授权谓词 + pair 级 ACL |
| importance/recency/relevance + reflection | Generative Agents (arXiv:2304.03442) | 检索三因子 + L4 反思晋升 |
| 睡眠期整合与算法遗忘 | Sleep-time Compute (Letta)；SCM (arXiv 2026) | consolidation job 的衰减/合并/反思 |
| 多智能体群聊防串扰 | Collaborative Memory；Mem0 多智能体生产模式 | @路由红线 + Lead 唯一入口 |
| 章程化人机团队 | 已实现（Agent Teams + EnterpriseTeamDefinition） | 群聊团队式直接接入，零运行时新建 |

## 附录 B：原型图索引

> 均为自包含 HTML，浏览器直接打开；配色按 DESIGN.md（暖中性底 + cobalt 主行动色 + 状态色不单独表意）。

1. [员工详情](2026-09-22-persistent-employee-mockups/1-employee-detail.html) — 五层记忆按色分区，一层一色；一键批准晋升提案
2. [项目空间](2026-09-22-persistent-employee-mockups/2-project-space.html) — 进行中 / 项目记忆 / 等你拍板，三件事一屏
3. [群聊 · 团队式](2026-09-22-persistent-employee-mockups/3-group-team-chat.html) — 只有 Lead 回话：任务勾选 + 一张决策卡
4. [群聊 · 联邦式与私聊](2026-09-22-persistent-employee-mockups/4-group-federated-chat.html) — @ 谁谁答、其余静默；记忆来源用色点标注
5. [频道](2026-09-22-persistent-employee-mockups/5-channel.html) — 话题分流、当值徽标、公告只收不答
