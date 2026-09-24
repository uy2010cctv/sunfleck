# Agent Note: PostgreSQL Session V4 schema cutover

Status: implemented

English | [中文](2026-09-25-postgres-session-v4-schema-cutover.zh.md)

## Problem

The enterprise PostgreSQL store contains released V0 and V3 Session rows. A V4 writer rejects those headers, while replacing their rows in place would erase the predecessor needed to restore the prior release.

## Decision

The enterprise profile selects a separate PostgreSQL schema through `DSH_ENTERPRISE_SESSION_V4_DATABASE_URL` and `databaseMode: standalone`. Historical rows in the original schema remain unchanged. The operator exports a consistent PostgreSQL snapshot as canonical JSONL generations, uses the static adjacent migration catalog to publish V4 successors, and imports only validated V4 headers and events into the empty schema. The importer rereads every Session and compares its header, inherited-event count, and complete event list before cutover. This applies the [released Session migration decision](2026-08-31-released-session-format-migrations.md) to the enterprise PostgreSQL provider without teaching that provider to reinterpret old rows silently.

## Alternatives considered

**Update existing rows in place.** Rejected because the prior executable would lose its readable V0/V3 source and a failed migration could leave a mixed table with no exact rollback point.

**Switch enterprise Sessions to JSONL storage.** Rejected because it would change the enterprise storage authority and operational backup path in addition to changing the event format.

## Consequences

- The old schema and its database backup remain usable by the prior release; the V4 schema has its own store identity and revision space.
- The new release requires a populated V4 schema and a separate connection URL before startup. Missing configuration fails at startup instead of writing new-format events into the old tables.
- A rollback after new V4 writes does not make those new Sessions visible to the old release. Operators retain the V4 schema and return to the new release or reconcile those writes before treating rollback as data-complete.
