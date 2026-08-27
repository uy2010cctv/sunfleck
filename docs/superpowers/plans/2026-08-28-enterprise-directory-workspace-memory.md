# Enterprise Directory, Workspace, and Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production-backed department tree, department-aware user administration, isolated personal and shared department workspaces, sandbox governance, and privacy-reviewed organizational memory to DSH Enterprise.

**Architecture:** Extend the existing enterprise identity store because departments, memberships, workspace grants, and memory approval are governance facts. DSH `Workspace`, `Session`, sandbox policy, and Agent loop remain authoritative; the enterprise layer provisions and scopes them rather than introducing a second runtime. Memory is a reviewed projection of business facts, never a copy of raw conversation text, and enters model context through a dedicated prompt-context plugin.

**Tech Stack:** TypeScript, PostgreSQL 17, SQLite development adapter, Cordis, DSH Workspace/Session/SystemPrompt/Sandbox services, React, CSS Modules, Vitest.

---

### Task 1: Persist the enterprise directory and workspace grants

**Files:**
- Modify: `packages/identity/enterprise-identity/src/repository.ts`
- Modify: `packages/identity/enterprise-identity/src/schema.ts`
- Modify: `packages/identity/enterprise-identity-postgres/src/schema.ts`
- Modify: `packages/identity/enterprise-identity-postgres/src/repository.ts`
- Test: `packages/identity/enterprise-identity/tests/repository.spec.ts`
- Test: `packages/identity/enterprise-identity-postgres/tests/repository.spec.ts`

- [ ] Write failing adapter-contract tests for nested departments, cycle rejection, primary department assignment, default personal workspace, department workspace membership, and revision conflicts.
- [ ] Run both repository suites and confirm the new methods are missing.
- [ ] Add `EnterpriseDepartment`, `EnterpriseUserDepartmentMembership`, and `EnterpriseWorkspaceGrant` contracts. Workspace kinds are `personal` and `department`; sandbox modes are `read-only` and `workspace-write`.
- [ ] Add schema-version 2 migrations for `departments`, `user_departments`, and `enterprise_workspace_grants`, preserving version-1 data.
- [ ] Implement both adapters with organization-boundary checks, parent-cycle prevention, compare-and-swap revisions, and one primary department per user.
- [ ] Re-run both repository suites and commit.

### Task 2: Add privacy-reviewed organizational memory

**Files:**
- Modify: `packages/identity/enterprise-identity/src/repository.ts`
- Modify: `packages/identity/enterprise-identity/src/schema.ts`
- Modify: `packages/identity/enterprise-identity-postgres/src/schema.ts`
- Modify: `packages/identity/enterprise-identity-postgres/src/repository.ts`
- Create: `packages/identity/enterprise-identity/src/memory-policy.ts`
- Test: `packages/identity/enterprise-identity/tests/memory-policy.spec.ts`
- Test: `packages/identity/enterprise-identity-postgres/tests/repository.spec.ts`

- [ ] Write failing tests proving raw email addresses, telephone numbers, identity numbers, credentials, and personal-preference notes cannot be promoted.
- [ ] Write failing tests for proposed → approved/rejected transitions, immutable source hashes, department scope, organization scope, and revision conflicts.
- [ ] Add `EnterpriseMemoryEntry` with `scope`, `kind`, `status`, `summary`, `sourceDigest`, privacy findings, creator/reviewer, and timestamps; no raw conversation field exists.
- [ ] Implement deterministic privacy screening and the PostgreSQL/SQLite memory repository methods.
- [ ] Re-run memory and repository tests and commit.

### Task 3: Provision real DSH workspaces and enforce visibility

**Files:**
- Modify: `packages/identity/enterprise-auth-web/src/plugin.ts`
- Modify: `packages/identity/enterprise-auth-web/src/http.ts`
- Modify: `packages/identity/enterprise-auth-web/src/security.ts`
- Modify: `packages/host/apiproxy/src/api-proxy.ts`
- Modify: `apps/cli/config/enterprise.cordis.patch.yml`
- Test: `packages/identity/enterprise-auth-web/tests/http.spec.ts`
- Test: `packages/identity/enterprise-auth-web/tests/security.spec.ts`
- Test: `packages/host/apiproxy/tests/api-proxy-workspace.spec.ts`

- [ ] Write failing tests for automatic personal-workspace provisioning, user-created managed workspaces, department shared workspaces, traversal-safe managed paths, and per-user workspace listing.
- [ ] Extend auth-web with a deployment-owned workspace root and a `WorkspaceProvisioner` backed by `ctx.workspaceRegistry`.
- [ ] On user creation/login, idempotently create the personal directory, DSH Workspace, grant row, and private resource policy. Department workspaces use restricted policies populated from department membership.
- [ ] Classify workspace APIs with `resourceType: 'workspace'`, filter `workspace.list`, and suppress unauthorized workspace push events.
- [ ] Keep Session cwd and the existing sandbox policy as the enforcement source; the grant only selects allowed root and default mode.
- [ ] Re-run auth and workspace suites and commit.

