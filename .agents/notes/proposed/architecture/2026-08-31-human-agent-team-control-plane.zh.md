# Agent Note: Human–Agent 团队定义与 Run 控制平面

Status: proposed

[English](2026-08-31-human-agent-team-control-plane.md) | 中文

## Problem

DSH 已经拥有持久 Session、Workspace、Employee Release、审批、subagent 生命周期和 Session event。Experimental Agent Teams 能力还在 Lead Session 上提供隐式根 Agent roster、持久任务 DAG 和 mailbox。它没有定义可复用的企业 Team 模板、Human roster 成员、Human 决策权、有范围的自治权演进，也没有一个聚合跨 Run Human 注意事项的入口。

如果把这些关切直接放进渠道、PostgreSQL 任务数据库或第二个编排引擎，系统将对 Team 成员、任务或审批是否已变更，以及哪项证据授权了不可逆操作给出互相竞争的答案。如果把 Human 视为团队外的审查者，Human 指令和决策也无法进入用于 Agent 工作的同一 actor 和审计模型。

## Proposal

本提案在 DSH 周边增加企业定义、命令、索引和投影能力，而不是增加另一个执行引擎。它扩展但不取代现有 [Agent Teams 运行时决策](../../implemented/feature/2026-08-05-agent-teams.zh.md)及其 [experimental 包边界](../../implemented/architecture/2026-08-18-experimental-agent-teams-packages.zh.md)。现有 `TeamService`、roster、task、mailbox、continuation 和 Session log fold 继续作为执行基础。

### 交付阶段顺序

首个交付阶段只实现 DSH 核心协作闭环：在经认证的 DSH 内实现 Team Definition、TeamRun 启动、Human 和 Agent roster、Agent Lead 协调、任务 DAG、决策、验证、人工接管以及跨 Run Human 待处理入口。它不暴露企业渠道命令界面。

该核心闭环通过回放、授权、恢复和 Human 注意事项验收标准后，企业渠道阶段先接入企业微信。飞书和钉钉随后复用同一 DSH 适配器协议，而不引入提供方特定工作流状态。在所有阶段中，个人微信都仍限于通知和邀请用户进入经认证 DSH 完成人工接管。

### Team Definition 与 TeamRun

`TeamDefinition` 是可复用、可版本化的企业定义，其持久化权威为 PostgreSQL。它包含 Human 编写的章程、Human 和 Agent 角色模板、一名 Agent Lead、必需的 Employee Release 和 Credential 引用、任务类型策略、Doer–Verifier 分离规则、能力授权、审查节奏、停止条件和渠道通知策略。保存或修订定义不会创建 Session、Team task、mailbox message 或审批。

`TeamRun` 是一次执行精确 Team Definition 版本的过程。它的持久身份是 DSH 根 `SessionId`；PostgreSQL 保存以同一身份为键的查询投影，而不分配第二个 Run 权威身份。启动会先把定义版本、Run 特定北极星、Workspace、实际参与的 roster、有效授权和决策策略记录进根 Session，然后 Agent Lead 才开始拆解。

由该根 Session event log 支撑的现有 experimental `TeamService` 继续作为唯一持久运行时所有者。启动和企业命令调用 `TeamService`，在同一 Team 领域追加可版本化 event。企业层只拥有 Team Definition 持久化、经授权命令、索引和投影；它绝不创建第二 roster、task board、mailbox、决策日志或验证 store。

Team Definition 可以在 Run 活动期间变更，但 Run 保留其启动版本和明示修订。经 Human 授权的修订会追加 Session event 并更新投影；编辑可复用定义绝不会隐式修改活动 Run。

### 状态归属与投影

对每个 TeamRun，`TeamService` 与其 DSH 根 Session event log 共同组成一个运行时权威：Service 验证并追加 Team 领域 event，log 持久拥有实例化 roster、task、mailbox、决策、验证和人工接管状态，其中包括 Human 指令、Agent 操作、审批、产物和渠道交付证据。Session 回放用已启动 Team Definition 快照和后续 event 驱动同一 `TeamService` fold，而不把 PostgreSQL 行当作运行时真源。Session event 顺序和身份继续作为运行时审计顺序和关联来源。

PostgreSQL 是可复用 Team Definition 的持久化权威，并保存搜索索引、组织策略引用和可重建的跨 Run 查询投影，例如 `Needs my attention`。这些查询投影不是运行时权威。投影 cursor 记录已应用的最后一个 Session event；延迟可能使列表陈旧，但绝不能授权操作。每项运行时变更都会先重新加载并根据所属根 Session 完成授权，然后追加 Session event。

DSH 作为产品是所有渠道中唯一业务状态与审计系统：PostgreSQL 提供 Team Definition 真源，根 Session event log 提供 TeamRun 运行时真源，渠道只提供传输观察。任何渠道数据库、sticky 选择、交付回执或提供方 event 都不得覆盖两个 DSH 权威之一。

