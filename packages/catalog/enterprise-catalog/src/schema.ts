/** PostgreSQL schema for employee drafts, releases, and versioned assets. */

import type { PostgresDatabase } from './types.ts'

/** Current PostgreSQL schema version accepted by the enterprise catalog. */
export const ENTERPRISE_CATALOG_SCHEMA_VERSION = 5

const statements = [
  'CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public',
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
    org_id TEXT NOT NULL, key TEXT NOT NULL, request_digest TEXT, result_json JSONB NOT NULL,
    PRIMARY KEY(org_id, key)
  )`,
  'ALTER TABLE dsh_enterprise_catalog_idempotency ADD COLUMN IF NOT EXISTS request_digest TEXT',
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_employee_drafts_query_idx
    ON dsh_enterprise_employee_drafts(org_id, updated_at DESC, preset_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_employee_visibility_page_idx
    ON dsh_enterprise_employee_drafts(org_id, visibility, owner_user_id, updated_at DESC, preset_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_asset_catalog_query_idx
    ON dsh_enterprise_asset_catalog(org_id, updated_at DESC, asset_id DESC)`,
  'DROP INDEX IF EXISTS dsh_enterprise_employee_preset_search_query_idx',
  'DROP INDEX IF EXISTS dsh_enterprise_asset_id_search_query_idx',
  'DROP INDEX IF EXISTS dsh_enterprise_asset_name_search_query_idx',
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_employee_preset_search_trgm_idx
    ON dsh_enterprise_employee_drafts USING gin (lower(preset_id) public.gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_employee_profile_search_trgm_idx
    ON dsh_enterprise_employee_drafts USING gin (lower(profile_json::text) public.gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_asset_id_search_trgm_idx
    ON dsh_enterprise_asset_catalog USING gin (lower(asset_id) public.gin_trgm_ops)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_asset_name_search_trgm_idx
    ON dsh_enterprise_asset_catalog USING gin (lower(name) public.gin_trgm_ops)`,
] as const

/**
 * Creates or advances the enterprise catalog schema under a transaction advisory lock.
 * @param database - PostgreSQL connection whose transaction owns migration statements.
 * @returns When the schema is ready for repository operations.
 */
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
    } else if ([1, 2, 3, 4].includes(Number(current.rows[0].value))) {
      await transaction.query(
        "UPDATE dsh_enterprise_catalog_meta SET value = $1 WHERE key = 'schema-version' AND value = $2",
        [String(ENTERPRISE_CATALOG_SCHEMA_VERSION), current.rows[0].value],
      )
    } else if (Number(current.rows[0].value) !== ENTERPRISE_CATALOG_SCHEMA_VERSION) {
      throw new Error('unsupported enterprise catalog schema version')
    }
  })
}
