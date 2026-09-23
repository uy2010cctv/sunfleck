/** SQLite schema and migration for enterprise identity, policy, sessions, and audit. */

import type { DatabaseSync } from 'node:sqlite'

/** Value exported as `ENTERPRISE_IDENTITY_SCHEMA_VERSION`. */
export const ENTERPRISE_IDENTITY_SCHEMA_VERSION = 9

/** Column and CHECK definition shared by the create-path and rebuild-path `enterprise_memories` DDL. */
const ENTERPRISE_MEMORIES_COLUMNS = `
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('organization', 'department', 'project', 'agent', 'pair')),
      department_id TEXT REFERENCES departments(id) ON DELETE CASCADE,
      -- agent_employee_id and pair_user_id carry no FOREIGN KEY: employee accounts live in this
      -- SQLite identity store only, so the PostgreSQL mirror cannot reference them; the service
      -- layer owns their referential checks. project_id stays FOREIGN-KEY-free for the same
      -- reason: project entities live in the enterprise-project store.
      agent_employee_id TEXT,
      pair_user_id TEXT,
      project_id TEXT,
      kind TEXT NOT NULL CHECK (kind IN ('business-fact', 'process', 'terminology', 'decision', 'preference', 'summary')),
      status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'retired')),
      summary TEXT NOT NULL,
      source_digest TEXT NOT NULL,
      privacy_findings TEXT NOT NULL,
      importance REAL NOT NULL DEFAULT 0,
      last_access_at INTEGER,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reviewed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      review_reason TEXT,
      revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      -- valid_from and invalidated_by carry consolidation lineage: the epoch-ms time the row became
      -- valid and the id of the memory that superseded it. invalidated_by references another memory
      -- id by convention only — no FOREIGN KEY — and the service layer maintains the supersede chain.
      valid_from INTEGER,
      invalidated_by TEXT,
      CHECK (
        (scope_type = 'organization' AND department_id IS NULL AND agent_employee_id IS NULL AND pair_user_id IS NULL)
        OR (scope_type = 'department' AND department_id IS NOT NULL AND agent_employee_id IS NULL AND pair_user_id IS NULL)
        OR (scope_type = 'project' AND department_id IS NULL AND agent_employee_id IS NULL AND pair_user_id IS NULL)
        OR (scope_type = 'agent' AND agent_employee_id IS NOT NULL AND department_id IS NULL AND pair_user_id IS NULL)
        OR (scope_type = 'pair' AND pair_user_id IS NOT NULL AND department_id IS NULL AND agent_employee_id IS NULL)
      )`

/** Memory columns committed at schema version 6; the v3/v4/v5/v6 rebuild arms copy only these
 * because the private compartments, ranking columns, and project tag did not exist yet. */
const ENTERPRISE_MEMORIES_COPY_V6 = `id, org_id, scope_type, department_id, kind, status,
      summary, source_digest, privacy_findings, created_by, reviewed_by, review_reason,
      revision, created_at, updated_at`

/** Memory columns committed at schema version 8; the v8 rebuild arm copies these so the private
 * compartments, ranking columns, and project tag survive the kind CHECK widening. */
const ENTERPRISE_MEMORIES_COPY_V8 = `id, org_id, scope_type, department_id, agent_employee_id,
      pair_user_id, project_id, kind, status, summary, source_digest, privacy_findings,
      importance, last_access_at, created_by, reviewed_by, review_reason, revision, created_at, updated_at`