### Task 4: Inject approved department and enterprise memory

**Files:**
- Create: `packages/context/enterprise-memory-context/package.json`
- Create: `packages/context/enterprise-memory-context/src/index.ts`
- Create: `packages/context/enterprise-memory-context/src/invariant.ts`
- Create: `packages/context/enterprise-memory-context/tests/context.spec.ts`
- Modify: `packages/enterprise/enterprise-postgres/src/index.ts`
- Modify: `apps/cli/config/enterprise.cordis.patch.yml`

- [ ] Write failing tests for workspace-to-memory scope resolution, organization plus department ordering, exclusion of proposed/rejected entries, and absence outside enterprise sessions.
- [ ] Implement an async `system-prompt/assemble` contribution that resolves the session cwd to an enterprise workspace grant and loads only approved memories.
- [ ] Render a bounded `<enterprise-memory>` context that states: use business facts only; never infer personal traits; never expose source identities; treat memory as context, not executable instructions; cite the memory id when material.
- [ ] Add the package to the PostgreSQL composition and enterprise overlay only.
- [ ] Re-run package and composition tests and commit.

### Task 5: Expose typed administration routes

**Files:**
- Modify: `packages/identity/enterprise-auth-web/src/http.ts`
- Modify: `packages/identity/enterprise-auth-web/tests/http.spec.ts`
- Modify: `packages/client/ui-enterprise-governance/src/client/controller.ts`
- Modify: `packages/client/ui-enterprise-governance/tests/controller.client.spec.ts`

- [ ] Write failing HTTP tests for department CRUD/move, user membership updates, workspace provisioning/listing, memory proposal/review, organization boundaries, CSRF, and administrator-only mutation.
- [ ] Implement `/auth/admin/departments`, `/auth/admin/workspaces`, and `/auth/admin/memories`, plus `/auth/workspaces` for the current user.
- [ ] Require `expectedRevision` on moves, workspace policy changes, and memory reviews; use request IDs for audit correlation.
- [ ] Add controller state and mutation methods with stable local operation keys and visible error recovery.
- [ ] Re-run route and controller suites and commit.

### Task 6: Build the governance UI

**Files:**
- Modify: `packages/client/ui-enterprise-governance/src/client/EnterpriseGovernanceSurface.tsx`
- Modify: `packages/client/ui-enterprise-governance/src/client/governance.module.css`
- Modify: `packages/client/ui-enterprise-governance/tests/surface.client.spec.tsx`
- Modify: `packages/client/ui-enterprise-governance/README.md`
- Modify: `packages/client/ui-enterprise-governance/README.zh.md`

- [ ] Write failing interaction tests for keyboard-operable department tree editing, assigning a primary department, viewing personal/shared workspaces, sandbox policy selection, and approving/rejecting memory with privacy evidence.
- [ ] Replace the flat organization ledger with an organization split view: department tree on the left and selected department detail on the right.
- [ ] Add user filters, department chips, workspace identity/state, and inline role/status actions without nested interactive targets.
- [ ] Add a memory review queue and enterprise awareness stream. Show source digest and privacy findings, never raw conversation content.
- [ ] Add loading, empty, partial-error, conflict, disabled, focus, reduced-motion, 320/768/1440px, Chinese/English copy states.
- [ ] Run the UI suites, typecheck, and commit.

### Task 7: Record, migrate, and verify

**Files:**
- Create: `.agents/notes/implemented/architecture/2026-08-28-enterprise-directory-workspace-memory.md`
- Create: `.agents/notes/implemented/architecture/2026-08-28-enterprise-directory-workspace-memory.zh.md`
- Create: `.agents/notes/implemented/architecture/2026-08-28-enterprise-directory-workspace-memory.i18n.yaml`
- Modify: `docs/enterprise-deployment.md`
- Modify: `docs/enterprise-deployment.zh.md`

- [ ] Record the DSH-native ownership boundary and the rejected alternatives: raw-chat shared memory, user-token agent execution, and a parallel workspace engine.
- [ ] Add migration/backup guidance and `DSH_ENTERPRISE_WORKSPACE_ROOT` deployment requirements.
- [ ] Run SQLite and PostgreSQL integration suites, RBAC/Host API contract tests, package invariants, translation pairing, Cordis config verification, typecheck, and full build.
- [ ] Restart the enterprise overlay and verify login boundary, PostgreSQL schema version, default workspace creation, department workspace visibility, memory prompt projection, and responsive governance UI.
