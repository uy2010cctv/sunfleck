# Group Room Schedules Implementation Plan

> **For agentic workers:** Execute these steps in order with test-driven development. No delegation is required for this task.

**Goal:** Let a group Agent create durable reminders in its bound Session, show those tasks in that group's details, and publish scheduled Agent replies in the same signed room.

**Architecture:** Reuse the Host Schedule service and its six recurrence selectors. Group room Sessions already bind one employee to one room; schedule records keep that Session id. The collaboration Host verifies current room membership for management reads and uses the durable `schedule` user-message source to project scheduled turns into the signed room log.

**Tech Stack:** Cordis, TypeScript, PostgreSQL room events, Host Schedule, React.

---

### Task 1: Signed scheduled replies

**Files:** `packages/api/enterprise-controller/src/collaboration-room-delivery.ts`, `collaboration-runtime.ts`, and their focused tests.

- [ ] Add a failing test: a completed turn with a Host `schedule` user message in a group-bound employee Session produces one signed employee post; ordinary private, channel, and unrelated turns do not.
- [ ] Run `pnpm exec vitest run packages/api/enterprise-controller/tests/collaboration-room-delivery.spec.ts packages/api/enterprise-controller/tests/collaboration-runtime.spec.ts` and observe the expected failure.
- [ ] Extend the narrow turn-source projection and the idempotent room append path. Record the schedule source cursor in the signed event. On recovery, the same source cursor must resolve to the existing post.
- [ ] Re-run the focused tests and commit this unit.

### Task 2: Authenticated group schedule management

**Files:** `packages/api/enterprise-controller/src/collaboration-http.ts`, a group schedule adapter under the same package, and focused HTTP tests.

- [ ] Add failing GET tests that list only active Schedule records whose Session ids are bound to the authorized group, plus cases for another room, a revoked member, and a channel.
- [ ] Add a failing DELETE test: only the group administrator or the Schedule's employee Session owner can remove an exact group task; a foreign task id is rejected.
- [ ] Use `ctx.schedule.list` and `ctx.schedule.delete` after current room authorization; do not expose the Host-wide catalog to the browser. Return employee display name, task id, title, prompt, next time, and recurrence fields.
- [ ] Re-run the focused tests and commit this unit.

### Task 3: Group detail panel

**Files:** `packages/client/ui-enterprise-workbench/src/client/CollaborationGroupSchedules.tsx`, `CollaborationRoom.tsx`, its controller and locale files, and focused client tests.

- [ ] Add failing tests for a group-only task section, task list, loading/empty/error states, refresh, and an exact delete action.
- [ ] Render the section inside the existing group detail pane. Use the authorized room endpoint and existing button, dialog, and feedback primitives. Show the task's employee and next run, and explain that the Agent can create or update it in the group chat.
- [ ] Re-run client tests and commit this unit.

### Task 4: Agent guidance, docs, and end-to-end verification

**Files:** group room prompt and snapshot/test owner, affected English/Chinese READMEs with pairing records.

- [ ] Add a failing model-input test that a group Agent is told to use the existing `schedule_create` tool for group work and not to write a parallel OS scheduler.
- [ ] Implement the bounded prompt text, update affected docs, and record bilingual pairs.
- [ ] Run targeted tests, typecheck/build, and a real test that creates a short-lived group Schedule and observes the scheduled reply in that same room. Remove the test Schedule afterward.
- [ ] Merge into local master after verification and deploy 47 with a browser readback.
