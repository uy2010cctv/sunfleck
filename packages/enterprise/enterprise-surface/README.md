---
description: "Enterprise conversation-surface registry and inbound delivery between channel users and persistent employees, groups, or channels, carrying an authenticated message into anchored sessions, a chartered team run, or organization memory."
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-surface

English | [中文](README.zh.md)

## Summary

`dsh-enterprise-surface` owns durable conversation surfaces between enterprise users and persistent employees and delivers authenticated inbound messages into the anchored sessions that serve them. It exposes `ctx.surfaces`: `ensureDm` returns the one dm surface per user-employee pair with its session, and `deliverToEmployee` steers each enqueued message into that session; `ensureGroupSurface` and `deliverToGroup` route a group message to @-mentioned members' group sessions or into a chartered team's active run; `ensureChannelSurface` and `deliverToChannel` route channel messages by topic, mention, and duty roster, settle on `/done`, or propose ingest-only announcements into organization memory. The composing plugin supplies the migrated database, the preset, and agent-host services.

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

Mount this plugin when an ingress bridge turns authenticated channel messages into employee work. The bridge resolves or ensures the surface, then calls `deliverToEmployee` with the origin actor and message text, `deliverToGroup` with the originating user and text, or `deliverToChannel` with the originating user, text, optionally the mentioned employees and the topic id pinned from a previous routed result.

### When to choose it

Choose this package when the same process already hosts the employee's agent runtime: delivery steers a live anchored session, so a composition without in-process agents cannot deliver. Surface and inbox durability lives in the enterprise identity database, so compositions persisting enterprise data in PostgreSQL through `@deepseek-ai/dsh-enterprise-postgres` need a PostgreSQL-backed implementation first.

### Minimal configuration

| Field | Default | Meaning |
|---|---|---|
| `database` | required | Migrated enterprise identity database backing surface and inbox rows |
| `defaultAgentPreset` | required | Agent preset composed into every anchored session this registry creates |

The service reads `ctx.employeeAccounts`, `ctx.agents`, `ctx.agentDefaultModel`, `ctx.agentPresets`, `ctx.sessionTitle`, `ctx.sessions`, and `ctx.workspaceRegistry`, declared in `inject`. Team-mode groups additionally read `enterpriseTeamControl` and `enterpriseTeamRuntimeDriver` lazily by name; both are optional, and an unmounted team plane returns a structured `team-runtime-unavailable` result instead of failing load. Ingest-only channels read the `enterprisePostgres` identity store lazily by name; when it is unmounted, announcements return a structured `memory-unavailable` result. `ensureDm` refuses an unknown employee and an employee from another organization; `deliverToEmployee` re-checks the surface-employee organization pairing, and marks the claimed inbox item failed before rethrowing when the message does not land in the session log.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

`DmSurfaceRegistry` is a thin coordinator over three authorities: the employee store owns the durable `surfaces` and `employee_inbox` rows, `ctx.employeeAccounts` owns account facts and inbox queueing, and the anchored session log owns message durability. `ensureDm` mints the surface row through the store's idempotent `ensureSurface` (`UNIQUE(user_id, employee_id)`), creates the anchored session through the same shape as the webhook session runtime — workspace from the employee's `homeWorkspacePath`, session title from the employee display name, header meta `agentPreset` and `cwd`, creation-time model selection pinned until the first durable request header — and attaches the session id to the surface row only after creation succeeds, so a failed attempt is retried by the next call. `deliverToEmployee` claims rows with `claim(employeeId, 1)` in creation order until the row this call enqueued is delivered, submits each as steering input (a running session consumes it at the nearest step boundary, an idle one opens a turn), then flushes the session and accepts the landing when the log records the message — appended, or still pending in the spliced-inbox projection (a cancellation splice un-lands it). Concurrent deliveries for one employee serialize on a promise chain, so claims stay in queued order and each message lands in its own surface's session; concurrent `ensureDm` calls for one pair share one session creation. Any failure on a claimed row calls the store's `failInboxItem` and rethrows to the caller.

Group delivery adds a second mode. `ensureGroupSurface` keys the surface by external key or id, validates every member employee against the organization, and stores the member set through the store's replace-all member API — no session is created at ensure time. Federated groups route the message to the explicitly mentioned members, or to the members whose display name appears as an @-token (case-insensitive), and steer each one's per-employee group session (`surface_sessions` bindings, created lazily on first mention) directly: group delivery never enqueues employee inbox rows, which stay dm-specific. Per-member failures are captured on their targets while the rest of the batch lands. Chartered groups (`teamDefinitionId` present) submit the text into the team's active run through the runtime driver's `submitRunInput`, starting one run with `source: 'channel'` and the stable idempotency key `<surface id>:<origin user>` when none is active.

