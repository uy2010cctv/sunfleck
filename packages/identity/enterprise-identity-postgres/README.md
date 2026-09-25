---
description: "PostgreSQL persistence and safe SQLite migration for DSH enterprise identity."
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-identity-postgres`

English | [中文](README.zh.md)

## Summary

PostgreSQL persistence and safe SQLite migration for DSH enterprise identity.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

PostgreSQL persistence for DSH enterprise organizations, users, roles, external identities, hashed sessions, department trees, Workspace grants, Session bindings, reviewed memory plus private agent and pair compartments written without review and project compartments tagged by project id, resource policies, managed assets, and attributable audit records. Its SQLite migration command preserves IDs and imports all control-plane rows in one transaction.

The `enterprise_workspace_employee_defaults` table stores one nullable employee identity and monotonically increasing revision per Workspace. Compare-and-swap writes preserve the revision after clearing a default and refuse a missing Workspace or stale revision; the authenticated controller owns the manager and employee-visibility checks.

## Migration

Run a read-only preflight first:

```sh
dsh-enterprise-identity-migrate --sqlite /path/identity.sqlite --database-url "$DSH_DATABASE_URL" --dry-run
```

Then run the write command only after independently backing up the PostgreSQL target:

```sh
dsh-enterprise-identity-migrate --sqlite /path/identity.sqlite --backup /safe/identity.before-postgres.sqlite \
  --database-url "$DSH_DATABASE_URL" --source-quiesced --target-backup-confirmed
```

`--backup` is optional; its default is `<sqlite>.pre-postgres-migration.bak`. Before write mode, stop every process that can write the source database, then acknowledge that state with `--source-quiesced`. The command checks SQLite integrity, copies its database and WAL sidecars under that quiescent-source contract before target writes, obtains an advisory migration lock, rejects a non-empty target, and rolls back if imported destination counts or checksums differ. Output contains only row counts and checksums; it never prints passwords, raw bearer tokens, backup contents, or connection strings.

## Model Experience

### Identity persistence

#### What the model sees

Nothing. This package persists Host-only `EnterpriseIdentityStore` data and migration state; it adds no prompt, message, tool schema, result, or model call.

#### Token effect

Zero tokens. PostgreSQL reads, writes, and migration checksums never enter model history.

#### KV Cache effect

None; this package does not assemble provider requests.

## Known Limitations and Deferred Work

- The adapter is asynchronous; existing SQLite-only consumers must be composed explicitly during the enterprise PostgreSQL deployment transition.
- A production PostgreSQL/pgvector rollout still needs deployment-owned backup, TLS, and connection-pool configuration.
- Driver-agnostic migration tests and optional real PostgreSQL integration tests cover the directory, Workspace, Session-binding, and reviewed-memory contracts.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
