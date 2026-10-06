# 核心

[English](core.md) | 中文

**核心**子系统即 [`packages/core`](../../packages/core/README.zh.md)，包含每个组合都会启动的包：事件溯源的会话日志、系统提示词组装、工具注册表、agent（智能体）类型，以及驱动它们的具体循环。本页说明 `agent`/`agent-loop` 这对包所声明的内容：agent 如何被创建与拥有，以及 `Agent` 句柄的投递、取消与拦截约定；本页还说明每个子系统都遵循的两个类型模式。该组的专属页面与目录其余部分见[子系统 README](README.zh.md)。

## 主干逐包速览

一个轮次按同一条循环流经六个包：[`agent-loop`](../../packages/core/agent-loop) 中的 driver 认领一条排队的提示词，在[会话日志](session.zh.md)（`ctx.sessions`）上开启轮次，通过 [system-prompt](system-prompt.zh.md)（`ctx.systemPrompt`）组装请求前缀并从日志派生历史，经 [LLM（大语言模型） seam](llm-streaming.zh.md) 流式获取模型响应，经[工具注册表](tools.zh.md)（`ctx.tools`）分发工具调用，并把每个模型可见的事实追加回日志，供下一步派生。循环搬运的对话词汇——`Message`、`ContentBlock`、`StreamChunk`、模型请求——由 [`packages/llm`](../../packages/llm/README.zh.md) 声明，记录在 [llm-streaming.md](llm-streaming.zh.md)。

| 包 | 负责内容 | 页面 |
|---|---|---|
| `session/` | 仅追加的 `SessionEvent` 日志与内存 store——唯一真源（`ctx.sessions`） | [session.md](session.zh.md) |
| `system-prompt/` | 提示词段落与工具 schema 组装（`ctx.systemPrompt`） | [system-prompt.md](system-prompt.zh.md) |
| `tools/` | 带作用域的工具注册表与受保护的执行流水线（`ctx.tools`） | [tools.md](tools.zh.md) |
| `agent/` | `Agent` 接口、实时注册表、发起者作用域与 `agent/*` 事件词汇（`ctx.agents`） | 本页 |
| `agent-loop/` | 实现公开 `Agent` 约定的具体 driver（`ctx.agentLoop`） | 本页 |
| `scope/` | 注册表与循环用于构建按 agent 作用域的注册原语 | [scope.md](scope.zh.md) |

`scope/` 是这里唯一的非服务包：一个零依赖库（`createScope`/`scopeOf`/`scopeTarget`），在模块图中位于 `session/` 与 `system-prompt/` 之下，正是为了让它们消费它而不形成环。`agent-loop` 是公开 `Agent` 约定的唯一具体实现，放在这里因为它是 harness 的默认产品循环；它在 `ctx.agents.withInitiator()` 内运行每个 driver。扩展插件依赖 `agent`——包括需要发起 Agent 时——而绝不直接依赖 `agent-loop`，因此循环保持可替换。[`dsh-base`](../../packages/bundle/base/README.zh.md) 是默认产品组合，[`dsh-sdk-minimal`](../../packages/bundle/sdk-minimal/README.zh.md) 则声明一棵更小的独立配置树。

<a id="creation-and-ownership"></a>

## 创建与所有权

消费方通过 `ctx.agents` 创建 agent——`create()` 在一个调用方提供的 `SessionId` 下构建全新会话与 agent，`resume()` 先加载持久会话——或者通过循环的声明式配置条目创建。编程式创建返回归属所有者的句柄：

源码：[`packages/core/agent/src/index.ts`](../../packages/core/agent/src/index.ts)

```ts type-equiv
/**
 * An owned agent plus its disposer, returned by {@link AgentRegistry.create} /
 * {@link AgentRegistry.resume}. The disposer is a CAPABILITY: among consumers,
 * only the holder can tear this agent down. The registered factory provider is
 * also a structural owner because the scoped agent depends on that provider's
 * service API; provider unload stops and drains every live handle it made.
 * `dispose()` stops the loop, awaits its exit, unregisters the agent, removes
 * its session from the store, and finally unwinds its scoped world.
 *
 * `ctx.agents.get(id)` still returns a bare {@link Agent} — the handle is
 * exposed only to the consumer owner that created it; the structural provider
 * reaches the same teardown internally. Config-created agents (the loop's own
 * startup) are owned by the loop fiber and never need a handle.
 */
interface AgentHandle {
  agent: Agent
  dispose(): Promise<void>
}
```

`CreateAgentOptions` 携带共享标识以及新 agent 发布前所需的一切：可选的存活 `parentAgent`、会话元数据（`meta`——已校验的 `cwd`、fork 谱系、`isSeeded` 标记、来源分类、委派深度与 `agentPreset`）、同级字段 `inheritedEventCount` 所表示的精确 fork cut、可选的 `seed` 回放前缀、按 agent 的 `AgentOptions`、仅创建期有效的取消 `signal`，以及 `setup`。`ResumeAgentOptions` 是持久标识的对应项：`resumeSessionId`、`parentAgent`、`agentOptions`、`signal` 与 `setup`。`setup` 回调（`AgentSetup`）在两个 id 均未发布时接收 `(agentCtx, agent)`：上下文拥有作用域注册，显式 Agent 提供确切的子 Session，Context 无需反向属性。凡经 `agentCtx` 注册的内容都先于 `agent/created` 与第一次提示词组装存在。Setup 可以返回在发布前一刻调用的同步 commit；setup 拒绝、commit 抛出或所有者 dispose（资源释放）都会回滚事务，两个 id 均不发布。

