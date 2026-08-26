/** PostgreSQL schema for work records, approvals, schedules, teams, and outbox. */
import type { PostgresDatabase } from './types.ts'
export const ENTERPRISE_OPERATIONS_SCHEMA_VERSION = 2
const statements = [
  'CREATE TABLE IF NOT EXISTS dsh_enterprise_operations_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_work_records (
    org_id TEXT NOT NULL, session_id TEXT NOT NULL, employee_release_id TEXT NOT NULL,
    team_id TEXT, source TEXT NOT NULL, business_state TEXT NOT NULL,
    source_references_json JSONB NOT NULL, revision BIGINT NOT NULL, created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL, PRIMARY KEY(org_id, session_id, employee_release_id),
    UNIQUE(session_id, employee_release_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_approval_requests (
    approval_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, kind TEXT NOT NULL,
    subject_type TEXT NOT NULL, subject_id TEXT NOT NULL, requested_by TEXT NOT NULL,
    state TEXT NOT NULL, reviewer_user_id TEXT, reason TEXT, revision BIGINT NOT NULL,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_schedules (
    schedule_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, target_json JSONB NOT NULL,
    timezone TEXT NOT NULL, rule TEXT NOT NULL, input_json JSONB NOT NULL,
    state TEXT NOT NULL, next_run_at BIGINT, last_run_at BIGINT, revision BIGINT NOT NULL,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_fixed_teams (
    team_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, leader_release_id TEXT NOT NULL,
    workflow_template_json JSONB NOT NULL, approval_policy_json JSONB NOT NULL,
    revision BIGINT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_fixed_team_members (
    team_id TEXT NOT NULL REFERENCES dsh_enterprise_fixed_teams(team_id) ON DELETE CASCADE,
    employee_release_id TEXT NOT NULL, role TEXT NOT NULL, PRIMARY KEY(team_id, employee_release_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_operation_outbox (
    command_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, schedule_id TEXT NOT NULL,
    occurrence_key TEXT NOT NULL, work_session_id TEXT NOT NULL, employee_release_id TEXT NOT NULL, team_id TEXT,
    payload_json JSONB NOT NULL, state TEXT NOT NULL, created_at BIGINT NOT NULL,
    UNIQUE(org_id, schedule_id, occurrence_key)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_operations_idempotency (
    org_id TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL,
    result_json JSONB NOT NULL, PRIMARY KEY(org_id, operation, key)
  )`,
] as const
export async function migrateEnterpriseOperations(database: PostgresDatabase): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.query('SELECT pg_advisory_xact_lock($1)', [0x4453484f])
    for (const statement of statements) await transaction.query(statement)
    const current = await transaction.query<{ value: string }>(
      "SELECT value FROM dsh_enterprise_operations_meta WHERE key = 'schema-version'",
    )
    if (current.rows[0] === undefined)
      await transaction.query(
        "INSERT INTO dsh_enterprise_operations_meta(key, value) VALUES ('schema-version', $1) ON CONFLICT (key) DO NOTHING",
        [String(ENTERPRISE_OPERATIONS_SCHEMA_VERSION)],
      )
    else if (Number(current.rows[0].value) !== ENTERPRISE_OPERATIONS_SCHEMA_VERSION)
      throw new Error('unsupported enterprise operations schema version')
  })
}
