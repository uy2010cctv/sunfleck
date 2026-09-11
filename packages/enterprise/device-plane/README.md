---
description: "Durable server-side authority for paired devices, Computer Use runs, permits, and action evidence."
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-device-plane

English | [中文](README.zh.md)

## Summary

This package owns Device Plane domain types, action policy, Ed25519 request verification, replay protection, and the PostgreSQL repository. Every record is scoped by organization and user; runs also bind one device, Workspace, and Session.

## Table of Contents

- [Runtime contract](#runtime-contract)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Runtime contract

The browser never receives device private keys. A local Agent claims only typed actions whose run is active and permit is unexpired. Permits and signed-request nonces are single-use. Results retain bounded summaries and evidence hashes rather than unnecessary screen content.

## Dev Note

See the [Device Plane Agent Note](../../../.agents/notes/implemented/feature/2026-09-11-device-plane.md).

## Model Experience

### Server-side authority

#### What the model sees

Nothing directly. This server-side authority contributes no prompt or tool; `dsh-tool-computer-use` owns the model-facing fixed operation vocabulary.

#### Token effect

Zero direct tokens. Only the consuming tool's schema, arguments, and bounded result summary enter model context.

#### KV Cache effect

None; repository, policy, and signed transport operations do not assemble or send model requests.

## Known Limitations and Deferred Work

- Stopping a run prevents later claims; cooperative cancellation of an already executing native call depends on its Adapter.
- Screenshot streaming is not stored by this package; a future local-only preview channel must remain separately authorized.
- macOS is the first real-device target; Windows and Linux remain protocol-compatible but unverified.
