---
description: "Enterprise channel kernel and provider adapters."
kind: "package-group"
---
# Channel packages

English | [中文](README.zh.md)

## Summary

Enterprise channel kernel and provider adapters.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Provider-neutral enterprise channel contracts. [`channel-kernel`](channel-kernel/README.md) owns routing and reliability decisions; provider adapters own WeChat/WeCom login, transport, durable inbox/outbox persistence, and acknowledgements.

The supported GA provider adapter is [`channel-wecom`](channel-wecom/README.md), which implements the wire-format and security contracts for a WeCom enterprise application only. It intentionally excludes personal WeChat. HTTP serving, PostgreSQL inbox/outbox persistence, credentials, leases, and actual delivery remain Host responsibilities.

The [Webhook subsystem](../../docs/subsystems/webhook.md) describes the shared inbound HTTP and delivery lifecycle that provider adapters compose.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
