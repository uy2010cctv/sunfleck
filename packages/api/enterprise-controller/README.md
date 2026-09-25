---
description: "Authenticated Typert Remote APIs for enterprise employees, assets, teams, approvals, schedules, and work records."
kind: "package-reference"
---
# Enterprise Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-enterprise-controller` owns the authenticated Typert Remote namespaces for enterprise employees, capability assets, fixed teams, typed team definitions, TeamRuns, TeamDecisions, autonomy grants, work records, approvals, schedules, goal-first work start, and paired user devices. Every operation resolves an `EnterprisePrincipal`, applies organization and role policy, records an audit decision, and delegates to the enterprise control plane.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

`GET /enterprise/session-context/:sessionId` returns the Session's pinned employee release, an explicit-member project, and approved authorized summaries without activating a runtime. Employee selection is independent of the work-mode preset and is checked against the durable owner and organization. Private summaries require an ordinary owner-only Session with a matching employee selection or account anchor; collaboration Sessions omit agent and pair summaries. Pair memory requires both employee and user ids; legacy pair rows without employee attribution are omitted.

Mount the controller only in the enterprise profile after `enterprisePostgres`, `enterpriseSecurity`, `enterpriseRequestContext`, and `sessionController`. Clients consume its generated `enterpriseEmployee`, `enterpriseAsset`, `enterpriseTeam`, `enterpriseTeamDefinition`, `enterpriseTeamRun`, `enterpriseTeamDecision`, `enterpriseTeamAutonomy`, `enterpriseOperation`, `enterpriseWork`, and `enterpriseDevice` namespaces through API Gateway. The TeamRun start and cancel namespaces use an optional `enterpriseTeamRuntimeDriver`; without a provider, start fails with a stable runtime-unavailable result. Device pairing and Computer Use requests are bound to the authenticated user, Workspace, Session, short-lived operation permit, and device signature. Host code injects organization and actor identity, while browser requests cannot write runtime revisions or event positions. The package does not replace DSH Workspace, Session, Workflow, Sandbox, Subagent, or Agent Loop identities.

`enterpriseTeamDefinition` separates charter editing from executable history: `draft` appends an immutable revision, `getDraft` returns the current owner-visible draft without replacing the active charter, `publish` promotes one checked draft for future runs, and `discardDraft` archives only that draft. Each endpoint uses the existing `team.read` or `team.manage` policy and audit path; callers never supply organization or actor identity.

`cordisWorkspace` reads use the authenticated principal to filter private Packages and bindings. Its `archive` and `restore` operations act only on a Plugin owned by that principal in the requested Workspace; archival retains immutable source and stops new-Session activation. `cordisReview.submitSaved` accepts only an owner-private version in its department Workspace and creates a separate pending review without activating it. Department approval and organization publication keep their manager and administrator policies.

Employee publication writes an immutable catalog release and maintains a native Agent Preset declaration for historical Session replay and employee roster display. The Preset write retries once after a transient failure. A persistent failure states that the catalog release is already published and asks the caller to retry reconciliation; an unchanged published draft returns the same release. Once the Host Loader settles, the controller reconstructs the latest declaration of every published employee. The registry checks the authenticated caller against the employee catalog before listing, reading, selecting, or binding an employee declaration; Host-internal replay can still resolve committed legacy Sessions.

`enterpriseWork.workspaceDefault` reads a caller-safe Workspace employee choice and CAS revision. `saveWorkspaceDefault` lets a personal owner, department manager, or organization administrator set or clear it after workspace and published-employee authorization. A hidden or unavailable employee is returned as `employeeId: null` with `unavailable: true`; the stored revision remains visible for authorized Workspace members. New Sessions select a generic Agent Preset as their work mode, then `selectEmployee` checks Session ownership, Workspace grant, employee visibility, and blank-turn state before appending an independent employee selection event with the immutable release id. The employee persona shadows the mode persona inside that Agent while its other mode plugins remain mounted. Replay restores the same release; learning and private employee memory read the employee binding. Goal-first work starts use the configured default work mode and bind the selected employee release separately. Selecting an employee alone does not create a work record or start a task.

