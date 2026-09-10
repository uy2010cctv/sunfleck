# Agent Auto Memory Implementation Plan

English | [中文](2026-08-28-agent-auto-memory.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a DSH Agent autonomously evaluate durable business knowledge, save it into the current enterprise or department scope, and make it immediately available to subsequent Agents.

**Architecture:** Extend `@deepseek-ai/dsh-enterprise-memory-context`, which already resolves the current Workspace grant and injects approved memory. Register one model-facing tool that derives scope only from the calling Agent's Workspace, writes through the authoritative identity repository, auto-approves with a fixed system review reason, and appends a masked audit event. Use a deterministic content digest and memory id for idempotency; privacy inspection and repository validation remain mandatory.

**Tech Stack:** TypeScript, Cordis, DSH ToolRuntime/SystemPrompt, Schemastery, SQLite/PostgreSQL enterprise identity adapters, Vitest.

---

### Task 1: Auto-memory contract tests

**Files:**
- Modify: `packages/context/enterprise-memory-context/tests/context.spec.ts`
- Test: `packages/context/enterprise-memory-context/tests/context.spec.ts`

- [ ] Write failing tests that register `remember_business_knowledge`, execute it with an owning Agent, and assert an approved memory plus an audit record.
- [ ] Add failure cases for missing Agent/cwd, a department outside the current Workspace, ambiguous personal-Workspace department membership, privacy findings, and a disabled organization scope.
- [ ] Add an idempotency test: the same scope, kind, and normalized summary returns the same memory id and produces one approved memory.
- [ ] Run `pnpm exec vitest run packages/context/enterprise-memory-context/tests/context.spec.ts`; expect failures because the tool and config do not exist.

### Task 2: Model-facing tool and scope resolver

**Files:**
- Modify: `packages/context/enterprise-memory-context/src/index.ts`
- Modify: `packages/context/enterprise-memory-context/package.json`
- Modify: `packages/context/enterprise-memory-context/tsconfig.json`

- [ ] Extend plugin config with `autoSave`, `actorUserId`, and `allowOrganizationScope`.
- [ ] Register `remember_business_knowledge` with `scope`, `kind`, and `summary` parameters.
- [ ] Resolve organization from `workspaceGrantByRootPath(agent.session.header.cwd)`; derive department only from the department grant or the personal-Workspace owner's primary/sole department.
- [ ] Compute `memorySourceDigest(JSON.stringify([orgId, scope, departmentId, kind, normalizedSummary]))` and use `agent-memory-<digest>` as the stable id.
- [ ] Reuse an existing approved record, auto-approve an existing proposed record, and reject a matching rejected/retired record.
- [ ] For a new record, call `proposeMemory`, then `reviewMemory` with fixed reason `Agent 自动评估并直接启用`, then append an audit record without raw conversation text.
- [ ] Add a SystemPrompt section instructing the Agent to evaluate only durable, reusable, non-personal business facts and call the tool autonomously without asking the user.
- [ ] Run the focused tests and make them pass.

### Task 3: Enterprise composition and governance projection

**Files:**
- Modify: `apps/cli/config/enterprise.cordis.patch.yml`
- Modify: `packages/client/ui-enterprise-governance/src/client/EnterpriseGovernanceSurface.tsx`
- Modify: `packages/client/ui-enterprise-governance/src/client/governance.module.css`
- Modify: `packages/client/ui-enterprise-governance/tests/surface.client.spec.tsx`

- [ ] Enable auto-save with `actorUserId: bootstrap-admin` and organization scope in the enterprise profile.
- [ ] Mark auto-approved memories in the governance UI using their fixed review reason, while retaining scope, type, and audit evidence.
- [ ] Add a UI regression that explains Agent auto-evaluation and immediate effect without implying that privacy checks are bypassed.
- [ ] Run enterprise-memory and governance tests.

### Task 4: Release verification

**Files:**
- Verify all files above.

- [ ] Run focused package tests, type checks, Cordis catalog verification, and the full repository build.
- [ ] Restart `dsh web` on port 3081 while preserving the enterprise PostgreSQL environment.
- [ ] Verify the tool appears in the assembled enterprise Agent schema and the memory page identifies auto-approved entries.
- [ ] Commit the implementation with a scoped conventional commit.