`AgentFactory` 是注册表背后的创建接口：循环经 `ctx.agents.setFactory()` 注册其工厂，因此消费方使用 `ctx.agents` 时无需依赖具体循环包。运行时子 Agent 的创建方设置 `options.parentAgent`；注册表把 options 与调用方 Context 传给工厂，不从其中一项推导另一项。确切的 `create`/`resume` 签名及回滚约定见下方[生成区块](#ctxagents--agentregistry)。

<a id="the-agent-handle"></a>

## Agent 句柄

`Agent` 是每个插件（UI、钩子、orchestrator）面向编程的 surface；`ctx.agents.get(id)` 返回它，[发起者作用域](#initiating-agent)携带它。具体实现为 dsh-agent-loop 包内部细节；循环外没有任何组件依赖它。统一的 `send` 方法直接暴露 target 与 wakeup 路由；`followup`、`steer` 与 `inject` 是固定预设的别名方法。

源码：[`packages/core/agent/src/types.ts`](../../packages/core/agent/src/types.ts)

```ts type-equiv
/** Public live-agent handle; the runtime face augments its live capabilities. */
interface Agent {
  /** Session-backed Agent identity. */
  readonly id: SessionId
  /** The provider route and model this agent's requests use. */
  readonly options: AgentOptions
  /** The live session this agent drives; its log is the durable source of truth. */
  readonly session: Session
  /** Agent-owned access to durable pending work. */
  readonly inbox: Inbox
  /** The current lifecycle state, mirrored on every `agent/status` transition. */
  readonly status: AgentStatus
  /** Agent-scoped context; its contributions are agent-local, unwind on disposal, and reject registration afterward. */
  readonly ctx: Context

  /**
   * Clear queued and steering work — unless `keepInbox` — and abort the active
   * turn or between-turn task. The first cause wins for that activity. With no
   * active activity, cancellation is a no-op and does not arm later work.
   * @param cause - the stable caller intent carried by the active operation signal.
   * @param options - cancellation options; `keepInbox` preserves pending work.
   */
  cancel(cause: AgentCancelCause, options?: CancelOptions): void

  /**
   * Resolve after the current whole-agent activity reaches quiescence. This
   * follows replacement work started before the observed driver retires,
   * but does not identify the settlement of any particular message.
   * @returns fulfillment after no active driver or maintenance task remains.
   */
  whenIdle(): Promise<void>

  /**
   * Run one non-turn maintenance task from the true idle phase. The task starts
   * synchronously after claiming that phase; later waking input remains in the
   * inbox until the task settles, while public status stays `idle`.
   * `whenIdle()` follows both the task and any waking work released behind it.
   * @param task - operation whose fulfillment or rejection is preserved, with a signal aborted by {@link cancel}.
   * @throws synchronously when turn-driving or another maintenance task already owns the agent.
   * @returns the task promise.
   */
  runMaintenance<T>(task: (signal: AbortSignal) => Promise<T>): Promise<T>

  /**
   * Route identified input to an inbox boundary and optionally wake the driver.
   * Waking input submitted after active cancellation is queued for the next
   * turn and runs when the aborted activity converges to idle; a `disposed`
   * cancel leaves it parked. A wake submitted while already idle always opens
   * its turn boundary, even when its message is cleared before the driver
   * claims ([driver wake convergence](../../agent-loop/src/agent.ts)).
   * @param message - identified content and the source that supplied it.
   * @param target - the preferred next-turn or next-step inbox boundary.
   * @param wakeup - whether delivery may wake the driver.
   */
  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void

  /**
   * Queue an ordinary follow-up turn and wake the driver. The item becomes the
   * sole ordinary message of its own turn.
   * @param message - identified prompt content and the source that supplied it.
   */
  followup(message: UserMessage): void

  /**
   * Submit steering for the nearest step. An idle driver starts a turn;
   * a running driver consumes it at its next step boundary.
   * A rejected step leaves steering parked in the inbox until the next
   * wake; cancellation or disposal may discard pending steering.
   * @param message - identified steering content and the source that supplied it.
   */
  steer(message: UserMessage): void

  /**
   * Queue model-facing context for the next pre-step without waking the
   * driver. A running driver claims it at the nearest later step boundary;
   * idle drivers leave it pending until follow-up or steering
   * wakes them. It may miss a request whose pre-step already claimed its
   * batch. Cancellation or disposal may discard pending context.
   * @param message - identified injected context and the source that supplied it.
   */
  inject(message: UserMessage): void
}
```

```ts type-equiv
/**
 * An agent's lifecycle state, emitted on every transition as `agent/status`:
 * `idle` means no driver is active; `running` begins when waking input starts
 * cancellable pre-step processing and lasts while the driver drains,
 * closes, or checkpoints turns. Disposal removes the agent from its registry;
 * it is not a third observable status.
 */
type AgentStatus = 'idle' | 'running'
```

```ts type-equiv
/** One process-local live assistant streaming publication. */
type AssistantStreamFrame =
  | {
    readonly type: 'start'
    readonly attemptId: LlmAttemptId
    /** Monotone within one attached Agent lifecycle; replacement restarts at 1. */
    readonly revision: number
    readonly turn: number
    readonly step: number
  }
  | {
    readonly type: 'chunk'
    readonly attemptId: LlmAttemptId
    readonly revision: number
    /** Dense zero-based position within the attempt. */
    readonly index: number
    /** Safe-integer timestamp reused by the durable embedded stream. */
    readonly time: number
    readonly chunk: StreamChunk
  }
  | {
    readonly type: 'end'
    readonly attemptId: LlmAttemptId
    readonly revision: number
    /** Number of chunk frames emitted by this attempt. */
    readonly index: number
    /** Durable settlement committed before this notification, or live abandonment without one. */
    readonly outcome:
      | {
        readonly kind: 'committed'
        readonly eventType: 'assistant/message' | 'assistant/attempt'
        readonly seq: SessionSeq
      }
      | { readonly kind: 'abandoned' }
  }
```

`running` 描述整个驱动器的排空区间，可能跨越连续的排队轮次；它不能证明某个轮次仍然打开。dispose 会把 agent 从注册表移除并发出 `agent/disposed`；它不是一个终态 status 值。`followup()` 不返回句柄：其 `MessageId` 标识的是持久的 inbox 插入、认领与丢弃事实，而非之后的助手输出或轮次结束。`whenIdle()` 观察的是整个 agent，因此只有当调用方明确拥有从回执到空闲的这段区间时，才能把它称为一次 run（[决策](../../.agents/notes/implemented/architecture/2026-07-30-followup-enqueue-and-owned-runs.zh.md)）。

```ts type-equiv
/** Merge-extensible agent creation options. Persona belongs to system-prompt sections. */
interface AgentOptions {
  /** Provider route (must have a registered adapter at call time). */
  provider?: string
  /** Model id interpreted by the selected provider adapter. */
  model?: string
  /** Adapter-owned reasoning effort for the selected provider/model route. */
  reasoningEffort?: ReasoningEffortId
  /** Maximum output tokens for each conversation-model request. */
  maxTokens?: number
}
```

在 `agent/request` 之后，分发要求 `provider` 与 `model` 都存在。显式 `reasoningEffort` 会为该路由的首次请求提供初始值；确切模型解析会校验该值，省略时则允许填入适配器默认值。提供 `maxTokens` 时，它必须是正安全整数，并限制每次对话模型请求的输出；省略时，系统会在写入请求 header 前填入确切模型的适配器默认值，否则提供方行为保持不变。agent 作用域的 `deployment:persona-prefix` 提示词段落可以遮蔽全局默认 persona。

inbox 即投递词汇——agent 以持久投影形式拥有的两条有序待处理消息列表：

```ts type-equiv
/** Agent-owned access to pending work; concrete storage belongs to the driver. */
interface Inbox {
  /** Prompts awaiting individual turns. */
  readonly nextTurn: readonly UserMessage[]
  /** Input awaiting the next step boundary. */
  readonly nextStep: readonly UserMessage[]

  /** Durably cancel all pending input, clearing next-step before next-turn. */
  clear(): void

  /**
   * Append one message to a pending list.
   * @param target - pending list to extend.
   * @param message - message to append.
   */
  append(target: InboxTarget, message: UserMessage): void

  /**
   * Prepend one message to a pending list.
   * @param target - pending list to extend.
   * @param message - message to prepend.
   */
  prepend(target: InboxTarget, message: UserMessage): void

  /**
   * Replace one pending message in place.
   * @param messageId - identity of the pending message to replace.
   * @param newMessage - replacement message.
   * @returns whether the message was still pending.
   */
  replace(messageId: MessageId, newMessage: UserMessage): boolean

  /**
   * Remove one pending message.
   * @param messageId - identity of the pending message to remove.
   * @returns whether the message was still pending.
   */
  remove(messageId: MessageId): boolean

  /**
   * Apply standard splice semantics and durably record the normalized result.
   * @param target - pending list to mutate.
   * @param start - splice position.
   * @param deleteCount - maximum number of messages to remove.
   * @param inserted - messages to insert at the resolved position.
   * @returns messages removed by the splice.
   */
  splice(
    target: InboxTarget,
    start: number,
    deleteCount: number,
    inserted: UserMessage[],
  ): UserMessage[]
}
```

```ts type-equiv
/** One of the two ordered pending-message lists owned by an agent. */
type InboxTarget = 'next-turn' | 'next-step'
```

每个待处理入队项就是其 `UserMessage`；`MessageId` 是唯一标识。结构化 `Inbox` 方法会记录规范化的持久 `agent/inbox/spliced` 变更，并拒绝重复的待处理 id。`replace(messageId, newMessage)` 与 `remove(messageId)` 通过 `MessageId` 跨两份列表定位待处理消息；替换可以改变标识，并先将旧消息作为 discarded 发布，再将新消息作为 inserted 发布。普通删除和 `clear()` 都表示取消。在步骤边界，dsh-agent-loop 包内部的 `ReactLoopInbox` 会通过纯删除 splice 移除拟进入步骤的批次——全部 `next-step` 输入，外加轮次边界上的一条 `next-turn` 消息——且不发出 discarded 通知，随后逐条发出 claimed 通知。仅供循环使用的待处理检测与领取操作不属于 `Agent.inbox`。`AgentLoop` 服务在发布工厂之前注册标准 `inbox` 投影；其 cell 是唯一 live 状态，同一份折叠在没有 Agent 时也服务于冷消费方。该 fold 会拒绝不安全或越界的 splice 坐标，以及跨两份列表重复的标识，并通过事件 seq 指出格式错误的持久历史。跟踪单条消息的消费方使用精确的 `agent/inbox/inserted`、`claimed` 与 `discarded` 通知。

取消：

```ts type-equiv
/** Options for {@link Agent.cancel}. */
interface CancelOptions {
  /**
   * Preserve queued and steering inbox items instead of discarding them. The
   * active turn is still aborted, but un-started and pending work survives for a
   * later turn and no canceled inbox splice is logged.
   */
  keepInbox?: boolean | undefined
}
```

```ts type-equiv
/** Why an active agent driver was cancelled. */
type AgentCancelCause =
  | { readonly kind: 'user' }
  | { readonly kind: 'parent' }
  | { readonly kind: 'hook'; readonly reason: string }
  | { readonly kind: 'disposed' }
```

cause 是由 TypeScript 强制约束的同进程输入。活跃的取消持有者把同一个对象暴露为仅运行时的 `AbortSignal.reason`；signal 不授予协作监听器任何分类权限。持久 `turn/end` 以 `{ kind: 'aborted', reason: TurnEndCancelCause }` 记录结果，取消原因随终态结果一起持久化。

[事件分类](../architecture.zh.md#events)负责 `agent/*` 生命周期、检查点与 waterfall（瀑布式事件）约定。轮次和步骤边界是持久会话事件，而不是 agent emit。

<a id="initiating-agent"></a>

## 发起 Agent

`ctx.agents` 携带的进程本地 initiator 就是上面的确切 `Agent`，不是单独的 frame 或复制的标识。环境中存在该值既不能证明存活，也不代表授权；[initiator 作用域决策](../../.agents/notes/implemented/architecture/2026-07-15-agent-initiator-scope.zh.md)定义其生命周期和作用域规则。

<a id="interception-decisions"></a>

## 拦截决策

pre-step 决策使用与持久 user-role 输入相同、带标识的 `UserMessage` 类型。进入步骤的批次具有权威性，并保留每条消息的 `id` 和 `source`。钩子桥接层把其原生决策字段映射到这一类型化结果上。

源码：[`packages/core/agent/src/types.ts`](../../packages/core/agent/src/types.ts)

`agent/pre-step` 接收一个 payload，携带独占的已领取批次（`messages`）、拟进入步骤的坐标（`turn`、`step`）与当前轮次的取消 `signal`。首次提案在已打开的轮次内、任何步骤开始前运行；工具 continuation 可以在步骤之间提交空的已领取批次：

它返回 `PreStepDecision`。reject 不会打开步骤。enter 提供在 `step/start` 后追加的完整消息批次；最终决策省略的已领取消息保持已删除，而领取后插入的输入仍留待后续处理：

```ts type-equiv
/** Whether and with which messages the loop enters a proposed step. */
type PreStepDecision =
  | { kind: 'reject' }
  | {
    kind: 'enter'
    messages: UserMessage[]
    /** Start a distinct model-message series before this step's admitted messages. */
    startsRequestSeries?: true
  }
```

`agent/request-error` 在失败的模型步骤关闭之后、其轮次关闭之前运行。listener 可以在失败轮次的 signal 仍然存活时修复持久状态或 await 策略工作。处理该错误的 listener 返回 `{ kind: 'retry' }` 且不调用 `next()`；默认的 `undefined` 会让失败保持终态。

```ts type-equiv
/** Action returned by a listener that owns model-request recovery. */
type RequestErrorAction = { kind: 'retry' } | undefined
```

`agent/pre-step` 是请求推导前唯一的 waterfall（瀑布式）监听器链。`agent/turn-stopping` 在轮次没有工具或 steering（中途引导）后续时运行，先于最后一次 steering 排空。

`agent/created` 携带 `SessionStartSource`（会话生命周期为何开始；桥接层据此匹配其 SessionStart）：

```ts type-equiv
/** Why a session lifecycle began; seeded creates are `startup`, while persisted loads are `resume`. */
type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact'
```

## 会话

`Session` 是一份类型化 `SessionEvent` 的**仅追加日志**——唯一的真源。LLM 消息历史从日志*派生*（`deriveMessages()`），而非单独存储。每个条目携带单调的 `seq`、`time` 与按 `type` 判别的 `data` payload；surface 变体还可以在 `sourceEventSeqs` 中列出被引用的较早事件，并携带 `surfaceOp`。

`SessionEvent` 信封的确切条件字段、十三种核心事件变体（`turn/start`、`turn/end`、`step/start`、`step/end`、`user/message`、`system/message`、`assistant/message`、`assistant/attempt`、`tool/call`、`tool/result`、`request/header`、`request/context`、`session/end-seed`）、`deriveMessages()` 投影规则、`TurnEndReason` 原因以及执行封闭和独立事件规则都在 **[session.md](session.zh.md)** 中。日志如何持久化——`SessionPersistence` 接口、JSONL provider、`session/flush` 检查点、崩溃恢复与 `SessionHeader`——则在 **[persistence.md](persistence.zh.md)** 中。

## 企业员工绑定

`WorkspaceEmployeeDefaultRequest` 指定工作区；`WorkspaceEmployeeDefaultSaveRequest` 增加可空员工 ID 与预期修订号。`WorkspaceEmployeeDefaultView` 返回调用方可见的选择、修订号、可用状态与管理权限。`EnterpriseEmployeeSessionRequest` 指定空白 Session 与员工，`EnterpriseEmployeeSessionValue` 记录选中的不可变发布版本。[企业控制器](../../packages/api/enterprise-controller/README.zh.md)拥有授权、工作模式组合与回放语义。

## `ToolDefinition`

唯一属于核心的流水线编写类型：每个已注册工具*是什么*——一个面向模型的 `ToolSchema` 加上一个 `execute` 函数，以及可选的最终内容回调与 UI 回调。工具作者很少手动构造它（`defineTool` DSL 会使用类型化参数构建），但它是注册表存储并由循环用于分发的约定。

其完整字段、`defineTool`/`ValueSchemaSpec`/`ParameterSchemaSpec` 类型化 schema DSL、`ToolExecution`/`ToolExecutionResult` waterfall 类型，以及工具展示 UI 类型都在 **[tools.md](tools.zh.md)** 中。

## 全仓通用类型模式

两个模式在每个子系统中反复出现，只在此处记录一次。

<a id="the-map--derived-union-pattern"></a>

### `…Map → derived-union` 模式

harness 中几乎所有可扩展的和类型都遵循同一模式：一个以判别标签为键的接口（`…Map`），联合类型由 `keyof` 派生。插件通过**声明合并**添加变体——无需修改拥有该类型的包。

```ts ignore-check
// The pattern, schematically:
interface ThingMap {
  'a': { kind: 'a'; /* … */ }
  'b': { kind: 'b'; /* … */ }
}
type ThingKind = keyof ThingMap          // 'a' | 'b'
type Thing = ThingMap[keyof ThingMap]    // the discriminated union

// A plugin extends it without touching the source package:
declare module '@deepseek-ai/dsh-llm' {
  interface ThingMap {
    'c': { kind: 'c'; /* … */ }
  }
}
```

五个规范 map 使用此模式；插件作者扩展它们：

| Map | 包 | 派生 | 目录 |
|---|---|---|---|
| `ContentBlockMap` | dsh-llm | `ContentBlock` | [llm-streaming.md](llm-streaming.zh.md#content-blocks-and-messages) |
| `MessageSourceMap` | dsh-llm | `MessageSource` | [llm-streaming.md](llm-streaming.zh.md#content-blocks-and-messages) |
| `FinishReasonMap` | dsh-llm | `FinishReason` | [llm-streaming.md](llm-streaming.zh.md#the-model-request-and-result) |
| `TurnEndReasonMap` | dsh-session | `TurnEndReason` | [session.md](session.zh.md) |
| `SessionEventMap` | dsh-session | `SessionEvent` | [session.md](session.zh.md) |

消费方最常 `switch` 的两个大型判别联合类型是：**`StreamChunk`**（流式协议）和 **`SessionEvent`**（日志条目）。按仓库约定，对标签做 `switch`——不要链式 `if`——这样每个分支都能窄化类型，拼错的标签会编译失败。

<a id="branded-ids"></a>

### 品牌化 ID

在包之间传递的 ID 都经过**品牌化**——结构上是字符串，但在类型层面不可互换（不能把 `SessionId` 传给需要 `ToolCallId` 的位置）。构造使用共享 `brandString<T>()` helper 或所属方自定义的校验工厂；比较、日志记录和 JSON 行为与普通字符串相同。

`Branded<B>` 原语与无状态构造函数位于 [dsh-brand](../../packages/util/brand)，该包不依赖 harness 能力。`brandString<T>()` 应用仅编译期存在的字符串品牌。

源码：[`packages/util/brand/src/index.ts`](../../packages/util/brand/src/index.ts)

```ts type-equiv
/** A string carrying a compile-time-only brand `B`. */
type Branded<B extends string> = string & { readonly [BRAND]: B }
```

两个核心 ID 是 `ToolCallId`（关联工具调用及其结果；dsh-llm）和 `SessionId`（活跃 agent 与持久会话共享的标识；dsh-session）。能力包也会品牌化各自的 id，例如 [jobs.md](jobs.zh.md) 中的 `JobId`。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentdefaultmodel--agentdefaultmodelconfig"></a>

### `ctx.agentDefaultModel` — `AgentDefaultModelConfig`

Owns the default model selection independently of any Host or transport. Each operation reads the owning Config references.

```ts cordis-catalog
/**
 * Read the current default model selection.
 * @returns a detached provider, model, and optional reasoning selection.
 */
currentSelection(): ModelSelection

/**
 * Save the complete default model selection. A deployment without a configuration
 * editor keeps its composition entry. Saves commit in submission order; a failed
 * save rejects its caller without blocking later saves.
 * @param next - resolved selection accepted by an entry point.
 * @returns fulfillment after the optional profile write settles.
 */
async saveSelection(next: ModelSelection): Promise<void>
```

Source: [`packages/core/agent-default-model/src/index.ts`](../../packages/core/agent-default-model/src/index.ts)

<a id="ctxagentloop--agentloop"></a>

### `ctx.agentLoop` — `AgentLoop`

Concrete agent factory and driver service.

```ts cordis-catalog
/**
 * Create an agent and session under one caller-supplied identity, owned by
 * the accessing fiber. Constructor-driven config calls mint a fresh combined
 * id before entering this boundary. When a persistence backend is mounted,
 * the session's durable identity and any seed are stored before publication.
 * @param id - shared agent/session identity.
 * @param options - concrete loop options.
 * @param meta - optional fresh-session workspace metadata.
 * @returns the published running agent.
 */
async create(id: SessionId, options: AgentOptions = {}, meta: Pick<SessionHeader, 'cwd'> = {}): Promise<Agent>

/**
 * Create an owned agent on a caller-supplied session id.
 * @param ownerCtx - caller context that structurally owns the lifecycle.
 * @param options - identities, optional live parent, session seed/metadata, loop options, setup, and cancellation.
 * @returns the published handle.
 */
async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle>

/**
 * Resume an owned agent from the configured persistence service.
 * @param ownerCtx - caller context that owns load, setup, and the live lifecycle.
 * @param options - persisted identity, optional live parent, loop options, setup, and cancellation.
 * @returns the published handle.
 */
async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle>
```

Types: [SessionHeader](persistence.zh.md)

Source: [`packages/core/agent-loop/src/index.ts`](../../packages/core/agent-loop/src/index.ts)

<a id="ctxagentpresets--agentpresetregistry"></a>

### `ctx.agentPresets` — `AgentPresetRegistry`

Registry of YAML-declared presets and the revisions live Agents retain.

```ts cordis-catalog
/** Gate request-visible presets while allowing a deployment to preserve internal Session replay.
 * @param policy - Returns whether the current caller may use or inspect one preset.
 * @returns Disposer that restores the unscoped roster when this deployment unloads.
 */
registerAccessPolicy(policy: (id: string) => Promise<boolean>): () => void

/** Register and eagerly load a definition; activation failure remains visible in the roster.
 * @param definition Parsed configuration supplied by the declaring plugin.
 * @returns Definition disposer after activation or its diagnostic settles; the declaring plugin owns it.
 */
async register(definition: PresetDefinition): Promise<() => Promise<void>>

/** Inspect retained revisions, or the exact revision an Agent joined.
 * @param ctx - optional Agent context; omission includes all retained revisions.
 * @returns detached module references and isolation diagnostics; no match returns an empty list.
 */
inspectCompositions(ctx?: Context): AgentPresetInspection[]

/** Read every declared preset, including activation failures.
 * @returns Display metadata and loading diagnostics.
 */
async list(): Promise<AgentPreset[]>

/** Read the selection roster.
 * @returns Current presets, each marked when it is the default.
 */
@Remote('list') async remoteExportList(): Promise<AgentPresetRoster>

/** Resolve an identity without starting an Agent.
 * @param id Explicit preset or the current default.
 * @returns Current metadata, including failure when activation failed.
 */
async resolve(id?: string): Promise<AgentPreset>

/** Read one declaration's child plugin list as YAML, for viewing only.
 * @param agentPreset Preset identity.
 * @returns The declared composition beside its published metadata.
 */
@Remote('read') async readDocument(agentPreset: string): Promise<AgentPresetDocument>

/** Bind an unpublished Agent to the current preset revision.
 * @param ctx Agent context from its setup callback.
 * @param id Requested preset, or the default.
 * @returns Bound preset identity.
 */
async mount(ctx: Context, id?: string): Promise<AgentPreset>

/** Join a child to the exact revision retained by its parent.
 * @param ctx Child Agent context.
 * @param parent Parent Agent context.
 * @returns Inherited preset id, or undefined in a preset-free composition.
 */
composeFrom(ctx: Context, parent: Context): string | undefined

/** Read the preset a live Agent uses.
 * @param ctx Agent context.
 * @returns Its preset id, if bound.
 */
composedPreset(ctx: Context): string | undefined

/** Read a service supplied inside an Agent's isolated preset group.
 * @param agent Agent whose composition is queried.
 * @param name Cordis service name.
 * @returns The service, or undefined.
 */
serviceFor<K extends string & keyof Context>(agent: { ctx: Context }, name: K): Context[K] | undefined

/** Immutable employee release mounted in this Agent's retained preset generation, if any.
 * @param ctx - Scoped Agent context.
 * @returns the mounted release identity and version, or undefined for a work mode.
 */
employeeReleaseFor(ctx: Context): { readonly releaseId: string; readonly releaseVersion: number } | undefined

/** Rebind a blank Agent; the caller owns the blank-session check.
 * @param ctx Agent context.
 * @param id Requested preset.
 * @returns The bound identity.
 */
async recompose(ctx: Context, id: string): Promise<AgentPreset>

/** Select a preset before a session starts its first turn.
 * @param agent Target Agent.
 * @param agentPreset Requested identity.
 * @returns Committed preset identity.
 */
@Remote('select') async select(agent: Agent, agentPreset: string): Promise<string>

/** Read current registrations for cold transcript presentation.
 * @param id Preset identity or the default.
 * @returns A revision lease; dispose it after the scoped read completes.
 */
async acquireScope(id?: string): Promise<{ key: ScopeKey } & AsyncDisposable>

/** Read plugin rows without creating an Agent.
 * @returns Current declaration metadata and activation states.
 */
compositionInventory(): Promise<AgentPresetComposition[]>
```

Types: [ScopeKey](scope.zh.md)

Source: [`packages/preset/agent-preset-registry/src/index.ts`](../../packages/preset/agent-preset-registry/src/index.ts)

<a id="ctxagents--agentregistry"></a>

### `ctx.agents` — `AgentRegistry`

Agent service (`ctx.agents`): tracks live agents and carries the initiating Agent through one process-local asynchronous driver chain. Agent *creation* is provided by whichever plugin implements the AgentFactory (`@deepseek-ai/dsh-agent-loop`), registered via setFactory.

Initiator methods provide same-process causal attribution only. Ambient presence is neither liveness proof nor authorization; subjects and owners remain explicit, as does identity at worker, process, persistence, and wire boundaries. Returned Promise boundaries drain during teardown, except a nested lineage that starts an owning-fiber unload is excluded from its own drain.

```ts cordis-catalog
/**
 * Read the Agent that initiated the inherited asynchronous driver chain.
 * Use this optional form for logging, tracing, metrics, or host attribution
 * that also supports agentless calls. When a parent creates a child, setup
 * reports the causal parent while the setup callback's Agent parameter
 * identifies the child.
 * @returns the inherited Agent, or `undefined` outside an initiator boundary
 *   and inside an explicit clearing boundary.
 * @throws when this service instance has been disposed.
 */
currentInitiator(): Agent | undefined

/**
 * Read the initiating Agent and fail when no initiator boundary is active.
 * Use this for private helpers contractually below a driver, or for a
 * deployment-owned outbound request whose contract forbids agentless calls.
 * Generic or direct-call paths use optional lookup or explicit request fields.
 * @returns the inherited Agent.
 * @throws when no initiator is active or this service instance has been disposed.
 */
requireInitiator(): Agent

/**
 * Run an operation with one exact Agent as its process-local initiator. The
 * exact synchronous value or Promise returned by the operation is preserved.
 * Custom drivers and test harnesses wrap their complete returned foreground
 * lifetime.
 * A queue or wire receiver may establish this boundary only after validating
 * explicit identity and resolving the exact live Agent; this method does neither.
 * Detached work remains owned by the subsystem that starts it.
 * @param agent - initiating Agent to inherit; presence is neither liveness proof nor authorization.
 * @param operation - synchronous or asynchronous operation to invoke.
 * @returns the exact value returned by `operation`.
 * @throws when the initiator scope is closing/disposed, or when `operation` throws.
 */
withInitiator<T>(agent: Agent, operation: () => T): T

/**
 * Run an operation inside a boundary that hides any inherited initiating
 * Agent. The exact synchronous value or Promise is preserved.
 * Use this while creating lazy shared timers, queue pumps, pool maintenance,
 * watchers, or exporters so they do not inherit the first Agent that happens
 * to initialize them. It clears only initiator attribution, not explicit
 * fields, and does not own or drain detached resources.
 * @param operation - synchronous or asynchronous operation to invoke without an initiator.
 * @returns the exact value returned by `operation`.
 * @throws when the initiator scope is closing/disposed, or when `operation` throws.
 */
withoutInitiator<T>(operation: () => T): T

/**
 * Register the agent-creation factory (the loop calls this on construction,
 * effect-scoped). A traced Cordis service is canonicalized to its concrete
 * target; each create/resume call is then traced through that caller's
 * context so ownership follows the caller without stacking proxy layers.
 * Throws if a factory is already registered. Returns the disposer; on
 * dispose the factory slot is cleared.
 * @param factory - the loop-owned factory {@link create}/{@link resume} delegate to.
 * @returns the disposer that clears the factory slot. The exact
 *   Cordis effect disposer (single-shot): composite (generator) effects may
 *   yield it directly — exact identity nests the teardown in order.
 */
setFactory(factory: AgentFactory): () => void

/**
 * Create and publish a new agent through the registered factory.
 * Distinct from {@link register} (which records an already-constructed
 * agent): this constructs the agent and its session. Rejects if no factory is
 * registered or creation/setup fails. The resolved {@link AgentHandle} lets
 * the owner tear down exactly this agent.
 * @param options - shared identity, optional live parent, session seed/metadata, and agent options.
 * @returns the handle after setup, rollback-covered publication, and loop start complete.
 */
async create(options: CreateAgentOptions): Promise<AgentHandle>

/**
 * Load a persisted session and resume an agent on it through the registered
 * factory. Rejects if no factory is registered; the factory rejects if
 * session persistence is not configured or persistence/setup fails.
 * @param options - persisted identity, optional live parent, configuration, and setup.
 * @returns the handle after setup, rollback-covered publication, and loop start complete.
 */
async resume(options: ResumeAgentOptions): Promise<AgentHandle>

/**
 * Register a live agent with source `startup`. Rejects if the id is already registered or a
 * serial `agent/created` listener fails. Emits `agent/disposed`
 * when the calling fiber is disposed — both with the agent's scope carrier
 * (`scopeTarget(agent, agent)`): the subject is the agent in hand, so the
 * emits are scope-filtered regardless of which context invoked `register`
 * (calling through `agent.ctx` scopes EFFECTS; dispatch scoping always
 * requires passing the carrier). The entry is a runtime root; factory-backed
 * creation uses `options.parentAgent` for child ownership. Await the registration before using the agent.
 * @param agent - the already-constructed agent to record in the store.
 * @returns the awaitable Cordis effect disposer (single-shot; a repeat call
 *   returns undefined without awaiting an in-flight teardown). Exact
 *   identity is load-bearing: a composite (generator) effect that owns a
 *   teardown ORDER — the agent factory's lifecycle chain — must yield THIS
 *   function so Cordis nests the unregistration at that yield position;
 *   yielding a wrapper would leave it disposing as a concurrent sibling on
 *   owner unload, unregistering the agent (and emitting `agent/disposed`)
 *   while its final turn is still draining.
 */
register(agent: Agent): ReturnType<Context['effect']>

/**
 * Insert an already-constructed agent without announcing it. This is the
 * advanced ordered-lifecycle primitive used by the async agent factory: it
 * first completes setup while the agent is unpublished, then assigns the
 * returned detach closure into its pre-installed composite teardown before
 * calling {@link announce}. Ordinary callers use {@link register}.
 * @param agent - the prepared, unpublished agent.
 * @param owner - explicitly supplied live runtime owner, or
 *   undefined for a top-level runtime root. This is runtime ownership, not
 *   the resumed session's durable parent lineage.
 * @returns an idempotent closure that removes this exact entry and emits
 *   `agent/disposed` with listener failures contained. When called from a
 *   `agent/created` listener, removal and disposal wait until the serial
 *   creation dispatch settles.
 */
enter(agent: Agent, owner: Agent | undefined): () => void

/**
 * Announce an agent previously inserted with {@link enter}.
 * @param agent - the live inserted agent to announce.
 * @param source - fresh creation, resume, clear, or compaction source.
 * @param signal - optional factory initialization cancellation signal passed to listeners.
 * @returns completion of the serial creation listeners; a listener failure rejects.
 * @throws if `agent` is not the exact live registry entry for its id, or its
 *   creation announcement already began (including a reentrant call from a
 *   creation listener).
 */
async announce(agent: Agent, source: SessionStartSource, signal?: AbortSignal): Promise<void>

/**
 * Look up a live agent.
 * @param id - the shared agent/session id to look up.
 * @returns the agent, or undefined when no live agent has that id.
 */
get(id: SessionId): Agent | undefined

/**
 * Test whether a live agent was created through one exact parent agent's
 * scoped context. Runtime ownership is independent of durable session
 * lineage and remains unambiguous when unrelated providers reuse an id.
 * @param id - the candidate child agent's shared agent/session id.
 * @param owner - the expected runtime creator agent.
 * @returns true only while the exact child entry is live under that owner.
 */
isOwnedBy(id: SessionId, owner: Agent): boolean

/**
 * All live agents, in registration order.
 * @returns a fresh array; mutating it does not affect the registry.
 */
list(): Agent[]

/**
 * All live top-level agents in registration order. A top-level agent was
 * created without an owning agent context; durable session lineage does not
 * affect this runtime relation, so a resumed fork may still be a root.
 * @returns a fresh array; mutating it does not affect the registry.
 */
roots(): Agent[]
```

Source: [`packages/core/agent/src/index.ts`](../../packages/core/agent/src/index.ts)

<a id="ctxemployeeaccounts--employeeaccounts"></a>

### `ctx.employeeAccounts` — `EmployeeAccounts`

Enterprise employee account service.

```ts cordis-catalog
/**
 * Create one employee account in the active state with a fresh durable id.
 * @param input - organization, display name, role card, and home workspace.
 * @returns the created account.
 */
create(input: CreateEmployeeAccountInput): EmployeeAccount

/**
 * Read one employee account by id.
 * @param id - employee identifier.
 * @returns the stored account, or undefined when the id is unknown.
 */
get(id: EmployeeId): EmployeeAccount | undefined

/**
 * List one organization's employee accounts in creation order.
 * @param orgId - organization whose accounts are listed.
 * @param options - pass `includeArchived` to also return archived accounts.
 * @returns the matching accounts in creation order.
 */
list(orgId: string, options?: { includeArchived?: boolean }): EmployeeAccount[]

/**
 * Move one employee account to a new lifecycle state; archived is terminal.
 * @param id - employee identifier.
 * @param state - new lifecycle state.
 */
setState(id: EmployeeId, state: EmployeeState): void

/**
 * Bind one actor key to an employee account within one organization,
 * replacing any previous binding for the pair.
 * @param orgId - organization the actor key belongs to.
 * @param actorKey - opaque actor key whose requests stick to one employee.
 * @param id - employee identifier the actor key binds to.
 */
bindSticky(orgId: string, actorKey: string, id: EmployeeId): void

/**
 * Read the employee account an actor key is bound to within one organization.
 * @param orgId - organization the actor key belongs to.
 * @param actorKey - opaque actor key to resolve.
 * @returns the bound employee identifier, or undefined when the key is unbound.
 */
resolveSticky(orgId: string, actorKey: string): EmployeeId | undefined

/**
 * Queue one inbox item for an employee in the queued state with a fresh
 * durable id. The caller owns surface-employee org consistency; the
 * composing surfaces are org-scoped by construction.
 * @param input - employee, surface, origin actor, and message text.
 * @returns the created inbox item.
 */
enqueue(input: EnqueueEmployeeInboxInput): EmployeeInboxItem

/**
 * Take an employee's queued inbox items in creation order and mark them
 * delivered.
 * @param employeeId - employee whose inbox is claimed.
 * @param limit - maximum number of items to take; passed through to the store.
 * @returns the claimed items in creation order.
 */
claim(employeeId: EmployeeId, limit: number): EmployeeInboxItem[]

/**
 * Read the employee account whose home workspace is one path. Matching is exact string
 * equality against the stored column, mirroring the workspace-grant root-path lookup; no
 * path normalization runs on either side.
 * @param homeWorkspacePath - absolute home workspace path to look up.
 * @returns the stored account, or undefined when no account claims that path.
 */
findByHomeWorkspacePath(homeWorkspacePath: string): EmployeeAccount | undefined

/**
 * Resolve the memory actor for one anchored session so compartment work can resolve at
 * process time without a schema change to outbox rows. Dm sessions resolve the full pair;
 * group member sessions resolve their employee and the surface's project; channel topic
 * sessions resolve only the surface's project.
 * @param sessionId - session id attached through `attachSurfaceSession`,
 *   `attachGroupSurfaceSession`, or `attachTopicSession`.
 * @returns the session's memory actor, or undefined when no surface anchors the session.
 */
resolveSessionActor(sessionId: string): SessionMemoryActor | undefined
```

Source: [`packages/enterprise/employee-account/src/types.ts`](../../packages/enterprise/employee-account/src/types.ts)

<a id="ctxenterpriseassetcontroller--enterpriseassetcontroller"></a>

### `ctx.enterpriseAssetController` — `EnterpriseAssetController`

Capability asset Remote service.

```ts cordis-catalog
/**
 * Execute one authenticated enterprise operation.
 * @param request - asset page filters.
 * @returns visible asset page.
 */
@Remote('list') async list(request: EnterpriseAssetListRequest): Promise<EnterpriseAssetPage>

/**
 * Execute one authenticated enterprise operation.
 * @param request - asset identity.
 * @returns current asset row.
 */
@Remote('get') async get(request: EnterpriseAssetLookup): Promise<EnterpriseAsset>

/**
 * Execute one authenticated enterprise operation.
 * @param request - new immutable asset content and CAS revision.
 * @returns created version.
 */
@Remote('saveVersion') async saveVersion(request: EnterpriseAssetSaveRequest): Promise<EnterpriseAssetVersion>

/**
 * Execute one authenticated enterprise operation.
 * @param request - asset identity.
 * @returns immutable version history.
 */
@Remote('listVersions') async listVersions(request: EnterpriseAssetLookup): Promise<readonly EnterpriseAssetVersion[]>

/**
 * Execute one authenticated enterprise operation.
 * @param request - asset identity and CAS revision.
 * @returns archived asset row.
 */
@Remote('archive') async archive(request: EnterpriseAssetArchiveRequest): Promise<EnterpriseAsset>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)

<a id="ctxenterprisechannelbotinstaller--enterprisechannelbotinstaller"></a>

### `ctx.enterpriseChannelBotInstaller` — `EnterpriseChannelBotInstaller`

Host-only seam implemented by approved WeCom, Feishu, or DingTalk provider-app adapters.

```ts cordis-catalog
/**
 * Start the provider authorization flow for one authenticated installation.
 * @param input - signed pending installation state and provider callback details.
 * @returns provider authorization URL and expiry matching the pending installation.
 */
begin(input: PendingChannelBotInstall & { readonly state: string }): Promise<{ readonly authorizationUrl: string readonly expiresAt: number }>

/**
 * Exchange a completed provider authorization for verified Bot metadata.
 * @param input - signed pending installation state and provider authorization code.
 * @returns verified Bot metadata and the credential reference to persist.
 */
complete(input: PendingChannelBotInstall & { readonly state: string readonly code: string }): Promise<EnterpriseInstalledChannelBot>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)

<a id="ctxenterprisechannelcontroller--enterprisechannelcontroller"></a>

### `ctx.enterpriseChannelController` — `EnterpriseChannelController`

Enterprise channel-configuration Remote service.

```ts cordis-catalog
/**
 * List channel configurations visible to the authenticated principal's hierarchy scope.
 * @param request - optional archived-record filter.
 * @returns secret-free channel configuration projections.
 */
@Remote('list') async list(request: EnterpriseChannelListRequest): Promise<EnterpriseChannelPage>

/**
 * Read one organization-scoped channel configuration.
 * @param request - stable channel identity.
 * @returns the secret-free channel configuration projection.
 */
@Remote('get') async get(request: EnterpriseChannelLookup): Promise<EnterpriseChannelConfiguration>

/**
 * Create or revision-fence an administrator-managed channel configuration.
 * @param request - provider account, Credential reference, route, and lifecycle state.
 * @returns the saved secret-free channel configuration projection.
 */
@Remote('save') async save(request: EnterpriseChannelSaveRequest): Promise<EnterpriseChannelConfiguration>

/**
 * Terminally archive one channel configuration.
 * @param request - channel identity, expected revision, and idempotency key.
 * @returns the archived secret-free channel configuration projection.
 */
@Remote('archive') async archive(request: EnterpriseChannelArchiveRequest): Promise<EnterpriseChannelConfiguration>

/**
 * Start installation of a provider-hosted DSH Bot before a channel exists.
 * Self-hosted builds fail visibly until an approved provider app installer is deployed.
 * @param request - provider and redirect URI for the installation session.
 * @returns setup instructions or an expiring provider authorization session.
 */
@Remote('beginBotInstall') async beginBotInstall(request: EnterpriseChannelBeginBotInstallRequest): Promise<EnterpriseChannelBotInstallResult>

/**
 * Poll an official Device Authorization Grant and create the channel after provider confirmation.
 * @param request - installation identity, idempotency key, and optional verification code.
 * @returns pending, verification-required, or completed installation state.
 */
@Remote('pollBotInstall') async pollBotInstall(request: EnterpriseChannelPollBotInstallRequest): Promise<EnterpriseChannelPollBotInstallResult>

/**
 * Complete a signed provider-app installation and create the governed channel automatically.
 * @param request - signed installation callback, authorization code, and idempotency key.
 * @returns the created secret-free channel configuration.
 */
@Remote('completeBotInstall') async completeBotInstall(request: EnterpriseChannelCompleteBotInstallRequest): Promise<EnterpriseChannelConfiguration>

/**
 * Begin a ten-minute process-bound official provider authorization session.
 * @param request - channel identity, exact revision, and registered callback URI.
 * @returns signed secret-free authorization session metadata.
 */
@Remote('beginBinding') async beginBinding(request: EnterpriseChannelBeginBindingRequest): Promise<EnterpriseChannelBindingSession>

/**
 * Consume a pending callback, exchange its code, and persist secret-free identity evidence.
 * @param request - provider callback values and write idempotency key.
 * @returns the verified secret-free channel configuration.
 */
@Remote('completeBinding') async completeBinding(request: EnterpriseChannelCompleteBindingRequest): Promise<EnterpriseChannelConfiguration>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)

<a id="ctxenterpriseemployeecontroller--enterpriseemployeecontroller"></a>

### `ctx.enterpriseEmployeeController` — `EnterpriseEmployeeController`

Enterprise employee Draft and Release Remote service.

```ts cordis-catalog
/**
 * Execute one authenticated enterprise operation.
 * @param request - page filters.
 * @returns visible employee Draft page.
 */
@Remote('list') async list(request: EnterpriseEmployeeListRequest): Promise<EnterpriseEmployeePage>

/**
 * Execute one authenticated enterprise operation.
 * @param request - employee identity.
 * @returns current mutable Draft.
 */
@Remote('getDraft') async getDraft(request: EnterpriseEmployeeLookup): Promise<EnterpriseEmployeeDraft>

/**
 * Improve one unsaved responsibility prompt through a caller-selected configured model.
 * @param request - employee prompt and selected model route.
 * @returns the optimized prompt without saving a Draft.
 */
@Remote('optimizePrompt') async optimizePrompt( request: EnterpriseEmployeeOptimizePromptRequest, ): Promise<EnterpriseEmployeeOptimizePromptResult>

/**
 * Execute one authenticated enterprise operation.
 * @param request - Draft snapshot and CAS revision.
 * @returns saved Draft.
 */
@Remote('saveDraft') async saveDraft(request: EnterpriseEmployeeSaveRequest): Promise<EnterpriseEmployeeDraft>

/**
 * Execute one authenticated enterprise operation.
 * @param request - Draft identity and CAS revision.
 * @returns immutable Release.
 */
@Remote('publish') async publish(request: EnterpriseEmployeePublishRequest): Promise<EnterpriseEmployeeRelease>

/**
 * Execute one authenticated enterprise operation.
 * @param request - employee identity.
 * @returns immutable Release history.
 */
@Remote('listReleases') async listReleases(request: EnterpriseEmployeeLookup): Promise<readonly EnterpriseEmployeeRelease[]>

/**
 * Execute one authenticated enterprise operation.
 * @param request - source Release and target Draft CAS revision.
 * @returns rollback Release.
 */
@Remote('rollback') async rollback(request: EnterpriseEmployeeRollbackRequest): Promise<EnterpriseEmployeeRelease>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)

<a id="ctxenterpriseoperationcontroller--enterpriseoperationcontroller"></a>

### `ctx.enterpriseOperationController` — `EnterpriseOperationController`

Work record, approval, and schedule Remote service.

```ts cordis-catalog
/**
 * Execute one authenticated enterprise operation.
 * @param request - work-record page filters.
 * @returns visible work-record page.
 */
@Remote('listWorkRecords') async listWorkRecords(request: EnterpriseWorkRecordListRequest): Promise<EnterprisePage<EnterpriseWorkRecord>>

/**
 * Execute one authenticated enterprise operation.
 * @param request - composite work-record identity.
 * @returns current work record.
 */
@Remote('getWorkRecord') async getWorkRecord(request: EnterpriseWorkRecordLookup): Promise<EnterpriseWorkRecord>

/**
 * Execute one authenticated enterprise operation.
 * @param request - work-record state and CAS revision.
 * @returns saved work record.
 */
@Remote('updateWorkRecord') async updateWorkRecord(request: EnterpriseWorkRecordUpdateRequest): Promise<EnterpriseWorkRecord>

/**
 * Execute one authenticated enterprise operation.
 * @param request - approval page filters.
 * @returns visible approval page.
 */
@Remote('listApprovals') async listApprovals(request: EnterpriseApprovalListRequest): Promise<EnterprisePage<EnterpriseApproval>>

/**
 * Execute one authenticated enterprise operation.
 * @param request - approval identity.
 * @returns current approval.
 */
@Remote('getApproval') async getApproval(request: EnterpriseApprovalLookup): Promise<EnterpriseApproval>

/**
 * Execute one authenticated enterprise operation.
 * @param request - new approval request.
 * @returns created approval.
 */
@Remote('createApproval') async createApproval(request: EnterpriseApprovalCreateRequest): Promise<EnterpriseApproval>

/**
 * Execute one authenticated enterprise operation.
 * @param request - approval decision and CAS revision.
 * @returns transitioned approval.
 */
@Remote('transitionApproval') async transitionApproval(request: EnterpriseApprovalTransitionRequest): Promise<EnterpriseApproval>

/**
 * Execute one authenticated enterprise operation.
 * @param request - cancellation reason and CAS revision.
 * @returns cancelled approval.
 */
@Remote('cancelApproval') async cancelApproval(request: EnterpriseApprovalCancelRequest): Promise<EnterpriseApproval>

/**
 * Execute one authenticated enterprise operation.
 * @param request - schedule page filters.
 * @returns visible schedule page.
 */
@Remote('listSchedules') async listSchedules(request: EnterpriseScheduleListRequest): Promise<EnterprisePage<EnterpriseSchedule>>

/**
 * Execute one authenticated enterprise operation.
 * @param request - schedule identity.
 * @returns current schedule.
 */
@Remote('getSchedule') async getSchedule(request: EnterpriseScheduleLookup): Promise<EnterpriseSchedule>

/**
 * Execute one authenticated enterprise operation.
 * @param request - schedule definition and CAS revision.
 * @returns saved schedule.
 */
@Remote('saveSchedule') async saveSchedule(request: EnterpriseScheduleSaveRequest): Promise<EnterpriseSchedule>

/**
 * Execute one authenticated enterprise operation.
 * @param request - schedule state and CAS revision.
 * @returns transitioned schedule.
 */
@Remote('transitionSchedule') async transitionSchedule(request: EnterpriseScheduleTransitionRequest): Promise<EnterpriseSchedule>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)

<a id="ctxenterpriseprojects--enterpriseprojects"></a>

### `ctx.enterpriseProjects` — `EnterpriseProjects`

Enterprise project governance service.

```ts cordis-catalog
/**
 * Create one active project and add its creator as the first 'user' member.
 * @param input - organization, name, goal, workspace, creator, and optional visibility fields.
 * @returns the created project.
 */
create(input: CreateProjectInput): Promise<Project>

/**
 * Read one project by id, regardless of state or visibility.
 * @param projectId - project identifier.
 * @returns the stored project, or undefined when the id is unknown.
 */
get(projectId: ProjectId): Promise<Project | undefined>

/**
 * List one organization's projects in creation order. With a viewer, projects are filtered:
 * 'organization' is visible to everyone, 'private' only to its creator, 'restricted' to
 * `allowedUserIds` plus the creator; the 'administrator' role sees everything.
 * @param orgId - organization whose projects are listed.
 * @param viewer - viewer the visibility rules evaluate against; omitted returns all projects.
 * @returns the visible projects in creation order.
 */
list(orgId: string, viewer?: EnterpriseProjectViewer): Promise<readonly Project[]>

/**
 * Add one member to an active project. A project of another organization is
 * indistinguishable from an unknown id.
 * @param orgId - organization the caller acts within.
 * @param projectId - project identifier; must be active and belong to `orgId`.
 * @param input - member principal and the actor adding it.
 * @returns the created membership.
 */
addMember(orgId: string, projectId: ProjectId, input: AddProjectMemberInput): Promise<ProjectMember>

/**
 * Remove one member from an active project. Removing the last member is allowed; archiving,
 * not membership, ends a project's life. A project of another organization is
 * indistinguishable from an unknown id.
 * @param orgId - organization the caller acts within.
 * @param projectId - project identifier; must be active and belong to `orgId`.
 * @param principalType - whether the member is a user or an employee.
 * @param principalId - identifier of the member to remove.
 */
removeMember(orgId: string, projectId: ProjectId, principalType: ProjectPrincipalType, principalId: string): Promise<void>

/**
 * List one project's members in addition order.
 * @param projectId - project identifier.
 * @returns the members in addition order.
 */
listMembers(projectId: ProjectId): Promise<readonly ProjectMember[]>

/**
 * Move one active project to archived; archived is terminal and every mutation except reads
 * rejects afterwards. The actor is recorded by the caller's audit trail; the store keeps only
 * the archival time. A project of another organization is indistinguishable from an unknown id.
 * @param orgId - organization the caller acts within.
 * @param projectId - project identifier; must be active and belong to `orgId`.
 * @param byUserId - actor id requesting the archival; must not be empty.
 * @returns the archived project.
 */
archive(orgId: string, projectId: ProjectId, byUserId: string): Promise<Project>

/**
 * Resolve the project one principal may work in, or undefined without leaking existence:
 * unknown ids, other organizations' projects, and non-members all return undefined. Projects
 * are member-gated spaces, so visibility never substitutes for a member row: 'user' members
 * match `principal.userId` and 'employee' members match `principal.employeeId`. Archived
 * projects stay readable for their members.
 * @param orgId - organization the caller claims the project belongs to.
 * @param projectId - project identifier.
 * @param principal - user and optional employee identity of the caller.
 * @returns the project when the principal is an explicit member, otherwise undefined.
 */
requireMember(orgId: string, projectId: ProjectId, principal: EnterpriseProjectMemberPrincipal): Promise<Project | undefined>
```

Source: [`packages/enterprise/enterprise-project/src/types.ts`](../../packages/enterprise/enterprise-project/src/types.ts)

<a id="ctxenterpriseteamcontroller--enterpriseteamcontroller"></a>

### `ctx.enterpriseTeamController` — `EnterpriseTeamController`

Fixed team Remote service.

```ts cordis-catalog
/**
 * Execute one authenticated enterprise operation.
 * @param request - page cursor and size.
 * @returns visible team page.
 */
@Remote('list') async list(request: EnterpriseTeamListRequest): Promise<EnterpriseTeamPage>

/**
 * Execute one authenticated enterprise operation.
 * @param request - team identity.
 * @returns current team.
 */
@Remote('get') async get(request: EnterpriseTeamLookup): Promise<EnterpriseTeam>

/**
 * Execute one authenticated enterprise operation.
 * @param request - team composition and CAS revision.
 * @returns saved team.
 */
@Remote('save') async save(request: EnterpriseTeamSaveRequest): Promise<EnterpriseTeam>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)

<a id="ctxenterpriseteamdefinitioncontroller--enterpriseteamdefinitioncontroller"></a>

### `ctx.enterpriseTeamDefinitionController` — `EnterpriseTeamDefinitionController`

Enterprise team-definition Remote service.

```ts cordis-catalog
/**
 * List definitions visible to the authenticated organization.
 * @param request - page cursor and size.
 * @returns visible definition page.
 */
@Remote('list') async list(request: EnterpriseTeamDefinitionListRequest): Promise<EnterpriseTeamDefinitionPage>

/**
 * Read one definition from the authenticated organization.
 * @param request - team identity.
 * @returns current definition.
 */
@Remote('get') async get(request: EnterpriseTeamDefinitionLookup): Promise<EnterpriseTeamDefinition>

/**
 * Read an owner-visible draft without substituting it for the active charter.
 * @param request - team identity for the requested draft.
 * @returns the owner-visible draft revision.
 */
@Remote('getDraft') async getDraft(request: EnterpriseTeamDefinitionDraftLookup): Promise<EnterpriseTeamDefinitionRevision>

/**
 * Create or CAS-save one non-archived definition in the authenticated organization.
 * @param request - definition and write guards; revision zero creates it and archive state is rejected.
 * @returns saved definition.
 */
@Remote('save') async save(request: EnterpriseTeamDefinitionSaveRequest): Promise<EnterpriseTeamDefinition>

/**
 * Save a draft without changing the active Team Definition used by TeamRuns.
 * @param request - team identity, draft payload, and write guards.
 * @returns the definition containing the saved draft.
 */
@Remote('draft') async draft(request: EnterpriseTeamDefinitionDraftRequest): Promise<EnterpriseTeamDefinition>

/**
 * Validate and publish the currently selected draft for new TeamRuns.
 * @param request - team identity and expected draft revision.
 * @returns the definition with its newly active charter.
 */
@Remote('publish') async publish(request: EnterpriseTeamDefinitionPublishRequest): Promise<EnterpriseTeamDefinition>

/**
 * Discard a draft while retaining both the active definition and historical TeamRuns.
 * @param request - team identity and expected draft revision.
 * @returns the retained active definition revision.
 */
@Remote('discardDraft') async discardDraft(request: EnterpriseTeamDefinitionDiscardDraftRequest): Promise<EnterpriseTeamDefinitionRevision>

/**
 * Archive one definition; only this operation enters the terminal archived state.
 * @param request - team identity and write guards.
 * @returns archived definition.
 */
@Remote('archive') async archive(request: EnterpriseTeamDefinitionArchiveRequest): Promise<EnterpriseTeamDefinition>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)

<a id="ctxenterpriseworkcontroller--enterpriseworkcontroller"></a>

### `ctx.enterpriseWorkController` — `EnterpriseWorkController`

Goal-first enterprise work entry point. This slice deliberately does not route models, teams, tools, or budgets.

```ts cordis-catalog
/** Actor used by employee-private memory for a live, release-bound Session.
 * @param sessionId - Session identity.
 * @returns the selected employee and Session owner, if active.
 */
employeeActor(sessionId: string): { orgId: string; userId: string; employeeId: string } | undefined

/** Read the caller-visible default employee for one authorized Workspace.
 * @param request - Workspace identity.
 * @returns the visible employee choice and revision.
 */
@Remote('workspaceDefault') async workspaceDefault(request: WorkspaceEmployeeDefaultRequest): Promise<WorkspaceEmployeeDefaultView>

/** Set or clear a Workspace default under its manager policy and CAS revision.
 * @param request - Workspace, employee choice, and expected revision.
 * @returns the new caller-visible choice.
 */
@Remote('saveWorkspaceDefault') async saveWorkspaceDefault(request: WorkspaceEmployeeDefaultSaveRequest): Promise<WorkspaceEmployeeDefaultView>

/** Select a published employee for one owned blank Session and record the release used.
 * @param request - Owned Session and employee identity.
 * @returns the Workspace and immutable release mounted in that Session.
 */
@Remote('selectEmployee') async selectEmployee(request: EnterpriseEmployeeSessionRequest): Promise<EnterpriseEmployeeSessionValue>

/**
 * Resolve the workspace and employee that would start enterprise work.
 * @param request - Goal and optional workspace or employee choices.
 * @returns a ready selection or the visible choices needed to continue.
 */
@Remote('prepare') async prepare(request: EnterpriseWorkPrepareRequest): Promise<EnterpriseWorkPreparation>

/**
 * Start enterprise work using the prepared, authorized workspace and employee.
 * @param request - Goal, optional selections, and idempotency key.
 * @returns the durable native Session and selected release.
 */
@Remote('start') async start(request: EnterpriseWorkStartRequest): Promise<EnterpriseWorkStartValue>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)

<a id="ctxmemoryconsolidation--memoryconsolidationruntime"></a>

### `ctx.memoryConsolidation` — `MemoryConsolidationRuntime`

Process-scoped consolidation service: interval lifecycle, per-compartment runs, and the reentrancy guard the manual endpoint answers 409 through.

```ts cordis-catalog
/** Start the interval timer; an interval of `0` or an empty org list starts nothing. */
start(): Promise<void>

/** Wire the service into the context and tie the timer to the context lifecycle. */
install(): void

/** Stop the timer; an in-flight run finishes but no tick fires afterwards. */
close(): void

/**
 * Run consolidation once for one compartment. An overlapping run of the same compartment —
 * a tick racing a manual trigger, or two manual triggers — throws `ConsolidationRunningError`.
 * @param orgId - organization whose memory is consolidated.
 * @param compartment - the compartment to consolidate.
 * @returns the closed run report.
 */
async runCompartment(orgId: string, compartment: ConsolidationCompartment): Promise<ConsolidationReport>

/**
 * Distill one project's approved memory compartment into shared-memory lesson proposals. The
 * manual controller route awaits this and returns the report; the post-archive trigger runs it
 * fire-and-forget. The refinement route, budget, and audit shape are the consolidation ones.
 * @param input - organization, project, and the actor the proposals and audit attribute to.
 * @returns the closed run report.
 * @throws When the project service is unmounted, the project does not resolve, or the
 *   compartment has a store failure outside the per-lesson recording; the failure is audited
 *   before the rethrow because the archive trigger swallows rejections.
 */
async distillProject(input: { orgId: string; projectId: string; actorUserId: string }): Promise<ProjectDistillReport>
```

Source: [`packages/context/enterprise-memory-context/src/consolidation-runtime.ts`](../../packages/context/enterprise-memory-context/src/consolidation-runtime.ts)

<a id="ctxsurfaces--enterprisesurfaces"></a>

### `ctx.surfaces` — `EnterpriseSurfaces`

Enterprise conversation surface registry and inbound delivery.

```ts cordis-catalog
/**
 * Return the durable dm surface for one (user, employee) pair, creating it
 * and its anchored session on first call. Repeated calls return the same
 * surface and create the session at most once; concurrent calls for one pair
 * share one creation.
 * @param input - organization, channel user, and employee.
 * @returns the dm surface, with its anchored session id once attached.
 */
ensureDm(input: { orgId: string; userId: string; employeeId: EmployeeId }): Promise<DmSurface>

/**
 * Return the durable group surface keyed by the organization and external
 * key, creating it when absent and replacing its member set with the given
 * employee ids. The external key carries the idempotency: a call without
 * one always creates a new surface keyed by its fresh id. Keyed repeats
 * return the stored surface; group surfaces create no session at ensure
 * time.
 * @param input - organization, name, optional external key and project, the
 * member employees, and the chartered team for team-mode groups.
 * @returns the stored group surface.
 * @throws an `EnterpriseSurfaceError` when a federated group carries no
 * member employee, or a member is missing or belongs to another organization.
 */
ensureGroupSurface(input: { orgId: string name: string externalKey?: string memberEmployeeIds: readonly EmployeeId[] teamDefinitionId?: string projectId?: string }): Promise<GroupSurface>

/**
 * Return the durable channel surface keyed by the organization and external
 * key, creating it when absent and replacing its member set with the given
 * employee ids — the same idempotency as `ensureGroupSurface`. Keyed repeats
 * return the stored surface without rewriting its policies; duty roster
 * updates ride `setDutyRoster`. Channel surfaces create no session at ensure
 * time.
 *
 * Policy pairing: `respondPolicy: 'ingest_only'` makes the duty roster and
 * mention routing moot — every message becomes a memory proposal — so a
 * stored roster is allowed but inert. Every duty employee id must name an
 * employee of the organization.
 * @param input - organization, name, optional external key and project, the
 * member employees, both policies, and the duty roster in routing order.
 * @returns the stored channel surface.
 * @throws an `EnterpriseSurfaceError` when a duty employee is missing or
 * belongs to another organization.
 */
ensureChannelSurface(input: { orgId: string name: string externalKey?: string memberEmployeeIds: readonly EmployeeId[] topicPolicy: ChannelTopicPolicy respondPolicy: ChannelRespondPolicy dutyEmployeeIds: readonly EmployeeId[] projectId?: string }): Promise<ChannelSurface>

/**
 * Resolve the sticky employee for one channel actor.
 * @param orgId - organization the actor belongs to.
 * @param actorKey - opaque actor key of the channel participant.
 * @returns the sticky employee, or undefined while unbound.
 */
stickyEmployee(orgId: string, actorKey: string): EmployeeId | undefined

/**
 * Enqueue one authenticated inbound message and deliver it to the employee's anchored session.
 * @param surface - surface the message arrived on; its anchored session must be live.
 * @param originActor - opaque key of the authenticated actor that sent the message.
 * @param payloadText - message text delivered to the employee.
 * @returns the durable inbox item id delivered by this call.
 * @throws an `EnterpriseSurfaceError` when the surface is not a dm surface, the employee is missing or belongs
 * to another organization, the surface has no anchored session, the anchored
 * session is not live, or the delivery does not land in the session log; the
 * failed path also marks the inbox item failed. When an older queued item
 * fails mid-loop, the rejection names that older item while this call's item
 * stays queued. Underlying agent-host failures propagate unchanged after the
 * failing row is marked failed.
 */
deliverToEmployee(surface: Surface, originActor: string, payloadText: string): Promise<InboxItemId>

/**
 * Deliver one inbound group message. Team-mode surfaces submit the text into
 * the chartered team's active run, starting one with the given idempotency
 * key when none is active; federated surfaces steer the @-mentioned member
 * employees' group sessions. Group delivery never enqueues employee inbox
 * rows; the inbox stays dm-specific.
 * @param surface - surface the message arrived on.
 * @param input - originating user, message text, optional explicitly
 * mentioned employee ids, and the optional channel message id: passing it
 * makes a team-mode run start retry-safe (the same envelope reuses its
 * run), while omitting it starts every start-needing message its own run
 * and leaves transport-level dedup to the channel kernel.
 * @returns the structured delivery outcome; federated no-target and team
 * control failures come back as results, not rejections. Per-member steering
 * failures are captured on their targets while the rest of the batch lands.
 */
deliverToGroup( surface: Surface, input: { originUserId: string; text: string; mentionedEmployeeIds?: readonly EmployeeId[]; messageId?: string }, ): Promise<GroupDeliveryResult>

/**
 * Deliver one inbound channel message. Ingest-only surfaces propose the
 * truncated text as one organization-scope memory announcement and never
 * touch a session. Interactive (`mention_duty`) surfaces resolve the topic
 * and the addressed employees, then steer the topic's one session:
 *
 * - `/done` settles the topic named by `topicId` and steers a settle marker
 *   into its session when one exists — the store row and the session log
 *   both record the settle. Without `topicId` the command is a `no-topic`
 *   result; on a settled or archived topic it is `already-settled`.
 * - `/topic 标题` ensures the topic titled by the command, under the given
 *   `topicId` or a fresh one. A bare `/topic` with no title is
 *   `invalid-command`.
 * - Plain messages resolve their topic by policy: `thread` uses the given
 *   `topicId` or auto-creates one titled by the message's first 40
 *   characters; `command` requires `topicId` naming an existing topic of
 *   this surface; `lane` routes into the one surface-wide topic titled by
 *   the channel name, ignoring `topicId`.
 *
 * Routing targets the @-mentioned members — explicit ids win over
 * display-name tokens, matching group delivery — and falls back to the duty
 * roster head for unaddressed messages. A topic session anchors to its
 * first routed employee's home workspace and the shared default preset;
 * later messages from other employees steer the same session and attribute
 * through the message's `originActor`. Topic sessions are created at most
 * once per topic even under concurrent first messages.
 * @param surface - surface the message arrived on.
 * @param input - originating user, message text, optional explicitly
 * mentioned employee ids, and the optional topic id the transport pinned
 * from a previous routed result.
 * @returns the structured delivery outcome; routing and intake failures
 * come back as results, not rejections. Unknown or cross-org employees and
 * a non-channel surface still reject, matching dm and group delivery.
 */
deliverToChannel( surface: Surface, input: { originUserId: string; text: string; mentionedEmployeeIds?: readonly EmployeeId[]; topicId?: string }, ): Promise<ChannelDeliveryResult>

/**
 * List one organization's stored surfaces in creation order, optionally narrowed to one kind.
 * @param input - organization and the optional kind filter.
 * @returns The stored surfaces with their stored member counts.
 */
listSurfaces(input: { orgId: string; kind?: Surface['kind'] }): Promise<readonly SurfaceListEntry[]>

/**
 * Read one stored surface by id within one organization; unknown and
 * cross-organization ids both resolve nothing so callers can fold existence.
 * @param input - organization and surface id.
 * @returns The stored surface, or undefined when the id is missing or foreign.
 */
findSurface(input: { orgId: string; surfaceId: SurfaceId }): Promise<Surface | undefined>

/**
 * Read the one channel surface bound to an external key. The deployment token
 * owns the organization scope on the inbound path, so the key alone addresses
 * the surface; the store fails loud when several organizations bound the same key.
 * @param input - the transport-pinned external key.
 * @returns The stored channel surface, or undefined when the key is unbound.
 */
findChannelByExternalKey(input: { externalKey: string }): Promise<ChannelSurface | undefined>
```

Source: [`packages/enterprise/enterprise-surface/src/types.ts`](../../packages/enterprise/enterprise-surface/src/types.ts)

<a id="agent-events"></a>

### `agent/*` events

<a id="agentassistant-stream--emit"></a>

#### `agent/assistant-stream` — emit

Process-local assistant-stream publication. Chunk frames are transient; the loop appends one final v2 `assistant/message` or `assistant/attempt` with the same stream before a committed end frame.

```ts cordis-catalog
/**
 * Process-local assistant-stream publication. Chunk frames are transient;
 * the loop appends one final v2 `assistant/message` or `assistant/attempt`
 * with the same stream before a committed end frame.
 * @param payload.agent - the agent whose attempt produced the frame.
 * @param payload.frame - one ordered start, chunk, or end publication.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/assistant-stream'(this: Scoped<Agent>, payload: { agent: Agent; frame: AssistantStreamFrame }): void
```

Types: [Scoped](scope.zh.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentcreated--serial"></a>

#### `agent/created` — serial

An entered agent is ready for per-agent initialization after factory setup. Listeners run in order and are awaited before creation resolves. AgentLoop holds queued input until all listeners finish. A throw or rejection fails creation and skips later listeners. Disposal retains the scope and session until dispatch settles; listeners must not await agent.whenIdle() or their own owner's disposal.

```ts cordis-catalog
/**
 * An entered agent is ready for per-agent initialization after factory setup.
 * Listeners run in order and are awaited before creation resolves. AgentLoop
 * holds queued input until all listeners finish. A throw or rejection fails
 * creation and skips later listeners. Disposal retains the scope and session
 * until dispatch settles; listeners must not await agent.whenIdle() or their
 * own owner's disposal.
 * @param payload.agent - the newly registered agent with its live session and completed setup.
 * @param payload.source - fresh creation, resume, clear, or compaction source.
 * @param payload.signal - factory initialization cancellation signal, when provided.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode serial
 */
'agent/created'(this: Scoped<Agent>, payload: { agent: Agent; source: SessionStartSource; signal?: AbortSignal }): undefined | Promise<undefined>
```

Types: [Scoped](scope.zh.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentdisposed--emit"></a>

#### `agent/disposed` — emit

An agent left the registry; AgentLoop emits this after driver quiescence and scoped-registration unwind, but before session detachment. Custom registry users own their driver-ordering contract.

```ts cordis-catalog
/**
 * An agent left the registry; AgentLoop emits this after driver quiescence
 * and scoped-registration unwind, but before session detachment. Custom
 * registry users own their driver-ordering contract.
 * @param payload.agent - the exact agent removed from the registry.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/disposed'(this: Scoped<Agent>, payload: { agent: Agent }): void
```

Types: [Scoped](scope.zh.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agenterror--emit"></a>

#### `agent/error` — emit

A step or turn errored. The machine reports a failure here even when the error has no in-turn position for a durable record.

```ts cordis-catalog
/**
 * A step or turn errored. The machine reports a failure here even when
 * the error has no in-turn position for a durable record.
 * @param payload.agent - the agent whose turn errored.
 * @param payload.turn - the turn in which the failure surfaced.
 * @param payload.step - the step at which the failure surfaced.
 * @param payload.error - the failure, verbatim.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; error: unknown }): void
```

Types: [Scoped](scope.zh.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxclaimed--emit"></a>

#### `agent/inbox/claimed` — emit

One message left the inbox inside its open turn. If the proposed step is rejected, the claimed message ends here: it is neither discarded nor re-emitted as a user/message, and the turn closes without a step.

```ts cordis-catalog
/**
 * One message left the inbox inside its open turn. If the proposed step
 * is rejected, the claimed message ends here: it is neither discarded nor
 * re-emitted as a user/message, and the turn closes without a step.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the claimed message.
 * @param payload.turn - the owning turn.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/claimed'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage; turn: number }): void
```

Types: [Scoped](scope.zh.md) · [UserMessage](session.zh.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxdiscarded--emit"></a>

#### `agent/inbox/discarded` — emit

One message was discarded from the live inbox.

```ts cordis-catalog
/**
 * One message was discarded from the live inbox.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the discarded message.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/discarded'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
```

Types: [Scoped](scope.zh.md) · [UserMessage](session.zh.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentinboxinserted--emit"></a>

#### `agent/inbox/inserted` — emit

One message entered the live inbox.

```ts cordis-catalog
/**
 * One message entered the live inbox.
 * @param payload.agent - the agent whose inbox changed.
 * @param payload.message - the inserted message.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/inbox/inserted'(this: Scoped<Agent>, payload: { agent: Agent; message: UserMessage }): void
```

Types: [Scoped](scope.zh.md) · [UserMessage](session.zh.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentpre-step--waterfall"></a>

#### `agent/pre-step` — waterfall

Reject a proposed step or replace the messages that enter it. Calling `next()` preserves the current messages.

```ts cordis-catalog
/**
 * Reject a proposed step or replace the messages that enter it. Calling
 * `next()` preserves the current messages.
 * @param payload.agent - the agent proposing the step.
 * @param payload.messages - messages removed from the inbox for this step.
 * @param payload.turn - the turn that will own the step.
 * @param payload.step - the step proposed by the loop.
 * @param payload.signal - the current turn's cancellation signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
 */
'agent/pre-step'(this: Scoped<Agent>, payload: { agent: Agent; messages: UserMessage[]; turn: number; step: number; signal: AbortSignal }, next: () => Promise<PreStepDecision>): Promise<PreStepDecision>
```

Types: [Scoped](scope.zh.md) · [UserMessage](session.zh.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentrequest--waterfall"></a>

#### `agent/request` — waterfall

Replace the frozen call configuration. `await next()` yields the config the machine would use (agent options on the first request, the logged header afterwards); return a replacement to switch. On step admission, this runs after assembly and `step/start`, before the system prompt and accepted user batch are committed. Cancellation here or during subsequent `prepareCall()` resolution commits neither. The prepared call capability governs prompt admission. Model-visible content must use logged channels; this waterfall cannot mutate messages.

```ts cordis-catalog
/**
 * Replace the frozen call configuration. `await next()` yields the config
 * the machine would use (agent options on the first request, the logged
 * header afterwards); return a replacement to switch. On step admission,
 * this runs after assembly and `step/start`, before the system prompt and
 * accepted user batch are committed. Cancellation here or during subsequent
 * `prepareCall()` resolution commits neither. The prepared call capability
 * governs prompt admission. Model-visible content must use logged channels;
 * this waterfall cannot mutate messages.
 * @param payload.agent - the agent making the model call.
 * @param payload.turn - the open turn number.
 * @param payload.step - the step whose request this is.
 * @param payload.signal - the current turn's explicit abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
*/
'agent/request'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; signal: AbortSignal }, next: () => Promise<LlmCallConfig>): Promise<LlmCallConfig>
```

Types: [LlmCallConfig](llm-streaming.zh.md) · [Scoped](scope.zh.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentrequest-error--waterfall"></a>

#### `agent/request-error` — waterfall

Handle one failed model-request attempt before the loop retries or closes its step. A listener returns `{ kind: 'retry' }` without calling `next()` when it owns recovery, or calls `next()` to delegate. The default `undefined` leaves the failure terminal.

```ts cordis-catalog
/**
 * Handle one failed model-request attempt before the loop retries or closes
 * its step. A listener returns `{ kind: 'retry' }` without calling `next()`
 * when it owns recovery, or calls `next()` to delegate. The default
 * `undefined` leaves the failure terminal.
 * @param payload.agent - the agent whose request failed.
 * @param payload.turn - the turn containing the failed request.
 * @param payload.step - the step containing the failed request attempt.
 * @param payload.provider - the provider selected for the failed request.
 * @param payload.failure - serializable facts normalized at the final adapter boundary.
 * @param payload.retryPolicy - the policy of the adapter registration that served the failed request.
 * @param payload.signal - the turn abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode waterfall
 */
'agent/request-error'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; step: number; provider: string; failure: LlmFailure; retryPolicy: ResolvedRetryPolicy | undefined; signal: AbortSignal }, next: () => Promise<RequestErrorAction>): Promise<RequestErrorAction>
```

Types: [LlmFailure](llm-streaming.zh.md) · [ResolvedRetryPolicy](llm-streaming.zh.md) · [Scoped](scope.zh.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentstatus--emit"></a>

#### `agent/status` — emit

Agent status changed (`idle` ⇄ `running`). A waking delivery enters `running` synchronously after reserving cancellation; `idle` means no driver remains scheduled or active.

```ts cordis-catalog
/**
 * Agent status changed (`idle` ⇄ `running`). A waking delivery enters
 * `running` synchronously after reserving cancellation; `idle` means no
 * driver remains scheduled or active.
 * @param payload.agent - the agent whose status flipped.
 * @param payload.status - the status just entered (the transition's destination).
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode emit
 */
'agent/status'(this: Scoped<Agent>, payload: { agent: Agent; status: AgentStatus }): void
```

Types: [Scoped](scope.zh.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agentturn-stopping--serial"></a>

#### `agent/turn-stopping` — serial

The turn is about to close: the model owes no response (no live tool calls, no fresh steering). Awaited before the boundary commits — a listener that objects steers (`agent.steer(...)`) and the machine re-reads its inbox: fresh steering runs another step, none closes the turn. Data decides, so listener order cannot change the outcome. The inverse control (stop a tool loop early) is data too: a tool result carrying `concludesTurn` ends the turn at its step. The conclusion never short-circuits already-submitted next-step work: same-step `additionalContexts` or racing steering still runs, and the turn closes only when that inbox drains.

```ts cordis-catalog
/**
 * The turn is about to close: the model owes no response (no live tool
 * calls, no fresh steering). Awaited before the boundary commits — a
 * listener that objects steers (`agent.steer(...)`) and the machine
 * re-reads its inbox: fresh steering runs another step, none closes the
 * turn. Data decides, so listener order cannot change the outcome. The
 * inverse control (stop a tool loop early) is data too: a tool result
 * carrying `concludesTurn` ends the turn at its step. The conclusion
 * never short-circuits already-submitted next-step work: same-step
 * `additionalContexts` or racing steering still runs, and the turn
 * closes only when that inbox drains.
 * @param payload.agent - the agent whose turn is at its stop boundary.
 * @param payload.turn - the turn about to close.
 * @param payload.signal - the current turn's explicit abort signal.
 * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent.
 * @mode serial
 */
'agent/turn-stopping'(this: Scoped<Agent>, payload: { agent: Agent; turn: number; signal: AbortSignal }): Promise<void> | void
```

Types: [Scoped](scope.zh.md)

Source: [`packages/core/agent/src/runtime-types.ts`](../../packages/core/agent/src/runtime-types.ts)

<a id="agent-loop-events"></a>

### `agent-loop/*` events

<a id="agent-loopconfig-start-failed--emit"></a>

#### `agent-loop/config-start-failed` — emit

A declarative agent entry failed before it could publish a live agent. Consumers that buffer work for the configured identity use this transient signal to reject that work instead of waiting forever. Normal factory teardown suppresses failures from the cancelled startup attempt.

```ts cordis-catalog
/**
 * A declarative agent entry failed before it could publish a live agent.
 * Consumers that buffer work for the configured identity use this
 * transient signal to reject that work instead of waiting forever. Normal
 * factory teardown suppresses failures from the cancelled startup attempt.
 * @param payload.sessionId - exact shared agent/session identity that failed startup.
 * @param payload.error - persistence, setup, or publication failure.
 * @mode emit
 */
'agent-loop/config-start-failed'(payload: { sessionId: SessionId; error: unknown }): void
```

Source: [`packages/core/agent-loop/src/index.ts`](../../packages/core/agent-loop/src/index.ts)

<a id="agent-preset-events"></a>

### `agent-preset/*` events

<a id="agent-presetselected--emit"></a>

#### `agent-preset/selected` — emit

One session committed a different agent preset to its durable log. Consumers invalidate only state derived from that session's composition.

```ts cordis-catalog
/**
 * One session committed a different agent preset to its durable log.
 * Consumers invalidate only state derived from that session's composition.
 * @mode emit
 * @param sessionId - the session whose composition changed.
 * @param agentPreset - the preset recorded by the committed selection.
 */
'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
```

Source: [`packages/preset/agent-preset-registry/src/types.ts`](../../packages/preset/agent-preset-registry/src/types.ts)
<!-- END GENERATED cordis-surface -->
