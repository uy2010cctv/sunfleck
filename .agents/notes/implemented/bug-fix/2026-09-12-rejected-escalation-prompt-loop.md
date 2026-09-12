# Agent Note: Rejected escalation prompt loop

Status: implemented

English | [中文](2026-09-12-rejected-escalation-prompt-loop.zh.md)

## Problem

After a user rejected a `danger-full-access` sandbox escalation, the model could issue another call in the same turn with a reworded justification. ApprovalService assigned a fresh request id and dispatched it again, so the user saw the same high-permission prompt after every rejection and could not resume the conversation normally.

## Decision

ApprovalService derives a narrow deduplication key only for sandbox escalation reasons: tool name plus requested target mode. Before dispatching an ask, it scans the current open turn's durable `approval/asked` and `approval/decided` pairs. A prior rejection for the same key makes the new request resolve `rejected` without consulting a human answerer. The service still appends the new audit pair, and a later turn starts with a clean decision scope.

## Alternatives considered

**Deduplicate by request id or justification.** The model creates a new call id and can reword the justification, so neither identifies the human decision.

**Disable all approvals after one rejection.** That would incorrectly suppress unrelated commands and narrower permissions. The key is limited to one tool and target mode in one turn.

## Consequences

One human rejection stops approval harassment for that escalation scope while preserving fail-closed execution and complete audit history. Legitimately different targets and later turns can still ask.
