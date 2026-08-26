/** SQLite schema and migration for enterprise identity, policy, sessions, and audit. */

import type { DatabaseSync } from 'node:sqlite'

export const ENTERPRISE_IDENTITY_SCHEMA_VERSION = 1

/** Create or validate the enterprise identity schema. */
export function migrateEnterpriseIdentity(database: DatabaseSync): void {
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA journal_mode = WAL')
  database.exec(`
    CREATE TABLE IF NOT EXISTS enterprise_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      disabled INTEGER NOT NULL CHECK (disabled IN (0, 1)),
      password_verifier TEXT,
      UNIQUE(org_id, username)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS user_roles (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      PRIMARY KEY(user_id, role)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS external_identities (
      provider_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY(provider_id, subject)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      revoked_at INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
    CREATE TABLE IF NOT EXISTS resource_policies (
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      creator_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      visibility TEXT NOT NULL,
      allowed_user_ids TEXT NOT NULL,
      PRIMARY KEY(resource_type, resource_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS managed_assets (
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL,
      PRIMARY KEY(org_id, type, id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      actor_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      reason TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      details_json TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS audit_events_org_time ON audit_events(org_id, created_at DESC);
  `)
  const version = database.prepare("SELECT value FROM enterprise_meta WHERE key = 'schema-version'")
    .get() as { value: string } | undefined
  if (version === undefined) {
    database.prepare("INSERT INTO enterprise_meta(key, value) VALUES ('schema-version', ?)")
      .run(String(ENTERPRISE_IDENTITY_SCHEMA_VERSION))
  } else if (Number(version.value) !== ENTERPRISE_IDENTITY_SCHEMA_VERSION) {
    throw new Error(
      `enterprise identity schema version ${version.value} is not supported; expected ${String(ENTERPRISE_IDENTITY_SCHEMA_VERSION)}`,
    )
  }
}
