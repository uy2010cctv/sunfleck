# Left Collaboration Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkboxes (`- [ ]`) for tracking.

**Goal:** Put Workspace, group, and channel browsing behind three tabs in the left sidebar and show an unread dot for new messages, mentions, and completed Agent work.

**Architecture:** The native left sidebar owns the Workspace browsing slot. Its Workspace occupant renders a category tab strip and dispatches group and channel content through a keyed child slot. The right sidebar remains Session-scoped. Room event sequences and per-user read cursors provide durable message attention; Workspace completion uses native Session status. Browser tabs display only server-authorized data.

**Tech Stack:** Cordis slots, React, DSH Client snapshots, PostgreSQL room event log, Vitest, Web profile integration.

---

### Task 1: Left-sidebar category navigation

**Files:** `packages/client/ui-workspace/src/client/{index.ts,navigation.ts,sidebar-tabs.tsx,rows/WorkspaceBrowser.tsx}`, `packages/client/ui-enterprise-workbench/src/client/collaboration.ts`, focused Client tests.

- [x] Write a failing test for the three left tabs and category attention retained while switching.
- [x] Restore the existing Session-only right sidebar.
- [ ] Register Workspace, group, and channel content in the left Workspace browsing region, preserving all Workspace actions.
- [ ] Verify keyboard tab navigation, collapsed rail, and authenticated Web rendering.

### Task 2: Durable room attention

**Files:** `packages/enterprise/enterprise-postgres/src/{collaboration.ts,collaboration-events.ts}`, `packages/api/enterprise-controller/src/{collaboration-service.ts,collaboration-http.ts}`, Client collaboration state and tests.

- [x] Write failing repository/API tests for per-principal read cursors, new-message and mention classification, and permission revocation.
- [x] Persist exact read sequences and return category attention from authorized room lists; do not count an actor's own posts.
- [x] Mark a room read only when that room's event page is actually opened and displayed.
- [x] Verify migration, persistent readback, and mixed human/Agent authors with PostgreSQL tests.

### Task 3: Workspace completion attention

**Files:** Workspace/session Client projection, left-navigation state and tests.

- [x] Test the native `completionUnread` status setting the Workspace dot and its cleared status removing the dot.
- [x] Derive the live dot from `uiSession.sessionStatus`, excluding room execution Sessions.
- [ ] Persist a per-user Session completion cursor. The current UI status is process-local and a full reload clears its dot.

### Task 4: Release checks

- [ ] Run focused tests, Host/Client typecheck, Client i18n and paired-doc gates, Web build, and PostgreSQL integration after the corrected placement.
- [ ] Verify three tabs and dots in the authenticated local SUNFLECK left sidebar while Session details remain on the right.
