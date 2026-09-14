# Agent Note: Bind provider knowledge to employees

Status: implemented

English | [中文](2026-09-14-bind-provider-knowledge-to-employees.zh.md)

## Problem

The capability-assets Knowledge page embedded the provider's management UI, but employee editing still read only enterprise-catalog assets. A provider knowledge base therefore increased the management-page count without becoming selectable for an employee or a conversation.

## Decision

The employee editor owns an `enterprise.employee-knowledge-bindings` slot in its Knowledge category. A knowledge provider receives the employee Preset id, renders its own base selector, persists its own references, and reports the selected count. The enterprise catalog remains the source for versioned native assets; provider documents are not copied into it.

Conversation plugins may contribute a session-scoped control to `conversation.input.left`. The provider resolves the effective retrieval scope in order: explicit conversation selection, employee Preset binding, then its existing global selection. An explicit empty conversation selection matches no bases. Restoring inheritance removes only the conversation override.

The binding contribution stays mounted across capability-category switches so it can load saved counts even while its controls are hidden. Native fallback controls render only in the active Knowledge category.

Roster and overview counts use a read-only `summaryOnly` presentation of the same provider slots. Counts come from saved employee bindings or available base metadata, independently of editor navigation. `refreshKey` triggers a new read, and null distinguishes loading or unavailable data from a confirmed zero. Providers ignore responses after their summary unmounts or its request changes.

## Alternatives considered

Mount only the selected category. Rejected because the count cards remain visible in every category and after editor reload.

## Consequences

Provider bindings follow the stable employee Preset identity and apply to new conversations without duplicating document content. The provider must enforce the same effective scope for proactive retrieval and model-facing knowledge tools. Employee draft publication and native asset versioning remain separate operations.

## Verification

Workbench tests prove saved counts load before selecting Knowledge, the contribution survives category switches, and publish-style reloads and employee changes refresh the count. Provider tests cover durable employee/session mappings, precedence, explicit empty scope, UI registration, and conversation-scoped automatic retrieval.
