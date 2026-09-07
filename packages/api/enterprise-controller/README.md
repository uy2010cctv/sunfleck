---
description: "Authenticated Typert Remote APIs for enterprise employees, assets, teams, approvals, schedules, and work records."
kind: "package-reference"
---
# Enterprise Controller

English | [中文](README.zh.md)

## Summary

`@deepseek-ai/dsh-api-enterprise-controller` owns the authenticated Typert Remote namespaces for enterprise employees, capability assets, fixed teams, typed team definitions, TeamRuns, TeamDecisions, autonomy grants, work records, approvals, schedules, and goal-first work start. Every operation resolves an `EnterprisePrincipal`, applies organization and role policy, records an audit decision, and delegates to the enterprise control plane.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the controller only in the enterprise profile after `enterprisePostgres`, `enterpriseSecurity`, `enterpriseRequestContext`, and `sessionController`. Clients consume its generated `enterpriseEmployee`, `enterpriseAsset`, `enterpriseTeam`, `enterpriseTeamDefinition`, `enterpriseTeamRun`, `enterpriseTeamDecision`, `enterpriseTeamAutonomy`, `enterpriseOperation`, and `enterpriseWork` namespaces through API Gateway. The TeamRun start and cancel namespaces use an optional `enterpriseTeamRuntimeDriver`; without a provider, start fails with a stable runtime-unavailable result. Host code injects organization and actor identity, while browser requests cannot write runtime revisions or event positions. The package does not replace DSH Workspace, Session, Workflow, Sandbox, Subagent, or Agent Loop identities.

`enterpriseTeamDefinition` separates charter editing from executable history: `draft` appends an immutable revision, `getDraft` returns the current owner-visible draft without replacing the active charter, `publish` promotes one checked draft for future runs, and `discardDraft` archives only that draft. Each endpoint uses the existing `team.read` or `team.manage` policy and audit path; callers never supply organization or actor identity.

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
