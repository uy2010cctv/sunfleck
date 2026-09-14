# Agent Note: Idempotent employee publish reconciliation

Status: implemented

English | [中文](2026-09-14-idempotent-employee-publish-reconciliation.zh.md)

## Problem

Employee publication commits an immutable catalog release before updating the writable native Agent Preset. If the Preset write fails, the API reports failure although the release already exists. Repeated clicks with new idempotency keys created duplicate releases from the unchanged published draft.

The employee controller class declared `agentPresets`, but the enclosing plugin omitted it from its root inject list. Cordis therefore rejected the real service access even though isolated controller tests manually supplied the dependency.

## Decision

Publishing an unchanged draft whose status is already `published` returns the latest release when its digest matches. The repository records the new idempotency key without incrementing the release version or draft revision.

The controller retries the idempotent native Preset write once. If it still fails, the API reports a stable reconciliation message that states the release was published. Retrying Publish reuses the current release and attempts the remaining Preset synchronization.

The root plugin declares `agentPresets`, matching the employee controller's actual runtime dependency.

## Consequences

A successful catalog commit cannot be multiplied by repeated Publish clicks. A changed draft still produces a new immutable release. The catalog remains authoritative, while the native Preset is a retryable projection used by new Sessions.

## Verification

Repository tests publish the same published draft under two keys and assert one release and one draft revision change. Controller tests assert the root inject declaration, inject a transient Preset write failure, and verify one catalog publication with two projection attempts.
