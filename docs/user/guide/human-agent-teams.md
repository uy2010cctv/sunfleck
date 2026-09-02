# Human–Agent team operating model (proposal)

English | [中文](human-agent-teams.zh.md)

This page describes the complete target operating model. The source-checkout enterprise profile now stores typed Team Definitions, starts real TeamRuns on the Agent Teams Session log, projects Human and Agent roster entries, opens the root Session as a Team Room, exposes a cross-Run Human decision queue, and provides governed Channel Settings. Human task ownership, a trust-grant editor, version-aware capability-asset assembly, and live enterprise channel delivery remain proposed.

## Proposal status

The implementation preserves DSH runtime ownership instead of adding another Team engine. PostgreSQL persists reusable Team Definitions and query projections; the experimental `TeamService` and each root Session event log own one TeamRun's actor roster, task DAG, mailbox, decisions, verification, and handoff state.

The current experimental [Agent Teams subsystem](../../subsystems/agent-team.md) provides durable Human and Agent roster projection, an Agent-owned task DAG, mailbox, TeamRun state, and Human decisions in the source-checkout enterprise profile. PostgreSQL provides Team Definition, TeamRun/decision query projections, explicit autonomy grants, and administrator-managed channel configurations. Verifier records, Human task ownership, and provider delivery integration are not complete.

## Proposed lifecycle

### 1. Charter and definition

A future Team Definition would record a Human-owned North Star, success evidence, non-goals, constraints, decision rights, stop conditions, review cadence, one Agent Lead, and Human and Agent role templates. PostgreSQL would be the persistent authority for that reusable version.

Autonomy would be scoped by Agent, task type, and capability instead of one global label. Each Agent would use an independent service identity and Credential references rather than a Human browser or channel credential.

### 2. Launch in the source-checkout enterprise profile

Open **Teams**, select an active charter, choose a Workspace, and enter the Run objective. Launch snapshots the exact Team Definition revision, roster, Workspace, effective policy, and immutable employee Release identities before Agent work begins. Later definition edits do not change an active Run implicitly.

The same `TeamService` domain records both Human and Agent members for that Run. A Human member has an enterprise user identity without a Session; an Agent member binds a Session and Employee Release. Open **Team Room** to enter the root Session and inspect its Agent Teams roster and task projection.

### 3. Coordination and verification

The Agent Lead would decompose the North Star into a dependency-aware task DAG, assign Doers and independent Verifiers where policy requires separation, coordinate the existing Team mailbox, and assemble evidence. Humans would retain goals, value judgments, autonomy changes, policy exceptions, and irreversible decisions.

A Doer completion and a Verifier decision would remain separate runtime events. Evidence would distinguish source changes, focused tests, builds or packages, authenticated behavior, persisted business state, deployment, provider delivery, and final business outcome rather than treating one as proof of another.

### 4. Human decisions and handoff

Runtime decision requests carry their question, options, recommendation, assignee, context digest, revision, and root Session event position. Open **Needs my attention** to answer assigned decisions; every response is revalidated against the owning root Session before its PostgreSQL projection changes.

A handoff would be a recorded Human or Agent actor transition inside the same TeamRun. Personal WeChat could notify a Human and link to authenticated DSH, but it could not settle the decision or mutate Team state.

### 5. Review and grant evolution

A retrospective would compare the charter with recorded evidence, inspect Human interruptions and unresolved concerns, and review each scoped grant. Repeated evidence could justify a later Human-approved grant change, but no Agent or automated score would widen autonomy.

Reusable business knowledge would enter organization or department memory only through its governed review path. Raw conversations, personal preferences, credentials, and one-off speculation would remain outside shared memory.

## Proposed trust levels

The model uses four trust levels, each constrained by Agent, task type, and capability:

- `observe` reads authorized context and evidence without mutating work or external systems.
- `propose` produces a recommendation, draft, plan, or decision request without executing the proposed mutation.
- `execute-reviewed` executes within scope but cannot advance dependent work until the required review accepts the result.
- `execute-delegated` executes pre-authorized reversible work within scope; irreversible actions and policy exceptions still require Human approval.

## Channel settings and delivery boundary

Open **Channels** in the enterprise workbench to create, edit, activate, pause, or archive Enterprise WeChat, Feishu, DingTalk, and personal WeChat configurations. Each record stores provider/account identity, an optional tenant, a Host-managed Credential reference, a default employee Release route, inbound policy, lifecycle state, and revision. The page never asks for or displays the secret value.

Personal WeChat is always outbound-only. Enterprise providers may enable inbound commands, but identity binding and DSH authorization still decide whether an individual intent is accepted. Saved or active configuration does not prove delivery: transport remains **unverified** until provider adapters record receipts or health evidence.

The current Channel Kernel routing decision remains `stickyEmployeeId` → inferred intent → binding default. The Kernel and adapter do not persist an authoritative selection; future enterprise composition must derive `stickyEmployeeId` from a DSH-owned binding or Session projection. That integration is a migration target, not a current capability.

Future provider delivery still requires durable inbox/outbox records, stable `operationId` values, leases, retries, receipts, heartbeat evidence, and reconciliation. External de-duplication can only be guaranteed when the provider supports an idempotency key; an unsupported provider or timeout with an ambiguous result must create a visible unknown outcome and reconciliation task, not an exactly-once claim.

## Continue

- [Use the currently shipped Web UI](./index.md)
- [Inspect the current experimental Agent Teams runtime](../../subsystems/agent-team.md)
- [Read the proposed architecture decision](../../../.agents/notes/proposed/architecture/2026-08-31-human-agent-team-control-plane.md)
