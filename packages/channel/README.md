# Channel packages

English | [中文](README.zh.md)

Provider-neutral enterprise channel contracts. [`channel-kernel`](channel-kernel/README.md) owns routing and reliability decisions; provider adapters own WeChat/WeCom login, transport, durable inbox/outbox persistence, and acknowledgements.

The supported GA provider adapter is [`channel-wecom`](channel-wecom/README.md), which implements the wire-format and security contracts for a WeCom enterprise application only. It intentionally excludes personal WeChat. HTTP serving, PostgreSQL inbox/outbox persistence, credentials, leases, and actual delivery remain Host responsibilities.
