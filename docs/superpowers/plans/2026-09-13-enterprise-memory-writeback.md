# Enterprise Memory Writeback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn completed employee conversations into durable, deduplicated enterprise or department memory without requiring the main Agent to remember to call a write tool.

**Architecture:** At `agent/turn-stopping`, capture only the current direct user text and final assistant text into a PostgreSQL outbox before allowing the turn to close. A detached worker uses the completed turn's actual model route to extract zero or more strict memory candidates, checks existing active and pending memory in the same organization/scope, then records `skip`, auto-activated `create`, or pending `conflict`. Queue state, bounded snapshots, attempts, next retry time, and result remain durable across restart; extraction never injects a synthetic user message or blocks the next turn after enqueue.

**Tech Stack:** TypeScript, Cordis events, DSH LLM runtime, PostgreSQL, enterprise identity repository, Vitest, React governance UI.

---

### Task 1: Durable writeback outbox

**Files:**
- Create: `packages/context/enterprise-memory-context/src/writeback-repository.ts`
- Modify: `packages/identity/enterprise-identity-postgres/src/schema.ts`
- Test: `packages/context/enterprise-memory-context/tests/writeback-repository.spec.ts`

- [ ] **Step 1: Write the failing repository tests** for enqueue idempotency by `sessionId:turn`, same-session ordering, lease recovery, bounded retry state, completed-result retention, and snapshot removal after success.
- [ ] **Step 2: Run** `node node_modules/vitest/vitest.mjs run packages/context/enterprise-memory-context/tests/writeback-repository.spec.ts` and confirm failure because the repository does not exist.
- [ ] **Step 3: Implement** `EnterpriseMemoryWritebackRepository` over the existing enterprise PostgreSQL database. Store `source_key`, organization/workspace/department/actor/session/turn, provider/model, bounded user/assistant snapshot, state, attempts, lease owner/expiry, next attempt, error, and result JSON. Use advisory locks and `FOR UPDATE SKIP LOCKED`; never store credentials or raw tool results.
- [ ] **Step 4: Run the focused test and package typecheck** until they pass.

### Task 2: Turn snapshot and strict extraction

**Files:**
- Create: `packages/context/enterprise-memory-context/src/writeback-extraction.ts`
- Test: `packages/context/enterprise-memory-context/tests/writeback-extraction.spec.ts`

- [ ] **Step 1: Write failing tests** proving the snapshot contains only direct user messages and the final assistant message for one completed turn; skips empty/aborted/error turns; applies independent user/assistant bounds; rejects malformed model JSON, secrets, unsupported kinds/scopes, and low-confidence guesses.
- [ ] **Step 2: Run the test** and confirm the missing extractor failure.
- [ ] **Step 3: Implement** a pure snapshot function and a one-shot LLM extractor. The output is `{ candidates: [{ action: 'skip'|'create'|'conflict', scope, kind, summary, confidence, reason }] }`. The system policy admits only durable reusable business facts, processes, terminology, and confirmed decisions; it excludes task status, personal data, raw customer content, credentials, and ephemeral output.
- [ ] **Step 4: Run focused tests and typecheck** until they pass.

### Task 3: Background worker and memory reconciliation

**Files:**
- Create: `packages/context/enterprise-memory-context/src/writeback-worker.ts`
- Modify: `packages/context/enterprise-memory-context/src/index.ts`
- Test: `packages/context/enterprise-memory-context/tests/writeback-worker.spec.ts`
- Test: `packages/context/enterprise-memory-context/tests/auto-memory.spec.ts`

- [ ] **Step 1: Write failing tests** for durable enqueue before turn close, asynchronous processing, exact duplicate skip, compatible new memory activation, contradiction pending confirmation, retry backoff, restart recovery, actor/workspace isolation, and revoked/disabled actor failure.
- [ ] **Step 2: Run tests** and confirm failure because no post-turn writeback listener or worker exists.
- [ ] **Step 3: Implement** `agent/turn-stopping` enqueue plus a detached worker. Re-read the session owner and workspace grant at execution time. Compare with approved and proposed memories in the same scope. Exact normalized duplicates skip; conflicting statements remain proposed; high-confidence non-conflicting candidates activate using the existing review API and write an audit event. Reuse `sessionId:turn:candidateDigest` for idempotency.
- [ ] **Step 4: Run all enterprise-memory tests and typecheck** until they pass.

### Task 4: Operations UI and deployment proof

**Files:**
- Modify: `packages/client/ui-enterprise-governance/src/client/EnterpriseGovernanceSurface.tsx`
- Modify: `packages/client/ui-enterprise-governance/src/client/governance.module.css`
- Modify: `packages/client/ui-enterprise-governance/src/client/locales.ts`
- Modify: `packages/identity/enterprise-auth-web/src/http.ts`
- Test: `packages/client/ui-enterprise-governance/tests/surface.client.spec.tsx`
- Test: `packages/identity/enterprise-auth-web/tests/http.spec.ts`
- Modify: `packages/context/enterprise-memory-context/README.md`

- [ ] **Step 1: Write failing UI/API tests** for writeback counts, recent queued/running/completed/failed jobs, per-job retry, and clear provenance (`conversation`, session/turn, automatic vs pending conflict) without exposing raw snapshots.
- [ ] **Step 2: Implement** read/status/retry endpoints and a compact “自动沉淀” area above active memories. Normal completed/skip states stay quiet; failures and conflicts are visually prominent and actionable.
- [ ] **Step 3: Run 49 existing memory/governance tests plus new writeback tests, targeted TypeScript build, source lint, and Impeccable detector.**
- [ ] **Step 4: Deploy only after the active 47 task is complete.** Back up changed modules, verify archive SHA-256, restart, create one disposable enterprise-memory E2E conversation, wait for its durable outbox result, restart again, and verify the resulting memory and conversation still load. Remove only the disposable test memory through the normal retire flow.

---

Self-review: the plan covers completed-turn capture, independent extraction, durable queue/retry, deduplication/conflict handling, enterprise scope, provenance, UI operations, and cold restart proof. It deliberately defers full Markdown knowledge documents, arbitrary file notes, remote client tokens, and vector recall because enterprise memory currently owns concise governed business statements rather than a general document knowledge base.
