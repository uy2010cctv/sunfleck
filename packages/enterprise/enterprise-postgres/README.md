# `@deepseek-ai/dsh-enterprise-postgres`

English | [中文](README.zh.md)

Production PostgreSQL composition for DSH Enterprise. It owns one bounded `pg.Pool`, verifies connectivity, initializes the identity, Session, catalog, operations, and pgvector schemas, and exposes the adapters over a shared transaction-aware database wrapper.

The provider does not store credentials, connection strings, or cursor keys in PostgreSQL or DSH Session events. The deployment supplies `connectionString` and a stable `cursorSigningKey` from its secret manager and owns pool sizing, TLS, backup, and database role permissions. The enterprise CLI overlay derives the cursor key from `DSH_ENTERPRISE_MASTER_KEY` with HMAC-SHA256 and the domain label `dsh-enterprise-catalog/cursor-signing/v1`; it never passes the credential-encryption key bytes directly to the catalog.

## Known Limitations and Deferred Work

- The browser Host API still needs an application-specific composition to expose catalog and operations methods; this package only provides the durable services.
- SQLite-to-PostgreSQL data migration for legacy Session logs remains a separate controlled operation.
