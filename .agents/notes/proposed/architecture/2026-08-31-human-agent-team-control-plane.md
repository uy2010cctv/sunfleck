# Agent Note: Human–Agent team definition and run control plane

Status: proposed

English | [中文](2026-08-31-human-agent-team-control-plane.zh.md)

## Problem

DSH already owns durable Sessions, Workspaces, Employee Releases, approvals, subagent lifecycles, and Session events. The experimental Agent Teams capability adds an implicit-root Agent roster, durable task DAG, and mailbox over a Lead Session. It does not define reusable enterprise Team templates, Human roster membership, Human decision ownership, scoped autonomy progression, or one cross-Run queue for Human attention.

Adding those concerns directly to a channel, a PostgreSQL task database, or a second orchestration engine would create competing answers for who is on the Team, whether a task or approval changed, and which evidence authorized an irreversible action. Treating the Human as an external reviewer would also omit Human instructions and decisions from the same actor and audit model used for Agent work.

## Proposal

This proposal adds an enterprise control projection around DSH rather than another execution engine. It extends, and does not supersede, the current [Agent Teams runtime decision](../../implemented/feature/2026-08-05-agent-teams.md) or its [experimental package boundary](../../implemented/architecture/2026-08-18-experimental-agent-teams-packages.md). The existing roster, task, mailbox, continuation, and Session-log folds remain the execution foundation; this proposal supplies reusable definitions, Human actors, grants, decision records, and cross-Run views.

### Team Definition and TeamRun

`TeamDefinition` is a reusable, versioned enterprise definition stored in PostgreSQL. It contains the Human-authored charter, Human and Agent role templates, one Agent Lead, required Employee Release and Credential references, task-type policy, Doer–Verifier separation rules, capability grants, review cadence, stop conditions, and channel notification policy. Saving or revising a definition creates no Session, Team task, mailbox message, or approval.

`TeamRun` is one execution of an exact Team Definition version. Its durable identity is the DSH root `SessionId`; PostgreSQL stores a query projection keyed by that same identity rather than allocating a second run authority. Launch records the definition version, Run-specific North Star, Workspace, active roster, effective grants, and decision policy in the root Session before the Agent Lead begins decomposition.

The Team Definition may change while a Run is active, but the Run retains its launched version and explicit amendments. A Human-authorized amendment appends a Session event and updates the projection; editing a reusable definition never mutates an active Run implicitly.

### State ownership and projection

The root DSH Session log is the sole source of runtime truth for Team membership materialized for that Run, task and mailbox state, Human instructions and decisions, Agent actions, approvals, verification, artifacts, and channel delivery evidence. Session replay must reconstruct the Run without PostgreSQL. Session event order and identity remain the audit order and correlation source.

PostgreSQL owns reusable Team Definitions, search indexes, organization policy references, and rebuildable cross-Run query projections such as `Needs my attention`. A projection cursor records the last applied Session event. Projection lag may make a list stale but may never authorize an action; every mutation reloads and authorizes against the DSH owner before appending a Session event.

Existing DSH authorities remain unchanged: Workspace owns the business-space and filesystem boundary, Employee Release selects immutable published Agent composition, Approval owns interactive authorization, Subagent and experimental Agent Teams own child execution and coordination, Credential owns secret material, and SessionEvent owns audit and replay. PostgreSQL does not copy credential values or raw conversation content into Team definitions or query rows.

### Human and Agent actors

`HumanActor` and `AgentActor` are first-class roster variants with stable organization identities, display metadata, roles, and Run participation. Human events identify the authenticated enterprise principal and the authorization path. Agent events identify the Employee Release, live Session actor, service identity, and effective grant. A channel alias may resolve to a Human principal but is never itself the authorizing actor.

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

Enterprise WeChat is the first enterprise adapter; Feishu and DingTalk follow the same interface. An adapter authenticates its transport account, maps an intent to a DSH command, submits it under the resolved Human principal, and renders the resulting DSH projection or delivery receipt. It owns transport retry and provider acknowledgement only.

Personal WeChat is notification and Human-takeover transport only. It cannot issue a DSH command that creates, edits, assigns, completes, or approves a task; changes roster or grants; settles a decision; or modifies Team state. Its message directs the Human to the authenticated DSH surface.

