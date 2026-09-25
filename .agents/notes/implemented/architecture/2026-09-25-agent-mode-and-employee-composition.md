# Agent Note: Agent mode and employee composition

Status: implemented

English | [中文](2026-09-25-agent-mode-and-employee-composition.zh.md)

## Problem

Selecting a published employee as the Session's Agent Preset replaced the work mode the user had selected. It also made employee memory and learning infer identity from the preset field, although that field describes tools and work style. The earlier [employee ownership decision](2026-09-25-digital-employee-and-agent-mode-ownership.md) established separate management homes but did not separate the two runtime selections.

## Decision

A Session keeps its Agent Preset as the base work mode. Before the first turn, an authorized user may select a published digital employee in the same Workspace. A required Session event records the employee id, immutable release id, organization, and owner independently of preset changes. The employee persona mounts in the Agent scope and overrides only the mode's persona section; mode tools and other sections remain active. Session restoration loads that same release after validating its recorded owner and Workspace. The employee identity supplies private memory and learned capability context; the release id pins existing learned text. A Workspace default preselects only the employee. Goal-first work creates the base mode Session and binds the chosen release separately.

Existing Sessions whose preset is an employee declaration continue to replay through the historical registry path. Employee declarations remain visible to the authorized roster but are excluded from general mode selection and global defaults. Capability labels describe responsibilities and do not grant executable tools or data permissions.

## Alternatives considered

**Copy a selected mode into a new employee preset for each combination.** Rejected because every combination would need its own version and replay identity, while changing the mode would still replace the employee's runtime generation.

**Infer the employee from the current Agent Preset.** Rejected because Standard, PTC, and custom modes can all serve the same employee, and a mode switch must preserve the employee identity.

## Consequences

- New Sessions have two independent selections and one immutable employee release reference.
- A mode change before the first turn preserves the selected employee; employee changes preserve the mode.
- Existing employee-preset Sessions retain their historical replay path. The new event becomes part of the required Session format understood by this release.