The PostgreSQL collaboration routes under `/enterprise/surfaces` list explicit memberships, create groups/channels, read details, resolve `/by-session/:sessionId`, open native destinations, and dispatch text messages. Creation accepts an optional `idempotencyKey` scoped to the authenticated organization and creator: matching resolved values reuse the stored conversation, and different values return 409 without writes. Creation requires an accessible existing Workspace, explicit human members with access to it, and visible published employees. Detail and open responses include native Session ids only after membership and Workspace checks. Native `session.prompt` uses the same routing after reload and returns authorized response Session ids for navigation. Team retries inspect durable request receipts before lifecycle routing, so completed or waiting-human runs retain their original receipt. Employee destinations start through `enterpriseWork.start` with an exact published release and retain their separate base work-mode preset on resume. Group mentions match full roster names, including spaces, and prefer the longest valid name before routing to employee Sessions; an unaddressed message from an existing native composer is logged without running an employee. Channel policies control topics and duty routing, with a separate native Session for each topic and employee; `/done` settles a topic. Announcement channels propose privacy-screened organization memory without starting an Agent. Attachments are explicitly rejected. User messages retain the native request id together with their conversation and authenticated actor attribution.

The employee dm routes under `/enterprise/employees` and token-authenticated inbound route under `/enterprise/channels` require their separately composed surface runtime. Project routes under `/enterprise/projects` retain explicit membership checks, archival, and optional memory distillation.

<a id="model-experience"></a>
## Model Experience

### Enterprise control APIs

#### What the model sees

Collaboration delivery records the authenticated message as `user/message` in the selected native Session. Employee mention and duty routing use the same Agent preset and Session history as ordinary work.

#### Token effect

Metadata operations add no model tokens. Each routed collaboration message enters native Session history; normal employee prompt and history costs apply. Announcement intake uses the deterministic memory-proposal path.

#### KV Cache effect

None until a released employee starts an ordinary DSH Session.

## Known Limitations and Deferred Work

- The first enterprise profile targets one organization and one PostgreSQL deployment.
- Live enterprise invalidation events are not a substitute for reading the authoritative repository after reconnect.
- The package provides no concrete Agent Teams runtime driver, TeamRun UI, or channel adapter.
- Public `EnterpriseWorkPrepareRequest`, `EnterpriseWorkStartRequest`, `EnterpriseWorkPreparation`, and `EnterpriseWorkStartValue` contracts are exported from the package root and `./types`.
- `enterpriseWork.prepare` resolves an authorized workspace in explicit, caller-owned Session, authorized recent hint, then personal-workspace order. An implicit personal workspace is used only when exactly one caller-owned personal workspace remains authorized and visible; otherwise it returns `needs-workspace-selection` with the authorized visible workspace IDs. It automatically selects only the newest release of a single published preset and returns `needs-selection` for multiple presets. `start` derives an opaque SHA-256 Session ID from organization, user, and idempotency key, then atomically reserves its canonical request fingerprint, immutable release ID, and resolved Session inputs in Enterprise Operations before native Session creation or binding. A reused key with changed input conflicts before those side effects; a `starting` reservation lets the same request resume after a WorkRecord write failure, and the reservation becomes `completed` only after the upsert. It stores only an objective digest plus an optional permitted deadline and does not route models/capabilities, create teams, accept attachments, assign budgets, or create autonomy grants.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Keep all Remote payloads JSON-safe and preserve authorization and audit calls when adding methods. Work-start idempotency must keep its opaque deterministic Session-ID derivation limited to organization, user, and idempotency key; reserve the canonical request fingerprint, immutable release ID, and resolved Session inputs in Enterprise Operations before native effects, never expose request values in a Session ID, reject a reused key whose reservation fingerprint differs, and only complete a reservation after WorkRecord persistence.

</details>
