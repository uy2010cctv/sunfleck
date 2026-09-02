# Human–Agent team operating model (proposal)

English | [中文](human-agent-teams.zh.md)

This page describes the complete target operating model. The source-checkout enterprise profile now stores typed Team Definitions, starts real TeamRuns on the Agent Teams Session log, projects Human and Agent roster entries, opens the root Session as a Team Room, exposes a cross-Run Human decision queue, and provides governed Channel Settings. Human task ownership, a trust-grant editor, version-aware capability-asset assembly, and live enterprise channel delivery remain proposed.

## Proposal status

The implementation preserves DSH runtime ownership instead of adding another Team engine. PostgreSQL persists reusable Team Definitions and query projections; the experimental `TeamService` and each root Session event log own one TeamRun's actor roster, task DAG, mailbox, decisions, verification, and handoff state.

The current experimental [Agent Teams subsystem](../../subsystems/agent-team.md) provides durable Human and Agent roster projection, an Agent-owned task DAG, mailbox, TeamRun state, and Human decisions in the source-checkout enterprise profile. PostgreSQL provides Team Definition, TeamRun/decision query projections, explicit autonomy grants, and administrator-managed channel configurations. Verifier records, Human task ownership, and provider delivery integration are not complete.

## Proposed lifecycle

### 1. Charter and definition

A future Team Definition would record a Human-owned North Star, success evidence, non-goals, constraints, decision rights, stop conditions, review cadence, one Agent Lead, and Human and Agent role templates. PostgreSQL would be the persistent authority for that reusable version.

Autonomy would be scoped by Agent, task type, and capability instead of one global label. Each Agent would use an independent service identity and Credential references rather than a Human browser or channel credential.

### 2. Launch in the source-checkout enterprise profile

Open **Teams**, select an active charter, choose a Workspace, and enter the Run objective. Launch snapshots the exact Team Definition revision, roster, Workspace, effective policy, and immutable employee Release identities before Agent work begins. Later definition edits do not change an active Run implicitly.

The same `TeamService` domain records both Human and Agent members for that Run. A Human member has an enterprise user identity without a Session; an Agent member binds a Session and Employee Release. Open **Team Room** to enter the root Session and inspect its Agent Teams roster and task projection.

### 3. Coordination and verification

The Agent Lead would decompose the North Star into a dependency-aware task DAG, assign Doers and independent Verifiers where policy requires separation, coordinate the existing Team mailbox, and assemble evidence. Humans would retain goals, value judgments, autonomy changes, policy exceptions, and irreversible decisions.

A Doer completion and a Verifier decision would remain separate runtime events. Evidence would distinguish source changes, focused tests, builds or packages, authenticated behavior, persisted business state, deployment, provider delivery, and final business outcome rather than treating one as proof of another.

### 4. Human decisions and handoff

Runtime decision requests carry their question, options, recommendation, assignee, context digest, revision, and root Session event position. Open **Needs my attention** to answer assigned decisions; every response is revalidated against the owning root Session before its PostgreSQL projection changes.

A handoff would be a recorded Human or Agent actor transition inside the same TeamRun. Personal Weixin may bind the identity used to enter an authenticated DSH handoff, but website-app authorization has no official personal-chat messaging API and cannot settle a decision or mutate Team state.

### 5. Review and grant evolution

A retrospective would compare the charter with recorded evidence, inspect Human interruptions and unresolved concerns, and review each scoped grant. Repeated evidence could justify a later Human-approved grant change, but no Agent or automated score would widen autonomy.

Reusable business knowledge would enter organization or department memory only through its governed review path. Raw conversations, personal preferences, credentials, and one-off speculation would remain outside shared memory.

## Proposed trust levels

The model uses four trust levels, each constrained by Agent, task type, and capability:

- `observe` reads authorized context and evidence without mutating work or external systems.
- `propose` produces a recommendation, draft, plan, or decision request without executing the proposed mutation.
- `execute-reviewed` executes within scope but cannot advance dependent work until the required review accepts the result.
- `execute-delegated` executes pre-authorized reversible work within scope; irreversible actions and policy exceptions still require Human approval.

## Channel settings and delivery boundary

