# `@deepseek-ai/dsh-enterprise-operations`

English | [中文](README.zh.md)

Durable operation projections over native DSH execution:

- Work records reference native Session IDs and employee releases without duplicating event bodies. Deployments may inject Session and release resolvers; when configured, each resolver must confirm its reference in the same organization before a write.
- Approval requests use optimistic revisions and auditable transitions.
- Employee and fixed-team schedules create one idempotent start-session Outbox command per occurrence; retries with another request idempotency key return the original command.
- Fixed teams bind a leader, members, Workflow template, and approval policy.
- PostgreSQL transactions and organization-scoped queries preserve boundaries.
- Native references fail closed when their resolver is missing. Tests and local development may explicitly set `allowUnverifiedReferences`; production composition must omit it.
- Idempotency keys bind a SHA-256 request digest, and reuse with different input is rejected. Only active schedules can fire; the Outbox command creates the new scheduled Session.
- `EnterpriseOperationsWorker` claims one Outbox command, invokes an injected native Session creator, then completes or fails the claim. Retry timing is supplied by the caller through `nextAttemptAt`.

## Host API service contract

`EnterpriseOperationsService` is the driver-neutral Host/API facade. It accepts an
`EnterprisePrincipal` and requires `authorize` and `audit` callbacks. Organization
scope is checked before authorization, and denied requests never reach the driver.
Each method uses a typed `enterpriseOperation.*` endpoint and injects the principal's
organization ID into the driver, so request payloads cannot switch organizations.
Production composition should connect `authorize` to the central
`EnterpriseSecurity.authorizeApi` policy and `audit` to the durable audit repository.

```ts
const service = new EnterpriseOperationsService(repository, {
  authorize: (principal, endpoint, input) => security.authorizeApi(principal, endpoint, input),
  audit: event => auditRepository.append(event),
})
const records = await service.listWorkRecords(principal, { businessState: 'waiting-approval' })
```

The service only owns the Host boundary and delegation; it does not replace the
native DSH Session/Workflow execution loop. The product composition injects the
PostgreSQL driver, native Session creator, and outbox worker.

## Model Experience

### Operation projections

#### What the model sees

Nothing. The package persists operations control data and contributes no prompt, message, tool schema, result, or model call.

#### Token effect

Zero tokens. Projection writes do not enter model history.

#### KV Cache effect

None; operation state does not assemble provider requests.

## Known Limitations and Deferred Work

- This package does not implement the browser management pages or a real scheduler worker.
- Fixed teams intentionally exclude StaffDeck bidding, blackboards, and market wakeups.
