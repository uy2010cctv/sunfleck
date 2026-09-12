# Agent Note: Idempotent device reconnect

Status: implemented

English | [中文](2026-09-12-device-repair-idempotency.zh.md)

## Problem

The **Connect this computer** button always allocated a new device id. PostgreSQL correctly enforces one `(org, user, public key)` identity, so reconnecting an already paired Mac hit the unique constraint and surfaced only `enterprise repository operation failed`.

## Decision

Pairing is now one atomic owner-scoped upsert on the public-key uniqueness boundary. A repeated request refreshes only the existing online state and heartbeat, preserves its friendly name and platform, then returns the original device id. Signed heartbeats remain a separate operation and cannot change ownership or key material.

## Alternatives considered

**Disable the button for online devices.** Reconnect is still needed after browser refresh, local-agent reinstall, or a stale UI projection, so presentation alone cannot enforce identity semantics.

**Read before insert.** Concurrent double clicks can race between the read and insert. The database uniqueness boundary must perform the idempotent decision atomically.

## Consequences

Repeated clicks and retries no longer create duplicate devices or expose a generic Repository error. A public key remains unique only within its organization and user, preserving multi-user isolation.
