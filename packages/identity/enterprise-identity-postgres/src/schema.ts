/** PostgreSQL schema for enterprise identity and governance control data. */

import type { PostgresDatabase } from './types.ts'

/** Value exported as `ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION`. */
export const ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION = 8

/** Scope-to-owner pairing CHECK shared by the create-path and widen-path `enterprise_memories` DDL. */
const ENTERPRISE_MEMORIES_PAIRING_CHECK = `(
      (scope_type = 'organization' AND department_id IS NULL AND agent_employee_id IS NULL AND pair_user_id IS NULL)
      OR (scope_type = 'department' AND department_id IS NOT NULL AND agent_employee_id IS NULL AND pair_user_id IS NULL)
      OR (scope_type = 'project' AND department_id IS NULL AND agent_employee_id IS NULL AND pair_user_id IS NULL)
      OR (scope_type = 'agent' AND agent_employee_id IS NOT NULL AND department_id IS NULL AND pair_user_id IS NULL)
      OR (scope_type = 'pair' AND pair_user_id IS NOT NULL AND department_id IS NULL AND agent_employee_id IS NULL)
    )`

/** Column and CHECK definition shared by the create-path and widen-path `enterprise_memories` DDL. */
const ENTERPRISE_MEMORIES_COLUMNS = `
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('organization', 'department', 'project', 'agent', 'pair')),
    department_id TEXT REFERENCES departments(id) ON DELETE CASCADE,
    -- agent_employee_id and pair_user_id carry no FOREIGN KEY: employee accounts live only in the
    -- SQLite identity store, so the PostgreSQL mirror cannot reference them; the service layer owns
    -- their referential checks. project_id stays FOREIGN-KEY-free for the same reason: project
    -- entities live in the enterprise-project store.
    agent_employee_id TEXT,
    pair_user_id TEXT,
    project_id TEXT,
    kind TEXT NOT NULL CHECK (kind IN ('business-fact', 'process', 'terminology', 'decision', 'preference', 'summary')),
    status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'retired')),
    summary TEXT NOT NULL,
    source_digest TEXT NOT NULL,
    privacy_findings JSONB NOT NULL,
    importance DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_access_at BIGINT,
    created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    reviewed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
    review_reason TEXT,
    revision BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    -- valid_from and invalidated_by carry consolidation lineage: the epoch-ms time the row became
    -- valid and the id of the memory that superseded it. invalidated_by references another memory
    -- id by convention only — no FOREIGN KEY — and the service layer maintains the supersede chain.
    valid_from BIGINT,
    invalidated_by TEXT,
    CHECK (${ENTERPRISE_MEMORIES_PAIRING_CHECK})`

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
    department_revision BIGINT NOT NULL DEFAULT 0,
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
  `CREATE INDEX IF NOT EXISTS enterprise_resource_policy_allowed_users_idx
    ON resource_policies USING gin (allowed_user_ids)`,
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
  `CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    parent_id TEXT REFERENCES departments(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    sort_order BIGINT NOT NULL,
    revision BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS departments_org_parent_order
    ON departments(org_id, parent_id, sort_order, name, id)`,
  `CREATE TABLE IF NOT EXISTS user_departments (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL,
    PRIMARY KEY(user_id, department_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS user_departments_one_primary
    ON user_departments(user_id) WHERE is_primary`,
  `CREATE TABLE IF NOT EXISTS enterprise_workspace_grants (
    workspace_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('personal', 'department')),
    owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    department_id TEXT REFERENCES departments(id) ON DELETE CASCADE,
    root_path TEXT NOT NULL UNIQUE,
    sandbox_mode TEXT NOT NULL CHECK (sandbox_mode IN ('read-only', 'workspace-write')),
    revision BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    CHECK ((kind = 'personal' AND owner_user_id IS NOT NULL AND department_id IS NULL)
      OR (kind = 'department' AND owner_user_id IS NULL AND department_id IS NOT NULL))
  )`,
  `CREATE INDEX IF NOT EXISTS enterprise_workspace_grants_org_kind
    ON enterprise_workspace_grants(org_id, kind, name, workspace_id)`,
  `CREATE TABLE IF NOT EXISTS enterprise_memories (${ENTERPRISE_MEMORIES_COLUMNS}
  )`,
  `CREATE INDEX IF NOT EXISTS enterprise_memories_scope_status
    ON enterprise_memories(org_id, scope_type, department_id, status, updated_at DESC, id)`,
  `CREATE TABLE IF NOT EXISTS enterprise_session_workspaces (
    session_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES enterprise_workspace_grants(workspace_id) ON DELETE RESTRICT,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT
  )`,
] as const

/** Widen enterprise_memories in place to the current CHECK set and columns. PostgreSQL cannot alter
 * a CHECK, so every existing CHECK on the table is dropped and the current set is re-added under
 * the same constraint names a fresh CREATE TABLE generates for these definitions. */
