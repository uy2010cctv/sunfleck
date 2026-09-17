# Enterprise Multi-Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow one SUNFLECK Host to create, authenticate, provision, and govern multiple organizations without exposing enterprise records or mutable workspaces across organization boundaries.

**Architecture:** Keep the configured organization as the platform organization and make authenticated principals carry the organization selected during login. Provision each organization with an administrator in one repository transaction, place managed workspaces beneath an organization-specific directory, and restrict Host-global model, credential, inspection, and plugin operations to platform administrators. Organization-local APIs continue deriving `orgId` exclusively from the authenticated principal.

**Tech Stack:** TypeScript, Cordis, PostgreSQL/SQLite identity repositories, React enterprise governance UI, Vitest, systemd deployment on 47.

---

### Task 1: Atomic organization and administrator bootstrap

**Files:**
- Modify: `packages/identity/enterprise-identity/src/repository.ts`
- Modify: `packages/identity/enterprise-identity-postgres/src/repository.ts`
- Test: `packages/identity/enterprise-identity/tests/repository.spec.ts`
- Test: `packages/identity/enterprise-identity-postgres/tests/repository.spec.ts`

- [ ] Add failing tests proving one operation creates an organization, its enabled administrator, password verifier, and administrator role, while a duplicate id/username rolls back the entire operation.
- [ ] Add `createOrganizationWithAdministrator({ organization, administrator, passwordVerifier })` to `EnterpriseIdentityStore`.
- [ ] Implement one SQLite transaction using `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`.
- [ ] Implement one PostgreSQL transaction through the repository's existing `transaction()` helper.
- [ ] Run the two repository suites and commit.

### Task 2: Organization-aware login and platform authority

**Files:**
- Modify: `packages/identity/enterprise-auth-web/src/security.ts`
- Modify: `packages/identity/enterprise-auth-web/src/http.ts`
- Modify: `packages/identity/enterprise-auth-web/src/plugin.ts`
- Test: `packages/identity/enterprise-auth-web/tests/security.spec.ts`
- Test: `packages/identity/enterprise-auth-web/tests/http.spec.ts`
- Test: `packages/identity/enterprise-auth-web/tests/plugin.spec.ts`

- [ ] Add failing local-login tests with identical usernames in two organizations; assert each cookie authenticates to the selected `orgId` and cannot read the other organization's records.
- [ ] Change local and external login to issue a session against the authenticated user's organization instead of `config.organizationId`.
- [ ] Return `defaultOrganizationId` and `platformAdministrator` from `/auth/status`; keep `organizationId` as the login default when unauthenticated and as the principal organization when authenticated.
- [ ] Restrict organization listing and creation to platform administrators; ordinary tenant administrators receive only their own organization and cannot create another.
- [ ] Accept organization plus initial administrator fields in the create request, call the atomic repository operation, and provision the administrator's personal workspace.
- [ ] Run auth tests and commit.

### Task 3: Organization-specific workspace filesystem compartments

**Files:**
- Modify: `packages/identity/enterprise-auth-web/src/workspace-provisioner.ts`
- Test: `packages/identity/enterprise-auth-web/tests/workspace-provisioner.spec.ts`

- [ ] Add failing tests proving equal user and department labels in separate organizations resolve under distinct `organizations/<org-hash>/...` roots.
- [ ] Include the organization compartment in new personal and department workspace paths while retaining already persisted grants unchanged.
- [ ] Ensure organization bootstrap provisions only the new administrator and never backfills sessions from another organization.
- [ ] Run the provisioner suite and commit.

### Task 4: Platform organization creation UI

**Files:**
- Modify: `packages/client/ui-enterprise-governance/src/client/controller.ts`
- Modify: `packages/client/ui-enterprise-governance/src/client/EnterpriseGovernanceSurface.tsx`
- Modify: `packages/client/ui-enterprise-governance/src/client/locales.ts`
- Modify: `packages/client/ui-enterprise-governance/src/client/governance.module.css`
- Test: `packages/client/ui-enterprise-governance/tests/controller.client.spec.ts`
- Test: `packages/client/ui-enterprise-governance/tests/surface.client.spec.tsx`

- [ ] Add failing controller tests for the complete organization/admin request and safe password clearing.
- [ ] Add failing UI tests proving only a platform administrator sees “创建隔离组织”, required fields gate submission, errors remain visible, and the password is cleared after submit.
- [ ] Add a compact organization bootstrap form above the current department tree; organization id, name, administrator username/display name/password are explicit.
- [ ] Refresh governance state after success and show the new organization without switching the active principal.
- [ ] Run controller/UI tests and commit.

### Task 5: Prevent tenant administrators from operating Host-global services

**Files:**
- Modify: `packages/identity/enterprise-auth-web/src/security.ts`
- Test: `packages/identity/enterprise-auth-web/tests/security.spec.ts`

- [ ] Add failing tests proving tenant administrators cannot manage credentials, model settings, developer inspection, or organization-wide Cordis package publication, while platform administrators retain access.
- [ ] Apply the platform-administrator check before the ordinary role policy for Host-global resource types.
- [ ] Keep organization-scoped employee, asset, team, memory, channel, workspace, and audit operations authorized from `principal.orgId`.
- [ ] Run the security suite and commit.

### Task 6: Real composition, documentation, deployment, and readback

**Files:**
- Create: `.agents/notes/implemented/architecture/2026-09-17-enterprise-multi-organization.md`
- Create: `.agents/notes/implemented/architecture/2026-09-17-enterprise-multi-organization.zh.md`
- Create: `.agents/notes/implemented/architecture/2026-09-17-enterprise-multi-organization.i18n.yaml`
- Modify: `packages/identity/enterprise-auth-web/README.md`
- Modify: `packages/identity/enterprise-auth-web/README.zh.md`
- Test: `packages/identity/enterprise-auth-web/tests/plugin.spec.ts`

- [ ] Add a Loader-composed test that boots PostgreSQL-backed auth, creates a second organization, logs into both organizations, and proves user/workspace/memory/audit isolation.
- [ ] Document the platform-organization model, organization bootstrap, shared-code/runtime boundary, and Host-global restrictions in both languages.
- [ ] Run focused tests, typecheck, lint, translation pairing, and a clean production build.
- [ ] Merge the feature branch into local `master`, push the private `sunfleck` remote, and deploy a rollback-capable release on 47.
- [ ] Create a disposable second organization on 47, log in with its administrator, verify its personal workspace and empty enterprise catalog, then verify the default organization remains unchanged.
