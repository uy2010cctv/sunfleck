# Design — DeepSeek Harness Enterprise

A locked design system for the enterprise digital-employee layer. Existing DSH conversation, settings, and tool surfaces remain functional; enterprise surfaces use this system and integrate through DSH slots rather than replacing route or runtime ownership.

## Genre

modern-minimal, designed for an Operate surface

## Direction

Employee Operations Deck. The interface treats digital employees as finite operational identities and work as evidence-backed records. It refuses a generic analytics dashboard and a StaffDeck visual clone: the primary structure is an employee roster paired with live work state, recent records, and direct entry into the existing DSH conversation surface.

## Macrostructure family

- App shell: Workbench with a persistent DSH sidebar action and a frame-level enterprise surface.
- Employee discovery: StaffDeck-inspired roster gallery with dominant search, release tabs, explicit conversation actions, and capability evidence.
- Operations: dense but quiet work-record list, exception-first status, and direct return to the source Session.
- Team operations: reusable Team Definitions, a deliberate launch review, one evidence-first Team Room, and a cross-Run Human attention queue.
- Conversation: existing DSH conversation and details columns remain unchanged.

## Theme

- Strategy: restrained neutrals plus one cobalt action accent.
- Light surfaces use cool white and mist-gray layers; dark surfaces inherit DSH graphite layers.
- Accent is reserved for primary actions, current selection, focus, and active work.
- Status colors have paired icon/text labels and never carry meaning alone.
- StaffDeck illustrations and character assets are excluded.

## Typography

- Display and body: the existing DSH interface font token, medium and semibold only where hierarchy requires it.
- Code and ids: the existing DSH code font token.
- Headings are roman, compact, and sentence case.
- Data uses tabular numerals where supported.

## Spacing

4-point named scale. Enterprise CSS consumes semantic tokens and does not introduce ad-hoc inline color or font declarations.

## Motion

- 150–220 ms state transitions.
- Transform and opacity only.
- No orchestrated page-load animation.
- Reduced motion removes spatial movement and keeps an immediate or short opacity transition.

## Microinteractions stance

- Silent success; errors and blocked work remain visible until resolved.
- Employee cards expose explicit Manage and Start conversation controls; the surrounding card is descriptive, not a second hidden action.
- Hover clarifies elevation; focus uses an immediate high-contrast ring.
- Loading uses skeleton rows; empty states teach how to create or select an employee.
- Closing the workbench returns focus to its sidebar trigger.

## Enterprise navigation

- The existing DSH sidebar and session browser remain the shell authority.
- The `数字员工` / `Digital employees` action opens the enterprise workbench through `shell.overlay`. It belongs to the same bottom control group as Settings and sits directly above Settings in both the expanded column and collapsed rail.
- The overlay contains its own close control and does not replace the conversation slot.
- Selecting a work record closes the overlay and opens the source Session.
- Starting work with an employee creates a Session using that Agent Preset, then opens the existing conversation.

## Governance directory and memory

- The organization surface is a split view: keyboard-operable department tree on the left, selected department identity, members, and shared Workspace evidence on the right.
- User rows keep role, department membership, primary department, status, and action visible together; department selection uses native multi-select behavior rather than custom draggable chips.
- Workspace rows distinguish personal from department scope, show the real managed root, and expose the sandbox mode as an operational control. The UI states that changes apply to new Sessions.
- The memory surface separates proposed items from the approved enterprise awareness stream. It shows a short business summary, stable memory id, scope, kind, and source digest prefix, never raw conversation content.
- Memory approval requires a visible reason. Privacy rejection remains an error state rather than silently rewriting the proposed summary.

## Cordis Workspace extensions

