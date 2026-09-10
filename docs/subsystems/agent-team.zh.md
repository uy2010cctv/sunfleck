# Agent Teams

[English](agent-team.md) | 中文

实验性隐式 Root Team 领域、模型工具与宿主适配器共享的类型。[Agent Teams Agent Note](../../.agents/notes/implemented/feature/2026-08-05-agent-teams.zh.md)负责身份、mailbox、task 与共享 checkout 决策；本页记录 [`packages/experimental/agent-team/src/types.ts`](../../packages/experimental/agent-team/src/types.ts) 中的字面持久形式。

## 身份与 roster

`TeamId` 是具有独立[品牌](core.zh.md#branded-ids)的 Root `SessionId`。`TeamTaskId` 在 Team 内按 `task-<n>` 单调分配；`TeamMessageId` 是全局随机值。teammate 的 Session id 始终是持久身份，而 `name` 是不可变的模型／UI 标签。

```ts type-equiv
/** Whole durable value written on every teammate lifecycle change. */
interface TeamMemberSnapshot {
  readonly id: SessionId
  readonly name: string
  readonly description: string
  readonly provider: string
  readonly context: 'fresh' | 'fork'
  readonly phase: TeamMemberPhase
  readonly error?: string
  readonly employeeReleaseId?: string
  readonly roleId?: string
  readonly release?: TeamReleaseSnapshot
}
```

每个 member 都从 `provisioning` 开始，并且只到达一个终态 roster phase：`active` 或 `failed`。运行时 `running`／`idle`／`inactive` 状态单独派生，绝不会重写该记录。

## 持久 mailbox

Lead Session 首先存储完整 queued message。只有 target 的 pending inbox 条目或已记录用户消息完成持久化，才会写入独立 acknowledgement event，queued-minus-delivered 因而构成恢复 mailbox。

```ts type-equiv
/** One peer message retained until its target Session records it. */
interface TeamMessageSnapshot {
  readonly id: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
  readonly targetId: SessionId
  readonly content: ContentBlock[]
}
```

每条消息都会尝试 Steer 投递。running target 在最近的步骤边界收到消息，idle target 启动一个轮次，inactive teammate 则冷恢复。调用方不能选择其他模式，因此持久记录不存储调度方式。

target Session 会在 pending inbox 条目和最终用户消息上保留消息身份与发送者归因。跨 inbox 与历史折叠该 source 构成 target 侧去重键；模型可见的 framing 会重复 id 和发送者。

```ts type-equiv
/** Source retained by the target Session for durable mailbox de-duplication. */
interface TeamMessageSource {
  readonly kind: 'team-message'
  readonly teamId: TeamId
  readonly messageId: TeamMessageId
  readonly senderId: SessionId
  readonly senderName: string
}
```

## 共享任务 DAG

每条 task event 都存储完整快照。`revision` 是 compare-and-set 值，每次变更递增 1。`blockedBy` edge 必须指向未删除任务，并维持无环图。`writeScopes` 是规范化的提示性路径前缀，不是锁。

```ts type-equiv
/** Whole durable task snapshot; every mutation increments {@link revision}. */
interface TeamTaskSnapshot {
  readonly id: TeamTaskId
  readonly revision: number
  readonly subject: string
  readonly description: string
  readonly status: TeamTaskStatus
  readonly ownerId?: SessionId
  readonly blockedBy: TeamTaskId[]
  readonly writeScopes: string[]
}
```

`pending` 表示尚未开始或已经释放，`in_progress` 携带 owner，`completed` 满足 blocker，`deleted` 是保留的 tombstone。view 会添加 owner name、readiness 和 write-scope 重叠警告，但不会改变持久快照。

## 企业运行与 Human roster

同一 Team 日志可以保留一个企业 TeamRun、Human roster 条目、不可变员工 Release 证据与 Human 决策。Human 条目没有 Session 身份，也不会进入 Agent mailbox 或 task owner 权限。TeamRun 与 decision mutation 使用稳定 operation id 和单调 runtime revision；回放会拒绝身份变化、跳跃 revision、非法终态转换和 operation id 冲突复用。私有[企业 Team runtime adapter](../../packages/experimental/enterprise-team-runtime/README.zh.md)负责 Workspace、Release、Agent 创建、取消与冷恢复行为。

## 回放

`foldTeam()` 把一个 Root Session 回放成 Team 操作读取的 Agent/Human roster、任务板、queued-minus-delivered mailbox、TeamRun、decision 与 operation receipt。它按 `TeamId` 选取记录，因此普通 fork 继承的 event 保留 ancestor id，绝不会进入新 Root 的状态。Session event 的 `seq` 与 `time` 继续负责顺序和时间记录，Team snapshot 不再重复保存它们。roster、task、run 与 decision 读取以 view 形式到达调用方，而 pending 邮件仅供投递与恢复内部使用。包 [README](../../packages/experimental/agent-team/README.zh.md)负责 operation、authorization、recovery 和限制行为。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentteams--teamservice"></a>

### `ctx.agentTeams` — `TeamService`

Agent Teams service backed by the exact live Lead Session log.

```ts cordis-catalog
/**
 * Resolve one exact live Agent's Team role.
 * @param agent - exact live Agent used as the authority credential.
 * @returns its root, Team identity, role, and model-facing name.
 */
membership(agent: Agent): TeamMembership

/**
 * List the runtime-enriched roster visible to one Team member.
 * @param agent - exact live Team member.
 * @returns Lead and teammate rows in creation order.
 */
listMembers(agent: Agent): TeamMemberView[]

/**
 * Return the Agent and Human roster without granting Humans Agent authority.
 * @param agent - exact live Team member used to resolve the root Team.
 * @returns Agent and Human rows in durable roster order.
 */
listRoster(agent: Agent): TeamRosterMemberView[]

/**
 * Append or recover the authoritative starting TeamRun mutation.
 * @param root - exact live Team Lead whose Session owns the run.
 * @param request - immutable run identity, Release evidence, actor, and operation id.
 * @returns committed runtime revision and root event position.
 */
startRun(root: Agent, request: TeamRunStartRequest): Promise<TeamRuntimeMutationReceipt>

/**
 * Register a Human in the shared roster without Agent mailbox authority.
 * @param root - exact live Team Lead whose Session owns the roster.
 * @param member - immutable Human identity, display name, and Team role.
 * @returns once the Human roster event is durable.
 */
registerHuman(root: Agent, member: TeamHumanMemberSnapshot): Promise<void>

/**
 * Append one authoritative TeamRun transition.
 * @param root - exact live Team Lead whose Session owns the run.
 * @param request - target state, Human attribution, failure, and operation id.
 * @returns committed runtime revision and root event position.
 */
setRunState(root: Agent, request: TeamRunStateRequest): Promise<TeamRuntimeMutationReceipt>

/**
 * Append one runtime-projected Human decision.
 * @param root - exact live Team Lead whose Session owns the decision.
 * @param request - immutable open-decision fields and projection operation id.
 * @returns committed runtime revision and root event position.
 */
projectDecision(root: Agent, request: TeamDecisionProjectRequest): Promise<TeamRuntimeMutationReceipt>

/**
 * Append one CAS-protected Human answer.
 * @param root - exact live Team Lead whose Session owns the decision.
 * @param request - decision revision, answer, Human attribution, and operation id.
 * @returns committed runtime revision and root event position.
 */
respondDecision(root: Agent, request: TeamDecisionResponseRequest): Promise<TeamRuntimeMutationReceipt>

/**
 * Create one named, continuable direct child of the Team Lead.
 * @param caller - exact live Lead Agent.
 * @param request - immutable name, description, prompt, context mode, provider, and cancellation.
 * @returns the active roster row.
 */
async spawnTeammate(caller: Agent, request: SpawnTeammateRequest): Promise<SpawnTeammateResult>

/**
 * Queue one durable peer message, then attempt immediate delivery.
 * @param caller - exact live sending Team member.
 * @param request - target name, content, and pre-queue cancellation.
 * @returns durable message identity and immediate-delivery observation.
 */
async sendMessage(caller: Agent, request: SendTeamMessageRequest): Promise<SendTeamMessageResult>

/**
 * Create one unowned pending task in the Team Lead log.
 * @param caller - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @returns the revision-one task view.
 */
async createTask(caller: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Return one task, including a deleted tombstone.
 * @param caller - exact live Team member reading the task.
 * @param id - Team-local task identity.
 * @returns the latest task value and derived readiness diagnostics.
 */
getTask(caller: Agent, id: TeamTaskId): TeamTaskView

/**
 * List current non-deleted tasks in numeric creation order.
 * @param caller - exact live Team member reading the board.
 * @returns detached current task views.
 */
listTasks(caller: Agent): TeamTaskView[]

/**
 * Compare-and-set one authorized task transition.
 * @param caller - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @returns the committed next task revision.
 */
async updateTask(caller: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskView>

/**
 * Wait for the next Team-domain or member-status change.
 * @param caller - exact live Team member waiting for activity.
 * @param timeoutMs - bounded wait duration from ten seconds through one hour.
 * @param signal - caller cancellation for the wait only.
 * @returns one observed change or a timeout result.
 */
async waitForChange(caller: Agent, timeoutMs: number, signal: AbortSignal): Promise<TeamWaitResult>

/**
 * Interrupt one live teammate turn without clearing its pending inbox.
 * @param caller - exact live Lead Agent.
 * @param targetName - durable teammate name.
 * @returns the target status sampled before cancellation.
 */
interrupt(caller: Agent, targetName: string): { previousStatus: 'running' | 'idle' | 'inactive' }

/**
 * Resolve a caller without throwing, used by scoped-tool installation and observers.
 * @param agent - candidate exact live Agent.
 * @returns Team membership, or undefined for non-Team subagents and stale identities.
 */
tryMembership(agent: Agent): TeamMembership | undefined

/**
 * Read the current roster and non-deleted task board through the generated Remote API.
 * @param agent - exact live Team member used as the authority credential.
 * @returns detached current roster and task views.
 */
@Remote('view') remoteView(agent: Agent): TeamView

/**
 * Create one shared task through the generated Remote API.
 * @param agent - exact live Team member creating the task.
 * @param request - task text, blockers, and advisory write scopes.
 * @returns the revision-one task or a typed Team rejection.
 */
@Remote('createTask') remoteCreateTask(agent: Agent, request: CreateTeamTaskRequest): Promise<TeamTaskMutationResult>

/**
 * Apply one task mutation and preserve Team rejections as business results.
 * @param agent - exact live Team member authorizing the mutation.
 * @param request - task identity, expected revision, action, and action fields.
 * @returns the committed task or a typed Team rejection.
 */
@Remote('updateTask') remoteUpdateTask(agent: Agent, request: UpdateTeamTaskRequest): Promise<TeamTaskMutationResult>
```

Types: [Agent](core.zh.md)

Source: [`packages/experimental/agent-team/src/index.ts`](../../packages/experimental/agent-team/src/index.ts)

<a id="ctxenterpriseteamautonomycontroller--enterpriseteamautonomycontroller"></a>

### `ctx.enterpriseTeamAutonomyController` — `EnterpriseTeamAutonomyController`

Enterprise explicit autonomy-grant Remote service.

```ts cordis-catalog
/**
 * List visible explicit autonomy grants.
 * @param request - visible autonomy-grant filters.
 * @returns visible grant page.
 */
@Remote('list') async list(request: EnterpriseTeamAutonomyListRequest): Promise<EnterpriseTeamAutonomyGrantPage>

/**
 * Save an explicit human-authored autonomy grant.
 * @param request - explicit human grant and CAS fields.
 * @returns active grant.
 */
@Remote('save') async save(request: EnterpriseTeamAutonomySaveRequest): Promise<EnterpriseTeamAutonomyGrant>

/**
 * Revoke an autonomy grant terminally.
 * @param request - grant identity, CAS, and idempotency fields.
 * @returns terminal revoked grant.
 */
@Remote('revoke') async revoke(request: EnterpriseTeamAutonomyRevokeRequest): Promise<EnterpriseTeamAutonomyGrant>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)

<a id="ctxenterpriseteamdecisioncontroller--enterpriseteamdecisioncontroller"></a>

### `ctx.enterpriseTeamDecisionController` — `EnterpriseTeamDecisionController`

Enterprise TeamDecision query and human-response Remote service.

```ts cordis-catalog
/**
 * List visible runtime-emitted decisions.
 * @param request - visible decision filters.
 * @returns visible decision page.
 */
@Remote('list') async list(request: EnterpriseTeamDecisionListRequest): Promise<EnterpriseTeamDecisionPage>

/**
 * Append and project a permitted human answer.
 * @param request - answer, CAS, and idempotency fields.
 * @returns answered decision projection.
 */
@Remote('respond') async respond(request: EnterpriseTeamDecisionRespondRequest): Promise<EnterpriseTeamDecision>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)

