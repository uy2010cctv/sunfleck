# Recorder memory retrieval repair

English | [中文](2026-09-22-memory-retrieval-repair.zh.md)

Date: 2026-09-22.

## Scope

This repair replaces per-segment knowledge-document retrieval with an indexed private recorder timeline, corrects worker acknowledgements, rebuilds historical processing generations, and converges raw transcripts and processed memory into stable session documents.

## Behavior

- JSONL readers advance durable per-file byte cursors and parse only appended complete lines.
- One WorkerState SQLite connection owns source cursors, parsed segments, ingestion acknowledgement, and processing acknowledgement.
- `indexed_v1` replays older successful ingestion once into the new DSH recorder index.
- `processed_v2` reprocesses the earlier ledger oldest-first; success marks only ids included as `isNew` in the submitted request.
- DSH stores recorder segments under organization/user/stable id with owner/time and owner/term indexes.
- Recent queries return ranked matches, up to 120 seconds of bounded adjacent context, stable session summaries, processed memories, and evidence ids in one tool call.
- Processing upserts one transcript and one memory document per recorder session. Empty extraction is ledger state, not a document.
- Android VAD treats five seconds as a target, waits for a 160 ms micro-pause, and uses eight seconds as the hard cap.

## Verification

- Worker regressions cover backlog acknowledgement, append-only cursors, one-time index replay, context inclusion, quarantine, and connection cleanup.
- Knowledge tests cover stable-id conflicts, session grouping, indexed topic ranking, adjacent context, stable memory upserts, indexed ingest readback, stable document ids, and empty processing state.
- A 10,000-segment built-JavaScript benchmark measured 51.523 ms median and 54.713 ms P95 over 20 warm topic queries with adjacent context; setup, model inference, and transport are excluded.
- Android tests cover a natural pause after the five-second target and a continuous-speech hard cut at eight seconds.
