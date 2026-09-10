---
description: "PostgreSQL composition and lifecycle provider for DSH Enterprise."
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-postgres`

English | [中文](README.zh.md)

## Summary

PostgreSQL composition and lifecycle provider for DSH Enterprise.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Production PostgreSQL composition for DSH Enterprise. It owns one bounded `pg.Pool`, verifies connectivity, initializes the identity, Session, catalog, operations, and pgvector schemas, and exposes the adapters over a shared transaction-aware database wrapper.

The provider does not store credentials, connection strings, or cursor keys in PostgreSQL or DSH Session events. The deployment supplies `connectionString` and a stable `cursorSigningKey` of at least 32 bytes and eight distinct byte values from its secret manager and owns pool sizing, TLS, backup, and database role permissions. The enterprise CLI overlay derives the cursor key from `DSH_ENTERPRISE_MASTER_KEY` with HMAC-SHA256 and the domain label `dsh-enterprise-catalog/cursor-signing/v1`; it never passes the credential-encryption key bytes directly to the catalog.

## Model Experience

### Enterprise persistence composition

#### What the model sees

Nothing. `enterprisePostgres` composes Host-owned repositories and registers no prompt, tool, or model call.

#### Token effect

Zero tokens; connection and schema work happens before Agent request assembly.

#### KV Cache effect

None; provider request caching is outside the database composition.

## Known Limitations and Deferred Work

- The browser Host API still needs an application-specific composition to expose catalog and operations methods; this package only provides the durable services.
- SQLite-to-PostgreSQL data migration for legacy Session logs remains a separate controlled operation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