async function widenEnterpriseMemories(database: PostgresDatabase): Promise<void> {
  await database.query('ALTER TABLE enterprise_memories ADD COLUMN IF NOT EXISTS agent_employee_id TEXT')
  await database.query('ALTER TABLE enterprise_memories ADD COLUMN IF NOT EXISTS pair_user_id TEXT')
  await database.query('ALTER TABLE enterprise_memories ADD COLUMN IF NOT EXISTS project_id TEXT')
  await database.query('ALTER TABLE enterprise_memories ADD COLUMN IF NOT EXISTS importance DOUBLE PRECISION NOT NULL DEFAULT 0')
  await database.query('ALTER TABLE enterprise_memories ADD COLUMN IF NOT EXISTS last_access_at BIGINT')
  await database.query('ALTER TABLE enterprise_memories ADD COLUMN IF NOT EXISTS valid_from BIGINT')
  await database.query('ALTER TABLE enterprise_memories ADD COLUMN IF NOT EXISTS invalidated_by TEXT')
  await database.query(`DO $$
    DECLARE constraint_name text;
    BEGIN
      FOR constraint_name IN
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'enterprise_memories'::regclass AND contype = 'c'
      LOOP
        EXECUTE format('ALTER TABLE enterprise_memories DROP CONSTRAINT %I', constraint_name);
      END LOOP;
    END $$`)
  await database.query(`ALTER TABLE enterprise_memories
    ADD CONSTRAINT enterprise_memories_scope_type_check
    CHECK (scope_type IN ('organization', 'department', 'project', 'agent', 'pair'))`)
  await database.query(`ALTER TABLE enterprise_memories
    ADD CONSTRAINT enterprise_memories_kind_check
    CHECK (kind IN ('business-fact', 'process', 'terminology', 'decision', 'preference', 'summary'))`)
  await database.query(`ALTER TABLE enterprise_memories
    ADD CONSTRAINT enterprise_memories_status_check
    CHECK (status IN ('proposed', 'approved', 'rejected', 'retired'))`)
  await database.query(`ALTER TABLE enterprise_memories
    ADD CONSTRAINT enterprise_memories_check CHECK (${ENTERPRISE_MEMORIES_PAIRING_CHECK})`)
}

/** Creates the schema in the current transaction; callers own commit or rollback.
 * @param database - Input value used by this API.
 */
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
  if (Number(version) === 1) {
    await database.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS department_revision BIGINT NOT NULL DEFAULT 0')
    await database.query("UPDATE enterprise_meta SET value = $1 WHERE key = 'schema-version'", [String(ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION)])
    return
  }
  if (Number(version) === 2) {
    await database.query("UPDATE enterprise_meta SET value = $1 WHERE key = 'schema-version'", [String(ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION)])
    return
  }
  // Versions 3 and 5 carry the v3-era enterprise_memories CHECKs, which PostgreSQL cannot alter in
  // place; the widen drops and re-adds them together with the columns added after v3.
  if (Number(version) === 3 || Number(version) === 5) {
    await widenEnterpriseMemories(database)
    await database.query("UPDATE enterprise_meta SET value = $1 WHERE key = 'schema-version'", [String(ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION)])
    return
  }
  if (Number(version) === 4) {
    await database.query('ALTER TABLE enterprise_session_workspaces ADD COLUMN IF NOT EXISTS owner_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT')
    await database.query(`UPDATE enterprise_session_workspaces binding
      SET owner_user_id = workspace.owner_user_id
      FROM enterprise_workspace_grants workspace
      WHERE workspace.workspace_id = binding.workspace_id AND binding.owner_user_id IS NULL`)
    await widenEnterpriseMemories(database)
    await database.query("UPDATE enterprise_meta SET value = $1 WHERE key = 'schema-version'", [String(ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION)])
    return
  }
  // Version 6 shipped the P1 private memory compartments and the purely additive project column;
  // v8 widens the kind CHECK, which PostgreSQL cannot alter in place, so the widen completes the
  // upgrade without touching committed rows.
  if (Number(version) === 6) {
    await widenEnterpriseMemories(database)
    await database.query("UPDATE enterprise_meta SET value = $1 WHERE key = 'schema-version'", [String(ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION)])
    return
  }
  // Version 7 shipped the project compartment column; v8 adds the consolidation lineage columns
  // and the summary kind, and PostgreSQL cannot alter a CHECK in place, so the widen appends the
  // columns and drops/re-adds the current CHECK set without touching committed rows.
  if (Number(version) === 7) {
    await widenEnterpriseMemories(database)
    await database.query("UPDATE enterprise_meta SET value = $1 WHERE key = 'schema-version'", [String(ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION)])
    return
  }
  if (Number(version) !== ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION) {
    throw new Error(
      `enterprise identity PostgreSQL schema version ${version} is not supported; expected ${String(ENTERPRISE_IDENTITY_POSTGRES_SCHEMA_VERSION)}`,
    )
  }
}
