# Enterprise Channel Settings Implementation Plan

English | [中文](2026-09-02-enterprise-channel-settings.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authenticated, PostgreSQL-backed Channel Settings control surface for Enterprise WeChat, Feishu, DingTalk, and identity/handoff-only personal WeChat without storing secret values outside the Credential seam.

**Architecture:** Enterprise Operations owns reusable channel configuration and revision/idempotency rules. Enterprise Controller exposes principal-scoped Remote methods with central `channel.manage` authorization and audit. The workbench renders provider capabilities, configuration readiness, credential references, routing defaults, and lifecycle actions; real transport health remains adapter evidence and is never inferred from saved configuration.

**Tech Stack:** TypeScript, Cordis, Typert Remote, PostgreSQL, React, CSS Modules, Vitest, pnpm.

---

### Task 1: Define the channel-management contract

**Files:**
- Modify: `packages/operations/enterprise-operations/src/types.ts`
- Create: `packages/api/enterprise-controller/src/contract/channels.ts`
- Modify: `packages/api/enterprise-controller/src/contract/index.ts`

- [ ] Add a failing type/API test requiring the provider, account identity, Credential reference, routing default, inbound policy, lifecycle, revision, and timestamps.
- [ ] Run `pnpm exec vitest run packages/api/enterprise-controller/tests/channel-controller.spec.ts` and confirm the namespace is absent.
- [ ] Define `EnterpriseChannelConfiguration` and list/get/save/archive requests. Use only `credentialRef: string`; never accept a secret value.
- [ ] Encode personal WeChat as handoff-only and force inbound commands off.

### Task 2: Persist channel settings with CAS and idempotency

**Files:**
- Modify: `packages/operations/enterprise-operations/src/schema.ts`
- Modify: `packages/operations/enterprise-operations/src/repository.ts`
- Modify: `packages/operations/enterprise-operations/src/service.ts`
- Modify: `packages/operations/enterprise-operations/tests/repository.spec.ts`

- [ ] Write failing repository tests for create, exact retry, stale revision, cross-organization lookup, provider capability validation, pause, and terminal archive.
- [ ] Run `pnpm exec vitest run packages/operations/enterprise-operations/tests/repository.spec.ts -t channel` and confirm the table/methods are missing.
- [ ] Add schema v13 table `dsh_enterprise_channel_configurations` and organization/provider/state indexes.
- [ ] Implement organization-scoped list/get/save/archive using existing signed cursors, request digests, and idempotency storage.
- [ ] Add Host service methods using `enterpriseChannel.*` endpoints and existing authorization/audit callbacks.

### Task 3: Expose authenticated Remote management

**Files:**
- Modify: `packages/identity/enterprise-auth-web/src/security.ts`
- Modify: `packages/api/enterprise-controller/src/index.ts`
- Create: `packages/api/enterprise-controller/tests/channel-controller.spec.ts`

- [ ] Write failing tests proving an administrator can list/save/archive while creators, operators, auditors, and members cannot mutate channels.
- [ ] Map `enterpriseChannel.*` to `channel.manage`; reads remain administrator-only because channel account identifiers and Credential references are governance data.
- [ ] Implement `enterpriseChannel.list/get/save/archive`, inject organization and actor from the authenticated Host context, and emit one attributable audit per request.
- [ ] Re-run the controller and security tests.

### Task 4: Build the Channel Settings workbench page

**Files:**
- Modify: `packages/client/ui-enterprise-workbench/src/client/store.ts`
- Modify: `packages/client/ui-enterprise-workbench/src/client/index.ts`
- Modify: `packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- Modify: `packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.module.css`
- Modify: `packages/client/ui-enterprise-workbench/src/client/locales.ts`
- Modify: `packages/client/ui-enterprise-workbench/tests/workbench.client.spec.tsx`
- Modify: `packages/client/ui-enterprise-workbench/tests/store.client.spec.ts`

- [ ] Write failing UI tests for the Channels navigation entry, provider capability boundary, Credential-reference-only form, readiness state, save, pause, archive, and personal-WeChat inbound lock.
- [ ] Add `channels` to workbench state and refresh/mutation flows.
- [ ] Build an Operate surface with a connection path: provider/account → Credential reference → DSH routing → allowed intents. Use evidence rows, not equal dashboard cards.
- [ ] Keep active/paused/draft/archived, unverified transport state, validation, empty, loading, error, keyboard, mobile, and bilingual behavior explicit.
- [ ] Run all workbench tests and the Impeccable detector once.

### Task 5: Document and verify

**Files:**
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`
- Modify: `docs/user/guide/human-agent-teams.md`
- Modify: `docs/user/guide/human-agent-teams.zh.md`

- [ ] Update current-capability wording: configuration management is implemented; provider delivery, receipts, leases, and live token checks remain adapter/runtime evidence.
- [ ] Run channel, operations, controller, workbench, PostgreSQL, typecheck, build, package-path, tsconfig-path, and translation-pairing gates.
- [ ] Review the final diff for secret-bearing fields, raw provider payloads, cross-organization access, and unsupported personal-WeChat writes.
