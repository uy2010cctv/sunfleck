# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are operators and administrators inside one enterprise intranet. They create and manage digital employees, assign work, review execution evidence, intervene in blocked work, and reuse proven employee capabilities. Ordinary enterprise users start work with permitted digital employees and inspect the work records they are allowed to access.

## Product Purpose

DeepSeek Harness Enterprise turns the existing DSH agent runtime into an enterprise digital-employee workbench. It makes agent definitions legible as employees, sessions legible as work records, and goals, jobs, schedules, subagents, workflows, approvals, event logs, and human–Agent teams legible as one operational system. Success means an operator can understand who is working, on what, with which capabilities and permissions, and with what evidence, without leaving the DSH runtime.

## Positioning

The enterprise layer is a projection and control plane over the real DSH runtime, not a second employee engine. Agent Presets remain the employee definition, Workspaces remain business spaces, Sessions remain work records, Session Events remain the audit source of truth, and DSH tools and runtime services remain the execution boundary. This preserves replay, resume, fork, approval, sandbox, subagent, and workflow semantics while adding enterprise operating language and navigation.

## Operating Context

- One enterprise operates the deployment on a trusted intranet.
- Multiple authenticated users have different operating responsibilities.
- Administrators manage employee definitions, employee metadata, model and capability configuration, and organization-wide visibility.
- Operators monitor work, approvals, failures, scheduled work, and collaboration.
- Users start work from a digital employee or business workspace and continue it through the existing DSH conversation surface.
- StaffDeck is an information-architecture and workflow reference only. Its source code, visual assets, and Agent runtime are not copied into DSH.

## Capabilities and Constraints

- `AgentPreset` is the canonical digital-employee definition.
- `Employee Release` is the immutable published employee reference selected for enterprise execution.
- `Workspace` is the canonical business-space boundary.
- `Session` is the canonical work-record identity.
- `SessionEvent` is the canonical audit and replay record.
- `Goal`, background Jobs, Schedule, Subagent, and Workflow remain their existing DSH capabilities and are projected into enterprise operations.
- The first enterprise foundation adds employee metadata, employee discovery, an operations workbench, and role-aware UI/API seams.
- The target is single-enterprise intranet multi-user, not public anonymous access or cloud multi-tenancy.
- The enterprise security overlay adds authenticated identity and authorization before every HTTP RPC, Typert endpoint, dedicated RPC channel, and WebSocket downlink. The ordinary Web profile remains a developer profile and its loopback/trusted-host checks remain transport fences only.
- Organization isolation, cross-enterprise tenancy, billing, and public SaaS administration are outside the first release.
- The single enterprise has a cycle-free department tree. Users may belong to multiple departments with one primary department.
- Each user receives a managed personal DSH Workspace and may create more below the deployment-owned root. Departments receive managed shared Workspaces; Session-to-Workspace bindings drive current membership visibility.
- Shared memory contains reviewed business summaries and source digests, not raw conversations. Organization memory is enterprise-wide; department memory follows the Workspace compartment and never models personal preferences.
- Existing DSH routes, plugin ownership, session formats, conversation behavior, and runtime services must remain compatible.
- StaffDeck is AGPL-3.0; only independently implemented product concepts may be reused unless separate licensing permits more.

## Brand Commitments

- Product name: DeepSeek Harness Enterprise.
- Product language: enterprise digital employees, employees, work records, business spaces, operations, evidence, approvals, capabilities, and teams.
- Preserve the DeepSeek Harness identity and its existing dark/light theme capability.
- The workbench may take structural inspiration from StaffDeck, but must remain recognizably DSH and must not reproduce StaffDeck illustrations, logos, or page code.

## Evidence on Hand

- The local official DSH checkout contains working Agent Presets, Workspaces, Sessions, Goals, Jobs, Schedules, Subagents, Workflows, approvals, event-sourced persistence, and a plugin-based Web client.
- The local StaffDeck checkout demonstrates employee rosters, employee-scoped navigation, employee capability assets, scheduled work, logs, teams, and operational intervention patterns.
- No enterprise customer logos, adoption metrics, productivity claims, testimonials, or service-level guarantees have been supplied; the UI must not fabricate them.

## Product Principles

