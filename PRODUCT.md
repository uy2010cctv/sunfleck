# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary users are operators and administrators inside one enterprise intranet. They create and manage digital employees, assign work, review execution evidence, intervene in blocked work, and reuse proven employee capabilities. Ordinary enterprise users start work with permitted digital employees and inspect the work records they are allowed to access.

## Product Purpose

DeepSeek Harness Enterprise turns the existing DSH agent runtime into an enterprise digital-employee workbench. It makes agent definitions legible as employees, sessions legible as work records, and goals, jobs, schedules, subagents, workflows, approvals, and event logs legible as an operational system. Success means an operator can understand who is working, on what, with which capabilities and permissions, and with what evidence, without leaving the DSH runtime.

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
- `Workspace` is the canonical business-space boundary.
- `Session` is the canonical work-record identity.
- `SessionEvent` is the canonical audit and replay record.
- `Goal`, background Jobs, Schedule, Subagent, and Workflow remain their existing DSH capabilities and are projected into enterprise operations.
- The first enterprise foundation adds employee metadata, employee discovery, an operations workbench, and role-aware UI/API seams.
- The target is single-enterprise intranet multi-user, not public anonymous access or cloud multi-tenancy.
- The enterprise security overlay adds authenticated identity and authorization before every HTTP RPC, Typert endpoint, dedicated RPC channel, and WebSocket downlink. The ordinary Web profile remains a developer profile and its loopback/trusted-host checks remain transport fences only.
- Organization isolation, cross-enterprise tenancy, billing, and public SaaS administration are outside the first release.
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

## Channel Plane

The channel plane is a separate Channel Kernel around, not inside, the Agent runtime. A provider adapter owns transport login, webhook/desktop ingress, provider acknowledgements, and provider-specific outbound calls. The kernel normalizes those facts and owns only routing and reliability policy:

- Initial provider targets are personal WeChat and Enterprise WeChat Bot adapters.
- One channel binding may publish multiple Agent Presets as digital employees and names one optional default.
- `/员工` and `/employees` list bound employees; `/切换 <employee>` and `/switch <employee>` change the explicit employee.
- Sticky Employee wins over inferred intent until an explicit switch; intent wins over the channel default.
- A canonical enterprise user may merge several channel-account aliases; an unbound alias remains channel-local.
- Inbound idempotency is scoped by channel, platform account, and provider message id.
- Outbound delivery uses a durable dispatcher with capped exponential retry and provider acknowledgement evidence.
- Token expiry and stale inbound heartbeats become operator-visible health states.
- A disconnected Session resumes, a missing Session may be recreated, and corrupt history is quarantined rather than overwritten.
- Channel audit records direction, actor, employee, provider identifiers, content length, and content hash without copying raw message bodies or credentials.

`@deepseek-ai/dsh-channel-kernel` implements the provider-neutral decision contracts. Real WeChat/WeCom credentials, connection lifecycles, durable inbox/outbox storage, and SDK calls remain separate adapters and are not claimed complete by the kernel package.

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

## Accessibility & Inclusion

The workbench must support keyboard navigation, visible focus, reduced motion, light and dark themes, responsive layouts, Chinese and English copy, and status communication that does not depend on color alone.
