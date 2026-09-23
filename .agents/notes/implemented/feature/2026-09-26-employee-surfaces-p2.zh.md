# Agent Note: 员工协作形态

Status: implemented

[English](2026-09-26-employee-surfaces-p2.md) | 中文

## 问题

P0 的数字员工只能进行一种对话：私有的（用户, 员工）dm 通道。没有群聊、频道或项目形态，团队无法共享一个表面，运营频道无法分区对话或承接公告，项目范围内的知识既没有治理实体也没有召回路径。P0 建成的频道路由内核没有任何消费者，P1 的记忆召回覆盖了组织、部门和私有隔间，但 project scope 既无写入方也无读取方。

## 决策

员工现在以三种新形态共享协作表面，全部存储在企业身份 SQLite schema v8 的 `surfaces` 表中，由 `@deepseek-ai/dsh-enterprise-surface` 承载，并配有企业控制器 HTTP 边界和工作台投影。

**群聊分两档运行。** 联邦群（无章程）把每条消息路由给被 @ 的成员员工——先显式 id，再显示名 token——并逐个 steer 其持久的按员工群会话，键为 `surface_sessions` 的（表面, 员工）绑定；群投递不触碰 `employee_inbox`，inbox 语义保持 dm 专属。章程群（携带 `teamDefinitionId`）把 TeamRun 根会话当作 Lead 的协调面：投递解析团队的活跃 run，若无则经幂等 `startRun` 启动（`source: 'channel'`，幂等键为按消息的 `surfaceId:originUserId:messageId`），再经运行时的 `submitRunInput` 提交文本，以 `team-run-message` 落入 run 根。

**频道分区并承接。** 交互频道携带话题策略（`thread`、`command`、`lane`），每条消息先按 @ 提及路由，再落到 surface 静态值班名册的当值头；每个话题拥有唯一持久会话，由首个被路由员工锚定。`/done` 双重落定话题——`channel_topics` 行和 steer 进话题会话的 `/done` 标记——落定在两条留痕中都可审计。ingest-only 频道从不开回合：每条公告经身份存储的 `proposeMemory` 成为一条 proposed 的组织 scope 记忆，先过 scope 感知隐私检查，无法提议时按结构化结果丢弃。

**项目是一等治理实体。** `@deepseek-ai/dsh-enterprise-project` 把组织范围内、成员准入的项目空间持久化在 PostgreSQL（`projects` 加显式 `project_members`），暴露为 `ctx.enterpriseProjects`：visibility 只约束列表，而每个消费路径都会运行的 `requireMember` 把未知 id、其他组织和非成员统一折叠为一个不泄露存在性的 `undefined`；`archive` 是终态。创建复用 `team.manage` 授权动作与 creator 角色；群和频道表面可携带 `projectId` 引用。

**记忆召回获得 L3 项目隔间。** `resolveSessionActor` 经每种表面锚点解析会话——dm 对、群会话的员工、或仅有项目的频道话题——组装监听器在 `requireMember` 按表面的 `projectId` 确认会话行为人成员资格之后，才取回已批准的项目记忆。项目条目最后渲染在 `[Project memory]` 之下，并合并在共享与私有列表之后，因此排序精确同分时保持取回顺序（共享, pair, agent, 项目）。同一项目表面上的非成员会话、没有主体身份的会话、未挂载项目服务时，都解析为无隔间而不是错误。

## 延期偏差（D1–D5）

D1：章程团队投递绕过 `employee_inbox`——run 根就是 Lead 的协调面，inbox 语义保持 dm 专属。D2：频道当值是 surface 级静态名册；schedules 集成（时间窗轮换）等待组织级 schedule 查询 API，而 schedules 包尚无此 API。D3：团队与群记忆隔间（跨 run 记忆）等待 P3 整合。D4：ingest-only 进水直接提议截断后的公告文本；LLM 公告整理等待 P3。D5：频道入站路由接收已规范化 envelope，以部署令牌认证（`x-dsh-channel-token`，未配置时 503）；WeCom 加解密回调接线属部署证据，wecom 测试基建的伪造加密报文能力仍可供该集成复用。

