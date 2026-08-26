# `@deepseek-ai/dsh-enterprise-identity-postgres`

English | [中文](README.zh.md)

PostgreSQL persistence for DSH enterprise organizations, users, roles, external identities,
hashed sessions, resource policies, managed assets, and attributable audit records. Its
SQLite migration command preserves IDs and imports all control-plane rows in one transaction.

## Model Experience

### Identity persistence

#### What the model sees

Nothing. This package is Host-only persistence and migration infrastructure; it adds no prompt,
message, tool schema, result, or model call.

#### Token effect

Zero tokens. PostgreSQL reads, writes, and migration checksums never enter model history.

#### KV Cache effect

None; this package does not assemble provider requests.

## Migration

Run a read-only preflight first:

```sh
dsh-enterprise-identity-migrate --sqlite /path/identity.sqlite --database-url "$DSH_DATABASE_URL" --dry-run
```

Then run the write command only after independently backing up the PostgreSQL target:

```sh
dsh-enterprise-identity-migrate --sqlite /path/identity.sqlite --backup /safe/identity.before-postgres.sqlite \
  --database-url "$DSH_DATABASE_URL" --target-backup-confirmed
```

`--backup` is optional; its default is `<sqlite>.pre-postgres-migration.bak`. The command checks
SQLite integrity, copies its database and WAL sidecars before target writes, obtains an advisory
migration lock, rejects a non-empty target, and rolls back if imported destination counts or
checksums differ. Output contains only row counts and checksums; it never prints passwords, raw
bearer tokens, backup contents, or connection strings.

## Known Limitations and Deferred Work

- The adapter is asynchronous; existing SQLite-only consumers must be composed explicitly during
  the enterprise PostgreSQL deployment transition.
- A production PostgreSQL/pgvector rollout still needs deployment-owned backup, TLS, and
  connection-pool configuration.
- Driver-agnostic tests cover migration safety. A real PostgreSQL integration test needs a
  deployment-owned PostgreSQL endpoint and remains deferred.
