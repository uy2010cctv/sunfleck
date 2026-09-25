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

Mount the controller only in the enterprise profile after `enterprisePostgres`, `enterpriseSecurity`, `enterpriseRequestContext`, and `sessionController`. Clients consume its generated `enterpriseEmployee`, `enterpriseAsset`, `enterpriseTeam`, `enterpriseTeamDefinition`, `enterpriseTeamRun`, `enterpriseTeamDecision`, `enterpriseTeamAutonomy`, `enterpriseOperation`, `enterpriseWork`, and `enterpriseDevice` namespaces through API Gateway. The TeamRun start and cancel namespaces use an optional `enterpriseTeamRuntimeDriver`; without a provider, start fails with a stable runtime-unavailable result. Device pairing and Computer Use requests are bound to the authenticated user, Workspace, Session, short-lived operation permit, and device signature. Host code injects organization and actor identity, while browser requests cannot write runtime revisions or event positions. The package does not replace DSH Workspace, Session, Workflow, Sandbox, Subagent, or Agent Loop identities.

`enterpriseTeamDefinition` separates charter editing from executable history: `draft` appends an immutable revision, `getDraft` returns the current owner-visible draft without replacing the active charter, `publish` promotes one checked draft for future runs, and `discardDraft` archives only that draft. Each endpoint uses the existing `team.read` or `team.manage` policy and audit path; callers never supply organization or actor identity.

`cordisWorkspace` reads use the authenticated principal to filter private Packages and bindings. Its `archive` and `restore` operations act only on a Plugin owned by that principal in the requested Workspace; archival retains immutable source and stops new-Session activation. `cordisReview.submitSaved` accepts only an owner-private version in its department Workspace and creates a separate pending review without activating it. Department approval and organization publication keep their manager and administrator policies.

Employee publication writes the immutable catalog release and then updates the writable native Agent Preset used by new Sessions. The Preset write retries once after a transient failure. A persistent failure states that the catalog release is already published and asks the caller to retry reconciliation; an unchanged published draft returns the same release. Once the Host Loader settles, the controller reconstructs the latest release of every published employee as an Agent Preset. The registry checks the authenticated caller against the employee catalog before listing, reading, selecting, or binding an employee preset; Host-internal Session replay remains able to resolve committed presets.

`enterpriseWork.workspaceDefault` reads a caller-safe Workspace employee choice and CAS revision. `saveWorkspaceDefault` lets a personal owner, department manager, or organization administrator set or clear it after workspace and published-employee authorization. A hidden or unavailable employee is returned as `employeeId: null` with `unavailable: true`; the stored revision remains visible for authorized Workspace members. `selectEmployee` checks Session ownership, its Workspace grant, employee visibility, and blank-turn state, resumes a cold blank Agent when necessary, then mounts a published employee and records the actual mounted release in a work record. Generic work modes remain separate Agent Presets.

Three HTTP boundaries mount beside the Remote namespaces: the employee dm and memory governance routes under `/enterprise/employees` (`employee-http`), the collaboration surface and project routes under `/enterprise/surfaces` and `/enterprise/projects` (`surfaces-http`), and the token-authenticated channel inbound route `POST /enterprise/channels/:channelId/inbound`, which compares the `x-dsh-channel-token` header against the configured deployment token and answers 503 while that token is unset. The surface and project routes reuse the shared cookie authentication, the `channel.read` / `employee.create` / `employee.execute` and `team.read` / `team.manage` actions, and the `enterpriseSurface.*` / `enterpriseProject.*` audit names; project reads fold non-members behind 404, and structured not-delivered results answer 200. When no full surface runtime is mounted, authenticated `GET /enterprise/surfaces` reads the PostgreSQL directory with the same `channel.read` audit and kind validation; surface writes and inbound delivery still answer 503. The project routes own project distillation: `POST /enterprise/projects/:id/distill` runs it behind the member gate when the memory-consolidation plane is mounted (503 otherwise), and `POST /enterprise/projects/:id/archive` fires the same distillation without awaiting it, so closing a project never waits on or fails with memory work. Responses carry governance fields only — anchored session ids, delivery error chains, workspace paths, and member allowlists stay internal.

<a id="model-experience"></a>
## Model Experience

### Enterprise control APIs

#### What the model sees

None. These APIs manage control-plane metadata and do not directly assemble model prompts or execute an Agent turn.

#### Token effect

Zero tokens. `enterpriseTeamDefinition` Remote calls do not enter model history.

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
