# `@deepseek-ai/dsh-enterprise-operations`

English | [中文](README.zh.md)

Durable operation projections over native DSH execution:

- Work records reference native Session IDs and employee releases without duplicating event bodies. Deployments may inject Session and release resolvers; when configured, each resolver must confirm its reference in the same organization before a write.
- Approval requests use optimistic revisions and auditable transitions.
- Employee and fixed-team schedules create one idempotent start-session Outbox command per occurrence; retries with another request idempotency key return the original command.
- Fixed teams bind a leader, members, Workflow template, and approval policy.
- PostgreSQL transactions and organization-scoped queries preserve boundaries.
- Native references fail closed when their resolver is missing. Production may set `requireNativeReferences`; tests and local development must explicitly set `allowUnverifiedReferences` to bypass resolution. The two settings are mutually exclusive.
- Idempotency keys bind a SHA-256 request digest, and reuse with different input is rejected. Only active schedules can fire; the Outbox command creates the new scheduled Session.

## Model Experience

### Operation projections

#### What the model sees

Nothing. The package persists operations control data and contributes no prompt, message, tool schema, result, or model call.

#### Token effect

Zero tokens. Projection writes do not enter model history.

#### KV Cache effect

None; operation state does not assemble provider requests.

## Known Limitations and Deferred Work

- This package does not implement the browser management pages or a real scheduler worker.
- Fixed teams intentionally exclude StaffDeck bidding, blackboards, and market wakeups.
