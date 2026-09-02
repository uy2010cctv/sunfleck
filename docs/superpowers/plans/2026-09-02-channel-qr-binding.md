# Official Channel QR Binding Implementation Plan

English | [中文](2026-09-02-channel-qr-binding.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-specific official QR authorization flows for WeCom, Feishu, DingTalk, and Weixin while preserving DSH as the authority and never claiming that user login proves message delivery.

**Architecture:** The Channel Kernel owns pure provider profiles, official authorization URL construction, and code-exchange adapters. Enterprise Operations persists only verified, non-secret binding evidence on the channel row with revision fencing. Enterprise Controller signs short-lived one-Host binding state, resolves the App Secret through the Credential seam, exchanges the one-time code, and writes binding evidence. The workbench opens the provider-hosted QR page, handles the same-origin DSH callback in the popup, refreshes the evidence path, and keeps message readiness separate.

**Tech Stack:** TypeScript, Cordis, Typert Remote, PostgreSQL, React, CSS Modules, Vitest, official OAuth endpoints.

---

### Task 1: Provider authorization profiles

**Files:**
- Modify: `packages/channel/channel-kernel/src/index.ts`
- Modify: `packages/channel/channel-kernel/tests/channel-kernel.spec.ts`

- [x] Write failing tests for provider prerequisites, official documentation URLs, authorization endpoints, callback parameters, and the personal-Weixin identity-only boundary.
- [x] Add `channelBindingProfile(provider)` and `channelAuthorizationUrl(input)` with these modes: WeCom `CorpApp`, Feishu OAuth authorize, DingTalk OAuth2 authorize, and Weixin website-app `snsapi_login`.
- [x] Add `exchangeChannelAuthorizationCode(input, fetch)` returning only provider identity, display name, and tenant evidence; never return access or refresh tokens.
- [x] Verify callback URI, `state`, one-time code, response size, timeout, and provider error handling.

### Task 2: Persist verified binding evidence

**Files:**
- Modify: `packages/operations/enterprise-operations/src/types.ts`
- Modify: `packages/operations/enterprise-operations/src/schema.ts`
- Modify: `packages/operations/enterprise-operations/src/repository.ts`
- Modify: `packages/operations/enterprise-operations/src/service.ts`
- Modify: `packages/operations/enterprise-operations/tests/repository.spec.ts`
- Modify: `packages/operations/enterprise-operations/tests/postgres.integration.spec.ts`

- [x] Write failing repository tests for verified evidence, stale revision rejection, organization isolation, rebinding, and archive rejection.
- [x] Add schema v14 binding columns: status, provider identity id/name, verified tenant, verified actor, and verified timestamp; do not store authorization codes or provider tokens.
- [x] Add a revision-fenced, idempotent `verifyChannelBinding` repository/service method and project the evidence in list/get.

### Task 3: Authenticated begin/complete Remote flow

**Files:**
- Modify: `packages/api/enterprise-controller/src/contract/channels.ts`
- Modify: `packages/api/enterprise-controller/src/index.ts`
- Modify: `packages/api/enterprise-controller/tests/channel-controller.spec.ts`
- Modify: `packages/identity/enterprise-auth-web/src/security.ts`
- Modify: `packages/identity/enterprise-auth-web/tests/security.spec.ts`

- [x] Write failing tests for `beginBinding` and `completeBinding`, expired/tampered state, callback mismatch, missing Credential, denied role, provider error, and successful evidence write.
- [x] Sign a 10-minute state envelope containing organization, actor, channel, provider, exact revision, exact callback URI, nonce, and expiry. State is process-bound in the one-Host phase; restart asks the administrator to rescan.
- [x] Resolve the App Secret per operation, call the provider exchange adapter, zero local references after use, and persist only non-secret evidence.
- [x] Keep every endpoint under `channel.manage` and the existing audit/correlation path.

### Task 4: Provider-specific binding workbench

**Files:**
- Modify: `packages/client/ui-enterprise-workbench/src/client/store.ts`
- Modify: `packages/client/ui-enterprise-workbench/src/client/index.ts`
- Modify: `packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- Modify: `packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.module.css`
- Modify: `packages/client/ui-enterprise-workbench/src/client/locales.ts`
- Modify: `packages/client/ui-enterprise-workbench/tests/workbench.client.spec.tsx`
- Modify: `packages/client/ui-enterprise-workbench/tests/store.client.spec.ts`

- [x] Write failing UI tests for four provider instructions, QR eligibility, official-domain popup target, pending callback, verified evidence, retry, expiration, keyboard/mobile behavior, and no secret input.
- [x] Add a binding rail inside each channel evidence row: prerequisites → scan official QR → identity verified → transport still unverified.
- [x] Use exact provider copy: WeCom requires CorpID/AgentID/trusted callback; Feishu requires App ID/redirect URL; DingTalk requires Client ID/callback same-origin rules; Weixin requires an approved website app and is identity/handoff only.
- [x] Detect `dsh_channel_binding=1&code&state` in the popup, call `completeBinding`, notify the opener with same-origin `postMessage` or the per-attempt BroadcastChannel fallback, remove callback parameters, and close only after success.

### Task 5: Documentation and release gates

**Files:**
- Modify: `PRODUCT.md`
- Modify: `DESIGN.md`
- Modify: `docs/user/guide/human-agent-teams.md`
- Modify: `docs/user/guide/human-agent-teams.zh.md`

- [x] Record official-source links and the identity-versus-delivery boundary.
- [x] Complete the feature-owned release gates: the focused matrix passes 257 tests across 18 files; typecheck and the production build pass after the strict fixture fixes in `66953f09`; package paths resolve across 4,829 files; tsconfig aliases are current; and the two changed translation pairs are consistent.
- [ ] Run the optional real PostgreSQL acceptance. The integration file was invoked but skipped all 12 tests because `DSH_TEST_POSTGRES_URL` is absent.
- [ ] Make full lint, corpus translation pairing, and doc-sync clean. They retain known unrelated repository-wide JSDoc/catalog, pairing, wrapping, subsystem, Agent Note, and package README debt outside this feature.
- [x] Preserve the single Impeccable detector run completed during Task 4; do not rerun it in Task 5.
- [ ] Browser-test the authenticated administrator flow without entering or exposing App Secrets. Real-provider QR remains unexecuted until platform applications and secrets are available.

### Task 4b: Independently adopt proven StaffDeck channel UX concepts

**Reference boundary:** `/Users/kris/Documents/ChatGPT/数字员工/StaffDeck` is AGPL-3.0. Inspect it as product prior art only; do not copy source, styling, assets, protocol code, or prose into DSH.

**Files:**
- Modify: `packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- Modify: `packages/client/ui-enterprise-workbench/src/client/channelBindingProfiles.ts`
- Modify: `packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.module.css`
- Modify: `packages/client/ui-enterprise-workbench/src/client/locales.ts`
- Modify: `packages/client/ui-enterprise-workbench/tests/workbench.client.spec.tsx`

- [x] Add an exception-first attention strip for missing prerequisites, expired/failed scans, and recorded transport failures. Treat `unverified` transport as neutral evidence, not an incident.
- [x] Keep four independent truths visible: configuration, QR identity, default Employee/Team route, and actual transport evidence.
- [x] Add provider-specific transport setup guidance without asking for secret values: WeCom Intelligent Bot/application visibility, Feishu minimum bot-message scopes, DingTalk Stream robot/Login and Share callback, and the personal-Weixin official website-app identity-only boundary.
- [x] Use status/action language that distinguishes pending configuration, ready to scan, verified identity, paused, archived, and transport unverified.
- [x] Preserve DSH revision/idempotency/RBAC and Credential-reference seams. Do not implement StaffDeck's AGPL code, iLink transport, manager model, delivery log, or conversation store in this QR-binding task.
