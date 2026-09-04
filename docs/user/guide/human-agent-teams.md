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

Open **Channels** in the enterprise workbench. An ordinary user only chooses a provider and scans; they never enter a channel name, channel ID, tenant, App ID, Credential reference, or employee Release. After the Host installer completes the official exchange, it returns verified tenant, application, and Bot metadata. DSH derives a stable channel ID from a SHA-256 digest of the organization, tenant, and application identity, uses the provider Bot name, binds a Host-stored Credential, and defaults routing to the DSH decision router. The same idempotent operation then creates an active channel and records its verified identity.

Each scan installation uses a ten-minute HMAC state bound to one Host process, organization, actor, provider, fixed callback URI, nonce, and expiry. The browser removes the authorization code from history before sending it to the Host-only `enterpriseChannelBotInstaller`. Platform application secrets, suite tickets, app tickets, permanent codes, access tokens, and Credential values never reach the browser. A successful callback notifies the original window through a same-origin BroadcastChannel and refreshes the automatically created channel. Rejection, expiry, Host restart, or actor/organization mismatch fails closed.

Feishu now has a built-in zero-configuration path in DSH. The Host invokes the official Feishu Node SDK `registerApp()` device authorization flow, gives the page only the official scan URL, and polls the creation result inside the Host. After an administrator scans and confirms, the App ID is used only to derive an auditable Credential reference and the App Secret is written directly to Host Credential storage. Neither requires manual input, and the Secret never appears in the browser or a Remote response. This path requires neither a pre-created Feishu app nor a public callback.

Operations must deploy the official third-party/store-app adapter on the Host before users can scan; users do not configure application fields:

- [WeCom third-party app installation](https://developer.work.weixin.qq.com/document/path/90665) uses a suite ticket, suite access token, pre-auth code, and enterprise permanent authorization information. After an administrator authorizes on the official install page, the adapter hands verified enterprise and application identity to DSH.
- [Feishu one-click app creation by QR scan](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/scan-to-create-an-app-in-one-click-nodejs) is built into DSH. The official device flow returns application credentials after scan confirmation and the Host stores them directly. A separate adapter for app-ticket and tenant-key events remains necessary when using the Feishu Store App distribution model instead.
- A [DingTalk third-party enterprise app](https://open.dingtalk.com/document/isvapp/application-authorization.md) is authorized through the App Directory. The Host adapter must consume SyncHTTP/RDS authorization events and derive enterprise/application identity from org_suite_auth or the temporary authorization code.
- [Personal Weixin Website App authorization](https://developers.weixin.qq.com/doc/oplatform/developers/dev/auth/web.html) is identity and Human handoff only. It exposes no official personal-chat Bot, so DSH does not present it as an installable chat channel.

Callback-based WeCom, Feishu Store App, and DingTalk installations require a fixed, publicly reachable HTTPS callback or event receiver registered with the provider; `127.0.0.1` cannot receive those platform installation events. Feishu's built-in device authorization flow does not depend on a public callback, so QR creation can complete from a local DSH Host. Successful scanning proves application creation/installation and identity verification, not message delivery; transport remains **unverified** until the adapter records a real receipt or health signal.

The channel experience was designed independently after reviewing the local AGPL-3.0 StaffDeck checkout as product prior art. DSH adopted the product ideas of exception-first setup attention, separate lifecycle/configuration/identity/route/transport evidence, provider-specific guidance, QR expiry/retry, and neutral unverified status; it copied no StaffDeck source, styles, assets, protocol, or prose. StaffDeck's personal-WeChat iLink is a non-public/experimental transport and remains outside this official QR-binding scope.

The workbench does not fabricate real conversation or delivery logs, manager roles, separate identity bind codes, or transport health. Those require DSH adapter and durable inbox/outbox evidence, governed identities and roles, provider receipts, heartbeat, or reconciliation records.

The current Channel Kernel routing decision remains `stickyEmployeeId` → inferred intent → binding default. The Kernel and adapter do not persist an authoritative selection; future enterprise composition must derive `stickyEmployeeId` from a DSH-owned binding or Session projection. That integration is a migration target, not a current capability.

Future provider delivery still requires durable inbox/outbox records, stable `operationId` values, leases, retries, receipts, heartbeat evidence, and reconciliation. External de-duplication can only be guaranteed when the provider supports an idempotency key; an unsupported provider or timeout with an ambiguous result must create a visible unknown outcome and reconciliation task, not an exactly-once claim.

## Continue

- [Use the currently shipped Web UI](./index.md)
- [Inspect the current experimental Agent Teams runtime](../../subsystems/agent-team.md)
- [Read the proposed architecture decision](../../../.agents/notes/proposed/architecture/2026-08-31-human-agent-team-control-plane.md)