1. Project existing runtime truth instead of creating parallel employee, task, or audit identities.
2. Make work status and evidence understandable before exposing implementation detail.
3. Keep enterprise controls reversible, permission-aware, and attributable to an authenticated user.
4. Preserve DSH composability: enterprise capabilities arrive as plugins, services, events, and Preset metadata.
5. Treat intranet reachability as transport, never as authentication or authorization.
6. Treat organizational memory as reviewed business evidence, never as a profile assembled from employee conversations.
7. Humans own goals, value judgments, and irreversible decisions; Agents decompose, execute, verify, and report within explicit grants.
8. Share context with the whole Team inside its Workspace and authorization boundary, while keeping unrelated conversations, personal memory, and credentials outside that boundary.
9. Present Humans and Agents in one roster. Every Agent uses its own service identity and Credential references rather than inheriting a Human's browser or channel credential.
10. A Human defines the North Star and decision policy; one accountable Agent Lead turns them into a task DAG, coordinates Doers, assigns independent Verifiers where risk requires separation, and escalates decisions instead of guessing.
11. Grant autonomy incrementally by Agent, task type, and capability scope. No Agent may extend its own grant or transfer it to another actor.
12. Optimize for Human attention: collect reviewable evidence, group compatible decisions, preserve urgency and dependency order, and interrupt immediately only when risk or an expiring decision requires it.

## Channel Plane

Across every channel, DSH is the only business-state and audit system. Within DSH, PostgreSQL is the persistent authority for reusable Team Definitions, while each root Session event log is the runtime authority for its TeamRun, roster, task, mailbox, decision, verification, and handoff state. A channel authenticates a transport account, submits an intent to DSH authorization and command handling, and delivers a projection or notification; it never becomes a state or audit source.

- Channel management is employee-first. The enterprise workbench shows each Preset once as a direct employee switcher and silently resolves its highest published Employee Release; release versions are implementation detail and are not exposed in channel setup. It then renders protocol adapters through `enterprise.employee-channels`. An adapter receives the selected employee's Preset identity and must persist that identity on a newly connected Bot before showing the Bot in the employee view. Protocol credentials, connection state, and receipts remain owned by the adapter; DSH owns the employee selection, route, permission, and audit projection.

