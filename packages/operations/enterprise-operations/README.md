# `@deepseek-ai/dsh-enterprise-operations`

English | [中文](README.zh.md)

Durable operation projections over native DSH execution:

- Work records reference native Session IDs and never duplicate event bodies.
- Approval requests use optimistic revisions and auditable transitions.
- Schedules create one idempotent start-session Outbox command per occurrence.
- Fixed teams bind a leader, members, Workflow template, and approval policy.
- PostgreSQL transactions and organization-scoped queries preserve boundaries.

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