No channel database or provider acknowledgement is a task, approval, roster, decision, or audit authority. Provider acceptance proves delivery to the provider, not Human receipt or a business result.

## Alternatives considered

**Store Team tasks and approvals primarily in PostgreSQL.** This would make Session replay incomplete and create dual-write ordering between the execution log and control database. PostgreSQL remains definition storage and a rebuildable query projection.

**Give each channel its own workflow state and synchronize later.** Reconciliation could not establish one authoritative decision when channels disagree or delivery retries reorder commands. Channels remain adapters to DSH commands and projections.

**Build a new enterprise task board and mailbox.** The existing experimental Agent Teams capability already owns durable task CAS, DAG validation, roster recovery, and mailbox delivery over the Lead Session. The enterprise layer reuses those mechanisms and adds Human and definition projections instead of duplicating them.

**Combine Team Definition and TeamRun.** Editing a reusable template would then risk changing active work, and every launch would overwrite history needed to explain its policy. Separate versioned definitions and Session-rooted Runs keep reuse and execution distinct.

**Represent Humans only as approvers outside the roster.** Human goals, instructions, availability, and decisions would become metadata around the Team rather than attributable work by a Team actor. Humans and Agents therefore share one roster with different authority.

**Assign one global autonomy level per Agent.** Trust demonstrated for one task type or capability would spill into unrelated work. Grants remain the intersection of Agent, task type, and capability scope.

**Let an Agent reuse the initiating Human's credentials.** Attribution, revocation, least privilege, and offboarding would become ambiguous. Every Agent uses an independent service identity and Credential references.

## Acceptance criteria

- Replaying one root Session from an empty projection reconstructs its launched definition version, effective Human and Agent roster, task DAG, mailbox state, decisions, approvals, verification, artifacts, and grant amendments without reading PostgreSQL runtime rows.
- Deleting and rebuilding PostgreSQL query projections from Session events produces the same cross-Run attention items and records a detectable lag cursor; a stale projection cannot authorize a mutation.
- Authorization tests cover each trust level and the full Agent × task type × capability intersection, including denial of self-escalation, grant transfer, Human credential reuse, Doer–Verifier conflict, and irreversible delegated execution.
- Team launch tests prove that one definition version can create independent Runs, later definition edits do not change them, and an explicit Human amendment is attributable and replayable.
- Existing experimental Agent Teams tests continue to own task CAS, DAG, roster, mailbox, recovery, and continuation behavior; enterprise composition tests prove that the control projection calls those owners rather than introducing another task or mailbox store.
- Channel tests prove that Enterprise WeChat commands append authorized DSH events, duplicates remain idempotent, provider receipts do not settle business state, and personal WeChat state-changing intents are rejected before command execution.
- Client tests cover keyboard use, responsive Team Room reading order, Human and Agent roster distinction, secret redaction, task DAG list equivalence, evidence-linked verification, urgent-item visibility, compatible-only batching, and partial batch failure.
- Keyless Session snapshots pin model-visible Team charter, scoped grants, Agent Lead responsibilities, Doer–Verifier separation, escalation packets, and the negative guarantees for channels and irreversible decisions.
- Recovery tests interrupt launch, projection, Agent execution, verification, and batch decision commits at each durable edge and prove that retries do not duplicate actors, tasks, decisions, or external mutations.

## Risks

Cross-Run queries are eventually consistent with multiple Session logs, so the UI must expose freshness and revalidate every mutation without making normal attention review noisy.

A unified roster can imply equal authority when Humans and Agents intentionally have different decision rights. Actor type, current role, grant scope, and decision owner must remain explicit without turning the roster into a credentials screen.

Detailed grants and verification policy can overwhelm launch. Definitions need safe organization defaults and progressive disclosure, but a compact UI must not hide the exact Agent, task type, capability, expiry, or irreversible-action rule.

Human attention batching can increase throughput while making consent less specific. Compatibility checks, consequence previews, one event per Run, and clear partial failure are required even when they add interaction cost.

The current experimental Agent Teams roster models Agents only and its task events do not carry every Human, verification, grant, artifact, or decision field in this proposal. Implementation must extend event ownership deliberately and preserve existing replay semantics rather than infer the missing records from UI or PostgreSQL.