- The authenticated enterprise workbench now includes an administrator-only Channel Settings control surface for WeCom, Feishu, DingTalk, and WeChat. It persists organization-scoped provider/account identity, a Host-managed Credential reference, routing default, inbound policy, lifecycle state, revision, and attributable actor; it never accepts or returns a secret value. This is configuration readiness, not proof of live delivery.
- Channel Settings can now open each provider's hosted official OAuth/QR flow. DSH signs a 10-minute, one-Host state, resolves the App Secret from the server-side Credential reference, exchanges the one-time code, and persists only non-secret verified identity evidence. User rejection, expiry, or a Host restart invalidates the process-bound pending state and requires a new scan. Production callbacks must use the fixed public HTTPS URL registered in the provider console; loopback HTTP is development-only and may not be accepted by provider consoles. No access token, refresh token, authorization code, raw provider payload, or App Secret is persisted or shown.
- Native QR contracts are: the WeCom Bot flow publicly shipped in Tencent WeCom team's [`@wecom/wecom-openclaw-cli`](https://github.com/WecomTeam/wecom-openclaw-plugin); built-in [Feishu one-click app creation](https://open.feishu.cn/document/mcp_open_tools/integrating-agents-with-feishu/scan-to-create-an-app-in-one-click-nodejs); and the iLink Bot flow in Tencent Weixin team's [OpenClaw WeChat channel](https://docs.openclaw.ai/channels/wechat). DSH keeps each provider's opaque QR polling value on the Host and writes the resulting Secret or token directly to Credentials. DingTalk still requires a deployed provider installer or hosted pairing control plane.
- WeChat admits notification, status, and authenticated handoff intents, but cannot start a Team, respond to a decision, approve work, or otherwise mutate DSH business state from chat.
- QR completion proves only that provider credentials and identity were obtained. It does not verify messaging transport; a receipt, heartbeat, or reconciliation record is still required.
- The local AGPL-3.0 StaffDeck checkout was reviewed only as product prior art. DSH independently adopted exception-first setup attention, separate lifecycle/configuration/identity/route/transport evidence, provider-specific setup guidance, QR expiry/retry recovery, and a neutral unverified transport state. No StaffDeck source, styles, assets, protocol implementation, or prose was copied. The WeCom and WeChat protocol evidence comes from Tencent teams' public npm packages and repositories.
- This work does not invent conversation or delivery logs, manager roles, separate identity bind codes, or transport health. Those claims require records from DSH-owned adapters, durable inbox/outbox operations, authorization, receipts, heartbeats, or reconciliation evidence.
- A canonical enterprise user may bind several channel-account aliases, but channel identity never substitutes for the authenticated DSH principal required by an action.
- One channel binding may expose permitted Agent Presets and route a message to a DSH Session. The current Channel Kernel keeps its decision order: `stickyEmployeeId`, then inferred intent, then the binding default. The Kernel and adapter do not persist an authoritative selection; enterprise composition must supply `stickyEmployeeId` from a DSH-owned binding or Session projection. That composition is a migration target, not a completed adapter capability.
- Inbound idempotency is scoped by channel, platform account, and provider message id; accepted state changes are idempotent DSH operations with attributable Session events.
- The channel phase requires every channel or outbox operation to have a persisted stable `operationId`. DSH admits and dispatches one logical operation for that id; recovery resumes the same record rather than creating another. Provider-side de-duplication is guaranteed only when the provider accepts an idempotency key. A timeout or ambiguous result from a provider without that support becomes a visible unknown outcome requiring reconciliation, not an exactly-once claim or blind retry.
- Token expiry and stale inbound heartbeats become operator-visible health states.
- Channel audit records direction, canonical actor when resolved, provider identifiers, content length, and content hash without copying raw message bodies or credentials.

`@deepseek-ai/dsh-channel-kernel` implements provider-neutral routing and delivery decisions. Real provider credentials, connection lifecycles, durable inbox/outbox storage, and SDK calls remain separate adapters and are not claimed complete by the kernel package.

## Enterprise Governance Plane

The governance plane decides who may perform an enterprise action; it does not authenticate users or store secrets itself:

- Every principal and protected resource belongs to one organization. Organization mismatch is denied before role evaluation.
- Roles are administrator, creator, operator, auditor, and member. Administrators govern users, models, credentials, channels, and all organization resources; creators can publish employees and update definitions they own; auditors are read-only.
- Employee and work-record visibility is organization-wide, private, or restricted to named users. Session creation and reading use the same resource visibility decision.
- Capability assets, model configuration, channel administration, and credential administration are explicit actions rather than UI conventions.
- Credential values remain in the DSH Credential seam; production providers must add encrypted-at-rest storage and rotation evidence.
- Governance audit records organization, authenticated actor, action, resource, decision, reason, correlation id, and time without accepting arbitrary secret-bearing payloads.
- Desktop mode permits a local identity boundary. LAN mode requires authenticated identity, RBAC, encrypted credentials, an audit sink, and single-port packaging. Public mode additionally requires TLS.
- SSO is an identity-provider adapter that produces the canonical enterprise principal; reachability and `trustedHosts` never satisfy that requirement.

`@deepseek-ai/dsh-enterprise-governance` implements authorization policy. The enterprise overlay composes SQLite identity/audit persistence, local and OIDC/SAML/LDAP login adapters, central Host transport enforcement, AES-256-GCM credentials, and the governance administration UI. Real external SSO readiness remains deployment evidence: an enterprise must still validate its own endpoints, metadata, certificate chain, directory, TLS, and secret-manager custody.

## Device Plane

DSH may execute approved browser and desktop actions on an authenticated user's own computer through a local `dsh-device-agent`. The Server owns device registration, Run scope, permission policy, durable action state, audit, and one-time Permits. The local Agent owns the device private key, operating-system permissions, Adapter processes, local confirmation, and execution.

- Device requests use Ed25519 signatures bound to method, path, timestamp, nonce, and body. They do not reuse browser cookies.
- Every Run is bound to one organization, user, device, Workspace, and Session. Every action is bound to one Run, typed capability, Adapter, operation, expiry, and one-time Permit.
- Browser actions use an isolated `agent-browser` or Playwright MCP session. Cua handles native desktop actions. Arbitrary commands and server-supplied module paths are not accepted.
- Control actions default to local confirmation. Device private keys, cookies, passwords, clipboard contents, and raw screen recordings are never stored by the Server.
- Action summaries and evidence hashes are durable. A claimed action with an unknown result is not blindly replayed.

## Accessibility & Inclusion

The workbench must support keyboard navigation, visible focus, reduced motion, light and dark themes, responsive layouts, Chinese and English copy, and status communication that does not depend on color alone.