现有 DSH 权威保持不变：Workspace 拥有业务空间和文件系统边界，Employee Release 选择不可变的已发布 Agent 组合，Approval 拥有交互授权，Subagent 和 experimental Agent Teams 拥有子执行与协调，Credential 拥有密钥材料，SessionEvent 拥有审计和回放。PostgreSQL 不会把凭据值或原始对话内容复制进 Team 定义或查询行。

### Human 与 Agent actor

拟议 event schema 把 `TeamService` 内当前 `TeamMemberSnapshot` 扩展为一个可版本化的可辨别 union，在同一 `team/member` event family 中承载两种 actor。Human 成员包含 `actorKind: 'human'`、企业 `userId`、角色元数据，但没有 Session 身份。Agent 成员包含 `actorKind: 'agent'`、`sessionId`、`employeeReleaseId`、服务身份、角色元数据和有效授权。渠道 alias 可解析为 Human `userId`，但 alias 自身绝不是授权 actor。

每个 Agent 使用独立服务身份和 Credential 引用。Agent 不会获得 Human 浏览器 token、渠道 session 或可复用的委托 bearer credential。Agent 操作的有效权限是企业策略、Team Definition 授权、Run 修订、Employee Release 能力、Workspace 范围和操作自身审批要求的交集。

Human 拥有北极星、价值判断、自治权变更、策略例外和不可逆决策。Agent Lead 负责拆解工作、维护任务 DAG、分配 Doer 和 Verifier、协调现有 mailbox、验证就绪状态、组装证据并提出决策请求。Agent Lead 不能扩大授权、审批自己的升级，也不能把缺失证据转换为成功。

### 信任授权与验证

每项自治授权都以 Agent、任务类型和能力范围为键。信任级别为以下之一：

- `observe`：读取已授权上下文和证据，但不修改工作状态或外部系统。
- `propose`：创建建议、草案、计划或决策请求，但不执行所建议的变更。
- `execute-reviewed`：在范围内执行，但在必需的 Human 或 Verifier 复核接受前，不得让结果推进依赖工作流。
- `execute-delegated`：在范围内执行预先授权的可逆工作并推进普通工作流；不可逆操作和策略例外仍需 Human 审批。

Agent 不能授予、扩大或转移自治权。Human 授权会记录原范围和新范围、原因、过期时间或审查日期，以及受影响的任务类型。复盘证据可以支持后续授权变更，但绝不会自动修改授权。

策略要求分离的任务使用不同的 Doer 和 Verifier 分配。完成记录 Doer 的结论和证据；验证记录独立的接受、拒绝或有边界的疑虑。同一 Agent 不能同时担任该任务的两个角色，除非 Human 记录了策略例外及其后果。

### Human 注意力与决策

决策请求包含建议选项、备选方案、后果、截止时间、下游阻塞、必需授权和有边界的证据包。跨 Run `Needs my attention` 视图由未解决的 DSH 决策和审批 event 以及授权投影重建；它不是可以独立结算工作的 inbox。

只有已选请求共享相同操作语义、授权要求和后果类别时，才允许批量决策。UI 为每个受影响 Run 记录一条可归因的决策 event，使回放和局部失败保持明确。风险、过期时间和被阻塞的下游工作优先于到达时间。

### 渠道是适配器

DSH 核心协作闭环交付后，企业微信是第一个企业适配器；飞书和钉钉随后复用同一接口。适配器验证其传输账户、把意图映射为 DSH 命令、以解析后的 Human principal 提交命令，并呈现所得 DSH 投影或交付回执。它只拥有传输重试和提供方确认。

Channel Kernel 保留其当前确定性路由输入和优先级：`stickyEmployeeId`，然后 `intentEmployeeId`，再然后 `binding.defaultEmployeeId`。Kernel 和适配器都不持久化权威 selection。企业组合必须从 DSH 拥有的渠道 binding 或 Session 投影推导 `stickyEmployeeId`，并在该投影变更前通过可归因 DSH 命令持久化 `/switch`。该组合属于迁移目标，不是已完成适配器行为。

个人微信只是通知和 Human 接管传输。它不能发出创建、编辑、分配、完成或审批 task，变更 roster 或 grant，结算决策，或修改 Team 状态的 DSH 命令。它的消息引导 Human 进入经认证的 DSH 界面。

每项渠道或 outbox 操作都持久化一个稳定 `operationId`。DSH 为该 id 只接收并派发一个逻辑操作，恢复会继续同一记录，而不是创建第二次派发。提供方支持幂等键时，适配器传入 `operationId` 并可声明提供方侧去重。没有该支持或超时使提供方结果模糊时，操作进入可见 `unknown-outcome` 状态等待对账，而不是盲目重试。

任何渠道数据库或提供方确认都不是 task、审批、roster、决策或审计权威。提供方接受只能证明交付给提供方，不能证明 Human 已收到或已产生业务结果。该设计不对外部提供方声明 exactly-once。

## Alternatives considered

**把 Team task 和审批主要存储在 PostgreSQL。** 这会使 Session 回放不完整，并在执行日志与控制数据库之间引入双写顺序。PostgreSQL 保持为 Team Definition 的持久化权威并存储可重建查询投影，而根 Session event log 拥有 TeamRun 运行时状态。

