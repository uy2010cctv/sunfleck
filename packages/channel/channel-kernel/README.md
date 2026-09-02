---
description: "Provider-neutral enterprise channel routing, reliability, identity, and audit contracts."
kind: "package-reference"
---
# `@deepseek-ai/dsh-channel-kernel`

English | [中文](README.zh.md)

## Summary

Provider-neutral enterprise channel routing, reliability, identity, and audit contracts.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Pure Channel Kernel contracts for enterprise messaging:

- `/员工`, `/employees`, `/切换`, and `/switch` command parsing.
- Sticky Employee, intent, and default routing over one channel's allowed employee set.
- Canonical enterprise-user and channel-local actor keys.
- Provider-scoped inbound idempotency and capped outbound retry timing.
- Token/heartbeat health and fail-closed Session recovery decisions.
- Message audit metadata containing a content hash and length, never raw content or credentials.
- A provider-neutral `ChannelEnvelope` for WeCom, Feishu, DingTalk, and personal WeChat, correlated to DSH Team and Run identities by a stable operation id.
- Fail-closed intent policy: enterprise channels may submit authorized Team and decision intents; personal WeChat is outbound notification and handoff only.

The package does not log in to WeChat, host WeCom webhooks, persist queues, or send messages. Those are adapter responsibilities and must use DSH Credentials and native Sessions rather than private copies.

## Model Experience

### Host channel policy

#### What the model sees

Nothing. `routeInbound` and the other kernel functions make deterministic Host-side identity, routing, reliability, and audit decisions; they contribute no prompt section, message, tool schema, tool result, or model call.

#### Token effect

None. A provider adapter may later deliver admitted channel content through the ordinary Session message path, whose token cost belongs to that path rather than this kernel.

#### KV Cache effect

None. The kernel neither assembles nor mutates a provider request.

## Known Limitations and Deferred Work

- Real Feishu, DingTalk, and personal-WeChat adapters are not included; the existing WeCom adapter does not yet implement the complete Team envelope command surface.
- Durable idempotency and outbox stores must be supplied by a deployment adapter.
- Intent recognition supplies an employee candidate; this package only validates and orders it.
- Provider acknowledgement, unknown-outcome reconciliation, and receipt storage remain adapter responsibilities.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
