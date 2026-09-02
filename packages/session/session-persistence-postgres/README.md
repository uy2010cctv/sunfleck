---
description: "PostgreSQL durable session persistence for DSH event logs."
kind: "package-reference"
---
# `@deepseek-ai/dsh-session-persistence-postgres`

English | [中文](README.zh.md)

## Summary

PostgreSQL durable session persistence for DSH event logs.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

An opt-in PostgreSQL `SessionPersistence` provider for native DSH event logs. It preserves the
existing `SessionPersistence` contract: session headers are lazily materialized with their first
event batch in one transaction, events are append-only and contiguous, and coordinator-owned
recovery closes interrupted turns without changing committed history.

## Storage model

`dsh_session_headers` stores the immutable JSON header, exact fork-inherited event count, a durable
incarnation, and a monotonic revision. Schema v2 adds `inherited_event_count`; schema-v1 rows migrate
with the legacy zero-prefix default. `dsh_session_events` stores one JSON event per `(session_id, seq)`. PostgreSQL locks the
header row before reading the tail, inserting a batch, or repairing a final torn row; independent
writers therefore cannot both claim the same next sequence. Revisions are source-qualified by a
database-local UUID, header incarnation, and revision counter.

The package exposes a driver-neutral `PostgresDatabase` interface. Declarative Cordis composition
uses `connectionString`; integration tests and embedded hosts may supply a transactional database
object directly. No secret or connection string enters session records.

## Configuration

```ts
interface Config {
  connectionString?: string
  preparedSessionCacheSize?: number
  writeBatchMaxDelayMs?: number
}
```

Use a dedicated PostgreSQL role with rights only to the package-owned `dsh_session_*` tables. The
schema is initialized inside a transaction on service startup. Session data has no per-session raw
artifact, so `locate()` returns `undefined` and `readRaw()` is unsupported.

## Model Experience

### Resumed conversation history

#### What the model sees

Nothing PostgreSQL-specific. Resume replays the same logical `SessionEvent[]` used by JSONL and
SQLite providers; headers, revisions, locks, and row layout never enter prompts or tool calls.

#### Token effect

Zero live-request tokens. Storage I/O happens only on the Host.

#### KV Cache effect

None. The reconstructed logical history and active provider request determine cache reuse.

## Known Limitations and Deferred Work

- Driver-shape tests cover ordering, conflict rejection, rollback, and tail repair. A live
  PostgreSQL integration suite is deferred until a deployment-owned test service is available.
- The initial schema has no SQLite migration command yet; migration must be added as a separately
  verified operation before a production cutover.
- This provider owns event durability only. Full-text and vector indexes remain separate read-model
  concerns and are not implemented by this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
