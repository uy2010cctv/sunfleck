---
description: "Enterprise WeCom application callback and delivery contracts."
kind: "package-reference"
---
# `@deepseek-ai/dsh-channel-wecom`

English | [中文](README.zh.md)

## Summary

Enterprise WeCom application callback and delivery contracts.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Enterprise WeCom application adapter contracts for DSH. This package supports only a WeCom enterprise application; personal WeChat and personal-account automation are intentionally outside the product boundary.

It provides:

- constant-time SHA-1 callback signature verification;
- WeCom's AES-256-CBC, 32-byte PKCS#7 callback envelope and URL challenge;
- a transport-neutral quick `success` ACK contract;
- normalized inbound identity and Channel Kernel idempotency keys;
- token-expiry/heartbeat health reminders;
- deterministic, provider-aware outbound retry/dead-letter decisions.

The package has no HTTP client, webhook server, token cache, database, or message sender. The Host must perform signature verification before durable admission, return the quick ACK, and then process the decrypted envelope through a PostgreSQL inbox/outbox worker. Credential values must come from DSH Credentials and must not be written to audit records.

## Reliability boundary

`nextWeComDeliveryAttempt` returns a decision; it does not sleep or send. A durable worker owns leases/fencing, idempotent outbox claims, retry persistence, provider receipts, and dead-letter replay. A provider `Retry-After` is honored up to 24 hours, while non-transient HTTP errors fail closed.

## Model Experience

### Provider wire translation

#### What the model sees

Nothing. The adapter translates provider callbacks into `ChannelEnvelope` records and adds no prompt section or tool schema.

#### Token effect

Zero tokens; callback validation and delivery decisions run on the Host.

#### KV Cache effect

None; the adapter does not assemble a provider model request.

## Known Limitations and Deferred Work

- The package implements WeCom wire contracts only; an authenticated Host must supply durable admission, credential resolution, delivery, and provider receipt reconciliation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
