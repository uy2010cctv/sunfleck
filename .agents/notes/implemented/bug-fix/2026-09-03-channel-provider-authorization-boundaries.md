# Agent Note: Channel providers keep distinct authorization prerequisites and intent grants

Status: implemented

English | [中文](2026-09-03-channel-provider-authorization-boundaries.zh.md)

## Problem

Channel configuration treated every active enterprise provider as if it required a tenant, although Feishu and DingTalk official OAuth only require the configured application account and Credential. Personal Weixin website-app OAuth also appeared to grant notification and status intents even though that official flow proves identity for an authenticated handoff and exposes no personal-chat delivery API. Feishu code exchange still targeted the superseded v2 endpoint, and the browser admitted callback codes by JavaScript character count instead of the Host's 2,048-byte limit.

## Decision

Only an active WeCom configuration requires a non-empty tenant CorpID. Feishu and DingTalk activate and begin official authorization with an account ID plus configured Credential, and persisted records retain no tenant unless one was supplied or verified.

Personal Weixin website-app authorization admits only the `handoff` intent. Notification, status, Team start, decision response, inbound commands, non-public iLink, and personal-chat protocols remain outside this official authorization path.

Feishu exchanges authorization codes through `https://accounts.feishu.cn/oauth/v3/token` with the official JSON request fields and reads the top-level `access_token`. The browser rejects a callback code whose UTF-8 encoding exceeds 2,048 bytes before invoking the Remote or publishing success.

## Verification

Kernel tests pin all five intent decisions and the exact Feishu v3 URL, method, JSON fields, and top-level token response. Repository, controller, and workbench tests cover tenant-free Feishu and DingTalk activation, WeCom rejection without CorpID, absence of a fabricated tenant, and handoff-only personal Weixin presentation. The browser callback test uses a multibyte value that is shorter than 2,048 characters but longer than 2,048 UTF-8 bytes.

## Alternatives considered

**Keep a common tenant prerequisite for every enterprise provider.** Rejected: it invents a provider requirement and blocks valid Feishu and DingTalk configurations.

**Keep notification and status as non-mutating personal Weixin intents.** Rejected: non-mutation does not make an unsupported personal-chat transport official or deliverable.

**Call Feishu v2 first and fall back to v3.** Rejected: the pre-release codebase does not preserve obsolete provider endpoints without an official compatibility requirement.

**Let the Host reject oversized callback codes.** Rejected: the browser would still pass an input it can reject deterministically and could publish misleading intermediate success behavior before the Remote failure.

## Consequences

Provider configuration matches each official prerequisite instead of a shared enterprise approximation. Personal Weixin remains useful for identity and authenticated handoff without implying chat delivery. Feishu follows the current official token exchange, and the client and Host enforce the same byte limit. A future personal-chat transport requires a separate public protocol, adapter evidence, authorization policy, and durable delivery records.
