# Agent Note: Employee memory across sessions

Status: implemented

English | [中文](2026-09-24-employee-memory-p1.zh.md)

## Problem

A call-bound digital employee forgot everything between sessions: each conversation restarted from its SOP and skill bindings alone, so private working experience had nowhere to persist. The memory injection that did exist fetched every approved organization and department row in one owner-unfiltered listing and rendered it as a flat, unlabeled list in fetch order. The writeback pipeline could land knowledge only in the two shared tracks, so an employee's personal working style either had to pollute shared memory or be dropped.

## Decision

Enterprise memory now has five compartments — `organization`, `department`, `project`, `agent`, `pair` — stored as scope values of the single `enterprise_memories` table in both identity stores (SQLite schema v7, PostgreSQL v6). `agent` rows carry a non-null `agent_employee_id` and `pair` rows a non-null `pair_user_id`, enforced by paired CHECK constraints in both schemas.

## Private writes and scope-aware privacy

`writePrivateMemory` writes `agent` and `pair` entries directly in the approved state with digest idempotency; private memory never passes through review. Privacy classification is scope-aware: prompt injection and over-long summaries block every compartment, while a personal-preference finding blocks only shared compartments. The writeback worker downgrades a shared-target candidate carrying that finding into the actor's own agent compartment instead of dropping it, so a personal preference is retained privately and never enters shared memory.

## Recall injection

The `system-prompt/assemble` listener injects approved memory as one `<enterprise-memory>` context block. Organization and department compartments keep their legacy owner-filter-free visibility; the `agent` and `pair` compartments are fetched only for a session anchored to an employee, each with an explicit scope and the session's own owner, so a foreign private row cannot enter by construction. Entries render under compartment labels (`[Organization memory]`, `[Department memory]`, `[My notes]`, `[Collaboration preference]`), rank by keyword hits, importance, and recency, fit the `maxEntries`/`maxChars` budget by rank, and touch `last_access_at` on injection.

## Memory tools

Five model-visible tools cover the store: `memory_search`, `memory_read`, `memory_write` (agent compartment only), `memory_retire` (own agent and pair rows only), and `promote_proposal` (organization or department, into administrator review). Actor resolution chains the authenticated request principal, the surface-anchored employee, and the workspace grant: the anchored triple comes from the session's direct-message surface row through `EmployeeAccountService.resolveSessionActor`, and the workspace grant of the session's cwd supplies the organization and departments. `promote_proposal` answers a personal preference with the structured result `{ proposed: false, reason: 'personal-preference' }` instead of a tool error. Tool calls are session-log events through the existing `tool/call` recording, so everything model-visible is reconstructable from the log.

## Governance

The enterprise controller exposes employee memory to administrators: list one employee's memories, review a proposal (approve or reject with revision conflict detection), and retire an approved entry. The workbench employee detail renders the memory view with the proposal queue, and its locale dictionaries own all client copy.

## Alternatives considered

**One table per compartment.** Separate tables would duplicate the digest-idempotency rule, the review state machine, and the recall fetch per compartment. Same-table scopes keep one pipeline; the paired CHECK constraints carry the per-compartment ownership rules.

**Keep the flat unfiltered injection.** Fetching every approved shared row without labels or ranking is simpler, but it cannot tell the model which statements are the employee's own notes, and extending it to private compartments would leak one employee's rows into another's context. Labeled, authorization-filtered compartments preserve the shared behavior and make private recall safe.

**Auto-approve promoted proposals.** Promotion could mirror auto-save and activate immediately. Shared memory outlives the employee and attributes statements to the organization, so the administrator review queue stays the control point.

**Resolve the employee from the session cwd.** The plan initially derived the anchored employee from `homeWorkspacePath` matching. The shipped resolution reads the surface row instead, because the surface already binds the organization, user, and employee to the live session, while a cwd match would re-derive attribution and break for employees sharing one home workspace root.

## Testing

The cross-session acceptance test drives the real chain through public APIs: session A writes an agent note via `memory_write` over a real `EmployeeAccountService` and surface row, a new session B assembles and sees the note under `[My notes]`, `promote_proposal` from session B lands a proposed organization row that `reviewMemory` approves, and the approved row appears in the next assembly under `[Organization memory]`. Package tests cover both store implementations, scope-aware privacy, writeback routing, recall filtering and rendering, every tool's success and failure paths, and the governance endpoints and workbench slice. The PostgreSQL integration suite keeps its existing skip convention.

## Consequences

Employees now keep private experience across sessions, and shared promotion feeds an operational administrator queue. The security property of private recall lives in the fetch shape — explicit scope plus owner per private listing — not in filters on the shared listing, so new shared fetchers must keep that shape. Recall ranking is lexical plus recency; importance writes default to 0 and no repository API mutates it yet. The recorded-session snapshot for the new model-visible tools is owner-local: this environment had no `DEEPSEEK_API_KEY` and the enterprise composition needs its PostgreSQL environment, and a scenario directory must not be committed without its recorded session JSONL because the corpus policy rejects a scenario that owns no selected Session role. The owner records it with `DSH_SNAPSHOT=record` once the key and the enterprise environment (per `apps/cli/config/enterprise.cordis.patch.yml`, which mounts this plugin) are available, and reviews the full diff before commit.

## Deferred

Project-compartment writers (the scope is CHECK-ready but nothing writes it), consolidation with decay and importance mutation, a pgvector upgrade behind the same `EnterpriseIdentityStore` interface, web client tool cards for the five memory tools, and attributing an approved shared proposal back to the originating employee.
