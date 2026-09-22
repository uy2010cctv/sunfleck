# Agent Note: Preserve NUL-containing Session events in PostgreSQL

Status: implemented

English | [中文](2026-09-22-postgres-session-nul-events.zh.md)

## Problem

The Session event format permits every JSON string value, including U+0000. PostgreSQL `JSONB` rejects the JSON escape `\u0000`, so one valid event could fail an asynchronous append and remain at the head of a writer's retry buffer. Every later event then waited behind the same unwriteable row, leaving the visible turn without durable `step/end` and `turn/end` records.

The workspace-instruction reconciler made this failure deterministic by joining an instruction directory and candidate file name with NUL. Reading a nested `CLAUDE.md` produced a source scope such as `xhs-src\u0000CLAUDE.md`; the next `user/message` was valid Session JSON but could not enter the PostgreSQL event table.

## Decision

`dsh_session_events.event_json` stores serialized JSON as `TEXT`. Schema version 3 converts existing `JSONB` rows with `event_json::text`; new and repaired events are inserted without a `JSONB` cast. Readers continue to parse and validate every value as a Session event, and the indexed `event_type` column still owns event selection. The lightweight title query selects only the latest `session/title` event text and parses that single event in the application.

Workspace instruction candidate keys use a JSON tuple of directory and candidate file name. The decoder accepts both that representation and the released NUL-delimited representation, so JSONL sessions containing the earlier key remain readable.

## Alternatives considered

**Replace NUL before each PostgreSQL insert.** This would keep the existing column but silently change arbitrary user, model, and tool text. It would also make round-trip equality depend on an ambiguous escape convention.

**Fix only the workspace-instruction separator.** This prevents the observed producer from emitting NUL but leaves the PostgreSQL provider unable to satisfy the Session event contract when another valid source contains U+0000.

**Add a second encoded JSON column.** A dual representation preserves query operators but creates synchronization and migration obligations for data the product reads as complete event objects. The separate indexed `event_type` and `event_time` columns already serve the required list queries.

## Consequences

PostgreSQL persistence accepts the same JSON string values as JSONL persistence and no valid U+0000 value can poison a writer queue. Event payload queries must parse text in the application or cast a package-owned, known-safe event type explicitly. Schema startup performs one table-column conversion when upgrading version 2 data. Focused tests cover the migration query, U+0000 round-trip, JSON-safe instruction keys, and decoding of released NUL-delimited keys.
