/** SQLite schema and migration for enterprise identity, policy, sessions, and audit. */

import type { DatabaseSync } from 'node:sqlite'

/** Value exported as `ENTERPRISE_IDENTITY_SCHEMA_VERSION`. */
export const ENTERPRISE_IDENTITY_SCHEMA_VERSION = 6

/** Create or validate the enterprise identity schema.
 * @param database - Input value used by this API.
 */
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
      department_revision INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES departments(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS departments_org_parent_order
      ON departments(org_id, parent_id, sort_order, name, id);
    CREATE TABLE IF NOT EXISTS user_departments (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
      is_primary INTEGER NOT NULL CHECK (is_primary IN (0, 1)),
      PRIMARY KEY(user_id, department_id)
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS user_departments_one_primary
      ON user_departments(user_id) WHERE is_primary = 1;
    CREATE TABLE IF NOT EXISTS enterprise_workspace_grants (
      workspace_id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('personal', 'department')),
      owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      department_id TEXT REFERENCES departments(id) ON DELETE CASCADE,
      root_path TEXT NOT NULL UNIQUE,
      sandbox_mode TEXT NOT NULL CHECK (sandbox_mode IN ('read-only', 'workspace-write')),
      revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK ((kind = 'personal' AND owner_user_id IS NOT NULL AND department_id IS NULL)
        OR (kind = 'department' AND owner_user_id IS NULL AND department_id IS NOT NULL))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS enterprise_workspace_grants_org_kind
      ON enterprise_workspace_grants(org_id, kind, name, workspace_id);
    CREATE TABLE IF NOT EXISTS enterprise_memories (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('organization', 'department')),
      department_id TEXT REFERENCES departments(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('business-fact', 'process', 'terminology', 'decision')),
      status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'retired')),
      summary TEXT NOT NULL,
      source_digest TEXT NOT NULL,
      privacy_findings TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reviewed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      review_reason TEXT,
      revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK ((scope_type = 'organization' AND department_id IS NULL)
        OR (scope_type = 'department' AND department_id IS NOT NULL))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS enterprise_memories_scope_status
      ON enterprise_memories(org_id, scope_type, department_id, status, updated_at DESC, id);
    CREATE TABLE IF NOT EXISTS enterprise_session_workspaces (
      session_id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES enterprise_workspace_grants(workspace_id) ON DELETE RESTRICT,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT
    ) STRICT;
    CREATE TABLE IF NOT EXISTS employee_accounts (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      role_card TEXT NOT NULL,
      active_release_id TEXT,
      state TEXT NOT NULL CHECK (state IN ('active', 'suspended', 'archived')),
      home_workspace_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS surfaces (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('dm')),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES employee_accounts(id) ON DELETE CASCADE,
      session_id TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, employee_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS employee_inbox (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL REFERENCES employee_accounts(id) ON DELETE CASCADE,
      surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE,
      origin_actor TEXT NOT NULL,
      payload_text TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('queued', 'delivered', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      delivered_at INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS employee_inbox_pending
      ON employee_inbox(employee_id, state, created_at);
    CREATE TABLE IF NOT EXISTS sticky_bindings (
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      actor_key TEXT NOT NULL,
      employee_id TEXT NOT NULL REFERENCES employee_accounts(id) ON DELETE CASCADE,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(org_id, actor_key)
    ) STRICT;
  `)
  const version = database.prepare("SELECT value FROM enterprise_meta WHERE key = 'schema-version'")
    .get() as { value: string } | undefined
  if (version === undefined) {
    database.prepare("INSERT INTO enterprise_meta(key, value) VALUES ('schema-version', ?)")
      .run(String(ENTERPRISE_IDENTITY_SCHEMA_VERSION))
  } else if (Number(version.value) === 1) {
    database.exec('ALTER TABLE users ADD COLUMN department_revision INTEGER NOT NULL DEFAULT 0')
    database.prepare("UPDATE enterprise_meta SET value = ? WHERE key = 'schema-version'")
      .run(String(ENTERPRISE_IDENTITY_SCHEMA_VERSION))
  // Versions 2, 3, and 5 differ from current only by additive tables that the IF NOT EXISTS
  // DDL above already created; restamping the recorded version completes their migration.
  } else if (Number(version.value) === 2 || Number(version.value) === 3 || Number(version.value) === 5) {
    database.prepare("UPDATE enterprise_meta SET value = ? WHERE key = 'schema-version'")
      .run(String(ENTERPRISE_IDENTITY_SCHEMA_VERSION))
  } else if (Number(version.value) === 4) {
    database.exec('ALTER TABLE enterprise_session_workspaces ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT')
    database.exec(`UPDATE enterprise_session_workspaces
      SET owner_user_id = (SELECT owner_user_id FROM enterprise_workspace_grants workspace
        WHERE workspace.workspace_id = enterprise_session_workspaces.workspace_id)
      WHERE owner_user_id IS NULL`)
    database.prepare("UPDATE enterprise_meta SET value = ? WHERE key = 'schema-version'")
      .run(String(ENTERPRISE_IDENTITY_SCHEMA_VERSION))
  } else if (Number(version.value) !== ENTERPRISE_IDENTITY_SCHEMA_VERSION) {
    throw new Error(
      `enterprise identity schema version ${version.value} is not supported; expected ${String(ENTERPRISE_IDENTITY_SCHEMA_VERSION)}`,
    )
  }
}
