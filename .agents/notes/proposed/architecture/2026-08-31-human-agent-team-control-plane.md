# Agent Note: Human–Agent team definition and run control plane

Status: proposed

English | [中文](2026-08-31-human-agent-team-control-plane.zh.md)

## Problem

DSH already owns durable Sessions, Workspaces, Employee Releases, approvals, subagent lifecycles, and Session events. The experimental Agent Teams capability adds an implicit-root Agent roster, durable task DAG, and mailbox over a Lead Session. It does not define reusable enterprise Team templates, Human roster membership, Human decision ownership, scoped autonomy progression, or one cross-Run queue for Human attention.

Adding those concerns directly to a channel, a PostgreSQL task database, or a second orchestration engine would create competing answers for who is on the Team, whether a task or approval changed, and which evidence authorized an irreversible action. Treating the Human as an external reviewer would also omit Human instructions and decisions from the same actor and audit model used for Agent work.

## Proposal

This proposal adds enterprise definition, command, index, and projection capabilities around DSH rather than another execution engine. It extends, and does not supersede, the current [Agent Teams runtime decision](../../implemented/feature/2026-08-05-agent-teams.md) or its [experimental package boundary](../../implemented/architecture/2026-08-18-experimental-agent-teams-packages.md). The existing `TeamService`, roster, task, mailbox, continuation, and Session-log folds remain the execution foundation.

### Delivery sequence

The first delivery phase implements the DSH core collaboration loop only: Team Definition, TeamRun launch, Human and Agent roster, Agent Lead coordination, task DAG, decisions, verification, handoff, and cross-Run Human attention inside authenticated DSH. It does not expose an enterprise channel command surface.

After that core loop passes its replay, authorization, recovery, and Human-attention acceptance criteria, the enterprise channel phase starts with Enterprise WeChat. Feishu and DingTalk then reuse the same DSH adapter protocol rather than introducing provider-specific workflow state. Personal WeChat remains limited to notifications and invitations to take over in authenticated DSH throughout every phase.

### Team Definition and TeamRun

`TeamDefinition` is a reusable, versioned enterprise definition whose persistent authority is PostgreSQL. It contains the Human-authored charter, Human and Agent role templates, one Agent Lead, required Employee Release and Credential references, task-type policy, Doer–Verifier separation rules, capability grants, review cadence, stop conditions, and channel notification policy. Saving or revising a definition creates no Session, Team task, mailbox message, or approval.

`TeamRun` is one execution of an exact Team Definition version. Its durable identity is the DSH root `SessionId`; PostgreSQL stores a query projection keyed by that same identity rather than allocating a second run authority. Launch records the definition version, Run-specific North Star, Workspace, active roster, effective grants, and decision policy in the root Session before the Agent Lead begins decomposition.

The existing experimental `TeamService`, backed by that root Session event log, remains the only durable runtime owner. Launch and enterprise commands call `TeamService` to append versioned events in the same Team domain. The enterprise layer owns Team Definition persistence, authorized commands, indexes, and projections only; it never creates a second roster, task board, mailbox, decision log, or verification store.

The Team Definition may change while a Run is active, but the Run retains its launched version and explicit amendments. A Human-authorized amendment appends a Session event and updates the projection; editing a reusable definition never mutates an active Run implicitly.

### State ownership and projection

For each TeamRun, `TeamService` and its root DSH Session event log are one runtime authority: the service validates and appends Team-domain events, and the log durably owns the materialized roster, task, mailbox, decision, verification, and handoff state, including Human instructions, Agent actions, approvals, artifacts, and channel delivery evidence. Session replay drives the same `TeamService` fold from the launched Team Definition snapshot and later events without treating PostgreSQL rows as runtime truth. Session event order and identity remain the runtime audit order and correlation source.

PostgreSQL is the persistent authority for reusable Team Definitions and also stores search indexes, organization policy references, and rebuildable cross-Run query projections such as `Needs my attention`. Those query projections are not runtime authorities. A projection cursor records the last applied Session event; lag may make a list stale but may never authorize an action. Every runtime mutation reloads and authorizes against the owning root Session before appending a Session event.

DSH as a product is the only business-state and audit system across all channels: PostgreSQL supplies Team Definition truth, root Session event logs supply TeamRun runtime truth, and channels supply transport observations only. No channel database, sticky selection, delivery receipt, or provider event may override either DSH owner.

Existing DSH authorities remain unchanged: Workspace owns the business-space and filesystem boundary, Employee Release selects immutable published Agent composition, Approval owns interactive authorization, Subagent and experimental Agent Teams own child execution and coordination, Credential owns secret material, and SessionEvent owns audit and replay. PostgreSQL does not copy credential values or raw conversation content into Team definitions or query rows.

