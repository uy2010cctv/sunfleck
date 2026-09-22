---
description: "Enterprise conversation-surface registry and inbound delivery between channel users and persistent employees, carrying an authenticated dm message into an employee's anchored session."
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-surface

English | [中文](README.zh.md)

## Summary

`dsh-enterprise-surface` owns the durable conversation surfaces between enterprise channel users and persistent employees and delivers each authenticated inbound message into the employee's anchored session. It exposes the `ctx.surfaces` Cordis service over the employee store of `@deepseek-ai/dsh-enterprise-identity` and the `ctx.employeeAccounts` service: `ensureDm` returns the one direct-message surface for a (user, employee) pair and creates its anchored session at most once, `deliverToEmployee` enqueues the message, claims it in durable order, and steers it into the session as a user message, and `stickyEmployee` resolves the employee an actor key is bound to. Choose it when an ingress bridge needs one place that binds channel identity to employees and guarantees a message either lands in the session log or is marked failed. All SQL stays in the employee store; the composing plugin supplies the migrated database handle and the agent-host services the anchored sessions run on.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when an ingress bridge turns authenticated channel messages into employee work. The bridge resolves or ensures the dm surface, then calls `deliverToEmployee` with the origin actor and message text.

### When to choose it

Choose this package when the same process already hosts the employee's agent runtime: delivery steers a live anchored session, so a composition without in-process agents cannot deliver. Surface and inbox durability lives in the enterprise identity database, so compositions persisting enterprise data in PostgreSQL through `@deepseek-ai/dsh-enterprise-postgres` need a PostgreSQL-backed implementation first.

### Minimal configuration

| Field | Default | Meaning |
|---|---|---|
| `database` | required | Migrated enterprise identity database backing surface and inbox rows |
| `defaultAgentPreset` | required | Agent preset composed into every anchored session this registry creates |

The service reads `ctx.employeeAccounts`, `ctx.agents`, `ctx.agentDefaultModel`, `ctx.agentPresets`, `ctx.sessionTitle`, `ctx.sessions`, and `ctx.workspaceRegistry`, declared in `inject`. `ensureDm` refuses an unknown employee and an employee from another organization; `deliverToEmployee` re-checks the surface-employee organization pairing, and marks the claimed inbox item failed before rethrowing when the message does not land in the session log.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

`DmSurfaceRegistry` is a thin coordinator over three authorities: the employee store owns the durable `surfaces` and `employee_inbox` rows, `ctx.employeeAccounts` owns account facts and inbox queueing, and the anchored session log owns message durability. `ensureDm` mints the surface row through the store's idempotent `ensureSurface` (`UNIQUE(user_id, employee_id)`), creates the anchored session through the same shape as the webhook session runtime — workspace from the employee's `homeWorkspacePath`, session title from the employee display name, header meta `agentPreset` and `cwd`, creation-time model selection pinned until the first durable request header — and attaches the session id to the surface row only after creation succeeds, so a failed attempt is retried by the next call. `deliverToEmployee` claims rows with `claim(employeeId, 1)` in creation order until the row this call enqueued is delivered, submits each as steering input (a running session consumes it at the nearest step boundary, an idle one opens a turn), then flushes the session and accepts the landing when the log records the message — appended or still in the durable inbox. Any failure on a claimed row calls the store's `failInboxItem` and rethrows to the caller.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config`, `inject`, `apply`, service provision, and the public re-exports |
| [`src/types.ts`](src/types.ts) | Domain types, the `EnterpriseSurfaces` interface, the `surface-message` source declaration, and the `ctx.surfaces` key declaration |
| [`src/dm.ts`](src/dm.ts) | `DmSurfaceRegistry`: surface idempotency, anchored-session creation, and ordered inbox delivery |
| — | No runtime invariant companion is published. The registry has one authority: every durable observation is either a row written through the employee store's SQL or an event in the anchored session's own log, so no independent observation can diverge ([package invariant rules](../../AGENTS.md)). |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough.

- [Employee account](../employee-account/README.md) — the `ctx.employeeAccounts` service this registry reads accounts, sticky bindings, and the inbox queue through.
- [Enterprise identity](../../identity/enterprise-identity/README.md) — the store module whose `ensureSurface`, `attachSurfaceSession`, and `failInboxItem` this registry calls directly.
- [Webhook session runtime](../../webhook/webhook/README.md) — the session-creation shape the anchored session follows.

-----

<a id="model-experience"></a>
## Model Experience

### Inbound dm delivery

#### What the model sees

One user-role message per delivered inbox item, carrying the payload text; its `surface-message` source records the surface, the inbox item id, and the origin actor on the durable log. The registry registers no prompt section or tool schema of its own, and the anchored session's prompt comes from the configured agent preset.

#### Token effect

The delivered payload text enters the employee's conversation once per message, plus the source framing the session records for it.

#### KV Cache effect

Each delivery extends the session tail; it never rewrites the cached prefix.

## Known Limitations and Deferred Work

These limits define when this registry is a poor fit or needs composing support.

- **P0 ships the dm kind only** — the surface kind union is closed at `'dm'`; group channels and other kinds wait on demand.
- **`defaultAgentPreset` is explicit configuration** — P0 resolves the preset from the config field; release-to-profile resolution belongs to the catalog release flow and is deferred.
- **Delivery needs the anchored session live in-process** — the registry looks the session up through `ctx.agents` and fails loud when it is not live; cold resume of anchored sessions after a restart is deferred.
- **Delivery is claim-once** — a message that does not land durably is marked failed and reported to the caller; redelivery policy belongs to a composing flow.
- **One in-process writer** — surface creation and claim-then-fail are check-then-act pairs over a single connection, atomic only under the current single-connection usage ([defensive patterns](../../../docs/defensive-patterns.md)).
- **Channel wiring is deployment evidence** — an authenticated ingress such as WeCom is not part of this package; readiness is expressed by composing this registry behind a bridge that owns transport authentication.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

- The plan-shaped synchronous signatures became `Promise<Surface>` and `Promise<InboxItemId>`: session creation (`ctx.agents.create`, `ctx.workspaceRegistry.create`, `ctx.agentPresets.resolve`) and the durable-landing flush are asynchronous, and `deliverToEmployee` must hand delivery failures back to its caller.
- Provenance (`originSurface`, `originActor`) rides the merge-extensible `MessageSourceMap` (`surface-message` kind) — the webhook template's provenance channel — because `SessionHeader` has no free-form meta field; `agentPreset` is recorded through the supported header meta field.
- The registry claims employee-scoped rows (`claim(employeeId, 1)`) and delivers them to the surface's anchored session until its own row is delivered; P0 employees carry one dm surface, and multi-surface employees need per-surface claiming when they arrive.
- Tests mount the fake agent host through `ctx.provide` over a real `Context`, mirroring `packages/experimental/enterprise-team-runtime/tests/runtime.spec.ts`; the fake session appends synchronously so the landing check runs against real event shapes.

</details>
