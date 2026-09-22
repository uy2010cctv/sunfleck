# Agent Note: Indexed recorder memory timeline

Status: implemented

English | [中文](2026-09-22-recorder-memory-timeline-index.zh.md)

## Problem

Recorder ingestion represented every short ASR segment as a knowledge document. Recent-recording queries loaded every such document before applying owner, time, and topic filters. Incremental processing also confirmed ids outside the submitted model window and created a new searchable document for every micro-batch, including empty results. History size therefore increased query work and document fragmentation while the processing ledger could overstate completed coverage.

## Decision

The recorder worker advances a persistent byte cursor per JSONL source and stores parsed rows in one SQLite connection. `indexed_v1` replays earlier ingestion acknowledgements once into the new timeline, while `processed_v2` reprocesses the earlier ledger in oldest-first bounded windows. A successful processing request acknowledges only new ids present in that request.

The knowledge plugin owns a separate recorder SQLite store keyed by organization, user, and stable segment id. B-tree owner/time indexes serve chronological ranges, and an owner-scoped term inverted index ranks topics. Nearby segments share a stable recorder session. A topic query returns matches, bounded adjacent evidence, session summaries, and active processed memories without reading knowledge documents.

Processing keeps one transcript document and one memory document per recorder session through stable document-id upserts. Extracted records use stable memory ids and retain evidence ids and input versions. An empty extraction records `no-new-memory` in the processing table and creates no knowledge document.

## Alternatives considered

**Keep one document per segment and add a cache.** A cache still leaves unbounded invalidation and fragmented model-visible results, so the indexed timeline becomes the source for recorder queries.

**Use the general chunk FTS index for raw segments.** The general index cannot filter source time before loading document metadata and couples raw recorder retention to knowledge-document count.

**Use SQLite FTS5 trigram ranking for the timeline.** A fresh 10,000-segment benchmark measured about 531 ms median locally. The dedicated owner-term inverted table measured 51.523 ms median and 54.713 ms P95 for the same query and context result.

## Consequences

Raw segments become queryable after one indexed write and no longer add one knowledge document each. Query cost follows the requested owner/time/topic range instead of the full knowledge corpus. Historical JSONL is replayable without deleting source data, and session documents converge as processing advances. The recorder store adds a second SQLite artifact and keeps deterministic lexical tokenization rather than general semantic ranking; processed memories and adjacent evidence provide the semantic context returned to the employee.