### Human and Agent actors

The proposed event schema evolves the current `TeamMemberSnapshot` inside `TeamService` into a versioned discriminated union that carries both actor kinds in the same `team/member` event family. A Human member has `actorKind: 'human'`, an enterprise `userId`, role metadata, and no Session identity. An Agent member has `actorKind: 'agent'`, a `sessionId`, an `employeeReleaseId`, service identity, role metadata, and effective grant. A channel alias may resolve to the Human `userId` but is never itself the authorizing actor.

Every Agent uses an independent service identity and Credential references. An Agent does not receive a Human browser token, channel session, or reusable delegated bearer credential. The effective permission for an Agent action is the intersection of enterprise policy, Team Definition grant, Run amendment, Employee Release capability, Workspace scope, and the action's own approval requirement.

The Human owns the North Star, value judgments, autonomy changes, exceptions to policy, and irreversible decisions. The Agent Lead decomposes work, maintains the task DAG, assigns Doers and Verifiers, coordinates the existing mailbox, verifies readiness, assembles evidence, and raises decision requests. The Agent Lead cannot widen a grant, approve its own escalation, or convert missing evidence into success.

### Trust grants and verification

Every autonomy grant is keyed by Agent, task type, and capability scope. Its trust level is one of:

- `observe`: read authorized context and evidence without mutating work state or external systems.
- `propose`: create a recommendation, draft, plan, or decision request, but do not execute the proposed mutation.
- `execute-reviewed`: execute within scope while keeping the result from advancing its dependent workflow until the required Human or Verifier review accepts it.
- `execute-delegated`: execute pre-authorized, reversible work and advance ordinary workflow within scope; irreversible actions and policy exceptions still require Human approval.

An Agent cannot grant, widen, or transfer autonomy. A Human authorization records the old and new scope, reason, expiry or review date, and affected task types. Retrospective evidence may support a later grant change but never changes a grant automatically.

Tasks whose policy requires separation carry distinct Doer and Verifier assignments. Completion records the Doer's claim and evidence; verification records a separate acceptance, rejection, or bounded concern. The same Agent cannot fill both roles for that task unless a Human records a policy exception with its consequence.

### Human attention and decisions

Decision requests contain the recommended option, alternatives, consequence, deadline, downstream blockers, required authorization, and a bounded evidence packet. The cross-Run `Needs my attention` view is rebuilt from unresolved DSH decision and approval events plus authorization projections; it is not an independent inbox that can settle work by itself.

Batch decisions are permitted only when selected requests share the same action semantics, authorization requirement, and consequence class. The UI records one attributable decision event per affected Run so replay and partial failure remain unambiguous. Risk, expiry, and blocked downstream work outrank arrival time.

### Channels are adapters

After the DSH core collaboration loop ships, Enterprise WeChat is the first enterprise adapter; Feishu and DingTalk later reuse the same interface. An adapter authenticates its transport account, maps an intent to a DSH command, submits it under the resolved Human principal, and renders the resulting DSH projection or delivery receipt. It owns transport retry and provider acknowledgement only.

The Channel Kernel keeps its current deterministic routing input and priority: `stickyEmployeeId`, then `intentEmployeeId`, then `binding.defaultEmployeeId`. Neither the Kernel nor an adapter persists authoritative selection. Enterprise composition must derive `stickyEmployeeId` from a DSH-owned channel binding or Session projection and persist `/switch` through an attributable DSH command before that projection changes. This composition is a migration target, not a completed adapter behavior.

Personal WeChat is notification and Human-takeover transport only. It cannot issue a DSH command that creates, edits, assigns, completes, or approves a task; changes roster or grants; settles a decision; or modifies Team state. Its message directs the Human to the authenticated DSH surface.

Every channel or outbox operation persists one stable `operationId`. DSH admits and dispatches one logical operation for that id, and recovery resumes the same record instead of creating a second dispatch. When a provider supports an idempotency key, the adapter passes `operationId` and may claim provider-side de-duplication. Without that support, or when a timeout leaves the provider outcome ambiguous, the operation enters a visible `unknown-outcome` state for reconciliation and is not blindly retried.

No channel database or provider acknowledgement is a task, approval, roster, decision, or audit authority. Provider acceptance proves delivery to the provider, not Human receipt or a business result. The design makes no exactly-once claim for an external provider.

## Alternatives considered

**Store Team tasks and approvals primarily in PostgreSQL.** This would make Session replay incomplete and create dual-write ordering between the execution log and control database. PostgreSQL remains the persistent Team Definition authority and stores rebuildable query projections, while root Session event logs own TeamRun runtime state.

