# Right Collaboration Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkboxes (`- [ ]`) for tracking.

**Goal:** Put Workspace, group, and channel browsing behind three tabs in the right column and show an unread dot for new messages, mentions, and completed Agent work.

**Architecture:** The current right Sidebar is Session-scoped, so a root-scoped navigation seat must coexist with its existing Session tabs and remain available on the home screen. Room event sequences and per-user read cursors provide durable attention state. Workspace completion uses native Session facts, with the same read-on-opening rule. Browser tabs display server-authorized data and never infer access from a hidden left-sidebar row.

**Tech Stack:** Cordis slots, React, DSH Client snapshots, PostgreSQL room event log, Vitest, Web profile integration.

---

### Task 1: Right-column root navigation

**Files:** `packages/client/ui-sidebar-right/src/client/{index.ts,shell/RightbarRoot.tsx,shell/SidebarRight.module.css}`, `packages/client/ui-workspace/src/client/index.ts`, `packages/client/ui-enterprise-workbench/src/client/collaboration.ts`, focused Client tests.

- [x] Write failing tests for a right navigation visible without a selected Session, tab switching, and retained Session detail tabs.
- [x] Add a root-scoped right navigation slot with Workspace, group, and channel registrants; preserve the existing Session tab seat.
- [x] Move the Workspace and collaboration browsing entries out of left-sidebar discovery after the right entry is usable.
- [ ] Verify keyboard tab navigation, narrow-width layout, light/dark copy, and authenticated real Web rendering. Unit and unauthenticated Web checks passed; Mac lock blocked authenticated browser interaction.

### Task 2: Durable room attention

**Files:** `packages/enterprise/enterprise-postgres/src/{collaboration.ts,collaboration-events.ts}`, `packages/api/enterprise-controller/src/{collaboration-service.ts,collaboration-http.ts}`, Client collaboration state and tests.

- [x] Write failing repository/API tests for per-principal read cursors, new-message and mention classification, and permission revocation.
- [x] Persist exact read sequences and return category attention from authorized room lists; do not count an actor's own posts.
- [x] Mark a room read only when that room's event page is actually opened and displayed.
- [x] Verify migration, persistent readback, and mixed human/Agent authors with PostgreSQL tests.

### Task 3: Workspace completion attention

**Files:** Workspace/session Client projection, right-navigation state and tests.

- [x] Test the native `completionUnread` status setting the Workspace dot and its cleared status removing the dot.
- [x] Derive the live dot from `uiSession.sessionStatus`, excluding room execution Sessions.
- [ ] Persist a per-user Session completion cursor. The current UI status is process-local and a full reload clears its dot.

### Task 4: Release checks

- [x] Run focused tests, Host/Client typecheck, Client i18n and paired-doc gates, Web build, and PostgreSQL integration.
- [ ] Verify three tabs and dots on the authenticated local SUNFLECK page; retain the existing Session detail panel. The unauthenticated Web shell showed the three tabs, but the Mac remained locked.
