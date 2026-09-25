# Agent Note: Enterprise digital-employee workbench

Status: implemented

English | [中文](2026-08-26-enterprise-digital-employee-workbench.zh.md)

## Problem

DSH exposes Agent Presets, Workspaces, Sessions, and Session Events as separate developer-facing concepts. An enterprise operator needs one coherent roster-and-work view, but a second employee or task engine would duplicate lifecycle and audit state and eventually disagree with the runtime.

## Decision

The enterprise operations layer is a DSH-native projection. Published employee Releases project into executable Agent Presets, Workspaces are business spaces, Sessions are work records, and Session Events remain the runtime audit source of truth. [Employee and mode ownership](../architecture/2026-09-25-digital-employee-and-agent-mode-ownership.md) governs their separate browser entries and Workspace defaults.

The browser surface is additive: one Sidebar footer action and one frame overlay. Starting work delegates to `SessionRuntime.create({ agentPreset })`; selecting existing work opens the original Session. The enterprise package stores no duplicate work lifecycle.

## Preset metadata

The published catalog Release supplies employee presentation and runtime persona fields. Its stable preset id remains the identity; capability labels do not grant tools or permissions. Ordinary Agent Preset declarations remain work modes.

## Managed employee creation

An empty enterprise roster must expose a primary **New digital employee** action instead of a terminal empty state. The editor begins as an unsaved revision-zero draft and hides the generated internal id. On the first valid save, DSH copies the deployment's default Agent Preset under that stable generated id, then persists the enterprise draft. Later saves use revision CAS, publishing freezes an immutable Release, and the employee remains runnable through the native Session `agentPreset` path rather than becoming a catalog-only record.

Each employee profile carries an opaque `avatarSeed`. New drafts receive a random seed, while older records fall back to the stable Preset id. The browser renders the seed with DiceBear's Lorelei HTTP API; it never sends a person's name, email, prompt, or organization data to the avatar service. Lorelei is a CC0-licensed remix and remains presentation metadata rather than runtime identity.

The employee editor reads `/auth/departments` through the current authenticated session and stores the selected canonical department name. This read route is available to ordinary authenticated members under employee-read policy; department creation and restructuring remain administrator-only. The form uses a full-width employee name, paired position/department controls, full-width descriptive fields, and no explanatory avatar paragraph.

`EnterpriseWorkbench.module.css` applies a scoped `border-box` sizing invariant to the workbench root and every descendant or pseudo-element. A control declared as `inline-size: 100%` therefore includes its padding and border inside its grid track. Employee, schedule, asset, team, and extension forms can share responsive field grids without adjacent inputs overlapping.

The model field reads the same live `session/modelCatalog` used by the conversation composer and stores a provider/model route. The **AI optimize** action calls `enterpriseEmployee.optimizePrompt`; the Host resolves the selected configured adapter, performs a text-only one-shot through `ctx.llm`, and returns an improved prompt without exposing credentials to the browser. The result only updates the unsaved local draft and remains subject to the ordinary explicit save/revision fence.

Release validation accepts that direct configured provider/model route without requiring a duplicate enterprise `model` asset binding. Historical drafts that reference a versioned model asset retain the original asset/version validation path. This keeps model selection aligned with the live DSH Provider catalog while preserving immutable legacy releases.

Publishing also compiles the immutable Release identity into the user-authored native Agent Preset: name, description, position, department, capability labels, and responsibility Prompt update `preset.yml` plus the scoped `@deepseek-ai/dsh-persona` row. The generated persona explicitly answers self-introduction from the employee identity instead of claiming to be a generic coding Agent or the DSH system. The composition stamp starts a new standing Preset generation for later Sessions; already-running Sessions retain the generation they started with.

Capability discovery uses the same five-card taxonomy in the employee editor and capability-management page: SOP, Knowledge, Skill, Tool, and Cordis Extension. The first four cards filter versioned enterprise assets for creation or binding; the Cordis card opens the existing Extension center because Cordis packages keep their own scope, review, Generation, and runtime lifecycle. Model selection remains in the employee runtime section and is not presented as a capability asset. Cards show honest stored or bound counts and reflow from five desktop columns to smaller responsive grids.

The team editor groups immutable Releases by employee Preset and offers only the newest published Release for each employee. Lead and member selection use responsive identity cards with the employee avatar, role, department, and explicit Release version; the lead is a single choice and is removed from the member choices after selection. Saving still records the selected immutable Release ids, so later employee publishing does not silently change an existing team definition.

