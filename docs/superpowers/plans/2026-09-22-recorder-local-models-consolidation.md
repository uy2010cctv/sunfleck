# Recorder local-model settings consolidation implementation plan

English | [中文](2026-09-22-recorder-local-models-consolidation.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put ASR, speaker recognition, and recorder-memory processing configuration on one Local Models page, with a persistent memory-model route and visible dedicated Session id.

**Architecture:** dsh-knowledge owns the Local Models page and exposes a child slot for recorder inference controls. The DSH recorder settings plugin fills that slot, while the enterprise controller persists the memory-processing route in `$DSH_HOME/storages/recorder-memory-runtime.json`; dsh-knowledge reads the same file before every processing call.

**Tech Stack:** TypeScript, React, Cordis slots, Typert Remote, JSON atomic persistence, Vitest, Python worker integration.

---

### Task 1: Persist the memory-processing route

**Files:**
- Create: `packages/api/enterprise-controller/src/recorder-memory-runtime.ts`
- Modify: `packages/api/enterprise-controller/src/contract/devices.ts`
- Modify: `packages/api/enterprise-controller/src/index.ts`
- Test: `packages/api/enterprise-controller/tests/recorder-memory-runtime.spec.ts`

- [ ] Write a failing test proving revision-checked writes persist `{provider, model, timeoutMs}` and reads return `recorder-memory-<userId>`.
- [ ] Run the focused Vitest file and confirm the missing store/API failure.
- [ ] Implement owner-only atomic JSON persistence below `dshHomePath('storages')`, validate the selected provider/model against `ctx.llm`, and expose authenticated get/save Remote methods.
- [ ] Run the focused controller tests and confirm they pass.

### Task 2: Make memory processing consume the persistent route

**Files:**
- Create: `src/knowledge/recorder-memory-config.ts` in dsh-knowledge
- Modify: `src/knowledge/recorder-memory.ts` in dsh-knowledge
- Test: `tests/recorder-memory.spec.ts` in dsh-knowledge

- [ ] Write a failing test that stores a route file and expects `processRecorderMemory` to use it instead of stale environment values.
- [ ] Run the focused test and confirm the model route mismatch.
- [ ] Implement bounded JSON parsing with environment fallback for migration and preserve `recorder-memory-<userId>` as the dedicated inference Session id.
- [ ] Run the focused memory-processing tests and confirm they pass.

### Task 3: Merge recorder controls into Local Models

**Files:**
- Modify: `src/ui/client/index.tsx` and `src/ui/client/LocalModelsSection.tsx` in dsh-knowledge
- Modify: `packages/client/ui-settings-recorder/src/client/index.ts`
- Modify: `packages/client/ui-settings-recorder/src/client/RecorderSettingsSection.tsx`
- Modify: `packages/client/ui-settings-recorder/src/client/store.ts`
- Modify: `packages/client/ui-settings-recorder/src/client/locales.ts`
- Test: both packages' Local Models and recorder settings client tests

- [ ] Write failing slot tests proving there is no standalone recorder settings section and the recorder control mounts under `settings.local-models.recorder`.
- [ ] Write a failing component/store test for model selection, dedicated Session id, and independent save states.
- [ ] Add the Local Models child slot, render it near the page heading, register recorder settings into it, and validate the saved provider/model against the active model catalog.
- [ ] Run both client test groups and the Impeccable detector.

### Task 4: Verify, document, and deploy

**Files:**
- Update the recorder-sync implementation and deployment Markdown pairs.
- Update the affected Agent Note when the persistent configuration decision ships.

- [ ] Run focused TypeScript and dsh-knowledge tests, both builds, translation pairing, and `git diff --check`.
- [ ] Merge the DSH change to `master` and dsh-knowledge change to `main`.
- [ ] Install both release artifacts on 47 with rollback backups.
- [ ] Verify one Local Models page shows ASR, CAM, memory model, dedicated Session id, and successful saved-state readback; then process one recorder batch with the selected route.
