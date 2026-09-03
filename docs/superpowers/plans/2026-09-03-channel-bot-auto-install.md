# Channel Bot Auto-Install Implementation Plan

English | [中文](2026-09-03-channel-bot-auto-install.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the DSH-owned scan flow so a trusted provider installer can return verified Bot metadata and DSH automatically creates the governed channel without user-entered identifiers or Credential references.

**Architecture:** `EnterpriseChannelController` owns signed, actor-bound, expiring installation sessions. An optional Host-only `enterpriseChannelBotInstaller` service owns provider application credentials and official API exchanges; the browser receives only an official authorization URL and opaque state. On completion, the controller derives a non-identifying stable channel ID, verifies the Host Credential reference, and commits the channel through the existing organization-scoped operations repository.

**Tech Stack:** TypeScript, Cordis services, Typert Remote, PostgreSQL-backed enterprise operations, React, Vitest.

---

### Task 1: Provider installer contract and signed session

**Files:**
- Modify: `packages/api/enterprise-controller/src/contract/channels.ts`
- Modify: `packages/api/enterprise-controller/src/index.ts`
- Test: `packages/api/enterprise-controller/tests/channel-controller.spec.ts`

- [x] Add failing tests proving installer absence returns `setup-required`, a configured installer returns an HTTPS authorization session, and state is scoped to organization and actor.
- [x] Add the Host-only installer service contract with `begin` and `complete` methods and declare it as an optional Cordis context service.
- [x] Sign installation state with HMAC, cap pending sessions per process, expire after ten minutes, and reject invalid URLs or mismatched actors.
- [x] Run `pnpm exec vitest run packages/api/enterprise-controller/tests/channel-controller.spec.ts` and require all tests to pass.

### Task 2: Automatic channel derivation and persistence

**Files:**
- Modify: `packages/api/enterprise-controller/src/contract/channels.ts`
- Modify: `packages/api/enterprise-controller/src/index.ts`
- Test: `packages/api/enterprise-controller/tests/channel-controller.spec.ts`

- [x] Add a failing completion test whose fake installer returns verified tenant, application, Bot name, and a Host Credential reference.
- [x] Derive `channelId` as `<provider>-<sha256(orgId, tenantId, accountId)[0..11]>`, derive the display name from the verified Bot or tenant name, force personal WeChat to identity-only inbound policy, and leave routing on the DSH decision router default.
- [x] Verify the returned Credential reference is configured before committing an active channel with `expectedRevision: 0` and the callback idempotency key.
- [x] Persist verified provider Bot identity and tenant evidence after channel creation.

### Task 3: Browser callback and scan-only UX

**Files:**
- Modify: `packages/client/ui-enterprise-workbench/src/client/channelBindingProfiles.ts`
- Modify: `packages/client/ui-enterprise-workbench/src/client/index.ts`
- Modify: `packages/client/ui-enterprise-workbench/src/client/store.ts`
- Modify: `packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- Modify: `packages/client/ui-enterprise-workbench/src/client/locales.ts`
- Test: `packages/client/ui-enterprise-workbench/tests/store.client.spec.ts`
- Test: `packages/client/ui-enterprise-workbench/tests/workbench.client.spec.tsx`

- [x] Add failing tests for the install callback, browser-history redaction, completion broadcast, automatic channel refresh, and popup ordering.
- [x] Pre-open the authorization window synchronously from the scan click, navigate it only after the Remote returns a validated official URL, and close it on setup-required/error.
- [x] Keep all account, tenant, application, Credential, name, ID, and Release fields absent from the channel UI.
- [x] Render only scan progress, provider confirmation, automatically created channel facts, and recoverable errors.

### Task 4: Documentation, build, and local deployment

**Files:**
- Modify: `docs/subsystems/agent-team.zh.md`
- Modify: `docs/subsystems/agent-team.md`

- [x] Document the provider-level prerequisite: WeCom Suite ticket/pre-auth code, Feishu Store App app_ticket/tenant_key, and DingTalk third-party app authorization event/SyncHTTP.
- [x] State that platform registration credentials live in the Host installer and never in browser state or channel records.
- [ ] Run controller and workbench suites, `pnpm exec tsc -b tsconfig.client.json`, and `pnpm build`.
- [ ] Commit only task-owned files, restart `com.deepseek.dsh.local.3081`, and verify the authenticated desktop and mobile channel page.