## StaffDeck provenance boundary

OpenBMB StaffDeck informed the employee-roster and operations information architecture. No StaffDeck React components, FastAPI models, illustrations, avatars, logos, or source files are copied. DSH keeps its MIT source, Cordis plugin topology, runtime services, event log, theme tokens, and browser slot system.

## Multi-user boundary

The selected deployment target is one enterprise intranet with multiple users. This feature establishes the employee and operations projection but does not mislabel the current Host as authenticated multi-user infrastructure. A later authenticated identity and authorization provider must enforce record visibility and administrative actions before that deployment claim is complete. `trustedHosts` and loopback checks remain DNS-rebinding/reachability controls only.

## Channel Kernel

`@deepseek-ai/dsh-channel-kernel` establishes provider-neutral command, Sticky Employee, intent/default routing, canonical channel identity, inbound idempotency, retry timing, token/heartbeat health, Session recovery, and redacted message-audit contracts. Personal WeChat and WeCom Bot login, transport, durable inbox/outbox storage, and provider acknowledgements remain adapter responsibilities. The kernel routes into native Sessions and never creates another conversation store.

## Enterprise governance kernel

`@deepseek-ai/dsh-enterprise-governance` establishes organization-first authorization, administrator/creator/operator/auditor/member roles, employee and Session visibility, deployment readiness, and attributable audit contracts. It does not authenticate users or store secrets. LAN and Public deployment remain blocked until identity, RBAC, encrypted credentials, durable audit, single-port packaging, and Public TLS evidence are supplied by deployment adapters.

## Authenticated enterprise deployment

The opt-in enterprise overlay replaces the managed plaintext credential provider with AES-256-GCM envelope storage, mounts SQLite identity/session/resource-policy/audit persistence, and exposes local plus OIDC/SAML/LDAP login through `/auth` on the same Web port. The Connection carrier authenticates and authorizes every shared HTTP RPC, Typert endpoint, dedicated RPC channel, and WebSocket downlink when `ctx.enterpriseSecurity` is present; unknown endpoints fail closed. The browser adds a full-frame login gate and an administrator-only organization/user/role/asset-policy/audit ledger.

Department shared Workspaces remain bound to the immutable department id. When a department is renamed, a system-generated `Department name · Shared workspace` label follows the new department name; an administrator-defined workspace label is preserved. The administrator Workspace ledger edits the display name and sandbox policy through one explicit revision-fenced save, then propagates the committed label to the native DSH Workspace Registry so the Sidebar and governance ledger agree. It does not reassign a Workspace across departments because Session visibility and department memory depend on that stable ownership boundary.

External SSO is implementation-complete but deployment-validation-dependent. Protocol-library and simulated-provider tests prove PKCE/state/nonce, SAML signature/InResponseTo configuration, LDAP TLS/filter/bind behavior, and canonical claim mapping. They do not prove a customer's real IdP metadata, certificate chain, directory schema, group mapping, TLS termination, or secret-manager custody.

## Alternatives considered

**A separate StaffDeck-style employee backend.** Rejected because it would create another task, audit, and employee identity plane that must synchronize with Sessions and Presets.

**Replacing the native Sidebar and Conversation.** Rejected because it would fork DSH navigation and execution behavior instead of composing with the existing slot system.

**Calling trusted-host checks multi-user security.** Rejected because reachability and DNS-rebinding controls do not authenticate a person or authorize a record.

**Embedding provider SDKs and RBAC directly in the workbench UI.** Rejected because transport and authorization must protect every Host entry point, not only one browser surface.

**Enabling authentication in the ordinary developer Web profile.** Rejected because it would break the existing loopback development workflow and turn missing enterprise secrets into a default startup failure. Enterprise security is an explicit overlay with fail-closed required key material.

## Consequences

- The workbench immediately benefits from existing Session resume, replay, fork, Jobs, approval, subagent, and workflow facts.
- Employee metadata can evolve without migrating session storage.
- No synchronization or conflict policy is needed between two employee engines.
- Enterprise roles, approval inboxes, persistent teams, and cross-user authorization remain explicit follow-up capabilities rather than UI-only claims.
- Channel and governance policy can be tested before any provider SDK or SSO system is selected.
- Desktop, LAN, and Public deployments share one-port `/auth` and `/api` transport; Public still requires deployment TLS.
