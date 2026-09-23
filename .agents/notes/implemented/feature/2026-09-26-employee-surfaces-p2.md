# Agent Note: Employee collaboration surfaces

Status: implemented

English | [中文](2026-09-26-employee-surfaces-p2.zh.md)

## Problem

The P0 digital employee could hold only one kind of conversation: a private (user, employee) dm channel. There were no group, channel, or project forms, so a team could not share one surface, an operations channel could not partition conversations or absorb announcements, and project-scoped knowledge had no governance entity or recall path. The channel-routing kernel built in P0 had zero consumers, and P1's memory recall covered organization, department, and private compartments but left the project scope with no writers and no readers.

## Decision

Employees now share collaboration surfaces in three new forms, all stored in the enterprise identity SQLite schema v8 `surfaces` table and served by `@deepseek-ai/dsh-enterprise-surface`, with an enterprise-controller HTTP boundary and workbench projection.

**Groups run in two tiers.** A federated group (no charter) routes each message to the @-mentioned member employees — explicit ids first, then display-name tokens — and steers each one's durable per-employee group session, keyed by the `surface_sessions` (surface, employee) binding; delivery never touches `employee_inbox`, which stays dm-specific. A chartered group (carrying a `teamDefinitionId`) treats the TeamRun root session as the Lead's coordination surface: delivery resolves the team's active run or starts one through the idempotent `startRun` with `source: 'channel'` and a per-message idempotency key (`surfaceId:originUserId:messageId`), then submits the text through the runtime's `submitRunInput`, which lands it in the run root as a `team-run-message`.

**Channels partition and absorb.** Interactive channels carry a topic policy (`thread`, `command`, `lane`) and route every message by @-mention first, then to the head of the surface's static duty roster; each topic owns exactly one durable session anchored by its first routed employee. `/done` settles a topic twice over — the `channel_topics` row and a `/done` marker steered into the topic's session — so the settle is auditable in both traces. Ingest-only channels never open a turn: each announcement becomes one proposed organization-scope memory through the identity store's `proposeMemory`, gated by the scope-aware privacy inspection and dropped as a structured result when it cannot be proposed.

**Projects are a governance entity.** `@deepseek-ai/dsh-enterprise-project` persists org-scoped, member-gated project spaces in PostgreSQL (`projects` plus explicit `project_members`), exposed as `ctx.enterpriseProjects`: visibility orders only listings, while `requireMember` — the gate every consumer path runs — folds unknown ids, other organizations, and non-members into one `undefined` that leaks no existence; `archive` is terminal. Creation reuses the `team.manage` authorization action and the creator role; group and channel surfaces can carry a `projectId` reference.

**Memory recall gains the L3 project compartment.** `resolveSessionActor` resolves a session through every surface anchor — the dm pair, a group session's employee, or a channel topic's project alone — and the assemble listener fetches approved project memory only after `requireMember` confirms the session actor's membership against the surface's `projectId`. Project entries render under `[Project memory]` last and merge after the shared and private lists, so exact ranking ties keep fetch order (shared, pair, agent, project). A non-member session on the same project surface, a session without a principal identity, and an unmounted project service all resolve no compartment instead of an error.

## Deferred deviations (D1–D5)

D1: chartered team delivery bypasses `employee_inbox` — the run root is the Lead's coordination surface, so inbox semantics stay dm-owned. D2: channel duty is a static surface-level roster; schedules integration (time-window rotation) waits for an organization-level schedule query API, which the schedules package does not expose. D3: team and group memory compartments (cross-run memory) wait for P3 consolidation. D4: ingest-only intake proposes the truncated announcement text directly; LLM announcement extraction waits for P3. D5: the channel inbound route accepts an already-normalized envelope authenticated by a deployment token (`x-dsh-channel-token`, 503 when unconfigured); WeCom crypto-callback wiring is deployment evidence, and the wecom test infrastructure's forged encrypted payloads remain available for that integration.