<a id="ctxenterpriseteamruncontroller--enterpriseteamruncontroller"></a>

### `ctx.enterpriseTeamRunController` — `EnterpriseTeamRunController`

Enterprise TeamRun query and command Remote service.

```ts cordis-catalog
/**
 * List visible TeamRun projections.
 * @param request - visible run page filters.
 * @returns visible TeamRun page.
 */
@Remote('list') async list(request: EnterpriseTeamRunListRequest): Promise<EnterpriseTeamRunPage>

/**
 * Read one visible TeamRun projection.
 * @param request - TeamRun identity.
 * @returns visible TeamRun projection.
 */
@Remote('get') async get(request: EnterpriseTeamRunLookup): Promise<EnterpriseTeamRun>

/**
 * Start a runtime-authoritative TeamRun.
 * @param request - browser-safe definition fence, Workspace, prompt, source, and idempotency.
 * @returns started or reconcilable TeamRun.
 */
@Remote('start') async start(request: EnterpriseTeamRunStartRequest): Promise<EnterpriseTeamRun>

/**
 * Cancel a runtime-authoritative TeamRun.
 * @param request - TeamRun CAS and idempotency fields.
 * @returns cancelled or reconcilable TeamRun.
 */
@Remote('cancel') async cancel(request: EnterpriseTeamRunCancelRequest): Promise<EnterpriseTeamRun>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)
<!-- END GENERATED cordis-surface -->
