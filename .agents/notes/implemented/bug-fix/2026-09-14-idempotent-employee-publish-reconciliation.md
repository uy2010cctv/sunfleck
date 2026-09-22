# Agent Note: Idempotent employee publish reconciliation

Status: implemented

English | [中文](2026-09-14-idempotent-employee-publish-reconciliation.zh.md)

## Problem

Employee publication commits an immutable catalog release before updating the writable native Agent Preset. If the Preset write fails, the API reports failure although the release already exists. Repeated clicks with new idempotency keys created duplicate releases from the unchanged published draft.

The employee controller class declared `agentPresets`, but the enclosing plugin omitted it from its root inject list. Cordis therefore rejected the real service access even though isolated controller tests manually supplied the dependency.

The projection also wrote the compiled employee identity to the persona row's unsupported `config.text` field. The persona plugin reads `config.prefix`, so the roster and Session header showed the selected employee while model requests retained the copied preset's generic identity.

## Decision

Publishing an unchanged draft whose status is already `published` returns the latest release when its digest matches. The repository records the new idempotency key without incrementing the release version or draft revision.

The controller retries the idempotent native Preset write once. If it still fails, the API reports a stable reconciliation message that states the release was published. Retrying Publish reuses the current release and attempts the remaining Preset synchronization.

The root plugin declares `agentPresets`, matching the employee controller's actual runtime dependency.

Preset synchronization replaces the persona `prefix` with the compiled employee name, position, department, responsibility prompt, and identity-consistency rule. It removes a legacy `text` field from the same row so republishing repairs presets written by the earlier implementation.

## Alternatives considered

**Inject employee fields beside the preset persona on every request.** This would create a second identity source and make the published preset differ from the system prompt a Session reconstructs, so it was rejected.

**Teach the persona plugin to accept `text` as an alias.** This would preserve an accidental field outside the documented configuration and weaken failure visibility for other misspelled keys, so it was rejected.

## Consequences

A successful catalog commit cannot be multiplied by repeated Publish clicks. A changed draft still produces a new immutable release. The catalog remains authoritative, while the native Preset is a retryable projection used by new Sessions. Republishing an existing employee repairs its persona; running Sessions keep the preset generation they started with and a new Session receives the repaired identity.

## Verification

Repository tests publish the same published draft under two keys and assert one release and one draft revision change. Controller tests assert the root inject declaration, inject a transient Preset write failure, and verify one catalog publication with two projection attempts.

The authoring regression starts from a valid generic persona prefix and verifies that employee synchronization removes both the generic identity and the unsupported `text` field while preserving the compiled employee identity.
