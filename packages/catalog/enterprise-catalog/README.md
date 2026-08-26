# @deepseek-ai/dsh-enterprise-catalog

English | [中文](README.zh.md)

Versioned enterprise catalog over native DSH identities:

- Agent Preset ids remain the canonical employee identity.
- Drafts use optimistic revisions and idempotent saves.
- Releases are immutable snapshots with deterministic SHA-256 digests.
- SOP, knowledge, skill, tool, and model assets are versioned and bound to a release.
- Raw secrets are rejected; runtime credentials are referenced by `credentialRef`.
- PostgreSQL writes use caller-owned transactions and parameterized queries.

## Model Experience

### Catalog persistence

#### What the model sees

Nothing. The catalog stores control-plane metadata and release snapshots; it does not add prompts, messages, tools, or model calls.

#### Token effect

Zero tokens until a released employee is used by an existing DSH Session.

#### KV Cache effect

None; catalog writes do not assemble provider requests.

## Known Limitations and Deferred Work

- This package supplies the catalog repository and contracts; Host API composition and browser pages are separate layers.
- A live PostgreSQL/JSONB integration test belongs to the deployment gate.
