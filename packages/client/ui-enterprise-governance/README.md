---
description: "Enterprise login gate and identity, role, asset-policy, and audit administration UI."
kind: "package-reference"
---
# `@deepseek-ai/dsh-client-ui-enterprise-governance`

English | [中文](README.zh.md)

## Summary

Enterprise login gate and identity, role, asset-policy, and audit administration UI.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Enterprise login and administration surface:

- Full-frame authentication gate with local and configured SSO providers.
- Organization and tree-structured department editing, user membership, primary department, role changes, and enable/disable controls.
- Personal and department Workspace inventory with governed sandbox modes.
- Privacy-screened memory proposals, review queue, and the approved enterprise awareness stream.
- Visibility policy management for employees, models, capabilities, and channels.
- Persistent audit ledger with actor and action filters.
- Administrator-only Settings section with no duplicate Sidebar entry; Host RBAC remains authoritative.

## Memory activation

Enterprise memory uses Save and activate for confirmed manual entries. Routine Agent knowledge activates automatically; the pending lane appears only for exceptions or existing proposals. Active memories can be deactivated without deleting their audit history.

The Automatic capture panel reports the durable completed-turn outbox without exposing copied conversation snapshots. Completed and skipped work stays compact; failed jobs show their reason and a retry action. Conflict candidates continue through the existing exception review lane.

## Model Experience

### Governance browser surface

#### What the model sees

Nothing. The UI calls `/auth` administration endpoints and contributes no prompt, message, tool schema, result, or model call.

#### Token effect

Zero tokens. Governance screens never enter Session history.

#### KV Cache effect

None; opening or editing governance state does not assemble a provider request.

## Known Limitations and Deferred Work

- The first UI uses Chinese operational copy; locale dictionaries can extend it without changing Host policy.
- External SSO buttons appear only for configured providers.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
