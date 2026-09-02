---
description: "Durable DSH enterprise work records, approvals, schedules, team definitions, outbox, and fixed teams."
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-operations`

English | [中文](README.zh.md)

## Summary

Durable DSH enterprise work records, approvals, schedules, team definitions, TeamRun query projections, explicit autonomy grants, outbox, and fixed teams.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Durable operation projections over native DSH execution:

- Work records reference native Session IDs and employee releases without duplicating event bodies. Deployments may inject Session and release resolvers; when configured, each resolver must confirm its reference in the same organization before a write.
- Approval requests use optimistic revisions and auditable transitions.
- Employee and fixed-team schedules create one idempotent start-session Outbox command per occurrence; retries with another request idempotency key return the original command.
- Fixed teams bind a leader, members, Workflow template, and approval policy.
- Fixed-team and definition writes share one global team-id advisory lock. A legacy save synchronizes a `needs-charter` definition's leader and Agent roster. Once active, compatibility compares the request only with the persisted FixedTeam leader, members, and approval policy; typed role IDs and formal definition policy are not reverse-projected into the legacy record. Active definitions allow exact no-ops and Workflow-only updates, while archived definitions allow only exact no-ops.
- Team definitions add a typed human-and-Agent roster, named responsibilities, verification policy, centralized decision queue, visibility, ownership, and charter lifecycle without storing TeamRun state.
- `EnterpriseTeamControlService` starts and cancels runtime-authoritative TeamRuns through an injected `EnterpriseTeamRuntimeDriver`. PostgreSQL stores only revision-fenced TeamRun and TeamDecision query projections; the driver appends the authoritative events to the root Session log and reconciles unknown outcomes with the same stable operation identity.
- Browser start requests contain only a team revision fence, Workspace, prompt, source, and idempotency key. Host principal injection supplies organization and creator identity, freezes the definition revision and roster snapshot, checks current visibility and Workspace authorization, and audits the operation.
- TeamDecision creation is Host-only runtime ingestion. Only the assigned human, team owner, or an administrator may respond; the driver appends the answer before PostgreSQL projects `answered`. Only the team owner or an administrator may save or revoke autonomy grants.
- Autonomy grants are explicit human writes over team, immutable employee release, task type, and capability scope. Revocation is terminal, evidence references are canonical, and no runtime path can create, restore, or raise a grant.
- Active definitions require a complete charter, a rostered human owner, a rostered Agent leader, unique actors and roles, valid role references, and complete verification and attention policies. Restricted visibility requires a non-empty list of trimmed, unique user IDs; organization and private visibility require an empty list.
- Schema migration and fixed-team creation establish one `needs-charter` definition when none exists, preserve release members, role labels, leader, approval policy, and organization visibility, and use the explicit `system:legacy-fixed-team-migration` owner placeholder. They do not infer a name, north star, responsibility, or policy. `needs-charter` definitions cannot back a team work record, schedule, or schedule fire.
- PostgreSQL transactions and organization-scoped queries preserve boundaries.
- Work records, approvals, schedules, fixed teams, and team definitions expose stable keyset pagination. Cursors are canonical base64url payloads authenticated with a scope-bound HMAC-SHA256 signature; changing the organization or filters invalidates a cursor. Limits must be integers from 1 through 100.
- Definition cursors also bind the Host-derived viewer id and administrator flag. PostgreSQL applies organization, owner, private, and restricted visibility before limiting rows, so hidden definitions neither enter cursors nor create empty intermediary pages.
- Cursor version 2 seeks on immutable `created_at` plus stable IDs; `updatedAt` remains display metadata. Updating an item between pages therefore cannot move it ahead of the cursor and omit it.
- Work-record queries filter by business state, source, and fixed team. Approval queries filter by kind, state, and requester. Schedule queries filter by state.
- Fixed teams and schedules support compare-and-swap updates. Team updates replace the complete member set after validating every release in the organization. Archived schedules are terminal and cannot be edited or restored.
- Team-definition writes use compare-and-swap revisions and request-bound idempotency keys. Only the archive operation can enter `archived`; all later saves are rejected, while an exact archive retry returns its recorded idempotent result.
- Restricted allowlists are trimmed, deduplicated, and sorted before validation, hashing, and storage. Active saves resolve the owner, every human roster member, every allowlisted user, and the optional department in the same organization.
- Active saves project the Definition leader, non-leader Agent roster members and role IDs, and approval policy into FixedTeam while preserving its Workflow template. New team work accepts only Agent releases in the current roster; scheduled commands capture the Definition revision and can admit only when that revision and leader still match.
- Every WorkRecord transition into `active` revalidates the current Definition and Agent roster; terminal or waiting updates for already-running work remain available. Deterministic admission failures enter `dead-letter` and cannot be claimed again, while retryable failures return to the normal claim path. Migration dead-letters legacy team commands that have no captured Definition revision.
- Pending approvals may be cancelled. The repository records the actor and reason; `EnterpriseOperationsService` permits cancellation only for the requester or an administrator.
- Native references fail closed when their resolver is missing. Tests and local development may explicitly set `allowUnverifiedReferences`; production composition must omit it.
- Idempotency keys bind a SHA-256 request digest, and reuse with different input is rejected. Only active schedules can fire; the Outbox command creates the new scheduled Session.
- `EnterpriseOperationsWorker` admits a claimed Outbox command before invoking the external Session creator. Admission uses a short transaction and the shared team lock to revalidate active state, the processing owner, and its unexpired lease, then records `startAdmittedAt` and releases the connection. Lost ownership, expired leases, and admission-update races return `fencing-lost`; the stale worker stops immediately without calling fail or complete, leaving the command to its current owner or expired-lease reclaim. Inactive or stale charter data returns deterministic `admission-rejected` or team-definition `invalid-state` and is dead-lettered. Definition save/archive rejects live admitted leases; pending or expired commands do not block.

## Host API service contract

`EnterpriseOperationsService` is the driver-neutral Host/API facade. It accepts an `EnterprisePrincipal` and requires `authorize` and `audit` callbacks. Organization scope is checked before authorization, and denied requests never reach the driver. Each method uses a typed `enterpriseOperation.*` endpoint and injects the principal's organization ID into the driver, so request payloads cannot switch organizations. Team-definition reads pass only a Host-derived user id and administrator flag to the repository; PostgreSQL applies stored visibility before pagination, while the repository remains free of role-bearing principals. Production composition should connect `authorize` to the central `EnterpriseSecurity.authorizeApi` policy and `audit` to the durable audit repository. The production PostgreSQL composition derives separate Catalog and Operations cursor keys from deployment secret material and resolves employee releases, users, departments, and native Session headers directly from their source tables. Session resolution additionally requires a matching `resource_policies` row for `resource_type = 'session'` and the caller's organization. Missing or cross-organization policies fail closed. Cancellation runs the central authorization decision before any driver read, then resolves ownership only when central policy allows; one final allowed or denied audit is emitted. Filtered schedule listing returns a cursor page; the no-filter service overload retains the legacy array result. Native reference resolvers receive the repository's active transaction connection and must query through it; this avoids pool re-entry deadlocks when `poolMax` is one.

```ts
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import {
  EnterpriseOperationsService,
  type EnterpriseOperationsAudit,
  type EnterpriseOperationsAuthorize,
  type EnterpriseOperationsDriver,
} from '@deepseek-ai/dsh-enterprise-operations'

declare const repository: EnterpriseOperationsDriver
declare const principal: EnterprisePrincipal
declare const authorize: EnterpriseOperationsAuthorize
declare const audit: EnterpriseOperationsAudit

const service = new EnterpriseOperationsService(repository, {
  authorize,
  audit,
})
const records = await service.listWorkRecords(principal, { businessState: 'waiting-approval' })
```

The service only owns the Host boundary and delegation; it does not replace the native DSH Session/Workflow execution loop. The product composition injects the PostgreSQL driver, native Session creator, and outbox worker.

## Model Experience

### Operation projections

#### What the model sees

Nothing. The package persists `EnterpriseTeamDefinition` and other operations control data and contributes no prompt, message, tool schema, result, or model call.

#### Token effect

Zero tokens. Projection writes do not enter model history.

#### KV Cache effect

None; operation state does not assemble provider requests.

## Known Limitations and Deferred Work

- This package does not implement a concrete Agent Teams runtime adapter, TeamRun UI, channel adapter, team-definition browser editor, or a real scheduler worker.
- Fixed teams intentionally exclude StaffDeck bidding, blackboards, and market wakeups.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
