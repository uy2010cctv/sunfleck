# Design — DeepSeek Harness Enterprise

A locked design system for the enterprise digital-employee layer. Existing DSH conversation, settings, and tool surfaces remain functional; enterprise surfaces use this system and integrate through DSH slots rather than replacing route or runtime ownership.

## Genre

modern-minimal, designed for an Operate surface

## Direction

Employee Operations Deck. The interface treats digital employees as finite operational identities and work as evidence-backed records. It refuses a generic analytics dashboard and a StaffDeck visual clone: the primary structure is an employee roster paired with live work state, recent records, and direct entry into the existing DSH conversation surface.

## Macrostructure family

- App shell: Workbench with a persistent DSH sidebar action and a frame-level enterprise surface.
- Employee discovery: finite roster grid with whole-cell status and capability summaries.
- Operations: dense but quiet work-record list, exception-first status, and direct return to the source Session.
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
- Whole employee cards are keyboard-addressable with an explicit primary action.
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

## Employee card

- Identity: display name, stable preset id as employee code, position, department.
- State: active, waiting for review, ready, or unavailable, derived from real Session and Preset state.
- Capability summary: explicit metadata when present; no invented capability counts.
- Work summary: active and recent Session counts derived from the Session list.
- Trust: locally authored presets remain visibly marked as custom definitions.

## Work record

- Source of truth: Session summary and its projections.
- Shows title, employee, business space, last update, running/completed/attention state.
- Never invents an SLA, completion percentage, owner, or business outcome absent from DSH events.

## Responsive behavior

- Desktop: summary rail, employee grid, and work-record panel in one workbench.
- Tablet: summary rail becomes a horizontal strip; roster and records stack.
- Mobile: single column, sticky close/primary controls, no horizontal scroll.
- Existing DSH sidebar auto-collapse remains authoritative.

## Accessibility

- Keyboard traversal and Escape dismissal.
- Visible focus on every interactive element.
- `aria-live` for load failures and refreshed operational counts.
- Status icon plus text; color is supplementary.
- Chinese and English locale dictionaries ship together.

## What surfaces must share

- Cobalt action/focus accent and restrained status palette.
- Existing DSH font, primitive, radius, border, and theme vocabulary.
- Employee status words and work-record state mapping.
- Whole-cell roster behavior and exception-first operational hierarchy.

## What surfaces may differ

- Roster density may change with viewport.
- Work-record presentation may use list or table depending on available width.
- Future team and approval surfaces may add domain-specific columns while retaining the same state vocabulary.

## Exports

Production tokens live in `packages/client/ui-enterprise-workbench/src/client/tokens.css`. The file defines enterprise semantic aliases over the existing DSH theme variables so light/dark theme ownership remains centralized.
