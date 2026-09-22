# Post-mortem 0005: PostgreSQL JSONB rejected one valid event and stalled the Session

English | [中文](0005-postgres-jsonb-nul-stalls-session.zh.md)

Status: resolved

## Executive summary

A production Agent Session stopped after a failed external publish was followed by reading a nested `CLAUDE.md`. The publish failure was contained, but workspace-instruction metadata used NUL inside a candidate key; PostgreSQL `JSONB` rejected the valid Session JSON escape `\u0000`. The failed event stayed at the asynchronous writer queue head and blocked every later turn boundary. Candidate keys now use JSON-safe tuples, PostgreSQL stores event JSON as lossless text, and tests cover both the producer and persistence contract.

## Summary

The external publish returned an ordinary tool error after its image upload timed out. The Agent continued into read-only diagnosis and successfully persisted the tool call, tool result, and `step/end`. Reading a source file caused the workspace-instruction reconciler to discover the repository's nested `CLAUDE.md` for the next step.

The reconciler identified each directory and candidate file with `<directory> NUL <candidate>`. That internal key entered the next durable `user/message` source as `xhs-src\u0000CLAUDE.md`. JavaScript `JSON.stringify` produced valid JSON, but PostgreSQL `JSONB` cannot convert `\u0000` to its text representation.

## Impact

The first rejected event remained in the live PostgreSQL writer buffer. Each later flush retried the same batch, so `step/end` and `turn/end` also stayed only in process memory. The Web client received transient failure frames and showed repeated terminal errors, while the durable session stopped at its last successful event. Reload or process loss could therefore discard the visible failures and leave recovery to infer an interrupted turn.

The external publish did not create a partial post. The availability failure occurred in DSH Session persistence during the subsequent source-read workflow.

## Timeline

- An image upload timed out and returned a structured failed tool result.
- The Agent continued diagnosis and read a nested project source file.
- Workspace instruction discovery prepared a `user/message` whose source contained a NUL-delimited candidate key.
- PostgreSQL rejected the insert with `unsupported Unicode escape sequence` and detail `\u0000 cannot be converted to text`.
- Background drain retried the same unwriteable event, so later boundary events could not advance the durable sequence.
- Database logs and the stopped sequence identified the persistence mismatch; focused tests reproduced the producer key and provider failure before the fix.

## Root cause

The workspace-instruction package relied on the filesystem rule that a path cannot contain NUL and reused that delimiter in durable JSON metadata. The delimiter was safe for an in-memory map and JSONL text, but not for PostgreSQL `JSONB`.

The PostgreSQL provider declared event payloads as `JSONB` even though the shared Session format permits every JSON string. Its asynchronous writer correctly retained failed batches, but a deterministic representation mismatch made that durability behavior an indefinite queue obstruction. Tests used an in-memory JSON parser that accepts U+0000 and did not simulate PostgreSQL's narrower `JSONB` value set.

## Guardrails added

- Workspace instruction candidate keys use a JSON tuple and decode both the new representation and released NUL-delimited keys.
- PostgreSQL schema version 3 stores serialized event JSON in `TEXT`; readers still parse and validate every complete event.
- The title listing selects only the latest `session/title` text and parses that event in the application; indexed event type and time remain separate columns.
- The PostgreSQL test adapter reproduces `JSONB` rejection of `\u0000`, and an end-to-end store test requires exact NUL round-trip.
- Agent-instruction tests reject NUL in new scope keys and pin decoding of the released key representation.

## Lessons

- An internal identifier becomes a storage format as soon as it enters a durable event.
- A persistence provider must represent the complete shared event format rather than the convenient subset of its native structured type.
- Retaining a failed append is safe only when every contract-valid event is representable; otherwise durability converts one deterministic rejection into a queue-wide availability failure.
- External tool failure and Session failure require separate causal evidence even when users observe them in one workflow.
