/** PostgreSQL schema for the enterprise project governance entity. */
import type { PostgresDatabase } from './types.ts'

/** Value exported as `ENTERPRISE_PROJECT_SCHEMA_VERSION`. */
export const ENTERPRISE_PROJECT_SCHEMA_VERSION = 1

const statements = [
  'CREATE TABLE IF NOT EXISTS dsh_enterprise_project_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL, goal TEXT NOT NULL,
    workspace_path TEXT NOT NULL,
    team_definition_id TEXT,
    state TEXT NOT NULL CHECK (state IN ('active','archived')),
    visibility TEXT NOT NULL CHECK (visibility IN ('organization','private','restricted')),
    allowed_user_ids TEXT NOT NULL DEFAULT '[]',
    created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL, archived_at BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS project_members (
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    principal_type TEXT NOT NULL CHECK (principal_type IN ('user','employee')),
    principal_id TEXT NOT NULL,
    added_by TEXT NOT NULL, added_at BIGINT NOT NULL,
    PRIMARY KEY(project_id, principal_type, principal_id)
  )`,
  'CREATE INDEX IF NOT EXISTS projects_org_created_idx ON projects(org_id, created_at, project_id)',
] as const

/**
 * Migrates the project tables to the current schema version. The `organizations`
 * FK target comes from the enterprise identity schema in the same database, so
 * the composition must run `migrateEnterpriseIdentityPostgres` first.
 * @param database - Input value used by this API.
 */
export async function migrateEnterpriseProject(database: PostgresDatabase): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.query('SELECT pg_advisory_xact_lock($1)', [0x44535052])
    for (const statement of statements) await transaction.query(statement)
    const current = await transaction.query<{ value: string }>(
      "SELECT value FROM dsh_enterprise_project_meta WHERE key = 'schema-version'",
    )
    const version = current.rows[0]?.value
    if (version === undefined) {
      await transaction.query(
        "INSERT INTO dsh_enterprise_project_meta(key, value) VALUES ('schema-version', $1)",
        [String(ENTERPRISE_PROJECT_SCHEMA_VERSION)],
      )
      return
    }
    if (Number(version) !== ENTERPRISE_PROJECT_SCHEMA_VERSION) {
      throw new Error(
        `enterprise project schema version ${version} is not supported; expected ${String(ENTERPRISE_PROJECT_SCHEMA_VERSION)}`,
      )
    }
  })
}
