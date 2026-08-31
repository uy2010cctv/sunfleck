# Human–Agent team operating model (proposal)

English | [中文](human-agent-teams.zh.md)

This page describes a proposed enterprise collaboration model, not an executable quickstart. DSH does not currently ship the complete Team Definition, Human roster, trust-grant editor, Team Room, cross-Run attention queue, or enterprise channel command surface described here. Users should not expect those controls in the current Web UI.

## Proposal status

The proposal preserves DSH runtime ownership instead of adding another Team engine. PostgreSQL would persist reusable Team Definitions; the existing experimental `TeamService` and each root Session event log would own one TeamRun's actor roster, task DAG, mailbox, decisions, verification, and handoff state.

The current experimental [Agent Teams subsystem](../../subsystems/agent-team.md) provides an Agent-only roster, task DAG, and mailbox in a source-checkout profile. It does not provide the proposed Human actor records, Team Definition lifecycle, scoped trust grants, decision queue, verifier records, or channel integration. A manually organized Session is not equivalent to the proposed TeamRun contract.

## Proposed lifecycle

### 1. Charter and definition

A future Team Definition would record a Human-owned North Star, success evidence, non-goals, constraints, decision rights, stop conditions, review cadence, one Agent Lead, and Human and Agent role templates. PostgreSQL would be the persistent authority for that reusable version.

Autonomy would be scoped by Agent, task type, and capability instead of one global label. Each Agent would use an independent service identity and Credential references rather than a Human browser or channel credential.

### 2. Launch

A future launch would snapshot one exact Team Definition version, Workspace, Run-specific North Star, participating actors, effective grants, verification policy, and decision policy into a DSH root Session before Agent work begins. Later definition edits would not change an active Run implicitly.

The same `TeamService` domain would record both Human and Agent members for that Run. A Human member would have an enterprise user identity without a Session; an Agent member would bind a Session and Employee Release. The enterprise layer would not maintain a second roster.

### 3. Coordination and verification

The Agent Lead would decompose the North Star into a dependency-aware task DAG, assign Doers and independent Verifiers where policy requires separation, coordinate the existing Team mailbox, and assemble evidence. Humans would retain goals, value judgments, autonomy changes, policy exceptions, and irreversible decisions.

A Doer completion and a Verifier decision would remain separate runtime events. Evidence would distinguish source changes, focused tests, builds or packages, authenticated behavior, persisted business state, deployment, provider delivery, and final business outcome rather than treating one as proof of another.

### 4. Human decisions and handoff

Decision requests would contain a recommendation, alternatives, consequences, deadline, downstream blockers, authorization requirement, and bounded evidence packet. A cross-Run attention projection would group only compatible decisions and would revalidate every mutation against the owning root Session.

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

## Channel and delivery proposal

The first delivery phase would contain only the authenticated DSH core collaboration loop. A later phase would start enterprise channel integration with Enterprise WeChat, then reuse the same DSH adapter protocol for Feishu and DingTalk. Personal WeChat would remain notification and Human-takeover transport only.

The current Channel Kernel routing decision remains `stickyEmployeeId` → inferred intent → binding default. The Kernel and adapter do not persist an authoritative selection; future enterprise composition must derive `stickyEmployeeId` from a DSH-owned binding or Session projection. That integration is a migration target, not a current capability.

Each future channel or outbox operation would persist one stable `operationId`. DSH would not dispatch a second logical operation for the same id. External de-duplication would be guaranteed only when the provider supports an idempotency key; an unsupported provider or timeout with an ambiguous result would create a visible unknown outcome and reconciliation task, not an exactly-once claim.

## Continue

- [Use the currently shipped Web UI](./index.md)
- [Inspect the current experimental Agent Teams runtime](../../subsystems/agent-team.md)
- [Read the proposed architecture decision](../../../.agents/notes/proposed/architecture/2026-08-31-human-agent-team-control-plane.md)
