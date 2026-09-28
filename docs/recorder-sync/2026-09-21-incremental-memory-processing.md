# 2026-09-21 Incremental three-layer memory processing for the recorder

English | [中文](2026-09-21-incremental-memory-processing.zh.md)

## Flow

After a raw transcript is stored and read back successfully, 47's durable worker summarizes the user's not-yet-processed new segments with the last two minutes of context and calls DSH `/recorder-memory/process`. Only after processing succeeds does it write `org_id + user_id + segment_id` into `processed_v1`; network, model, or storage failures stay unacknowledged and retry on the next round.

## Model and rules

- Reuses the configured DSH route `zai-coding-cn / glm-5.3-flash`; the dedicated processing call uses low reasoning, 1024 output tokens, and a 15-second total timeout.
- Recorder text is marked untrusted evidence and must never be treated as instructions.
- Output allows only `episode` / `semantic` / `behavioral`; each item must reference real `evidenceSegmentIds`.
- The behavioral layer requires at least one `speaker=self` evidence; otherwise the server drops the output.
- Insufficient evidence persists `layer: processing-status` / `status: no-new-memory` and records the round's new segment ids.
- Each round's output binds an `input_version` digest; retrying identical input returns the existing document.

## Verification

- 29 targeted tests passed covering the parser, evidence constraints, behavioral self-limit, HTTP auth, user scoping, knowledge tools, and time-range topic ordering; TypeScript check and the formal build pass.
- 4 worker tests passed covering the two-minute context, new-segment marking, composite idempotency keys, and unowned-data isolation.
- A real GLM call for an isolated test user returned HTTP 200 in 8.34 s, produced a behavioral memory, and included source segment ids with 0.9 confidence.
- A real user's vague short segment returned "processed with no new memory", producing no facts or todos.

## Operating boundary

Historically confirmed raw segments are pre-seeded with processing cursors, so this release will not suddenly fire a burst of model calls at the old store. Automatic processing starts from new non-empty voice segments after release.