Open **Channels** in the enterprise workbench to create, edit, activate, pause, or archive Enterprise WeChat, Feishu, DingTalk, and personal WeChat configurations. Each record stores provider/account identity, a Host-managed Credential reference, a default employee Release route, inbound policy, lifecycle state, and revision. An active WeCom record also requires its CorpID tenant; Feishu and DingTalk activate without a tenant and DSH does not fabricate one. The page never asks for or displays the secret value.

For an eligible saved channel, **Scan official QR code** opens the provider-hosted OAuth/QR page rather than rendering or proxying a provider QR inside DSH. DSH signs a 10-minute state tied to one Host process, the organization, actor, channel, provider, exact revision, fixed callback URI, nonce, and expiry. The Host resolves the App Secret from the Credential reference, exchanges the one-time code, and stores only the verified provider identity, display name, tenant evidence, verifying actor, and time. It never persists or shows an access token, refresh token, authorization code, raw provider payload, or App Secret. Rejection, expiry, or a Host restart requires a new scan.

Configure the corresponding provider application before scanning:

- [WeCom Web login](https://developer.work.weixin.qq.com/document/path/98152) and its [identity API](https://developer.work.weixin.qq.com/document/path/96442) require CorpID, AgentID, and an OAuth trusted callback domain.
- [Feishu QR SDK/OAuth](https://open.feishu.cn/document/common-capabilities/sso/web-application-sso/qr-sdk-documentation) and its [user-token exchange](https://open.feishu.cn/document/authentication-management/access-token/get-user-access-token) require App ID, App Secret, and a registered redirect URL; DSH exchanges the code through the official `https://accounts.feishu.cn/oauth/v3/token` endpoint.
- [DingTalk official login OAuth](https://open.dingtalk.com/document/isvapp/tutorial-enabling-login-to-third-party-websites.md) and its [user-token exchange](https://open.dingtalk.com/document/isvapp/obtain-user-token.md) require Client ID, Client Secret, and a DingTalk Login & Share callback.
- [Personal Weixin website-app QR login](https://developers.weixin.qq.com/doc/oplatform/developers/dev/auth/web.html) requires an approved Website App, AppID, AppSecret, `snsapi_login`, and a registered authorization domain.

Use one fixed public, registered HTTPS callback in production. A localhost HTTP callback is supported only for development and may not be accepted by provider consoles.

Successful QR completion verifies only identity binding and authenticated handoff. Enterprise providers may later enable inbound commands, but DSH authorization must still accept each intent. Personal Weixin website-app authorization provides no official personal-chat messaging API and does not turn personal WeChat into a delivery channel. Saved, active, or identity-verified configuration does not prove delivery: transport remains **unverified** until provider adapters record receipts or health evidence.

The channel experience was designed independently after reviewing the local AGPL-3.0 StaffDeck checkout as product prior art. DSH adopted the product ideas of exception-first setup attention, separate lifecycle/configuration/identity/route/transport evidence, provider-specific guidance, QR expiry/retry, and neutral unverified status; it copied no StaffDeck source, styles, assets, protocol, or prose. StaffDeck's personal-WeChat iLink is a non-public/experimental transport and remains outside this official QR-binding scope.

The workbench does not fabricate real conversation or delivery logs, manager roles, separate identity bind codes, or transport health. Those require DSH adapter and durable inbox/outbox evidence, governed identities and roles, provider receipts, heartbeat, or reconciliation records.

The current Channel Kernel routing decision remains `stickyEmployeeId` → inferred intent → binding default. The Kernel and adapter do not persist an authoritative selection; future enterprise composition must derive `stickyEmployeeId` from a DSH-owned binding or Session projection. That integration is a migration target, not a current capability.

Future provider delivery still requires durable inbox/outbox records, stable `operationId` values, leases, retries, receipts, heartbeat evidence, and reconciliation. External de-duplication can only be guaranteed when the provider supports an idempotency key; an unsupported provider or timeout with an ambiguous result must create a visible unknown outcome and reconciliation task, not an exactly-once claim.

## Continue

- [Use the currently shipped Web UI](./index.md)
- [Inspect the current experimental Agent Teams runtime](../../subsystems/agent-team.md)
- [Read the proposed architecture decision](../../../.agents/notes/proposed/architecture/2026-08-31-human-agent-team-control-plane.md)
