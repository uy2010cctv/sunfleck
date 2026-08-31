---
description: "Durable DSH enterprise work records, approvals, schedules, team definitions, outbox, and fixed teams."
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-operations`

English | [中文](README.zh.md)

## Summary

Durable DSH enterprise work records, approvals, schedules, team definitions, outbox, and fixed teams.

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
- Team definitions add a typed human-and-Agent roster, named responsibilities, verification policy, centralized decision queue, visibility, ownership, and charter lifecycle without storing TeamRun state.
- Active definitions require a complete charter, a rostered human owner, a rostered Agent leader, unique actors and roles, valid role references, and complete verification and attention policies. `needs-charter` definitions are never executable.
- Schema migration creates one `needs-charter` definition for each legacy fixed team, preserves its release members, role labels, leader, approval policy, and organization visibility, and uses the explicit `system:legacy-fixed-team-migration` owner placeholder. It does not infer a name, north star, responsibility, or policy.
- PostgreSQL transactions and organization-scoped queries preserve boundaries.
- Work records, approvals, schedules, fixed teams, and team definitions expose stable keyset pagination. Cursors are canonical base64url payloads authenticated with a scope-bound HMAC-SHA256 signature; changing the organization or filters invalidates a cursor. Limits must be integers from 1 through 100.
- Cursor version 2 seeks on immutable `created_at` plus stable IDs; `updatedAt` remains display metadata. Updating an item between pages therefore cannot move it ahead of the cursor and omit it.
- Work-record queries filter by business state, source, and fixed team. Approval queries filter by kind, state, and requester. Schedule queries filter by state.
- Fixed teams and schedules support compare-and-swap updates. Team updates replace the complete member set after validating every release in the organization. Archived schedules are terminal and cannot be edited or restored.
- Team-definition writes use compare-and-swap revisions and request-bound idempotency keys. Archived definitions cannot return to an active or chartering state.
- Pending approvals may be cancelled. The repository records the actor and reason; `EnterpriseOperationsService` permits cancellation only for the requester or an administrator.
- Native references fail closed when their resolver is missing. Tests and local development may explicitly set `allowUnverifiedReferences`; production composition must omit it.
- Idempotency keys bind a SHA-256 request digest, and reuse with different input is rejected. Only active schedules can fire; the Outbox command creates the new scheduled Session.
- `EnterpriseOperationsWorker` claims one Outbox command, invokes an injected native Session creator, then completes or fails the claim. Retry timing is supplied by the caller through `nextAttemptAt`.

## Host API service contract

`EnterpriseOperationsService` is the driver-neutral Host/API facade. It accepts an `EnterprisePrincipal` and requires `authorize` and `audit` callbacks. Organization scope is checked before authorization, and denied requests never reach the driver. Each method uses a typed `enterpriseOperation.*` endpoint and injects the principal's organization ID into the driver, so request payloads cannot switch organizations. Production composition should connect `authorize` to the central `EnterpriseSecurity.authorizeApi` policy and `audit` to the durable audit repository. The production PostgreSQL composition derives separate Catalog and Operations cursor keys from deployment secret material and resolves employee releases and native Session headers directly from their source tables. Session resolution additionally requires a matching `resource_policies` row for `resource_type = 'session'` and the caller's organization. Missing or cross-organization policies fail closed. Cancellation runs the central authorization decision before any driver read, then resolves ownership only when central policy allows; one final allowed or denied audit is emitted. Filtered schedule listing returns a cursor page; the no-filter service overload retains the legacy array result. Native reference resolvers receive the repository's active transaction connection and must query through it; this avoids pool re-entry deadlocks when `poolMax` is one.

```ts
const service = new EnterpriseOperationsService(repository, {
  authorize: (principal, endpoint, input) => security.authorizeApi(principal, endpoint, input),
  audit: event => auditRepository.append(event),
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

- This package does not implement TeamRun, a team-definition browser editor, Agent runtime coordination, or a real scheduler worker.
- Fixed teams intentionally exclude StaffDeck bidding, blackboards, and market wakeups.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
