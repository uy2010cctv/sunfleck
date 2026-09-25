# SUNFLECK 会话导航实施计划

> **For agentic workers:** Use subagent-driven-development to implement these tasks with focused review; work in the isolated `codex/sunfleck-conversation-surfaces` checkout.

**Goal:** 将已确认的工作区私聊、群聊和频道导航接入真实 SUNFLECK 会话与右侧详情，使用持久化业务数据。

**Architecture:** 左侧使用 sidebar 扩展插槽，正文复用原生 Session 会话及输入框，右侧使用现有 sidebarRight 标签。PostgreSQL 保存协作成员、话题与 Session 关联；消息经 Session prompt 路由扩展进入已有员工或 TeamRun 执行，授权在 Host 校验。

**Tech Stack:** Cordis / React / TypeScript / PostgreSQL / Vitest / dsh profiles.

## Tasks

- [x] 1. Add `sidebar.sections` list slot (wide/expandSidebar owner) below workspace browser; test column/rail rendering and disposal. Files: `packages/client/ui-sidebar/src/client/{index.ts,SidebarRoot.tsx,contract/slots.ts,SidebarRoot.module.css}` and shell tests. Preserve ordinary sidebar with no occupant.
- [x] 2. Add `api/session-prompt` waterfall with `SessionPromptRequest` and `next(): Promise<SessionPromptValue>`; native command remains terminal handler. Test interception, delegation, errors, and disposal in `packages/api/session-controller/tests/prompt-routing.host.spec.ts`. No Agent-loop changes or new log generations.
- [x] 3. Extend PostgreSQL collaboration persistence and authenticated HTTP list/detail/create/open/messages/by-session paths. Record explicit users, published employee presets, workspace, topics and source Session ids. Route charter groups through TeamRun, federated groups by mentions, channels by topic/mention/duty. Reject unsupported attachment payloads before delivery. Test reload, membership, routing, terminal topics and idempotency. Backend subtask owns `enterprise-postgres` collaboration repository and `enterprise-controller` route/runtime files.
- [x] 4. Extend Session access only for explicit collaboration members with current workspace access. Keep owner-only mutations owner-only. Test outsiders, other orgs, revoked workspace access, legitimate member read/prompt and owner operations. Auth subtask owns `enterprise-auth-web` and identity read seam.
- [x] 5. Add client collaboration state/controller: same-origin typed HTTP requests, request generation cancellation, lists, surface selection, first-message setup, topic/member selection, native Session opening, refresh restore. Unit tests must cover permission/unavailable/loading/retry and stale responses.
- [x] 6. Add sidebar group/channel rows, creation form using visible employees/workspaces, right detail tab, per-session header/context controls. Localized copy, existing tokens/icons; no sample records, duplicate sidebar, or parallel chat engine. Add project and employee context where existing authorized APIs resolve them.
- [ ] 7. Run focused client/API/auth tests, affected type checks, i18n, docs pairing, source diff checks, built profile smoke, and browser workflow at native desktop/narrow widths. Validate create → select → send → durable response → reload/readback; record limitations honestly. Update package README pairs with actual behavior and preserve unrelated primary-checkout changes.

## Acceptance

The original SUNFLECK shell, workspace tree and composer remain visible. Group/channel rows reflect stored authorized entities. Sending uses actual native sessions and preserves group/turn routing after reload. Shared access never follows possession of an id alone. Employee/project/team/channel details show authorized source facts; absent data stays explicitly absent. No remote release is claimed before runtime and rendered verification.

## Implementation evidence

The implementation lives on `codex/sunfleck-conversation-surfaces`, based on the native SUNFLECK shell. The local source-profile preview uses `http://127.0.0.1:3187`; the remote service on port 5173 is unchanged.

- Frontend collaboration and sidebar checks: 48 tests passed across nine files. Security, employee selection, and work-start checks: 48 tests passed across three files. Shared-memory regressions: 48 tests passed across two files. Pinned Session context: 11 tests passed. Collaboration routing and receipt checks: 42 tests passed across three files.
- Locale ownership passed for 873 client source files. New routing covers spaced employee names and resolves persisted TeamRun ids independently of catalog pagination. Existing Sessions retain their selected employee release and work mode.
- Native browser verification before the final compatibility changes covered group creation, stored transcript reopening, cross-employee mentions, channel topic creation, `/done`, and right-sidebar details. The Mac was locked during the final browser pass; the latest rendered state still needs that pass after unlock.
- Repository-wide documentation and persistence-acknowledgement gates have unrelated baseline failures. The built-profile runtime smoke is not established; source-profile runtime evidence must be reported separately from compilation and bundle results.
- PostgreSQL collaboration supports explicit employee memory tools. Automatic completed-turn private writeback still depends on the existing account-anchoring path and is outside this navigation change.

### Final source-profile verification

The affected Host graph, full Client graph, Host and Client bundles, and Web Vite build passed. The real PostgreSQL source-profile regression passed with a deterministic external model: group/channel creation, idempotent sending, authorized persisted WebSocket replies, work mode `standard`, and employee release pinning. Publishing version 2 preserves version 1 in an existing group Session and its details; a new channel Session selects version 2. This run also verified the controller's `sessionProjections` dependency declaration through actual profile startup. It does not establish production deployment or a real external-model response.
