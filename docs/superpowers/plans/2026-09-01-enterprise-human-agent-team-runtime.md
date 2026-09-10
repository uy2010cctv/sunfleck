# Enterprise Human-Agent Team Runtime Implementation Plan

English | [中文](2026-09-01-enterprise-human-agent-team-runtime.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect enterprise TeamRun control to the existing Session-backed Agent Teams runtime with immutable employee releases, first-class human roster rows, idempotent decisions, restart recovery, and enterprise-only composition.

**Architecture:** Extend the experimental Agent Teams event log and fold instead of creating another task, mailbox, or runtime store. A private experimental enterprise adapter resolves PostgreSQL-backed Workspace and Release records, creates or resumes the root Agent and continuable teammates, and implements `EnterpriseTeamRuntimeDriver`; the enterprise overlay loads this adapter before the enterprise controller. PostgreSQL TeamRun rows remain query projections while the root Session log is authoritative.

**Tech Stack:** TypeScript, Cordis, DSH Session/Agent/Subagent services, PostgreSQL enterprise repositories, Vitest, pnpm 11.7.0, Node 22.23.2.

---

### Task 1: Extend the Agent Teams durable domain

**Files:**
- Modify: `packages/experimental/agent-team/src/types.ts`
- Modify: `packages/experimental/agent-team/src/projection.ts`
- Modify: `packages/experimental/agent-team/src/index.ts`
- Modify: `packages/experimental/agent-team/src/roster.ts`
- Test: `packages/experimental/agent-team/tests/projection-events.spec.ts`
- Test: `packages/experimental/agent-team/tests/team.spec.ts`

- [ ] Write failing replay tests for legacy agent-member events, human and agent roster projection, run state revisions and operation idempotency, decision CAS/idempotency, and cold fold output.
- [ ] Run `pnpm exec vitest run packages/experimental/agent-team/tests/projection-events.spec.ts packages/experimental/agent-team/tests/team.spec.ts` and confirm failures name missing TeamRun/Human/Decision behavior.
- [ ] Add versioned `team/run`, `team/human-member`, and `team/decision` events; retain the existing `team/member` payload as a backwards-compatible agent record with optional enterprise release metadata.
- [ ] Add Team service methods that mutate root Session state under the existing Team journal serializer and expose run/decision metadata through `TeamView`; do not authorize Human callers through agent-only methods.
- [ ] Re-run the focused tests and retain green output.

### Task 2: Carry immutable employee composition into continuable teammates

**Files:**
- Modify: `packages/experimental/agent-team/src/types.ts`
- Modify: `packages/experimental/agent-team/src/roster.ts`
- Test: `packages/experimental/agent-team/tests/team.spec.ts`

- [ ] Write a failing test showing `SpawnTeammateRequest` forwards `agentOptions`, `persona`, and `toolFilter`, and persists `employeeReleaseId` plus `roleId` without a human principal or credential carrier.
- [ ] Run the focused Team test and confirm the captured continuable request lacks the fields.
- [ ] Forward the already-supported Subagent request fields and retain release identity in the durable member snapshot.
- [ ] Re-run the focused Team test and baseline Team suite.

### Task 3: Add exact release lookup and detached request execution

**Files:**
- Modify: `packages/catalog/enterprise-catalog/src/repository.ts`
- Modify: `packages/identity/enterprise-auth-web/src/request-context.ts`
- Test: `packages/catalog/enterprise-catalog/tests/repository.spec.ts`
- Test: `packages/identity/enterprise-auth-web/tests/request-context.spec.ts`

- [ ] Write failing tests for organization-fenced `getRelease(releaseId, orgId)` and `withoutPrincipal()` AsyncLocalStorage execution.
- [ ] Run both focused tests and confirm the methods are absent.
- [ ] Implement digest-verifying release lookup and request-context exit without exposing a replacement principal.
- [ ] Re-run both focused tests.

### Task 4: Implement the enterprise runtime driver

**Files:**
- Create: `packages/experimental/enterprise-team-runtime/package.json`
- Create: `packages/experimental/enterprise-team-runtime/tsconfig.json`
- Create: `packages/experimental/enterprise-team-runtime/tsdown.config.ts`
- Create: `packages/experimental/enterprise-team-runtime/src/index.ts`
- Create: `packages/experimental/enterprise-team-runtime/src/invariant.ts`
- Test: `packages/experimental/enterprise-team-runtime/tests/runtime.spec.ts`

- [ ] Write failing real-composition tests for deterministic root identity, authorized Workspace resolution, immutable release pinning, human roster, leader and teammate creation, start idempotency, unsupported bindings, unknown/cross-org releases, partial-spawn cleanup, cancel quiescence, decision response/wakeup, cold reconcile, replay after restart, and no principal inheritance.
- [ ] Run the new package test and confirm failures are caused by the absent driver.
- [ ] Implement the Cordis provider for `ctx.enterpriseTeamRuntimeDriver`, resolving release snapshots and configured model routes, mounting the pinned preset plus immutable persona, rejecting unsupported capability bindings, binding the root Session to the actor and real Workspace, and keeping owned root handles until disposal.
- [ ] Implement restart-safe root resume, authoritative run/decision mutation, teammate drain, deterministic errors, and fold-only reconciliation.
- [ ] Re-run the package test until green.

### Task 5: Compose only the enterprise profile and require the driver

**Files:**
- Modify: `apps/cli/config/enterprise.cordis.patch.yml`
- Modify: `apps/cli/package.json`
- Modify: `packages/api/enterprise-controller/src/index.ts`
- Test: `packages/bundle/web-app/tests/enterprise-workbench-composition.spec.ts`
- Test: `packages/api/enterprise-controller/tests/team-control-controller.spec.ts`

- [ ] Write failing composition tests that require Agent Teams core/tool/client and the runtime adapter before the controller while leaving the ordinary Web bundle unchanged.
- [ ] Write a failing controller test showing missing runtime injection fails at composition rather than returning a fake available runtime.
- [ ] Insert enterprise-only rows and dependencies in order; make TeamRun and Decision controllers require the runtime service.
- [ ] Re-run composition and controller tests.

### Task 6: Document exact capability and limitations

**Files:**
- Modify: `packages/experimental/agent-team/README.md`
- Modify: `packages/experimental/agent-team/README.zh.md`
- Modify: `docs/subsystems/agent-team.md`
- Modify: `docs/subsystems/agent-team.zh.md`
- Create: `packages/experimental/enterprise-team-runtime/README.md`
- Create: `packages/experimental/enterprise-team-runtime/README.zh.md`
- Create: `packages/experimental/enterprise-team-runtime/README.i18n.yaml`
- Create: `.agents/notes/implemented/feature/2026-09-01-enterprise-human-agent-team-runtime.md`
- Create: `.agents/notes/implemented/feature/2026-09-01-enterprise-human-agent-team-runtime.zh.md`
- Create: `.agents/notes/implemented/feature/2026-09-01-enterprise-human-agent-team-runtime.i18n.yaml`

- [ ] Document root Session authority, immutable release metadata, Human control-only access, unsupported release bindings, shared checkout, and the current Agent-only task-owner limitation.
- [ ] Keep experimental/release boundaries explicit and do not claim promotion.
- [ ] Update translation pairing records with the repository generator.

### Task 7: Generate, verify, self-review, and commit

- [ ] Run focused package tests and existing Agent Teams, enterprise operations, and controller baselines.
- [ ] Run typecheck/build for touched packages plus Cordis catalog generation and documentation pairing gates.
- [ ] Inspect `git diff`, run `git diff --check`, verify no generated or unrelated residue, and review every requirement against this plan.
- [ ] Create one commit containing the complete implementation and report the exact SHA, RED/GREEN commands, and any honest limitations.
