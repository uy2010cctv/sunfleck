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

An opt-in PostgreSQL `SessionPersistence` provider for native DSH event logs. It preserves the existing `SessionPersistence` contract: session headers are lazily materialized with their first event batch in one transaction, events are append-only and contiguous, and coordinator-owned recovery closes interrupted turns without changing committed history.

## Storage model

`dsh_session_headers` stores the immutable JSON header, a durable incarnation, and a monotonic revision. `dsh_session_events` stores the exact serialized JSON text for one event per `(session_id, seq)`, including JSON strings that contain U+0000; PostgreSQL `JSONB` cannot represent that valid JSON value. Lightweight `stat` and listing queries select conversation-start evidence and the latest `session/title` event text through indexed correlated reads, then parse that one event in the application; they do not read message bodies. `stat` also returns the event count and validates the stored Session identity and format version; complete event validation belongs to `open` and `read`. PostgreSQL locks the header row before reading the tail, inserting a batch, or repairing a final torn row; independent writers therefore cannot both claim the same next sequence. Revisions are source-qualified by a database-local UUID, header incarnation, and revision counter.

The package exposes a driver-neutral `PostgresDatabase` interface. Declarative Cordis composition uses `connectionString`; integration tests and embedded hosts may supply a transactional database object directly. No secret or connection string enters session records.

## Configuration

```ts
interface Config {
  connectionString?: string
  database?: PostgresDatabase
  databaseMode?: 'postgres' | 'standalone'
}
```

Use a dedicated PostgreSQL role with rights only to the package-owned `dsh_session_*` tables. The schema is initialized inside a transaction on service startup. `databaseMode: 'postgres'` shares the enterprise PostgreSQL pool; `standalone` uses `connectionString` and can select a separate schema through PostgreSQL connection options. The provider does not migrate released Session event formats: a V4 writer requires V4 rows prepared in an independent schema, while historical tables remain unchanged for rollback. Session data has no per-session raw artifact, so `locate()` returns `undefined` and `readRaw()` is unsupported.

### Live Session durability

The provider routes published `session/event` values to the active write handle, drains them at `session/flush`, and drains remaining events on close/disposal. Failed batches remain buffered for checkpoint retry. Shutdown attempts all handles and aggregates failures. Creating a header alone is not evidence that conversation events are durable.

## Model Experience

### Resumed conversation history

#### What the model sees

Nothing PostgreSQL-specific. Resume replays the same logical `SessionEvent[]` used by JSONL and SQLite providers; headers, revisions, locks, and row layout never enter prompts or tool calls.

#### Token effect

Zero live-request tokens. Storage I/O happens only on the Host.

#### KV Cache effect

None. The reconstructed logical history and active provider request determine cache reuse.

## Known Limitations and Deferred Work

- Driver-shape tests cover ordering, conflict rejection, rollback, and tail repair. A live PostgreSQL integration suite is deferred until a deployment-owned test service is available.
- The provider does not convert PostgreSQL V0/V3 rows to V4; an operator must verify conversion and import before selecting the V4 schema.
- This provider owns event durability only. Full-text and vector indexes remain separate read-model concerns and are not implemented by this package.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