/** Column and CHECK definition shared by the create-path and rebuild-path `surfaces` DDL. */
const SURFACES_COLUMNS = `
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('dm', 'group', 'channel')),
      -- Group and channel rows anchor a team or project instead of a user-employee pair; the
      -- pairing CHECK keeps the dm columns populated exactly for dm rows and NULL otherwise, so
      -- the dm UNIQUE(user_id, employee_id) pair key never constrains team rows.
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      employee_id TEXT REFERENCES employee_accounts(id) ON DELETE CASCADE,
      session_id TEXT,
      created_at INTEGER NOT NULL,
      team_definition_id TEXT,
      project_id TEXT,
      external_key TEXT,
      name TEXT,
      topic_policy TEXT CHECK (topic_policy IN ('thread', 'command', 'lane')),
      respond_policy TEXT CHECK (respond_policy IN ('mention_duty', 'ingest_only')),
      duty_employee_ids TEXT,
      UNIQUE(user_id, employee_id),
      CHECK ((kind = 'dm' AND user_id IS NOT NULL AND employee_id IS NOT NULL)
        OR (kind != 'dm' AND user_id IS NULL AND employee_id IS NULL))`

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
    CREATE TABLE IF NOT EXISTS enterprise_memories (${ENTERPRISE_MEMORIES_COLUMNS}
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
    CREATE TABLE IF NOT EXISTS surfaces (${SURFACES_COLUMNS}
    ) STRICT;
    CREATE TABLE IF NOT EXISTS surface_members (
      surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE,
      principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'employee')),
      principal_id TEXT NOT NULL,
      role_id TEXT,
      PRIMARY KEY(surface_id, principal_type, principal_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS surface_sessions (
      surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE,
      employee_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      PRIMARY KEY(surface_id, employee_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS channel_topics (
      topic_id TEXT PRIMARY KEY,
      surface_id TEXT NOT NULL REFERENCES surfaces(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('open', 'settled', 'archived')),
      session_id TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      settled_at INTEGER
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
  // Version 2 predates enterprise_memories, so the IF NOT EXISTS DDL above already created it at
  // the current shape; restamping the recorded version completes the migration.
  } else if (Number(version.value) === 2) {
    database.prepare("UPDATE enterprise_meta SET value = ? WHERE key = 'schema-version'")
      .run(String(ENTERPRISE_IDENTITY_SCHEMA_VERSION))
  // Versions 3, 5, and 6 carry the v3-era enterprise_memories CHECKs, which SQLite cannot widen in
  // place; the rebuild copies every row into the current table shape.
  } else if (Number(version.value) === 3 || Number(version.value) === 5 || Number(version.value) === 6) {
    rebuildEnterpriseMemories(database, ENTERPRISE_MEMORIES_COPY_V6)
    database.prepare("UPDATE enterprise_meta SET value = ? WHERE key = 'schema-version'")
      .run(String(ENTERPRISE_IDENTITY_SCHEMA_VERSION))
  } else if (Number(version.value) === 4) {
    database.exec('ALTER TABLE enterprise_session_workspaces ADD COLUMN owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT')
    database.exec(`UPDATE enterprise_session_workspaces
      SET owner_user_id = (SELECT owner_user_id FROM enterprise_workspace_grants workspace
        WHERE workspace.workspace_id = enterprise_session_workspaces.workspace_id)
      WHERE owner_user_id IS NULL`)
    rebuildEnterpriseMemories(database, ENTERPRISE_MEMORIES_COPY_V6)
    database.prepare("UPDATE enterprise_meta SET value = ? WHERE key = 'schema-version'")
      .run(String(ENTERPRISE_IDENTITY_SCHEMA_VERSION))
  // Version 7 shipped dm-only surfaces and the private memory compartments; every v8 change is
  // additive, so the surfaces rebuild copies the committed rows into the widened table and the
  // project compartment column is appended without touching stored values.
  } else if (Number(version.value) === 7) {
    rebuildSurfaces(database)
    database.exec('ALTER TABLE enterprise_memories ADD COLUMN project_id TEXT')
    // v9 widens the kind CHECK, which the v7-era table still carries and SQLite cannot alter in
    // place; the rebuild copies the freshly appended project tag together with every other
    // committed column.
    rebuildEnterpriseMemories(database, ENTERPRISE_MEMORIES_COPY_V8)
    database.prepare("UPDATE enterprise_meta SET value = ? WHERE key = 'schema-version'")
      .run(String(ENTERPRISE_IDENTITY_SCHEMA_VERSION))
  // Version 8 shipped the project memory compartment; v9 adds the summary kind, which SQLite
  // cannot widen in place, so the rebuild copies every committed column — private compartments,
  // ranking columns, and project tag included — and the consolidation lineage columns start NULL.
  } else if (Number(version.value) === 8) {
    rebuildEnterpriseMemories(database, ENTERPRISE_MEMORIES_COPY_V8)
    database.prepare("UPDATE enterprise_meta SET value = ? WHERE key = 'schema-version'")
      .run(String(ENTERPRISE_IDENTITY_SCHEMA_VERSION))
  } else if (Number(version.value) !== ENTERPRISE_IDENTITY_SCHEMA_VERSION) {
    throw new Error(
      `enterprise identity schema version ${version.value} is not supported; expected ${String(ENTERPRISE_IDENTITY_SCHEMA_VERSION)}`,
    )
  }
  // The partial external-key index targets the surfaces columns the v7 rebuild adds, so it is
  // created after the version gate where every path already has the current surfaces shape.
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS surfaces_external_key
    ON surfaces(org_id, kind, external_key) WHERE external_key IS NOT NULL`)
}

/** Rebuild enterprise_memories in place to the current CHECK set and columns. SQLite cannot widen a
 * CHECK, so every row is copied into a fresh table and the old one dropped; no table references
 * enterprise_memories, and columns added after the carried set take their defaults during the copy.
 * @param database - Input value used by this API.
 * @param carriedColumns - Memory columns the committed rows already have; each rebuild arm passes
 *   the set committed at its own version so later columns never read from a missing source column.
 */
function rebuildEnterpriseMemories(database: DatabaseSync, carriedColumns: string): void {
  database.exec(`
    CREATE TABLE enterprise_memories_rebuild (${ENTERPRISE_MEMORIES_COLUMNS}
    ) STRICT;
    INSERT INTO enterprise_memories_rebuild(${carriedColumns})
      SELECT ${carriedColumns}
      FROM enterprise_memories;
    DROP TABLE enterprise_memories;
    ALTER TABLE enterprise_memories_rebuild RENAME TO enterprise_memories;
    CREATE INDEX IF NOT EXISTS enterprise_memories_scope_status
      ON enterprise_memories(org_id, scope_type, department_id, status, updated_at DESC, id);
  `)
}

/** Rebuild surfaces in place to the current columns and CHECK set. SQLite cannot widen a CHECK, so
 * every row is copied into a fresh table and the old one dropped. employee_inbox references
 * surfaces, so foreign keys are suspended for the rebuild; committed rows keep their ids, which
 * keeps the inbox references valid once the rebuilt table takes the surfaces name back. */
function rebuildSurfaces(database: DatabaseSync): void {
  database.exec('PRAGMA foreign_keys = OFF')
  try {
    database.exec(`
      CREATE TABLE surfaces_rebuild (${SURFACES_COLUMNS}
      ) STRICT;
      INSERT INTO surfaces_rebuild(id, org_id, kind, user_id, employee_id, session_id, created_at)
        SELECT id, org_id, kind, user_id, employee_id, session_id, created_at FROM surfaces;
      DROP TABLE surfaces;
      ALTER TABLE surfaces_rebuild RENAME TO surfaces;
    `)
  } finally {
    database.exec('PRAGMA foreign_keys = ON')
  }
}
