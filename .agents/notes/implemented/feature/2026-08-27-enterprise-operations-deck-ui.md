# Agent Note: Enterprise operations deck uses authenticated read models

Status: implemented

English | [中文](2026-08-27-enterprise-operations-deck-ui.zh.md)

## Problem

The first enterprise workbench projected Agent Presets and the current browser Session mirror. That was a useful ordinary-profile fallback, but it could not operate the persistent employee catalog, release history, approvals, schedules, capability assets, or fixed teams added to the enterprise Host. Treating a transport or permission failure as a reason to fall back would also broaden the visible projection and conceal the actual failure.

## Decision

`@deepseek-ai/dsh-client-ui-enterprise-workbench` is the enterprise operations deck over the typed `enterpriseEmployees`, `enterpriseAssets`, `enterpriseTeams`, and `enterpriseOperations` client domains. Its overlay-local navigation owns digital employees, work records, approvals, schedules, capability assets, and teams. Enterprise governance, identity, credentials, and model administration remain Settings surfaces.

The employee roster sends search, status, visibility, owner, limit, and cursor fields to the Host. Its first view is an employee gallery: dominant search, All/Published/Draft release tabs, grouped Use/Manage navigation, responsibility-first employee cards, factual Knowledge/Skill/SOP binding counts, and one explicit Start conversation action. Owner id and visibility remain available under More filters; revision, ownership, visibility, and binding ids stay out of the roster card and remain in employee management. The employee editor loads one persistent draft and its release history, keeps changes local until explicit save, validates supported profile fields, sends the current `expectedRevision`, preserves dirty input on `enterprise-conflict`, and exposes publish and rollback as separate mutations. Work, approval, schedule, asset, and team pages use their typed read models and revision-fenced mutations. Browser payloads never contain `orgId` or `principal`; the authenticated Host owns those values.

Schedule, asset, and team creation use business forms rather than internal contracts. Schedules select an immutable published employee release and translate a human frequency and time into the stored rule. Assets generate their ids and store a structured purpose/content envelope; SOP lines become ordered steps. Teams generate their ids, require at least two published employees, and use one lead selector plus explicit member checkboxes. When prerequisites are absent, the page explains exactly what must be published and links back to Digital employees instead of rendering disabled or empty selects.

The runtime's single Host-stream consumer emits decoded `connection/host-frame` events after the native Session and Workspace folds. Every enterprise frame carries a resource type (`employee`, `asset`, `team`, `work-record`, `approval`, `schedule`, or `outbox`). The workbench bounds and deduplicates `eventId` values and refreshes the matching read model without guessing from the visible page. All mutations run through one contained error, conflict, and retry state; each action generates its idempotency key before constructing the retry closure, so a retry reuses the same key. Conflicts remove the stale mutation retry closure and reload authoritative state instead. Employee conflicts keep local fields beside the server comparison until the operator explicitly adopts the server draft or keeps local fields on the new revision. A failed reload makes only that reload retryable. Failures do not escape as unhandled rejections. Page states are independent, so a forbidden or failed read can coexist with usable successful pages.

Employee list and cursor reads, domain page reads, editor loads, and mutation attempts carry client generations. Only the latest matching generation may commit state. Enterprise event IDs become seen only after their targeted refresh succeeds, so a failed event can be replayed. Concurrent starts for one employee share one in-flight Session creation. Schedule, asset, and team form dirtiness joins employee draft dirtiness in the overlay leave guard, and mutation controls are disabled while the current mutation attempt is running.

Schedule, asset-version, and team-save mutations return a current-attempt success receipt. Their local forms clear dirtiness only for `true`; failure, conflict, or an attempt superseded by newer work retains the local draft and its leave guard.

An ordinary profile falls back to the Agent Preset, Session, and Workspace projection only when `enterpriseEmployee.list` explicitly reports that the enterprise API is unavailable. Authorization, cursor, transport, and other internal failures stay visible and never trigger fallback.

## Direction Contract

seed: enterprise-operations-deck-v1

### FORM

An additive DSH overlay with a grouped desktop operations rail, contained narrow-screen navigation, a three-column employee gallery, explicit card actions, and quiet record rows. Governance stays in Settings.

### TYPE

Existing DSH interface and code fonts, compact sentence-case headings, restrained medium/semibold hierarchy, tabular operational values, and paired Chinese/English product vocabulary.

### MATERIAL

Existing DSH surface, border, radius, focus, and cobalt semantic tokens. Cards remain flat operational cells; nested cards, inline colors, fabricated metrics, illustrations, and emoji are excluded.

### GROUND

Cool canvas and raised neutral surfaces in light mode, inherited graphite layers in dark mode, cobalt only for selection/action/focus, and status meaning always paired with text.

### FIRST VIEWPORT

The close header remains visible; operators first see grouped Use/Manage navigation and an employee gallery whose search and release tabs precede the roster. At 320 px navigation scrolls inside its own row and every single-column employee card keeps Manage and Start conversation visible without page horizontal scroll.

## Alternatives considered

- **Keep the Agent Preset and Session projection as the enterprise source of truth** — it has no persistent release, approval, schedule, asset, or team records and cannot represent cross-user permission-filtered enterprise state.
- **Fall back on every enterprise API error** — this hides outages and authorization failures while potentially showing a broader native projection than the authenticated enterprise read model allowed.
- **Put enterprise navigation and governance into one administrator dashboard** — ordinary operators need operational records, while identity, credentials, models, and organization policy have a different permission and task boundary already owned by Settings.
- **Open a second Host event stream in the workbench** — the client runtime already owns the one stream pump; forwarding decoded frames preserves single-consumer transport ownership and lets additive read-model clients subscribe locally.

## Consequences

Operators can choose an employee and create schedules, assets, and teams without understanding Preset ids, release ids, revisions, ownership ids, binding ids, cron syntax, or JSON envelopes, while advanced management remains available in the same overlay and the native conversation remains the execution surface. The deck has responsive 320 px, tablet, and desktop layouts; keyboard focus containment, Escape handling, dirty-leave confirmation, reduced-motion behavior, and paired Chinese/English vocabulary are part of the component contract. The UI deliberately shows no productivity, SLA, percentage, or inferred business-result metrics. Focused controller, React, API-fallback, conflict, event-deduplication, mutation-payload, prerequisite, and responsive-style tests pin the boundary.
