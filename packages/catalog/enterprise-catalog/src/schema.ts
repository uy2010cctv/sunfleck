/** PostgreSQL schema for employee drafts, releases, and versioned assets. */

import type { PostgresDatabase } from './types.ts'

export const ENTERPRISE_CATALOG_SCHEMA_VERSION = 1

const statements = [
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_catalog_meta (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_employee_drafts (
    preset_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
    visibility TEXT NOT NULL, profile_json JSONB NOT NULL, bindings_json JSONB NOT NULL,
    status TEXT NOT NULL, revision BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_employee_releases (
    release_id TEXT PRIMARY KEY, preset_id TEXT NOT NULL, org_id TEXT NOT NULL,
    version BIGINT NOT NULL, digest TEXT NOT NULL, snapshot_json JSONB NOT NULL,
    published_by TEXT NOT NULL, published_at BIGINT NOT NULL, source_release_id TEXT,
    UNIQUE(preset_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_asset_catalog (
    asset_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, kind TEXT NOT NULL,
    name TEXT NOT NULL, revision BIGINT NOT NULL, archived BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_asset_versions (
    asset_id TEXT NOT NULL REFERENCES dsh_enterprise_asset_catalog(asset_id),
    version BIGINT NOT NULL, content_json JSONB NOT NULL, created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL, PRIMARY KEY(asset_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_employee_release_assets (
    release_id TEXT NOT NULL REFERENCES dsh_enterprise_employee_releases(release_id),
    kind TEXT NOT NULL, asset_id TEXT NOT NULL, asset_version BIGINT NOT NULL,
    PRIMARY KEY(release_id, kind, asset_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_catalog_idempotency (
    org_id TEXT NOT NULL, key TEXT NOT NULL, result_json JSONB NOT NULL,
    PRIMARY KEY(org_id, key)
  )`,
] as const

export async function migrateEnterpriseCatalog(database: PostgresDatabase): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.query('SELECT pg_advisory_xact_lock($1)', [0x44534843])
    for (const statement of statements) await transaction.query(statement)
    const current = await transaction.query<{ value: string }>(
      "SELECT value FROM dsh_enterprise_catalog_meta WHERE key = 'schema-version'",
    )
    if (current.rows[0] === undefined) {
      await transaction.query(
        "INSERT INTO dsh_enterprise_catalog_meta(key, value) VALUES ('schema-version', $1) ON CONFLICT (key) DO NOTHING",
        [String(ENTERPRISE_CATALOG_SCHEMA_VERSION)],
      )
    } else if (Number(current.rows[0].value) !== ENTERPRISE_CATALOG_SCHEMA_VERSION) {
      throw new Error('unsupported enterprise catalog schema version')
    }
  })
}
