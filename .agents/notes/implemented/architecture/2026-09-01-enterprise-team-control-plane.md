# Agent Note: Enterprise team control plane

Status: implemented

English | [中文](2026-09-01-enterprise-team-control-plane.zh.md)

## Problem

Enterprise team definitions can authorize a fixed roster, but starting work directly against an experimental Agent Teams API would couple stable enterprise policy, browser requests, and PostgreSQL to one private runtime. Persisting HTTP-side state changes as though the database and root Session event log committed atomically would also create two competing runtime authorities.

## Decision

`EnterpriseTeamControlService` owns the stable Host flow for TeamRun, TeamDecision, and explicit autonomy grants. Browser requests omit organization, actor, root Session, runtime revision, and event sequence fields. Host request context supplies the principal, central RBAC checks `team.execute`, `team.decision.respond`, and `team.autonomy.manage`, and Workspace admission reuses Session-creation authorization.

`EnterpriseTeamRuntimeDriver` is the only runtime dependency. Start, cancel, decision response, and reconciliation receive stable operation IDs. The driver owns appending authoritative facts to the root Session event log. PostgreSQL `team_runs` and `team_decisions` records carry runtime revision and source event sequence only as query projections; unknown driver outcomes remain reconcilable instead of being presented as atomic commits. Start idempotency is resolved before audit and before allocating a run id; the repository lock calls the allocator only for the winning insert, and every successful or repeated audit names the persisted run id. A repeated `starting` reservation first reconciles the stable start operation, then replays the idempotent driver call when the authoritative event is still absent; this recovers crashes both before the driver call and after its commit but before projection.

Each start attempt settles exactly one audit event. Rejections before reservation address the team definition and correlate with the stable start idempotency operation; outcomes after reservation address the persisted TeamRun and retain the team id and definition revision as safe details. The audit decision records authorization only: RBAC, visibility, Workspace, idempotency, and definition-admission rejection are denied, while an authorized active, pending, deterministic-failure, or unknown runtime outcome remains allowed. Runtime state is recorded separately as `details.outcome`: `starting`, `waiting-human`, and `verifying` map to `runtime-pending`; `failed` maps to `runtime-failed`; active, completed, and cancelled retain their state names. Unknown driver outcome records `runtime-unknown` and leaves the run `starting` for reconciliation. TeamDecision and autonomy audit adapters preserve their own resource types, identities, and admission reasons instead of reclassifying every event from the Remote endpoint.

Start reservation acquires the same global team lock as definition save/archive, rereads the active expected revision, and freezes the complete definition and roster from that locked row. Definition edits do not change an existing run. Schema v12 backfills a full snapshot only when the current definition revision and roster match the legacy reservation; an unmatched legacy `starting` run becomes terminal `failed` with `legacy-definition-snapshot-unavailable`, while all terminal or already-running legacy rows receive a non-replayable non-null legacy snapshot before the column becomes `NOT NULL`. Runtime-emitted decisions enter PostgreSQL only through the Host projection method; browser code cannot create them. An answer is admitted only for the assigned human, team owner, or administrator. A short per-decision transaction reserves one operation id, request digest, and idempotency key before releasing the connection and calling the driver; retries replay that operation, while a different key cannot reach the driver. Run and decision projection treat an identical runtime revision and canonical payload as a no-op and reject divergent same-revision payload; a run never changes an established root Session id, and an answer event must strictly increase decision runtime revision. Autonomy writes are limited to the team owner and administrators; composite grant locking serializes different request keys, and save/revoke canonicalize task and capability keys identically.

Autonomy grants are human-authored records keyed by team, immutable employee release, task type, and capability scope. Only a rostered Agent release can receive a grant. Evidence references are canonical, revocation is terminal, and runtime code has no grant-write method, so observed success cannot promote autonomy. Run, decision, and grant queries join the current definition and apply the minimal viewer/admin visibility scope before limit; signed cursors bind that scope with organization and filters.

The concrete Agent Teams adapter and enterprise workbench consume this control plane through the driver and generated Remote namespaces; they remain separate packages with separate runtime and UI ownership. Channel integration is not part of this control plane.

## Alternatives considered

**Make PostgreSQL the TeamRun engine.** Rejected because the root Session log already owns runtime facts and replay; another lifecycle engine would diverge under partial failure.

**Call experimental Agent Teams packages from enterprise controllers.** Rejected because stable enterprise contracts must survive runtime replacement and must not take a dependency on private UI or experimental package types.

**Infer autonomy from successful runs.** Rejected because execution authority is a human governance decision and requires an attributable grant or revocation record.

## Consequences

- Enterprise policy, idempotency, audit, visibility, and query pagination remain stable while runtime implementations can change behind one driver.
- Unknown network outcomes require reconciliation and may leave a visible `starting` or pre-cancellation projection temporarily.
- The source-checkout enterprise profile supplies a private Agent Teams adapter plus Team launch, Room entry, and Human-decision UI; external channel delivery remains separate.

## Verification

Focused tests cover start success, idempotency and operation-ID reuse, stale and inactive definitions, visibility, Workspace denial, deterministic and unknown driver outcomes, reconciliation, immutable roster snapshots, cancellation, decision ingestion and response authority, autonomy validation and terminal revocation, organization scoping, signed pagination, Remote principal injection, audit calls, schema migration, the optional real-PostgreSQL path, and the workbench launch, Room, and decision surfaces.
