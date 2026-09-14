# Enterprise Hierarchical Access Implementation Plan

English | [中文](2026-09-14-enterprise-hierarchical-access.zh.md)

> **For Codex:** Execute each task with focused tests before implementation and keep every authorization decision attributable in the existing enterprise audit log.

**Goal:** Make channels, enterprise memory, and digital employees obey one organization hierarchy with organization, department, employee, and personal access scopes.

**Architecture:** Extend the existing `enterprise-governance` authorization service instead of adding a parallel permissions engine. Human principals carry department membership and managed departments; background channel runs carry an employee service identity. Resource owners publish a stable access scope, and `EnterpriseSecurity` resolves that scope before the existing authorize-and-audit path runs. Controllers remain responsible for loading their resource, while the governance package owns the final decision.

**Tech Stack:** TypeScript, Cordis services, Typert RPC, PostgreSQL/SQLite enterprise repositories, Vitest, React workbench.

---

## Subproject 1: Shared hierarchy policy

### Task 1: Define actors, scopes, actions, and decisions

**Files:**
- Modify: `packages/governance/enterprise-governance/src/index.ts`
- Test: `packages/governance/enterprise-governance/tests/enterprise-governance.spec.ts`
- Modify: `packages/governance/enterprise-governance/README.md`
- Modify: `packages/governance/enterprise-governance/README.zh.md`

1. Add failing tests for organization mismatch, department membership, department manager administration, exact employee service identity, and personal ownership.
2. Add explicit organization, department, employee, and personal resource scopes.
3. Extend principals with human department context or an employee service identity.
4. Add memory read/manage, employee execute, channel read/manage/execute actions.
5. Preserve existing visibility behavior inside the selected hierarchy scope.
6. Run the focused governance tests.

### Task 2: Hydrate human principals and employee service identities

**Files:**
- Modify: `packages/identity/enterprise-identity/src/repository.ts`
- Modify: `packages/identity/enterprise-identity-postgres/src/repository.ts`
- Modify: `packages/identity/enterprise-auth-web/src/security.ts`
- Modify: `packages/identity/enterprise-auth-web/src/request-context.ts`
- Test: `packages/identity/enterprise-auth-web/tests/security.spec.ts`

1. Add failing tests showing that login principals include department membership and that a department manager cannot act outside managed departments.
2. Project department membership from the identity repository into authenticated principals.
3. Add a non-user employee service principal constructor for background runs; it must name one immutable employee release and cannot gain human-only administration rights.
4. Ensure authorization and audit records retain the effective actor and do not borrow a browser user's identity.
5. Run identity and auth focused tests.

## Subproject 2: Digital employee hierarchy

### Task 3: Persist employee department scope

**Files:**
- Modify: `packages/api/enterprise-controller/src/contract/employees.ts`
- Modify: enterprise catalog types, repositories, and schema migrations under `packages/catalog/` and `packages/enterprise/enterprise-postgres/`
- Test: `packages/api/enterprise-controller/tests/employee-controller.spec.ts`
- Test: the owning catalog repository tests

1. Add failing create/read/update tests for owner, same-department member, department manager, and outside-department member.
2. Persist a stable `departmentId` and access scope on drafts and immutable releases.
3. Resolve employee resources through the shared hierarchy policy for list, get, save, publish, rollback, and execution.
4. Hide unauthorized employees as not found on direct reads and omit them from list pages.
5. Run focused catalog and controller tests.

### Task 4: Show scope and denial reasons in the workbench

**Files:**
- Modify: `packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- Modify: `packages/client/ui-enterprise-workbench/src/client/store.ts`
- Modify: `packages/client/ui-enterprise-workbench/src/client/locales.ts`
- Test: `packages/client/ui-enterprise-workbench/tests/store.client.spec.ts`
- Test: relevant rendered workbench tests

1. Add failing tests for department selection, scope badges, and disabled management actions.
2. Use the organization directory as the only department selector source.
3. Explain whether access comes from ownership, department membership, department management, or organization administration.
4. Run focused client tests and record a product UI GIF from the real PR server.

## Subproject 3: Memory hierarchy

### Task 5: Authorize memory reads and lifecycle changes

**Files:**
- Modify: `packages/context/enterprise-memory-context/src/index.ts`
- Modify: `packages/context/enterprise-memory-context/src/writeback-runtime.ts`
- Modify: memory admin endpoints in `packages/identity/enterprise-auth-web/src/http.ts`
- Test: `packages/context/enterprise-memory-context/tests/context.spec.ts`
- Test: `packages/context/enterprise-memory-context/tests/auto-memory.spec.ts`

1. Add failing tests for organization memory, department memory, employee-bound knowledge, and cross-department denial.
2. Resolve every memory query through the same hierarchy scope.
3. Permit department managers to review their department memory while reserving organization memory review for administrators.
4. Make background employee runs read only the organization, department, and employee scopes explicitly granted to that release.
5. Run focused memory and HTTP tests.

## Subproject 4: Channel hierarchy

### Task 6: Bind each channel to an employee service identity and department

**Files:**
- Modify: `packages/api/enterprise-controller/src/contract/channels.ts`
- Modify: channel configuration persistence under `packages/operations/enterprise-operations/`
- Modify: `packages/api/enterprise-controller/src/index.ts`
- Modify: `packages/enterprise/enterprise-cordis-runtime/src/index.ts`
- Test: `packages/api/enterprise-controller/tests/channel-controller.spec.ts`
- Test: `packages/enterprise/enterprise-cordis-runtime/tests/runtime.spec.ts`

1. Add failing tests for channel owner, department manager, outside-department member, and exact employee runtime identity.
2. Persist a stable department id and required employee release id on active inbound channels.
3. Authorize list/get/save/archive/bind through the shared hierarchy policy.
4. Start inbound sessions with the bound employee service principal and an exact managed workspace grant.
5. Reject release-directory workspaces and ambiguous or fuzzy workspace matches.
6. Run focused channel and runtime tests.

### Task 7: Update the IM adapter contract

**Files:**
- Modify: the `dsh-im` enterprise adapter and its tests in the sibling repository
- Modify: DSH channel deployment configuration and verification fixtures

1. Add failing adapter tests proving every inbound request supplies the bound channel id, employee release id, organization id, and department id.
2. Remove any fallback that derives authority from a working directory or a recently authenticated human.
3. Verify Feishu inbound reply and permission denial in separate live scenarios.

## Subproject 5: Migration, documentation, and release proof

### Task 8: Migrate existing resources without widening access

**Files:**
- Modify: relevant monotonic database migrations
- Add: deployment migration/readiness command and tests

1. Backfill employee and channel scope only from exact authoritative ids.
2. Quarantine rows that have only display names, release paths, or ambiguous matches.
3. Report every quarantined resource with a repair action; do not select the first candidate.

### Task 9: Document and validate the final behavior

**Files:**
- Add: one active Agent Note under `.agents/notes/`
- Modify: affected package READMEs and JSDoc
- Add: `raw/2026-09-14-enterprise-hierarchical-access.md` in the user knowledge base and update its index

1. Document the scope matrix, service identity rules, migration behavior, and audit reasons in English and Chinese sources.
2. Run the smallest checks selected by `dsh-pre-push-checks`, including focused tests, typecheck faces, docs gates, and the recorded product snapshot.
3. Merge to `master`, deploy to instance 47, and verify rendered access controls plus allowed and denied channel/memory/employee workflows with persisted readback.