## 其他已记录选择

`archive(projectId, byUserId)` 为调用方的审计留痕记录请求行为人，store 只保存落档时间。表面是对话通道，控制器复用既有授权动作（`channel.read`、`employee.execute`、`employee.create`）而不新增，项目复用 `team.read`/`team.manage`；该 union 不新增 surface 或 project 专属成员。共享记忆提案仍无法归属回发起员工（P1 限制继续成立）。项目成员名册 GET 端点延期；成员可通过进程内 `listMembers` 观察。

## Alternatives considered

**章程消息经 Lead 员工的 inbox 路由。** 复用 dm inbox 可以保住唯一投递机制，但 run 根本来就是 Lead 的工作面，经 inbox 路由会新增第二条队列、丢失 run 幂等键，并且投进一个不属于该 run 的会话。直接提交 run 保持每个 run 一条输入路径。（D1）

**从 schedules 推导当值。** 时间窗轮换能把当值表达为 schedules 包拥有的数据，但该包没有组织级 schedule 定义或查询 API——自建一个是新机制而不是接线改动。静态名册先落地路由形态，轮换留给集成。（D2）

**让公告开启对话。** 让 ingest-only 频道用 LLM 回合整理公告能得到更丰富的记忆条目，但每条广播都要消耗模型调用，还会把未评审的综合内容放进共享记忆；直接提议把人工评审队列保住为控制点。（D4）

**入站路由接收原始 webhook 载荷。** 在控制器内做签名解密会把企业边界与某个传输的加密算法耦合；规范化 envelope 契约让控制器可用普通请求测试，把传输桥留给部署证据。（D5）

**按列表可见性授权项目召回。** visibility 已经约束项目列表，把它复用于记忆召回可以省掉成员检查——但会把项目行泄漏给每个能列出 'organization' 可见项目的用户。成员资格才是访问判定，所以召回按 `requireMember` 把关，与 HTTP 详情路由一致。

## Testing

P2 验收套件经控制器边界驱动组合链路：一条章程群消息从 HTTP envelope 出发，经 `startRun`（`source: 'channel'`，按消息幂等，重投 envelope 复用同一 run）进入 run 根的记录日志，决策经 `respondDecision` 回流为已答——run 根之后的 Lead→Doer→Verifier 内部细节仍由团队运行时套件覆盖。频道 envelope 走令牌认证的入站路由，覆盖 @ 提及与当值两条路由进入锚定话题会话，以及 `/done` 双重留痕（store 行与会话标记）；ingest-only 公告在真实身份存储中落为一条 proposed 组织行。项目召回在真实身份存储库与真实 `EmployeeAccountService` 之上覆盖成员、非成员、未锚定、未挂载服务四种会话。包级套件覆盖存储 schema 与迁移、两档群投递、运行时 `submitRunInput` 契约、项目服务授权矩阵、控制器端点与工作台切片；PostgreSQL 集成套件沿用 skip 约定。

## 后果

一套部署现在可以跑全部五种交互形态——dm、联邦群、章程群、频道、项目空间——它们引入的每个模型可见输入（`surface-message`、`team-run-message`）都能从会话日志重建。安全属性是结构性的：私有与项目记忆只经显式 scope 取回进入并以会话行为人把关，run 输入接缝拒绝终态 run。代价：值班名册在 schedules 集成落地前是静态的，跨 run 团队记忆等待 P3，新模型可见消息 source 的 recorded-session 快照属于 owner-local——本环境没有 `DEEPSEEK_API_KEY`，企业组合需要它的 PostgreSQL 环境；owner 在密钥与企业环境（见 `apps/cli/config/enterprise.cordis.patch.yml`）就绪后用 `DSH_SNAPSHOT=record` 录制，并在入库前审查完整 diff。

## Deferred

schedules 支撑的当值轮换（D2）、随 P3 整合的团队与群记忆隔间（D3）、LLM 公告整理（D4）、WeCom 加解密回调部署接线（D5）、项目成员名册 GET 端点，以及共享提案归属回发起员工。
