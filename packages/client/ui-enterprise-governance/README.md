# `@deepseek-ai/dsh-client-ui-enterprise-governance`

English | [中文](README.zh.md)

Enterprise login and administration surface:

- Full-frame authentication gate with local and configured SSO providers.
- Organization and tree-structured department editing, user membership, primary department,
  role changes, and enable/disable controls.
- Personal and department Workspace inventory with governed sandbox modes.
- Privacy-screened memory proposals, review queue, and the approved enterprise awareness stream.
- Visibility policy management for employees, models, capabilities, and channels.
- Persistent audit ledger with actor and action filters.
- Administrator-only Settings section with no duplicate Sidebar entry; Host RBAC remains authoritative.

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
