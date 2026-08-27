# PostgreSQL Production Composition Implementation Plan

English | [中文](2026-08-27-postgresql-production-composition.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the enterprise Overlay compose PostgreSQL-backed identity, DSH Session persistence, catalog, operations, and knowledge services with startup validation and recovery-safe lifecycle.

**Architecture:** Add a single deployment-owned PostgreSQL connection provider with bounded pool lifecycle. Enterprise auth accepts an async identity store through an async security boundary; the Overlay initializes all enterprise schemas before serving traffic. SQLite remains an explicit development fallback, while production mode fails closed unless PostgreSQL is configured.

**Tech Stack:** Node 24, TypeScript, Cordis, `pg`, PostgreSQL 17 + pgvector, existing DSH persistence/catalog/operations/knowledge adapters.

---

### Task 1: PostgreSQL connection and schema composition

**Files:**
- Create: `packages/enterprise/enterprise-postgres/src/index.ts`
- Create: `packages/enterprise/enterprise-postgres/src/invariant.ts`
- Create: `packages/enterprise/enterprise-postgres/package.json`
- Create: `packages/enterprise/enterprise-postgres/tsconfig.json`
- Create: `packages/enterprise/enterprise-postgres/tests/composition.spec.ts`
- Modify: `tsconfig.host.json`
- Modify: `packages/bundle/web-app/package.json`

- [ ] Add a `PostgresEnterpriseDatabase` wrapper around `pg.Pool` with `query`, transaction rollback/commit, health check, and idempotent close.
- [ ] Expose `initializeEnterprisePostgres()` that runs identity, session, catalog, operations, and knowledge migrations in one startup sequence.
- [ ] Add tests proving schema initialization is repeatable and failed transactions roll back.

### Task 2: Async identity security boundary

**Files:**
- Modify: `packages/identity/enterprise-auth-web/src/security.ts`
- Modify: `packages/identity/enterprise-auth-web/src/http.ts`
- Modify: `packages/client/connection/src/rpc-host.ts`
- Modify: `packages/client/connection/src/index.ts`
- Modify: `packages/identity/enterprise-auth-web/tests/*.spec.ts`

- [ ] Convert identity reads/writes used by authentication and authorization to awaitable methods without breaking the synchronous SQLite adapter contract.
- [ ] Ensure every HTTP RPC, WebSocket, and admin operation awaits authentication, authorization, and audit persistence before dispatch.
- [ ] Add tests using an async fake identity store and verify denied requests never reach the target handler.

### Task 3: Production Overlay configuration

**Files:**
- Modify: `apps/cli/config/enterprise.cordis.patch.yml`
- Modify: `docs/enterprise-deployment.zh.md`
- Modify: `docs/enterprise-deployment.md`
- Create: `docs/enterprise-postgres-recovery.zh.md`

- [ ] Add `DSH_ENTERPRISE_DATABASE_URL` and `DSH_ENTERPRISE_DATABASE_MODE=postgres|sqlite` validation.
- [ ] Compose the PostgreSQL provider and inject its identity/session/catalog/operations/knowledge stores into the enterprise plugins.
- [ ] Fail startup in production mode when PostgreSQL or pgvector is unavailable; keep SQLite only for explicit desktop development mode.
- [ ] Document pool permissions, schema initialization, backup/restore, migration dry-run, and rollback procedures.

### Task 4: Runtime recovery and verification

**Files:**
- Modify: `.github/workflows/enterprise-postgres.yml`
- Create: `apps/web/tests/enterprise-postgres-composition.e2e.ts`
- Modify: `packages/bundle/web-app/tests/enterprise-workbench-composition.spec.ts`

- [ ] Add startup/restart tests proving Session/Event and operation Outbox survive process restart.
- [ ] Add real PostgreSQL + pgvector CI coverage for all enterprise migrations and a cross-package smoke composition.
- [ ] Run build, focused tests, package invariants, and local service health/login checks before reporting completion.
- [ ] Record production composition pool, schema, and recovery evidence.
