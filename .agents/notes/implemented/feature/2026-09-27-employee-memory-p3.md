# Agent Note: Employee memory consolidation and project distillation

Status: implemented

English | [中文](2026-09-27-employee-memory-p3.zh.md)

## Problem

Enterprise memory only flowed in. Every approved row lived forever at its initial importance: duplicates accumulated unchecked, conflicts were never resolved, nothing decayed, and no compartment ever produced a summary of itself. A closing project threw its lessons away — the project compartment was readable by members and nothing else, so the experience a project accumulated evaporated at archival instead of feeding the organization. Announcement intake proposed the raw truncated announcement text straight into the review queue, leaving the administrator to do the extraction by hand.

## Decision

Consolidation is a per-compartment pass over approved memory, run by a host-level interval (`consolidationIntervalMs`, `0` disables) plus the administrator trigger `POST /enterprise/consolidation/run`. The structure pass supersedes duplicate groups onto their latest member, rewrites every surviving entry's importance to its decayed weight in one batch, and retires entries whose decayed importance falls below the floor after the grace period.

Conflicts resolve through supersede chains, not rewrites: the superseded row turns `retired` with `invalidated_by` pointing at its survivor, so history replays and nothing approved is ever edited in place. The decay batch deliberately never advances the anchor clock — an entry neither recalled nor touched re-applies its full anchor age every run and compounds below the half-life curve until retirement. That compounding is the design, not a bug: one clock (`lastAccessAt`) serves both decay and the retirement staleness test, staleness has to win, and advancing the anchor per run would reset the staleness test every run and disable retirement outright. Recall is what resets both the clock and the decay for memory in active use.

Each shared compartment keeps one live digest: a `kind: 'summary'` row the refinement model writes from the surviving entries. The digest passes the scope-aware privacy classification before any persistence and activates immediately — consolidation is the authority over `summary` rows — and supersedes the previous digest. L4 reflection distills approved agent notes with enough remaining importance into `business-fact` proposals that enter the ordinary human review queue; privacy-blocked reflections drop. Project archival closes the loop: `distillProject` distills the project's approved compartment into at most five lesson proposals for the organization scope, each privacy-classified, each waiting for administrator review — the archive response never waits on distillation. Announcement intake extracts durable knowledge through the refinement model with the same strict-JSON contract and falls back to the exact pre-P3 truncated proposal when the model is unavailable or fails. The `memory_write` project scope writes member lessons straight into the project compartment approved, under the same shared-compartment privacy policy — membership is the review.

## Alternatives considered

**Merge duplicates in place.** Rewriting the surviving row and deleting the rest is smaller, but it destroys which statement was stated first and by whom, and an approved row would be edited without a human. The supersede chain keeps the audit trail replayable.

**Advance the decay anchor on every run.** Writing `lastAccessAt` alongside the decayed weight gives the exact half-life trajectory, but it resets the retirement staleness test every run and nothing ever retires. The anchor stays a pure function of recall.

**Push digests and distilled lessons through review.** Every consolidation output could land as `proposed`. Digests summarize rows a human already approved, so review would only re-read the same content every cycle; consolidation owns `summary` rows and approves them itself, while every statement-shaped output (reflections, distilled lessons) stays behind human review.

**Auto-apply distilled project lessons.** A closing project could write its lessons straight into organization memory. Shared memory outlives the project and speaks in the organization's voice, so the lessons enter the review queue like any other shared proposal.

**Adopt pgvector semantic dedupe now.** Embedding-based similarity would catch paraphrases the token Jaccard threshold misses, at the cost of an embedding store and a model dependency in the consolidation path; the upgrade stays deferred behind the same `EnterpriseIdentityStore` interface.

## Consequences

The organization now converges: duplicates collapse onto one survivor, stale knowledge retires itself, and each shared compartment carries one current summary. The compounding decay makes untouched memory fade faster than the half-life curve — deployments that want long-lived memory must recall it or raise `halfLifeDays` and `retireGraceDays`. The interval is guarded per compartment in-process, so enabling it on more than one host is unsafe by construction, and an enabled interval demands the `service:` consolidation actor plus a provider/model route, validated loud at load. Department-target reflections and lessons stay unavailable because no mounted service resolves a writer's department; they count as failures rather than guesses. Regenerating a digest an administrator rejected fails loud on the deterministic id conflict instead of masquerading as `unchanged`.

## Testing

The acceptance chain runs keyless through public APIs over the real SQLite identity repository: a project-anchored member session writes three lessons through `memory_write` (the near-duplicate pair lands, the email-bearing one is refused by the shared privacy policy), the project archives and refuses further writes, distillation proposes the near-duplicate lesson pair for organization review with the service actor and audit record, an administrator approves, and a new unanchored session of the same organization recalls both lessons under `[Organization memory]` — after which one consolidation run supersedes the duplicate, halves the pinned importance of a 30-day-old entry, retires a stale below-threshold entry, and replaces the previous digest, and the superseded duplicate leaves recall. Package tests cover the pure planning logic, both stores' lineage and importance-batch support, the runtime passes with their skips and failure recording, distillation's structured skips, announcement extraction with its fallback, and the controller endpoints. The recorded-session snapshot for the changed model-visible behavior is owner-local: this environment had no `DEEPSEEK_API_KEY` and the enterprise composition needs its PostgreSQL environment, so the owner records it with `DSH_SNAPSHOT=record` once the key and the enterprise environment are available, following the P1 convention.

## Deferred

Team and group compartments are deferred a third time: the P3 spec items name shared and project compartments only, and group/team digests need cross-run membership semantics this iteration did not design. The pgvector upgrade stays behind the store interface. `validFrom` gained a column and reads but no write path yet. Announcement intake does not reconcile its extracted proposals against previously approved rows beyond the deterministic-id skip, so a re-announced fact can still queue a near-duplicate for review.