**Give each channel its own workflow state and synchronize later.** Reconciliation could not establish one authoritative decision when channels disagree or delivery retries reorder commands. Channels remain adapters to DSH commands and projections.

**Build a new enterprise roster, task board, or mailbox.** The existing experimental `TeamService` already owns durable member events, task CAS, DAG validation, roster recovery, and mailbox delivery over the Lead Session. Its same event family gains Human actors, while the enterprise layer adds definitions, commands, indexes, and projections instead of duplicating runtime state.

**Combine Team Definition and TeamRun.** Editing a reusable template would then risk changing active work, and every launch would overwrite history needed to explain its policy. Separate versioned definitions and Session-rooted Runs keep reuse and execution distinct.

**Represent Humans only as approvers outside the roster.** Human goals, instructions, availability, and decisions would become metadata around the Team rather than attributable work by a Team actor. Humans and Agents therefore share one roster with different authority.

**Assign one global autonomy level per Agent.** Trust demonstrated for one task type or capability would spill into unrelated work. Grants remain the intersection of Agent, task type, and capability scope.

**Let an Agent reuse the initiating Human's credentials.** Attribution, revocation, least privilege, and offboarding would become ambiguous. Every Agent uses an independent service identity and Credential references.

## Acceptance criteria

- Replaying one root Session through the `TeamService` fold reconstructs its launched definition version, discriminated Human and Agent `TeamMemberSnapshot` records, task DAG, mailbox state, decisions, approvals, verification, handoffs, artifacts, and grant amendments without using PostgreSQL as TeamRun runtime truth.
- Deleting and rebuilding PostgreSQL query projections from Session events produces the same cross-Run attention items and records a detectable lag cursor; a stale projection cannot authorize a mutation.
- Authorization tests cover each trust level and the full Agent × task type × capability intersection, including denial of self-escalation, grant transfer, Human credential reuse, Doer–Verifier conflict, and irreversible delegated execution.
- Team launch tests prove that one definition version can create independent Runs, later definition edits do not change them, and an explicit Human amendment is attributable and replayable.
- Existing experimental Agent Teams tests continue to own task CAS, DAG, roster, mailbox, recovery, and continuation behavior; enterprise composition tests prove commands call `TeamService` and no second roster, task, mailbox, decision, or verification store exists.
- Release and channel tests prove that the core collaboration loop has no enterprise channel command dependency, Kernel routing remains sticky → intent → default, authoritative sticky selection comes only from a DSH projection, Enterprise WeChat is the first later adapter, and personal WeChat state-changing intents are rejected before command execution.
- Outbox tests prove one stable persisted `operationId` identifies one logical DSH dispatch, provider idempotency keys are used only when supported, and unsupported or ambiguous provider outcomes become visible `unknown-outcome` records requiring reconciliation rather than exactly-once claims.
- Client tests cover keyboard use, responsive Team Room reading order, Human and Agent roster distinction, secret redaction, task DAG list equivalence, evidence-linked verification, urgent-item visibility, compatible-only batching, and partial batch failure.
- Keyless Session snapshots pin model-visible Team charter, scoped grants, Agent Lead responsibilities, Doer–Verifier separation, escalation packets, and the negative guarantees for channels and irreversible decisions.
- Recovery tests interrupt launch, projection, Agent execution, verification, batch decisions, and outbox dispatch at each durable edge and prove that DSH does not duplicate actors, tasks, decisions, or logical operation ids; ambiguous external effects remain unknown until reconciled.

## Risks

Cross-Run queries are eventually consistent with multiple Session logs, so the UI must expose freshness and revalidate every mutation without making normal attention review noisy.

A unified roster can imply equal authority when Humans and Agents intentionally have different decision rights. Actor type, current role, grant scope, and decision owner must remain explicit without turning the roster into a credentials screen.

Detailed grants and verification policy can overwhelm launch. Definitions need safe organization defaults and progressive disclosure, but a compact UI must not hide the exact Agent, task type, capability, expiry, or irreversible-action rule.

Human attention batching can increase throughput while making consent less specific. Compatibility checks, consequence previews, one event per Run, and clear partial failure are required even when they add interaction cost.

The current experimental Agent Teams roster models Agents only and its task events do not carry every Human, verification, grant, artifact, or decision field in this proposal. Implementation must extend event ownership deliberately and preserve existing replay semantics rather than infer the missing records from UI or PostgreSQL.

Providers without idempotency-key support can apply an external effect before a timeout hides the result. Preventing blind retry reduces accidental duplication but introduces operational reconciliation and may leave the TeamRun blocked until a Human or provider query resolves the outcome.