**让每个渠道拥有自己的工作流状态，再于事后同步。** 渠道意见不一致或交付重试对命令重新排序时，对账无法确立唯一权威决策。渠道保持为 DSH 命令和投影的适配器。

**新建企业 roster、task board 或 mailbox。** 现有 experimental `TeamService` 已经拥有 Lead Session 上的持久成员 event、task CAS、DAG 验证、roster 恢复和 mailbox 交付。其同一 event family 增加 Human actor，而企业层增加定义、命令、索引和投影，不复制运行时状态。

**合并 Team Definition 和 TeamRun。** 编辑可复用模板将可能修改活动工作，每次启动也会覆盖用于解释其策略的历史。分离可版本化定义与以 Session 为根的 Run，可以分开复用与执行。

**仅把 Human 表示为 roster 之外的审批人。** Human 目标、指令、可用性和决策将成为 Team 周边的元数据，而不是 Team actor 可归因的工作。因此 Human 和 Agent 共用一个 roster，但拥有不同权限。

**为每个 Agent 分配一个全局自治级别。** 某一任务类型或能力已经证明的信任将溢出到无关工作。授权保持为 Agent、任务类型和能力范围的交集。

**让 Agent 复用发起 Human 的凭据。** 归因、撤销、最小权限和离职将变得含糊。每个 Agent 使用独立服务身份和 Credential 引用。

## Acceptance criteria

- 通过 `TeamService` fold 回放一个根 Session，能在不把 PostgreSQL 当作 TeamRun 运行时真源的情况下，重建其已启动定义版本、可辨别 Human 和 Agent `TeamMemberSnapshot` 记录、任务 DAG、mailbox 状态、决策、审批、验证、人工接管、产物和授权修订。
- 删除 PostgreSQL 查询投影并从 Session event 重建，会产生相同的跨 Run 待处理事项并记录可检测延迟 cursor；陈旧投影不能授权变更。
- 授权测试覆盖每个信任级别和完整 Agent × 任务类型 × 能力交集，包括拒绝自我升权、授权转移、Human 凭据复用、Doer–Verifier 冲突和不可逆的委托执行。
- Team 启动测试证明一个定义版本可以创建独立 Run，后续定义编辑不会修改它们，而明示 Human 修订可归因且可回放。
- 现有 experimental Agent Teams 测试继续拥有 task CAS、DAG、roster、mailbox、恢复和 continuation 行为；企业组合测试证明命令调用 `TeamService`，且不存在第二 roster、task、mailbox、决策或验证 store。
- 发布和渠道测试证明核心协作闭环不依赖企业渠道命令，Kernel 路由仍为 sticky → intent → default，权威 sticky selection 只来自 DSH 投影，企业微信是后续首个适配器，个人微信状态变更意图在命令执行前被拒绝。
- Outbox 测试证明一个稳定持久 `operationId` 标识一个逻辑 DSH 派发，仅在提供方支持时使用提供方幂等键，且不支持或模糊的提供方结果会成为需要对账的可见 `unknown-outcome` 记录，而不是 exactly-once 声明。
- Client 测试覆盖键盘使用、响应式 Team Room 阅读顺序、Human 和 Agent roster 区分、密钥隐藏、任务 DAG 列表等价视图、证据关联验证、紧急事项可见性、仅兼容事项批处理和局部批处理失败。
- Keyless Session snapshot 锁定模型可见 Team 章程、有范围的授权、Agent Lead 职责、Doer–Verifier 分离、升级包、渠道负面保证和不可逆决策负面保证。
- 恢复测试在每个持久边缘中断启动、投影、Agent 执行、验证、批量决策和 outbox 派发，并证明 DSH 不会重复 actor、task、决策或逻辑 operation id；模糊外部效果保持未知，直到对账完成。

## Risks

跨 Run 查询最终与多个 Session log 保持一致，因此 UI 必须暴露新鲜度并重新验证每项变更，同时不让普通待处理审查变得嘈杂。

统一 roster 可能暗示 Human 和 Agent 拥有相同权限，但它们的决策权被有意设计为不同。Actor 类型、当前角色、授权范围和决策负责人必须始终明确，但不能把 roster 变成凭据界面。

详细授权和验证策略可能使启动过程不堪重负。定义需要安全的组织默认值和渐进展示，但紧凑 UI 不能隐藏精确 Agent、任务类型、能力、过期时间或不可逆操作规则。

Human 注意事项批处理可以提高吞吐量，同时让同意变得不具体。即使兼容性检查、后果预览、每 Run 一条 event 和明确局部失败会增加交互成本，它们也是必需的。

当前 experimental Agent Teams roster 只建模 Agent，其 task event 也不包含本提案的所有 Human、验证、授权、产物或决策字段。实现必须有意扩展 event 归属并保留现有回放语义，而不是从 UI 或 PostgreSQL 推断缺失记录。

不支持幂等键的提供方可能已应用外部效果，然后超时隐藏了结果。防止盲目重试会减少意外重复，但也会引入运维对账，并可能让 TeamRun 保持阻塞，直到 Human 或提供方查询解析该结果。