- The enterprise workbench owns one `Extensions` page instead of introducing a separate low-code shell. Its Workspace selector follows the current Session's Workspace and falls back only when the current Session cannot be resolved.
- Scope is the primary wayfinding device: current running, personal, department, organization, and pending review use a quiet underline tab row over the same operational list.
- Extension versions render as evidence rows, not equal-sized dashboard cards. Name, stable Plugin id, immutable version, purpose, provided capabilities, isolation level, author, source, and lifecycle actions remain visible in one reading path.
- Empty extension scopes use the existing evidence-panel empty state. Desktop navigation stays compact at the top of its rail; mobile navigation becomes two columns and extension scope tabs scroll inside their own row without page-level horizontal overflow.
- Stop and rollback remain secondary actions. Department approval requires a visible reason; organization publication is explicit and never presented as an automatic consequence of department approval.

## Human–Agent team surfaces

The Team surface makes Human authority and Agent execution visible without creating a second runtime. A Team Definition is a reusable operating template; a Team Run is one execution rooted in a DSH Session. Every surface links state, evidence, and actions back to that Run's authoritative Session events.

### Team Definition

- The definition opens with a Human-authored charter: North Star, desired outcome, explicit non-goals, constraints, decision rights, stop conditions, and review cadence.
- One roster contains Human and Agent rows. Human rows show decision responsibility and availability; Agent rows show role, Agent Lead or member status, release, model route, Credential identity, capabilities, and current trust grants.
- Each trust grant is visibly scoped by Agent, task type, capability, and one of `observe`, `propose`, `execute-reviewed`, or `execute-delegated`. Broad labels such as “autonomous” never replace the scope.
- The definition selects one accountable Agent Lead. Doer and Verifier assignments remain separate for task classes whose risk policy requires independent verification.
- Saving a definition creates a reusable version, not a Run, task, approval, or Session. Editing a definition never changes an active Run silently.

### Launch panel

- Launch begins from an exact Team Definition version and asks the Human to confirm the Run-specific North Star, Workspace, source context, deadline or stop condition, participating roster, capability grants, verification policy, and decision policy.
- The summary highlights missing Agent credentials, unpublished Employee Releases, unavailable Humans, overlapping write scopes, absent Verifiers, and grants broader than the selected task types before the primary action is enabled.
- Launch creates one DSH root Session and shows its work-record identity. It does not imply that any task has completed or that any external channel received a notification.
- The panel lets the Human narrow grants for this Run but never widens them beyond enterprise policy or the selected definition without a separately attributable authorization.

### Team Room

- The North Star stays pinned with owner, success evidence, non-goals, and stop conditions. A material change is a Human decision recorded in the Run, not an unannounced prompt edit.
- The shared roster shows Humans and Agents together with role, presence, current assignment, trust scope, blocked state, and direct entry to the relevant DSH conversation. Agent credentials remain independent and secret values are never displayed.
- The task DAG is the primary work view. Nodes show owner, Doer, Verifier, dependencies, readiness, evidence state, and the source Session; progress is derived from recorded transitions rather than invented percentages.
- The decision queue separates proposals, approvals, escalations, and irreversible choices. It groups compatible items for batch review while preserving urgency, dependency order, expiry, and a clear single-item path.
- Verification pairs each claimed result with method, Verifier, timestamp, observed evidence, and unresolved concern. A Doer's completion claim and a Verifier's acceptance remain distinguishable.
- Artifacts show their producing task, version or digest, review state, and owning Workspace. The event timeline interleaves Human decisions, Agent actions, approvals, task transitions, verification, artifacts, and channel delivery evidence from DSH records; an ambiguous external result remains a visible unknown outcome with a reconciliation action.
- The Agent Lead may decompose, assign, coordinate, request verification, and recommend a decision within its grants. It cannot approve its own escalation, broaden autonomy, or make an irreversible Human-owned decision.

### Cross-Run attention

- `待我处理` / `Needs my attention` is a persistent entry outside any one Team Room. It aggregates only items the authenticated Human may decide across active and paused Runs.
- The default order is risk and expiry first, then blocked downstream work and age. Filters cover organization, department, Team, decision type, and urgency without hiding the count of filtered urgent items.
- Batch decisions are available only when every selected item has the same action semantics, authorization requirement, and visible consequence. The confirmation states the affected Runs and records one attributable decision per item.
- Opening an item preserves return context, shows the smallest sufficient evidence packet, and links to the full Team Room timeline. Resolving it updates the DSH Run and advances to the next compatible item without losing the queue position.

