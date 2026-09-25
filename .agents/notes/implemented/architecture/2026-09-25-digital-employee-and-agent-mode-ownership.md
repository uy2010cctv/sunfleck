# Agent Note: Digital employee and Agent mode ownership

Status: implemented

English | [中文](2026-09-25-digital-employee-and-agent-mode-ownership.zh.md)

## Problem

The enterprise catalog publishes employee identities as Agent Preset declarations so Sessions can run them. Showing those declarations as ordinary custom modes makes one employee appear to have two management homes and permits an employee to become the global new-task default for users who cannot use it.

The later [mode and employee composition decision](2026-09-25-agent-mode-and-employee-composition.md) changes how new Sessions bind employees while retaining this catalog ownership and historical replay path.

## Decision

The catalog Draft and immutable Release own the employee identity, permissions, responsibilities, and version. The Agent Preset registry owns the executable composition and marks a catalog projection as `kind: employee`; ordinary declarations are work modes. Settings offers only work modes as global defaults. The enterprise picker lists only authorized published employees and reports the release mounted in the Agent's retained generation.

A Workspace may store one employee identity as its default. Its owner or authorized manager edits the value with a revision check. A member sees the choice only while the employee remains published and visible; otherwise the new-session view uses Standard mode and explains the fallback. The choice is overridable and sends no task message. Employee selection is reauthorized against the Session owner, Workspace grant, and employee catalog before the Host changes a blank Session and records its mounted release.

The Operations work record verifies a Session through the organization-scoped Session–Workspace binding in the identity database. Session logs can live in a separate V4 database, so checking legacy headers in the main database would reject a valid newly created Session.

The older employee direct-message directory stays in source and storage but is hidden from the workbench until its PostgreSQL runtime can serve the complete workflow. Existing Session ids and history are not rewritten.

## Alternatives considered

**Keep employees in the custom-mode group.** Rejected because a runtime declaration does not own employee publishing or authorization, and the global default can fail across users and organizations.

**Make a Workspace default mandatory.** Rejected because members need to switch to another authorized employee or a general work mode for a different task.

## Consequences

- Workspaces own shared employee preselection, while the catalog remains the authority for employee releases and visibility.
- Generic presets remain reusable without becoming enterprise employees.
- A Session records the employee preset id and the work record records the immutable release used at selection. Session replay still follows the registry's current-definition rule after a process restart; it does not reconstruct retired code generations from a release snapshot.
