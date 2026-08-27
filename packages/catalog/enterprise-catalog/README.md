# @deepseek-ai/dsh-enterprise-catalog

English | [中文](README.zh.md)

Versioned enterprise catalog over native DSH identities:

- Agent Preset ids remain the canonical employee identity.
- Drafts use optimistic revisions and idempotent saves.
- Management lists are always organization-scoped, use parameterized filters, and paginate by HMAC-SHA256-signed opaque cursors in `updatedAt` and id order.
- Releases are immutable snapshots with deterministic SHA-256 digests.
- SOP, knowledge, skill, tool, and model assets are versioned and bound to a release.
- Asset archive is a logical, revision-checked write; an idempotency key is bound to the request digest and returns its original result on an exact retry.
- Raw secrets are rejected; runtime credentials are referenced by `credentialRef`.
- PostgreSQL writes use caller-owned transactions, and every query is parameterized.
- Pagination indexes cover organization, update time, and resource id; expression indexes cover lowercase resource ids and asset names without requiring `pg_trgm`.

Production repositories provide a stable `cursorSigningKey` as a `Buffer` or string. A repository without a key can read a first page only when it does not need to return a cursor; generating or consuming a cursor fails explicitly. Rotating the key invalidates outstanding cursors.

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
- PostgreSQL integration tests run when `DSH_TEST_POSTGRES_URL` is set and are mandatory in CI.