## Employee card

- Avatar: DiceBear Lorelei rendered from an opaque persisted seed. New employees receive a random seed; names, emails, and other personal data never become avatar seeds. Existing records without a seed fall back to their stable Preset id.
- Identity: display name, position, department, and release state. Owner ids, revisions, visibility internals, and binding ids stay in management views.
- Purpose: responsibility description is the primary body copy; an honest missing-description state replaces technical ids.
- Capability summary: explicit profile tags plus real Knowledge, Skill/Tool, and SOP binding counts. No inferred abilities or fabricated totals.
- Action: Start conversation is primary and Manage is secondary. Cards never require selection before the primary action appears.
- Discovery: search matches the stored profile and Preset id; All, Published, and Draft tabs are the primary filters, with owner and visibility behind More filters.

## Work record

- Source of truth: Session summary and its projections.
- Shows title, employee, business space, last update, running/completed/attention state.
- Never invents an SLA, completion percentage, owner, or business outcome absent from DSH events.

## Management creation flows

- Schedules, capability assets, and teams open with a purpose statement and one primary action; raw ids and JSON are never the first interaction.
- Schedule creation requires a published employee and asks for task name, employee, instructions, human frequency, time, and timezone. DSH derives the immutable schedule id and cron rule.
- Capability assets are independently creatable. The user names the capability, selects its type, explains its purpose, and enters reusable content; DSH derives the asset id and structured content envelope.
- Team Definition creation requires a Human North Star owner and at least one published Agent. The user chooses one accountable Agent Lead, adds Human and Agent members to the shared roster, and scopes autonomy by Agent, task type, and capability.
- Missing prerequisites use an actionable empty state that links back to Digital employees. A generic empty-record message is not acceptable on these pages.
- Employee editing uses a two-column identity layout on desktop: a persistent avatar/profile preview supports a linear form divided into profile, responsibilities/runtime, and access/capabilities. Mobile stacks the preview above the same DOM-order form. Save/publish actions stay visible in one sticky footer; validation remains adjacent to the form rather than dominating the page.
- Employee department is selected from the authenticated organization directory. Free-text department entry is not permitted because the employee profile must use the same department names that govern shared Workspaces and visibility.
- Employee model selection reuses the native `session/modelCatalog` projection, grouped by configured provider. Prompt optimization is an explicit secondary action beside the responsibility field; it uses the selected configured route, replaces only the unsaved local prompt, and never persists until the operator saves the draft.

## Responsive behavior

- Desktop: grouped operations rail and a three-column employee gallery; narrower operational pages retain their evidence-row layouts.
- Tablet: summary rail becomes a horizontal strip; roster and records stack.
- Mobile: single-column gallery, contained horizontal navigation, visible actions on every card, no page-level horizontal scroll.
- Team Room keeps the North Star and attention count above a tabbed task, decision, verification, artifact, and timeline sequence on tablet and mobile; the DOM order matches that reading order at every width.
- Existing DSH sidebar auto-collapse remains authoritative.

## Accessibility

- Keyboard traversal and Escape dismissal.
- Visible focus on every interactive element.
- `aria-live` for load failures and refreshed operational counts.
- Status icon plus text; color is supplementary.
- Task DAG relationships have an equivalent keyboard-readable dependency list, and batched decisions announce selection count, consequence, and partial failure.
- Chinese and English locale dictionaries ship together.

## What surfaces must share

- Cobalt action/focus accent and restrained status palette.
- Existing DSH font, primitive, radius, border, and theme vocabulary.
- Employee status words and work-record state mapping.
- Whole-cell roster behavior and exception-first operational hierarchy.

## What surfaces may differ

- Roster density may change with viewport.
- Work-record presentation may use list or table depending on available width.
- Team and approval surfaces may add domain-specific columns while retaining the same state vocabulary and Human authority cues.

## Exports

Production tokens live in `packages/client/ui-enterprise-workbench/src/client/tokens.css`. The file defines enterprise semantic aliases over the existing DSH theme variables so light/dark theme ownership remains centralized.
