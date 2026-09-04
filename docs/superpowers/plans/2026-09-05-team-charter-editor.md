# Team Charter Editor Implementation Plan

English | [中文](2026-09-05-team-charter-editor.zh.md)

> **For DSH maintainers:** Execute each task with tests first and keep Team Definition as the only charter write contract.

**Goal:** Complete the browser flow for creating a team charter, improving a migrated `needs-charter` draft, saving drafts, and activating a fully governed charter.

**Architecture:** Add a versioned Team Definition mutation to the enterprise workbench controller, then expose one inline charter editor in the Team command surface. The editor maps human-readable inputs to the typed roster, roles, verification, attention, approval, visibility, and revision fields already enforced by the Host. Team Run launch remains separate and only accepts active revisions.

**Tech Stack:** React, TypeScript, CSS Modules, generated Enterprise Remote contracts, Vitest, Testing Library.

---

### Task 1: Wire the typed Team Definition mutation

**Files:**
- Modify: `packages/client/ui-enterprise-workbench/src/client/store.ts`
- Modify: `packages/client/ui-enterprise-workbench/src/client/index.ts`
- Modify: `packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- Test: `packages/client/ui-enterprise-workbench/tests/store.client.spec.ts`

1. Add a failing controller test proving `enterpriseTeamDefinition.save` receives the charter payload plus one idempotency key and refreshes the Team Definition projection.
2. Add `saveTeamDefinition` to the controller and injected browser contract with conflict reload behavior.
3. Run the focused store test.

### Task 2: Build the create and improve-charter flow

**Files:**
- Modify: `packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.tsx`
- Modify: `packages/client/ui-enterprise-workbench/src/client/locales.ts`
- Modify: `packages/client/ui-enterprise-workbench/src/client/EnterpriseWorkbench.module.css`
- Test: `packages/client/ui-enterprise-workbench/tests/workbench.client.spec.tsx`

1. Add failing UI tests for opening a blank charter, opening a migrated draft, saving a draft, and activating a complete charter.
2. Replace the disabled charter row with accessible selection and edit actions.
3. Add an inline, responsive editor with essential identity, North Star, Human owner, visibility, Agent roster, leader, verifier, and governance controls.
4. Keep advanced limits progressively disclosed and map all fields to typed Team Definition values without exposing JSON.
5. Clear dirty state only after a successful save, and return the user to the charter list after save or cancel.

### Task 3: Verify UX, contracts, and deployment

1. Run focused store, workbench, style, and direction tests.
2. Run typecheck and package build.
3. Run the Impeccable detector once on changed UI files and address real findings.
4. Commit the isolated branch, integrate it into the current checkout without overwriting unrelated user changes, restart DSH on port 3081, and inspect create/improve/cancel behavior in the browser without persisting test business data.
