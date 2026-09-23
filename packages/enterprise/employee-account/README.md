---
description: "Persistent digital employee accounts, sticky actor bindings, and direct-message inbox queues over the enterprise identity database, for compositions choosing, configuring, or debugging durable employees."
kind: "package-reference"
---

# @deepseek-ai/dsh-employee-account

English | [中文](README.zh.md)

## Summary

`dsh-employee-account` persists digital employee accounts in one organization's enterprise identity database: account lifecycle with archived as the terminal state, sticky actor-to-employee bindings, and per-employee direct-message inbox queues. It exposes the `ctx.employeeAccounts` Cordis service over an already-migrated SQLite `DatabaseSync` handle that the composition supplies, so employee identity survives process restarts without a second persistence stack. Choose it when durable employees must share the identity store with organizations, users, and sessions; all SQL stays in the employee store of `@deepseek-ai/dsh-enterprise-identity`. One migrated database handle is the only configuration; input validation, branded id minting, and the archived-terminal check come with the service.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin when a composition needs durable employee accounts beside the enterprise identity database. The common path: open and migrate the identity database, pass the handle to this plugin, and let consumers read it as `ctx.employeeAccounts`.

### When to choose it

Choose this package when persistent employees belong in the same database as organizations, users, and audit records. Compositions that persist enterprise data in PostgreSQL compose identity through `@deepseek-ai/dsh-enterprise-postgres` instead and need a PostgreSQL-backed implementation. The service assumes one in-process writer: the archived check and each state change are one check-then-act pair over a single connection, atomic only under the current single-connection usage ([defensive patterns](../../../docs/defensive-patterns.md)).

### Minimal configuration

The only config field is a live `DatabaseSync` handle, which a cordis.yml row cannot express. The composing plugin mounts this package programmatically from its own setup — open and migrate the database with `migrateEnterpriseIdentity`, then call this package's `apply(ctx, { database })` — and owns the database lifecycle.

| Field | Default | Meaning |
|---|---|---|
| `database` | required | Migrated enterprise identity database the service reads and writes |

`create` rejects an empty `displayName` or `roleCard` and a relative `homeWorkspacePath` with `TypeError` before any SQL runs; `setState` refuses any change to an archived account and names the current state in the error; `claim` passes `limit` through to the store unchanged; `resolveSessionActor` returns the org, surface user, and employee of the surface anchored to one session, or undefined when no surface anchors it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

`EmployeeAccountService` is a thin wrapper over the `@deepseek-ai/dsh-enterprise-identity` employee store: it validates input, mints branded UUID ids with `randomUUID()`, maps store rows to domain values, and delegates every statement to the store module. `enqueue` looks up the employee first because the inbox row's `orgId` comes from the account, and the foreign keys require the account and the direct-message surface to exist. Foreign-key enforcement is on: `migrateEnterpriseIdentity` sets `PRAGMA foreign_keys = ON` on the connection, so a missing organization, surface, or employee fails the insert loudly.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config`, `apply`, service provision, and the public re-exports |
| [`src/types.ts`](src/types.ts) | Domain types, the `EmployeeAccounts` interface, and the `ctx.employeeAccounts` key declaration |
| [`src/service.ts`](src/service.ts) | `EmployeeAccountService`: validation, id minting, and row-to-domain mapping over the store |
| [`src/ids.ts`](src/ids.ts) | The branded `EmployeeId`, `SurfaceId`, and `InboxItemId` constructors |
| — | No runtime invariant companion is published. The service has one authority: every account, binding, and inbox observation flows through the same SQL statements in `@deepseek-ai/dsh-enterprise-identity`, so no independent observation can diverge ([package invariant rules](../../AGENTS.md)). |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the storage layer to the production composition and the concurrency assumptions.

- [Enterprise identity](../../identity/enterprise-identity/README.md) — the store module, schema migrations, and row types this service writes through.
- [Enterprise PostgreSQL composition](../enterprise-postgres/README.md) — the production PostgreSQL adapter composition for enterprise deployments.
- [Defensive patterns](../../../docs/defensive-patterns.md) — the single-writer check-then-act assumptions this service inherits.

-----

<a id="model-experience"></a>
## Model Experience

### Employee account persistence

#### What the model sees

Nothing directly. The service registers no prompt section, tool schema, or provider request; the composed consumer that reads `ctx.employeeAccounts` owns any model-visible use of account, binding, or inbox data.

#### Token effect

Zero direct tokens. Model-visible uses are owned by the composing consumer.

#### KV Cache effect

None at this repository layer. The service changes no model request, so it cannot invalidate a cached prefix.

## Known Limitations and Deferred Work

These limits define when this service is a poor fit or needs composing support.

- **Direct-message surfaces are not managed here** — `enqueue` requires the `surfaces` row to already exist; surface creation and session attachment stay in the identity store's `ensureSurface` and `attachSurfaceSession` and their composing flows.
- **Surface-employee org consistency is caller-owned** — `enqueue` records the surface id without checking that the surface row belongs to the employee's organization; surface creation in the identity store is org-scoped by construction, so composing flows own the pairing. Sticky bindings are checked here: `bindSticky` refuses an employee from another organization.
- **Inbox delivery is claim-once** — `claim` marks items delivered and never retries; marking an item failed is the store's `failInboxItem`, which this service does not re-export, so redelivery policy belongs to a composing flow.
- **One database engine per service** — the service writes the SQLite identity database passed in `Config`; PostgreSQL deployments compose identity through `@deepseek-ai/dsh-enterprise-postgres` and receive no employee-account service from this package.
- **One in-process writer** — the archived check and each state change are one check-then-act pair, atomic only under the current single-connection usage; multi-process writers need external coordination.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

- `apply` provides the service with `ctx.provide('employeeAccounts', service)`, which registers it as a lifecycle effect owned by the plugin's fiber, so an unload/reload cycle un-provides and re-provides cleanly and mounting stays idempotent.
- `Config.database` must already have run `migrateEnterpriseIdentity`; the composer owns opening and closing the database, and this package never closes it. This explicit-handle design exists because `@deepseek-ai/dsh-enterprise-identity` registers no database service on the Cordis context — it is a library plus its invariants plugin — so there is no handle to `inject`.
- Tests build the environment the schema tests do: an in-memory `DatabaseSync`, `migrateEnterpriseIdentity`, and the same organization/user seed rows.

</details>
