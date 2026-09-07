# Agent Note: Durable enterprise work start

Status: implemented

English | [中文](2026-09-07-durable-enterprise-work-start.zh.md)

## Problem

Goal-first enterprise work start must survive a Host restart and concurrent retries without allocating unrelated Sessions. A process-local completion cache makes a successful retry depend on one service instance, and a caller-provided or readable Session ID can expose request material or let distinct intent silently share a result.

## Decision

`enterpriseWork.prepare` and `enterpriseWork.start` expose their request and result vocabulary from `contract/work.ts`, re-exported by both the package root and `./types`. `prepare` automatically selects only the highest-version release for one preset, while an explicit visible historical release remains valid. `start` resolves an authorized workspace and a published employee release, then derives `session-work-<sha256>` only from organization, user, and idempotency key.

The deterministic opaque ID is passed as `sessionId` to `SessionController.create`, so the existing native create-or-adopt behavior owns Session convergence. Enterprise session-workspace binding is already idempotent for that tuple. The operations work record remains the durable idempotency boundary and stores the chosen release id, preset id, request fingerprint, objective digest, and optional deadline in source references. A changed request or release retains the same Session ID but changes the durable record input, allowing the existing operations idempotency conflict to reject reuse rather than return a stale start.

## Verification

The focused work-start suite proves independent service instances derive and submit the same opaque ID for one request, that altered input under the same key is rejected by the durable-record fingerprint without allocating another Session, and that the Remote controller passes the selected release preset and deterministic ID through native Session creation, enterprise binding, and work-record persistence.

## Alternatives considered

- **Process-local completed map** — rejected because it is lost on restart and cannot coordinate independent service instances.
- **Random Session IDs plus a new work-start table** — rejected because native Session adoption and the existing operations idempotency record already provide the required durable seams.
- **Fingerprint only the idempotency key** — rejected because changed objective, workspace, or release input could silently reuse a prior result.
- **Put raw request values in the Session ID** — rejected because Session IDs surface in ordinary operational paths and must not disclose work intent.

## Consequences

Retries may safely re-enter all three idempotent seams after an uncertain outcome, with the native Session ID acting as the common join key. The release and request fingerprint are intentionally immutable source references, so changing the input under a reused idempotency key fails loudly rather than replacing the original work. The workbench maps only the three `prepare` outcomes to goal entry, loaded Workspace titles, and employee names with release versions; it keeps internal identifiers and configuration absent, and opens the returned native Session before closing the overlay. The UI sends a current Session hint only when one is open and never promotes the first loaded Workspace into a recent-workspace hint. This slice does not add model routing, teams, attachments, budgets, or autonomy grants.
