/** PostgreSQL schema for work records, approvals, schedules, teams, and outbox. */
import type { PostgresDatabase } from './types.ts'
export const ENTERPRISE_OPERATIONS_SCHEMA_VERSION = 6
const statements = [
  'CREATE TABLE IF NOT EXISTS dsh_enterprise_operations_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_work_records (
    org_id TEXT NOT NULL, session_id TEXT NOT NULL, employee_release_id TEXT NOT NULL,
    team_id TEXT, source TEXT NOT NULL CHECK (source IN ('console', 'schedule', 'wecom')),
    business_state TEXT NOT NULL CHECK (business_state IN ('active', 'waiting-approval', 'completed', 'failed')),
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
    state TEXT NOT NULL CHECK (state IN ('active', 'paused', 'archived')),
    next_run_at BIGINT, last_run_at BIGINT, revision BIGINT NOT NULL,
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
    payload_json JSONB NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'completed', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_expires_at BIGINT,
    last_error TEXT, completed_at BIGINT, created_at BIGINT NOT NULL,
    UNIQUE(org_id, schedule_id, occurrence_key)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_operations_idempotency (
    org_id TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL,
    result_json JSONB NOT NULL, PRIMARY KEY(org_id, operation, key)
  )`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_work_records_page_idx
    ON dsh_enterprise_work_records(org_id, updated_at DESC, session_id DESC, employee_release_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_work_records_filter_idx
    ON dsh_enterprise_work_records(org_id, business_state, source, team_id, updated_at DESC, session_id DESC, employee_release_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_work_records_source_idx
    ON dsh_enterprise_work_records(org_id, source, updated_at DESC, session_id DESC, employee_release_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_work_records_team_idx
    ON dsh_enterprise_work_records(org_id, team_id, updated_at DESC, session_id DESC, employee_release_id DESC) WHERE team_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_approvals_page_idx
    ON dsh_enterprise_approval_requests(org_id, updated_at DESC, approval_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_approvals_filter_idx
    ON dsh_enterprise_approval_requests(org_id, kind, state, requested_by, updated_at DESC, approval_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_approvals_state_idx
    ON dsh_enterprise_approval_requests(org_id, state, updated_at DESC, approval_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_approvals_requester_idx
    ON dsh_enterprise_approval_requests(org_id, requested_by, updated_at DESC, approval_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_schedules_page_idx
    ON dsh_enterprise_schedules(org_id, updated_at DESC, schedule_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_schedules_state_idx
    ON dsh_enterprise_schedules(org_id, state, updated_at DESC, schedule_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_fixed_teams_page_idx
    ON dsh_enterprise_fixed_teams(org_id, updated_at DESC, team_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_work_records_created_page_idx
    ON dsh_enterprise_work_records(org_id, created_at DESC, session_id DESC, employee_release_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_work_records_state_created_idx
    ON dsh_enterprise_work_records(org_id, business_state, created_at DESC, session_id DESC, employee_release_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_work_records_state_source_created_idx
    ON dsh_enterprise_work_records(org_id, business_state, source, created_at DESC, session_id DESC, employee_release_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_work_records_source_created_idx
    ON dsh_enterprise_work_records(org_id, source, created_at DESC, session_id DESC, employee_release_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_work_records_team_created_idx
    ON dsh_enterprise_work_records(org_id, team_id, created_at DESC, session_id DESC, employee_release_id DESC) WHERE team_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_approvals_created_page_idx
    ON dsh_enterprise_approval_requests(org_id, created_at DESC, approval_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_approvals_kind_created_idx
    ON dsh_enterprise_approval_requests(org_id, kind, created_at DESC, approval_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_approvals_kind_state_created_idx
    ON dsh_enterprise_approval_requests(org_id, kind, state, created_at DESC, approval_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_approvals_state_created_idx
    ON dsh_enterprise_approval_requests(org_id, state, created_at DESC, approval_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_approvals_requester_created_idx
    ON dsh_enterprise_approval_requests(org_id, requested_by, created_at DESC, approval_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_schedules_created_page_idx
    ON dsh_enterprise_schedules(org_id, created_at DESC, schedule_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_schedules_state_created_idx
    ON dsh_enterprise_schedules(org_id, state, created_at DESC, schedule_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_fixed_teams_created_page_idx
    ON dsh_enterprise_fixed_teams(org_id, created_at DESC, team_id DESC)`,
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
    else {
      const version = Number(current.rows[0].value)
      if (version === 1) {
        await transaction.query('ALTER TABLE dsh_enterprise_operation_outbox ADD COLUMN IF NOT EXISTS team_id TEXT')
      }
      if (version === 1 || version === 2) {
        await transaction.query(
          "ALTER TABLE dsh_enterprise_work_records ADD CONSTRAINT dsh_work_source_check CHECK (source IN ('console', 'schedule', 'wecom'))",
        )
        await transaction.query(
          "ALTER TABLE dsh_enterprise_work_records ADD CONSTRAINT dsh_work_state_check CHECK (business_state IN ('active', 'waiting-approval', 'completed', 'failed'))",
        )
        await transaction.query(
          "ALTER TABLE dsh_enterprise_schedules ADD CONSTRAINT dsh_schedule_state_check CHECK (state IN ('active', 'paused', 'archived'))",
        )
        await transaction.query("UPDATE dsh_enterprise_operations_meta SET value = $1 WHERE key = 'schema-version'", [
          String(ENTERPRISE_OPERATIONS_SCHEMA_VERSION),
        ])
      }
      if (version < 4) {
        await transaction.query(
          'ALTER TABLE dsh_enterprise_operation_outbox ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0',
        )
        await transaction.query('ALTER TABLE dsh_enterprise_operation_outbox ADD COLUMN IF NOT EXISTS lease_owner TEXT')
        await transaction.query('ALTER TABLE dsh_enterprise_operation_outbox ADD COLUMN IF NOT EXISTS lease_expires_at BIGINT')
        await transaction.query('ALTER TABLE dsh_enterprise_operation_outbox ADD COLUMN IF NOT EXISTS last_error TEXT')
        await transaction.query('ALTER TABLE dsh_enterprise_operation_outbox ADD COLUMN IF NOT EXISTS completed_at BIGINT')
        await transaction.query(
          "UPDATE dsh_enterprise_operation_outbox SET state = 'pending' WHERE state NOT IN ('pending','processing','completed','failed')",
        )
        await transaction.query(
          "UPDATE dsh_enterprise_operations_idempotency SET result_json = jsonb_build_object('requestDigest', '', 'result', result_json) WHERE jsonb_typeof(result_json) <> 'object' OR NOT (result_json ? 'result')",
        )
      }
      if (version < ENTERPRISE_OPERATIONS_SCHEMA_VERSION) {
        await transaction.query("UPDATE dsh_enterprise_operations_meta SET value = $1 WHERE key = 'schema-version'", [String(ENTERPRISE_OPERATIONS_SCHEMA_VERSION)])
      } else if (version !== ENTERPRISE_OPERATIONS_SCHEMA_VERSION) {
        throw new Error('unsupported enterprise operations schema version')
      }
    }
  })
}
