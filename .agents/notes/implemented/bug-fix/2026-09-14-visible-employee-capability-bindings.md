# Agent Note: Visible employee capability bindings

Status: implemented

English | [中文](2026-09-14-visible-employee-capability-bindings.zh.md)

## Problem

The employee editor counted existing bindings on its category cards but excluded those assets from the picker and exposed their references only in read-only JSON. An employee with every available asset bound appeared unable to select any capability; an empty category and a failed catalog load looked the same.

## Decision

The editor shows bound names and pinned revisions per category, keeps current catalog assets selectable with an explicit bound label, and disables duplicate binding. Updating an asset replaces its previous references for the same kind and asset ID. Removing one row preserves every other binding. Archived or absent catalog assets remain visible through their stored references instead of disappearing.

Category counts describe bindings. Loading, permission or load failures, no available assets, and all assets already bound receive distinct presentation. An empty knowledge category does not imply that unrelated enterprise memory or provider knowledge is bindable as an asset.

All changes use the existing local draft patch operation. Saving and publishing remain explicit; viewing or selecting an asset does not change the employee's persisted capabilities. The broader employee workbench and self-learning mechanisms remain unchanged.

## Alternatives considered

**Keep bound assets hidden.** This prevents duplicate addition but makes existing capabilities inaccessible in the primary editor.

**Automatically bind the first asset or convert other knowledge records.** This grants capabilities without an explicit asset choice and conflates independently owned data.

## Consequences

Capability changes remain versioned asset references in an explicitly saved draft. The editor does not convert workspace plugin inventories or enterprise memory records into employee bindings.

## Verification

Component tests cover bound selection without a write, removal preserving another category, revision replacement, and empty versus failed loading. A rendered inline snapshot pins the option label and bound row. Existing structured-add and category-switch tests remain in the same suite.