## Smaller recorded choices

`archive(projectId, byUserId)` records the requesting actor for the caller's audit trail while the store keeps only the archival time. Surfaces are conversation channels, so the controller reuses existing authorization actions (`channel.read`, `employee.execute`, `employee.create`) instead of new ones, and projects reuse `team.read`/`team.manage`; the union gains no surface- or project-specific members. Shared-memory proposals still cannot be attributed back to the originating employee (the P1 limitation stands). A project member-roster GET endpoint is deferred; membership is observable through `listMembers` in-process.

## Alternatives considered

**Route chartered messages through the Lead employee's inbox.** Reusing the dm inbox would have kept one delivery mechanism, but the run root already is the Lead's working surface, and routing through an inbox would add a second queue, lose the run idempotency key, and deliver into a session that is not the run's. Direct run submission keeps one input path per run. (D1)

**Derive duty from schedules.** A time-window rotation would express duty as data the schedules package owns, but that package has no organization-level schedule definition or query API — building one is a new mechanism, not a wiring change. The static roster ships the routing shape and leaves rotation to the integration. (D2)

**Make announcements open a conversation.** Letting an ingest-only channel summarize announcements with an LLM turn would give richer memory entries, but it would spend model calls on every broadcast and put unreviewed synthesis into shared memory; direct proposing keeps a human review queue as the control point. (D4)

**Accept raw webhook payloads on the inbound route.** Signing and decrypting inside the controller would couple the enterprise boundary to one transport's cryptography; the normalized-envelope contract keeps the controller testable with plain requests and leaves the transport bridge as deployment evidence. (D5)

**Grant project recall by listing visibility.** Visibility already orders project listings, so reusing it for memory recall would save the membership check — and would leak project rows to every user who can list an 'organization'-visibility project. Membership is the access decision, so recall gates on `requireMember`, matching the HTTP detail route.

## Testing

The P2 acceptance suite drives the composed chains through the controller boundary: one chartered group message runs from the HTTP envelope through `startRun` (`source: 'channel'`, idempotent by per-message key, retried envelope reuses the run) into the run root's recorded log, and a decision flows back through `respondDecision` to answered — the Lead→Doer→Verifier internals behind the run root stay in the team-runtime suite. Channel envelopes over the token-authenticated inbound route cover the mention and duty routes into anchored topic sessions plus the `/done` dual trace (store row and session marker), and an ingest-only announcement lands as one proposed organization row in the real identity store. Project recall is covered for member, non-member, unanchored, and unmounted-service sessions over the real identity repository and the real `EmployeeAccountService`. Package suites cover the store schema and migrations, both surface delivery tiers, the runtime `submitRunInput` contract, the project service authorization matrix, the controller endpoints, and the workbench slice; the PostgreSQL integration suite keeps its skip convention.

## Consequences

A deployment can now run all five interaction forms — dm, federated group, chartered group, channel, and project space — and every model-visible input they introduce (`surface-message`, `team-run-message`) is reconstructable from session logs. The security properties are structural: private and project memory enter only through explicit-scope fetches gated on the session actor, and the run-input seam refuses terminal runs. Costs: the duty roster is static until the schedules integration lands, cross-run team memory waits for P3, and the recorded-session snapshot for the new model-visible message sources is owner-local — this environment had no `DEEPSEEK_API_KEY` and the enterprise composition needs its PostgreSQL environment; the owner records it with `DSH_SNAPSHOT=record` once the key and the enterprise environment (per `apps/cli/config/enterprise.cordis.patch.yml`) are available, and reviews the full diff before commit.

## Deferred

Schedules-backed duty rotation (D2), team and group memory compartments with P3 consolidation (D3), LLM announcement extraction (D4), the WeCom crypto-callback deployment wiring (D5), the project member-roster GET endpoint, and shared-proposal attribution to the originating employee.
