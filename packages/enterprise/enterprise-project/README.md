---
description: "PostgreSQL-backed project governance entity: org-scoped member-gated project spaces with visibility, membership, and an archived-terminal lifecycle, for compositions that need durable project state in enterprise deployments."
kind: "package-reference"
---

# @deepseek-ai/dsh-enterprise-project

English | [中文](README.zh.md)

## Summary

`dsh-enterprise-project` persists the enterprise project governance entity in PostgreSQL: one organization-scoped, member-gated project space with a name, goal, workspace path, optional team-definition binding, listing visibility, explicit membership, and an archived-terminal lifecycle. It exposes the `ctx.enterpriseProjects` Cordis service over a `PostgresDatabase` handle the composition supplies, and owns the versioned `projects` and `project_members` schema with its own migration unit. Projects are member-gated spaces per the employee-surfaces spec: listing visibility never substitutes for a member row.

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

Mount this plugin when a composition needs durable project state beside the enterprise PostgreSQL deployment. The composing plugin passes its shared enterprise `PostgresDatabase` handle programmatically; the repository migrates the project tables lazily on first use, and the composition owns the handle's lifecycle.

### When to choose it

Choose this package when project governance belongs in the same PostgreSQL deployment as organizations, operations, and audit records. The `organizations` FK target comes from the enterprise identity schema, so the composition must run `migrateEnterpriseIdentityPostgres` before the first project call.

### Minimal configuration

| Field | Default | Meaning |
|---|---|---|
| `database` | required | PostgreSQL handle backing the `projects` and `project_members` tables |

`create` rejects an empty name, goal, or creator and a relative `workspacePath` with `TypeError`, resolves the visibility default to 'organization' in `resolveCreateProjectSpec`, and inserts the creator as the first 'user' member in the same transaction. `archive` moves active to archived only; archived is terminal and every mutation except reads rejects. `requireMember` returns undefined without leaking existence for unknown ids, other organizations, and non-members.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

`EnterpriseProjectService` is a thin facade over the `EnterpriseProjectStore` structural contract: it validates input, mints branded UUID ids, resolves the visibility default explicitly, filters listings, and gates `requireMember`. `EnterpriseProjectRepository` owns every SQL statement, the state guards under row locks, and row parsing with closed-value validation for `state`, `visibility`, and `principal_type`. Listing visibility is evaluated on parsed rows, mirroring the operations team-definition read guard rather than pushing the predicate into SQL; the filtered set is one organization's projects.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config`, `apply`, service provision, and the public re-exports |
| [`src/types.ts`](src/types.ts) | Domain types, the `EnterpriseProjects` interface, and the `ctx.enterpriseProjects` key declaration |
| [`src/service.ts`](src/service.ts) | `EnterpriseProjectService`: validation, id minting, visibility resolve and filtering, and the member gate |
| [`src/repository.ts`](src/repository.ts) | `EnterpriseProjectRepository`: all SQL, state guards, and closed-value row parsing |
| [`src/schema.ts`](src/schema.ts) | Versioned `projects` and `project_members` schema and the `migrateEnterpriseProject` migration unit |
| [`src/ids.ts`](src/ids.ts) | The branded `ProjectId` constructor |
| — | No runtime invariant companion is published. The repository is the single authority: every project and membership observation flows through the same SQL statements, so no independent observation can diverge ([package invariant rules](../../AGENTS.md)). |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from this entity to the production composition and the adjacent enterprise seams.

- [Enterprise PostgreSQL composition](../enterprise-postgres/README.md) — the production adapter composition that owns the shared pool and the identity schema this package references.
- [Employee accounts](../employee-account/README.md) — the SQLite-backed employee entity whose account ids appear as 'employee' member principals.
- [Enterprise operations](../../operations/enterprise-operations/README.md) — the team definitions whose ids a project's `teamDefinitionId` names.

-----

<a id="model-experience"></a>
## Model Experience

### Project governance persistence

#### What the model sees

Nothing directly. The service registers no prompt section, tool schema, or provider request; the composed consumer that reads `ctx.enterpriseProjects` owns any model-visible use of project, membership, or visibility data.

#### Token effect

Zero direct tokens. Model-visible uses are owned by the composing consumer.

#### KV Cache effect

None at this repository layer. The service changes no model request, so it cannot invalidate a cached prefix.

## Known Limitations and Deferred Work

These limits define when this service is a poor fit or needs composing support.

- **Workspace binding is a stored path only** — the service keeps `workspacePath` as an opaque absolute string and performs no registry lookup; binding a project to a live workspace through `workspaceRegistry.ensure` and `attachSession` belongs to the consuming flow.
- **Visibility is a self-contained simplification** — listing visibility is stored on the project row and evaluated in the service, not shared with the governance `resource_policies` table; 'restricted' means `allowedUserIds` plus the creator, and the 'administrator' role bypasses filters, with no department scoping.
- **Team-definition references are not foreign-keyed** — `teamDefinitionId` is a plain column because team definitions live in the operations schema keyed by `(org_id, team_id)`; referential checks belong to the composing flow.
- **Archival attribution is caller-owned** — `archive` accepts an actor id only to validate it; the store records `archived_at` but no archiving principal, so audit trails stay with the caller.
- **Listing filters run after the read** — `list` fetches one organization's projects and filters in the service; organizations with very large project sets need a SQL-pushed visibility predicate before paging exists.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

- `apply` provides the service with `ctx.provide('enterpriseProjects', service)`, which registers it as a lifecycle effect owned by the plugin's fiber; `Config.database` is a non-serializable handle passed programmatically, mirroring `dsh-employee-account`'s `Config.database`.
- The repository mirrors the operations team-control pattern: `initialize()` memoizes one `migrateEnterpriseProject` run on first use, so eager compositions may also call the migration during startup and pay nothing extra.
- Membership is deliberately not implied by visibility (spec §6.4): `requireMember` matches 'user' rows by `principal.userId` and 'employee' rows by `principal.employeeId`, and employees are never users, so one principal never matches both row kinds.
- Tests use a statement-keyed in-memory `PostgresDatabase` double in `tests/memory-postgres.ts`; the real-PostgreSQL suite self-skips without `DSH_TEST_POSTGRES_URL`, mirroring `dsh-enterprise-operations`.

</details>
