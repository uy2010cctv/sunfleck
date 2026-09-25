# SUNFLECK 会话导航实施计划

> **For agentic workers:** Use subagent-driven-development to implement these tasks with focused review; work in the isolated `codex/sunfleck-conversation-surfaces` checkout.

**Goal:** 将已确认的工作区私聊、群聊和频道导航接入真实 SUNFLECK 会话与右侧详情，使用持久化业务数据。

**Architecture:** 左侧使用 sidebar 扩展插槽，正文复用原生 Session 会话及输入框，右侧使用现有 sidebarRight 标签。PostgreSQL 保存协作成员、话题与 Session 关联；消息经 Session prompt 路由扩展进入已有员工或 TeamRun 执行，授权在 Host 校验。

**Tech Stack:** Cordis / React / TypeScript / PostgreSQL / Vitest / dsh profiles.

## Tasks

- [ ] 1. Add `sidebar.sections` list slot (wide/expandSidebar owner) below workspace browser; test column/rail rendering and disposal. Files: `packages/client/ui-sidebar/src/client/{index.ts,SidebarRoot.tsx,contract/slots.ts,SidebarRoot.module.css}` and shell tests. Preserve ordinary sidebar with no occupant.
- [ ] 2. Add `api/session-prompt` waterfall with `SessionPromptRequest` and `next(): Promise<SessionPromptValue>`; native command remains terminal handler. Test interception, delegation, errors, and disposal in `packages/api/session-controller/tests/prompt-routing.host.spec.ts`. No Agent-loop changes or new log generations.
- [ ] 3. Extend PostgreSQL collaboration persistence and authenticated HTTP list/detail/create/open/messages/by-session paths. Record explicit users, published employee presets, workspace, topics and source Session ids. Route charter groups through TeamRun, federated groups by mentions, channels by topic/mention/duty. Reject unsupported attachment payloads before delivery. Test reload, membership, routing, terminal topics and idempotency. Backend subtask owns `enterprise-postgres` collaboration repository and `enterprise-controller` route/runtime files.
- [ ] 4. Extend Session access only for explicit collaboration members with current workspace access. Keep owner-only mutations owner-only. Test outsiders, other orgs, revoked workspace access, legitimate member read/prompt and owner operations. Auth subtask owns `enterprise-auth-web` and identity read seam.
- [ ] 5. Add client collaboration state/controller: same-origin typed HTTP requests, request generation cancellation, lists, surface selection, first-message setup, topic/member selection, native Session opening, refresh restore. Unit tests must cover permission/unavailable/loading/retry and stale responses.
- [ ] 6. Add sidebar group/channel rows, creation form using visible employees/workspaces, right detail tab, per-session header/context controls. Localized copy, existing tokens/icons; no sample records, duplicate sidebar, or parallel chat engine. Add project and employee context where existing authorized APIs resolve them.
- [ ] 7. Run focused client/API/auth tests, affected type checks, i18n, docs pairing, source diff checks, built profile smoke, and browser workflow at native desktop/narrow widths. Validate create → select → send → durable response → reload/readback; record limitations honestly. Update package README pairs with actual behavior and preserve unrelated primary-checkout changes.

## Acceptance

The original SUNFLECK shell, workspace tree and composer remain visible. Group/channel rows reflect stored authorized entities. Sending uses actual native sessions and preserves group/turn routing after reload. Shared access never follows possession of an id alone. Employee/project/team/channel details show authorized source facts; absent data stays explicitly absent. No remote release is claimed before runtime and rendered verification.
