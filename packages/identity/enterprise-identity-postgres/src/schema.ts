/** PostgreSQL schema for enterprise identity and governance control data. */

import type { PostgresDatabase } from './types.ts'

export const ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION = 1

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS enterprise_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    display_name TEXT NOT NULL,
    disabled BOOLEAN NOT NULL,
    password_verifier TEXT,
    UNIQUE(org_id, username)
  )`,
  `CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    PRIMARY KEY(user_id, role)
  )`,
  `CREATE TABLE IF NOT EXISTS external_identities (
    provider_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY(provider_id, subject)
  )`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    last_seen_at BIGINT NOT NULL,
    revoked_at BIGINT
  )`,
  'CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id)',
  `CREATE TABLE IF NOT EXISTS resource_policies (
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    creator_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    visibility TEXT NOT NULL,
    allowed_user_ids JSONB NOT NULL,
    PRIMARY KEY(resource_type, resource_id)
  )`,
  `CREATE TABLE IF NOT EXISTS managed_assets (
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    config_json JSONB NOT NULL,
    PRIMARY KEY(org_id, type, id)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    actor_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    reason TEXT NOT NULL,
    correlation_id TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    details_json JSONB NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS audit_events_org_time ON audit_events(org_id, created_at DESC)',
] as const

/** Creates the schema in the current transaction; callers own commit or rollback. */
export async function migrateEnterpriseIdentityPostgres(database: PostgresDatabase): Promise<void> {
  for (const statement of STATEMENTS) await database.query(statement)
  const current = await database.query<{ value: string }>(
    "SELECT value FROM enterprise_meta WHERE key = 'schema-version'",
  )
  const version = current.rows[0]?.value
  if (version === undefined) {
    await database.query(
      "INSERT INTO enterprise_meta(key, value) VALUES ('schema-version', $1)",
      [String(ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION)],
    )
    return
  }
  if (Number(version) !== ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION) {
    throw new Error(
      `enterprise identity PostgreSQL schema version ${version} is not supported; expected ${String(ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION)}`,
    )
  }
}