Channel delivery adds the third mode. `ensureChannelSurface` keys the surface like a group, validates members and duty employees against the organization, and stores both policies, the deduplicated duty roster, and the member set. On interactive (`mention_duty`) channels, `deliverToChannel` resolves the message's topic by policy — `/topic 标题` creates a commanded topic, `thread` auto-creates one titled by the message's first 40 characters when the transport pins none, `lane` routes into the one surface-wide topic — routes to the @-mentioned members or the duty roster head, and steers the topic's one session: the session anchors to the first routed employee's home workspace, is created at most once per topic under a per-topic serialization tail (the store row carries the `session_id`, so `topicBySession` resolves it), and later contributors attribute through their message's `originActor`. `/done` settles the addressed open topic and steers a settle marker into its live session, so the store row and the session log both record the settle; terminal topics answer `already-settled`. On ingest-only channels no session exists: with an extraction route configured (`announcementExtractionProvider` and `announcementExtractionModel`) and the `llm` service mounted, the announcement is distilled into at most three organization-scope memory proposals whose deterministic ids converge repeats, while privacy-blocked candidates are counted in the delivered result instead of proposed; every other case falls back to the exact pre-extraction behavior — the privacy-gated, truncated announcement becomes one organization-scope memory proposal — with `invalid-text` drops, `privacy-gated` drops, and `intake-failed` errors as structured results.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config`, `inject`, `apply`, service provision, and the public re-exports |
| [`src/types.ts`](src/types.ts) | Domain types, the `EnterpriseSurfaces` interface, the `surface-message` source declaration, and the `ctx.surfaces` key declaration |
| [`src/dm.ts`](src/dm.ts) | dm surface idempotency, anchored-session creation, ordered inbox delivery, and the shared per-key serialization tail |
| [`src/group.ts`](src/group.ts) | `GroupSurfaceRegistry`: group surfaces, federated member routing, and chartered-team submission |
| [`src/channel.ts`](src/channel.ts) | `ChannelSurfaceRegistry`: channel surfaces, topic partitioning and `/topic`–`/done` commands, mention-and-duty routing, and announcement intake |
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

One user-role message per delivered inbox item or steered group mention, carrying the payload text; its `surface-message` source records the surface and the origin actor on the durable log, plus the inbox item id for dm deliveries and the channel topic id for routed channel deliveries. A chartered-team submission reaches the run's Lead as one user message whose `team-run-message` source records the run, the origin surface, and the actor. Ingest-only channel messages reach no model at all — they become memory proposals reviewed through the governance flow. The registry registers no prompt section or tool schema of its own, and the anchored session's prompt comes from the configured agent preset.

#### Token effect

The delivered payload text enters the employee's conversation once per message, plus the source framing the session records for it.

#### KV Cache effect

Each delivery extends the session tail; it never rewrites the cached prefix.

## Known Limitations and Deferred Work

These limits define when this registry is a poor fit or needs composing support.

- **Topic continuity is transport-owned** — the registry resolves topics from the `topicId` the transport pins from a previous routed result; per-actor conversation-state tracking inside a channel is deferred to the channel kernel.
- **Announcement intake needs the PostgreSQL identity store** — ingest-only channels read `enterprisePostgres` lazily; a SQLite-only composition answers every announcement with a structured `memory-unavailable` result instead of proposing.
- **`defaultAgentPreset` is explicit configuration** — P0 resolves the preset from the config field; release-to-profile resolution belongs to the catalog release flow and is deferred.
- **Anchored sessions resolve no permission preset** — the registry records only the agent preset, so permission grants come from the preset's own configuration; per-surface permission presets are deferred.
- **Delivery needs the anchored session live in-process** — the registry looks the session up through `ctx.agents` and fails loud when it is not live; cold resume of anchored sessions after a restart is deferred.
- **Delivery is claim-once** — a message that does not land durably is marked failed and reported to the caller; redelivery policy belongs to a composing flow.
- **Suspended employees with a live session still accept delivery** — the claim-once inbox model defers dormancy, not suspension; blocking delivery for suspended employees is deferred.
- **One in-process writer** — surface creation and claim-then-fail are check-then-act pairs over a single connection, atomic only under the current single-connection usage ([defensive patterns](../../../docs/defensive-patterns.md)).
- **Channel wiring is deployment evidence** — an authenticated ingress such as WeCom is not part of this package; readiness is expressed by composing this registry behind a bridge that owns transport authentication.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

- Group routing rules: explicit mentioned ids win only when they name members; otherwise @-token display-name matches (case-insensitive, trailing punctuation trimmed) route; no match is a structured `no-target`, never a throw. Team control failures come back as structured results so a controller can map them to a 200.
- Channel contracts: the `/done` topic comes from the input's `topicId` only (missing or foreign ids are structured `no-topic` results); topic sessions anchor to the first routed employee and later contributors attribute via `originActor`; the per-topic tail makes concurrent first messages share one session, re-reading the stored `session_id` inside the tail; the settle marker is best-effort — the store row settles first and marker failures only warn.
- The plan-shaped synchronous signatures became `Promise<Surface>` and `Promise<InboxItemId>`: session creation (`ctx.agents.create`, `ctx.workspaceRegistry.create`, `ctx.agentPresets.resolve`) and the durable-landing flush are asynchronous, and `deliverToEmployee` must hand delivery failures back to its caller.
- Provenance (`originSurface`, `originActor`) rides the merge-extensible `MessageSourceMap` (`surface-message` kind) — the webhook template's provenance channel — because `SessionHeader` has no free-form meta field; `agentPreset` is recorded through the supported header meta field.
- The registry claims employee-scoped rows (`claim(employeeId, 1)`) and delivers them to the surface's anchored session until its own row is delivered; P0 employees carry one dm surface, and multi-surface employees need per-surface claiming when they arrive.
- Tests mount the fake agent host through `ctx.provide` over a real `Context`, mirroring `packages/experimental/enterprise-team-runtime/tests/runtime.spec.ts`; the fake session appends synchronously so the landing check runs against real event shapes.

</details>
