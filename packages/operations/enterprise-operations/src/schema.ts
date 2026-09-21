/** PostgreSQL schema for work records, approvals, schedules, teams, and outbox. */
import type { PostgresDatabase } from './types.ts'
/** Value exported as `ENTERPRISE_OPERATIONS_SCHEMA_VERSION`. */
export const ENTERPRISE_OPERATIONS_SCHEMA_VERSION = 20
/** Owner placeholder for legacy fixed teams whose creator was never persisted. */
export const LEGACY_TEAM_DEFINITION_OWNER_USER_ID = 'system:legacy-fixed-team-migration'
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
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_team_definitions (
    org_id TEXT NOT NULL, team_id TEXT NOT NULL, name TEXT NOT NULL, north_star TEXT NOT NULL,
    owner_user_id TEXT NOT NULL, department_id TEXT,
    visibility TEXT NOT NULL CHECK (visibility IN ('organization', 'private', 'restricted')),
    allowed_user_ids_json JSONB, leader_release_id TEXT NOT NULL,
    roster_json JSONB NOT NULL, roles_json JSONB NOT NULL, verification_policy_json JSONB NOT NULL,
    attention_policy_json JSONB NOT NULL, approval_policy_json JSONB NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('needs-charter', 'active', 'archived')),
    revision BIGINT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY(org_id, team_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_team_definition_revisions (
    org_id TEXT NOT NULL, team_id TEXT NOT NULL, revision BIGINT NOT NULL,
    name TEXT NOT NULL, north_star TEXT NOT NULL, owner_user_id TEXT NOT NULL, department_id TEXT,
    visibility TEXT NOT NULL CHECK (visibility IN ('organization', 'private', 'restricted')),
    allowed_user_ids_json JSONB, leader_release_id TEXT NOT NULL,
    roster_json JSONB NOT NULL, roles_json JSONB NOT NULL, verification_policy_json JSONB NOT NULL,
    attention_policy_json JSONB NOT NULL, approval_policy_json JSONB NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('needs-charter', 'draft', 'active', 'archived')),
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY(org_id, team_id, revision)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dsh_enterprise_team_definition_one_active_idx
    ON dsh_enterprise_team_definition_revisions(org_id,team_id) WHERE state='active'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS dsh_enterprise_team_definition_one_draft_idx
    ON dsh_enterprise_team_definition_revisions(org_id,team_id) WHERE state IN ('draft','needs-charter')`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_operation_outbox (
    command_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, schedule_id TEXT NOT NULL,
    occurrence_key TEXT NOT NULL, work_session_id TEXT NOT NULL, employee_release_id TEXT NOT NULL, team_id TEXT,
    payload_json JSONB NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'completed', 'failed', 'dead-letter')),
    attempt_count INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_expires_at BIGINT,
    last_error TEXT, completed_at BIGINT, start_admitted_at BIGINT, team_definition_revision BIGINT,
    created_at BIGINT NOT NULL,
    UNIQUE(org_id, schedule_id, occurrence_key)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_operations_idempotency (
    org_id TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL,
    result_json JSONB NOT NULL, PRIMARY KEY(org_id, operation, key)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_work_start_reservations (
    org_id TEXT NOT NULL, user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL, session_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    employee_release_id TEXT NOT NULL, preset_id TEXT NOT NULL, deadline TEXT, deadline_digest TEXT,
    state TEXT NOT NULL CHECK (state IN ('starting','completed')),
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY(org_id,user_id,idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_team_runs (
    run_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, team_id TEXT NOT NULL,
    team_definition_revision BIGINT NOT NULL, workspace_id TEXT NOT NULL, root_session_id TEXT,
    roster_snapshot_json JSONB NOT NULL, definition_snapshot_json JSONB NOT NULL, created_by TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('console','schedule','channel')),
    state TEXT NOT NULL CHECK (state IN ('starting','active','waiting-human','verifying','completed','failed','cancelled')),
    runtime_revision BIGINT NOT NULL, source_event_seq BIGINT, failure_json JSONB,
    revision BIGINT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_team_decisions (
    decision_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, run_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('approval','handoff','clarification')),
    question TEXT NOT NULL, options_json JSONB NOT NULL, recommendation TEXT, context_digest TEXT NOT NULL,
    assignee_user_id TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('open','answered','cancelled','expired')),
    answer TEXT, runtime_revision BIGINT NOT NULL, source_event_seq BIGINT,
    response_operation_id TEXT, response_request_digest TEXT, response_idempotency_key TEXT,
    revision BIGINT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_team_autonomy_grants (
    org_id TEXT NOT NULL, team_id TEXT NOT NULL, employee_release_id TEXT NOT NULL,
    task_type TEXT NOT NULL, capability_scope TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('observe','propose','execute-reviewed','execute-delegated')),
    granted_by TEXT NOT NULL, evidence_refs_json JSONB NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active','revoked')),
    revision BIGINT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY(org_id,team_id,employee_release_id,task_type,capability_scope)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_channel_configurations (
    org_id TEXT NOT NULL, channel_id TEXT NOT NULL, name TEXT NOT NULL,
    provider TEXT NOT NULL CHECK (provider IN ('wecom','feishu','dingtalk','wechat')),
    tenant_id TEXT, account_id TEXT NOT NULL, credential_ref TEXT,
    default_employee_release_id TEXT, inbound_enabled BOOLEAN NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('draft','active','paused','archived')),
    binding_status TEXT NOT NULL DEFAULT 'unbound' CHECK (binding_status IN ('unbound','verified')),
    bound_provider_identity_id TEXT, bound_provider_identity_name TEXT, verified_tenant_id TEXT,
    binding_verified_by TEXT, binding_verified_at BIGINT,
    created_by TEXT NOT NULL, revision BIGINT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    PRIMARY KEY(org_id,channel_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_devices (
    device_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL,
    device_name TEXT NOT NULL, platform TEXT NOT NULL CHECK (platform IN ('macos','windows','linux')),
    public_key TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('online','offline','revoked')),
    last_heartbeat_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    UNIQUE(org_id,user_id,public_key)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_recorder_pairings (
    pairing_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL,
    code_hash TEXT NOT NULL, expires_at BIGINT NOT NULL, consumed_at BIGINT,
    failed_attempts INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_recorder_pairings_owner_idx
    ON dsh_enterprise_recorder_pairings(org_id,user_id,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_recorder_devices (
    recorder_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL,
    device_name TEXT NOT NULL, serial_hash TEXT NOT NULL UNIQUE,
    relay_public_key TEXT NOT NULL, credential_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active','revoked')),
    last_seen_at BIGINT, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_computer_use_runs (
    run_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL, session_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('observe','confirm-each','delegated')),
    state TEXT NOT NULL CHECK (state IN ('active','paused','stopped','failed')),
    revision BIGINT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_computer_use_permits (
    permit_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES dsh_enterprise_computer_use_runs(run_id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL, capability TEXT NOT NULL, expires_at BIGINT NOT NULL,
    consumed_at BIGINT, created_at BIGINT NOT NULL, UNIQUE(org_id,run_id,operation_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_device_nonces (
    device_id TEXT NOT NULL REFERENCES dsh_enterprise_devices(device_id) ON DELETE CASCADE,
    nonce TEXT NOT NULL, expires_at BIGINT NOT NULL, PRIMARY KEY(device_id,nonce)
  )`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_device_nonces_expiry_idx
    ON dsh_enterprise_device_nonces(expires_at)`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_computer_use_actions (
    action_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, user_id TEXT NOT NULL, device_id TEXT NOT NULL,
    run_id TEXT NOT NULL REFERENCES dsh_enterprise_computer_use_runs(run_id) ON DELETE CASCADE,
    operation_id TEXT NOT NULL, capability TEXT NOT NULL, adapter TEXT NOT NULL,
    operation_json JSONB NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('pending','claimed','completed','rejected','paused','failed','unknown')),
    result_summary TEXT, evidence_hash TEXT, claimed_at BIGINT, completed_at BIGINT,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    UNIQUE(org_id,operation_id)
  )`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_computer_use_actions_claim_idx
    ON dsh_enterprise_computer_use_actions(device_id,state,created_at,action_id)`,
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
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_team_definitions_created_page_idx
    ON dsh_enterprise_team_definitions(org_id, created_at DESC, team_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_team_runs_created_page_idx
    ON dsh_enterprise_team_runs(org_id, created_at DESC, run_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_team_runs_filter_idx
    ON dsh_enterprise_team_runs(org_id, team_id, state, created_at DESC, run_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_team_decisions_created_page_idx
    ON dsh_enterprise_team_decisions(org_id, created_at DESC, decision_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_team_decisions_filter_idx
    ON dsh_enterprise_team_decisions(org_id, run_id, state, assignee_user_id, created_at DESC, decision_id DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_team_autonomy_created_page_idx
    ON dsh_enterprise_team_autonomy_grants(org_id, created_at DESC, team_id DESC, employee_release_id DESC, task_type DESC, capability_scope DESC)`,
  `CREATE INDEX IF NOT EXISTS dsh_enterprise_channel_configurations_idx
    ON dsh_enterprise_channel_configurations(org_id, provider, state, created_at DESC, channel_id DESC)`,
] as const
/** Executes `migrateEnterpriseOperations`.
 * @param database - Input value used by this API.
*/
export async function migrateEnterpriseOperations(database: PostgresDatabase): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.query('SELECT pg_advisory_xact_lock($1)', [0x4453484f])
    for (const statement of statements) await transaction.query(statement)
    await transaction.query(
      `INSERT INTO dsh_enterprise_team_definitions(
        org_id,team_id,name,north_star,owner_user_id,department_id,visibility,allowed_user_ids_json,
        leader_release_id,roster_json,roles_json,verification_policy_json,attention_policy_json,
        approval_policy_json,state,revision,created_at,updated_at)
      SELECT fixed.org_id,fixed.team_id,'','',$1,NULL,'organization',NULL,fixed.leader_release_id,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'actor',jsonb_build_object('kind','agent','employeeReleaseId',member.employee_release_id),
          'roleId',member.role) ORDER BY member.employee_release_id)
          FROM dsh_enterprise_fixed_team_members member WHERE member.team_id=fixed.team_id),'[]'::jsonb),
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'roleId',role.role,'name',role.role,'responsibility','') ORDER BY role.role)
          FROM (SELECT DISTINCT member.role FROM dsh_enterprise_fixed_team_members member
            WHERE member.team_id=fixed.team_id) role),'[]'::jsonb),
        '{}'::jsonb,'{}'::jsonb,fixed.approval_policy_json,'needs-charter',1,fixed.created_at,fixed.updated_at
      FROM dsh_enterprise_fixed_teams fixed ON CONFLICT (org_id,team_id) DO NOTHING`,
      [LEGACY_TEAM_DEFINITION_OWNER_USER_ID],
    )
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
      if (version < 8) {
        await transaction.query('ALTER TABLE dsh_enterprise_operation_outbox ADD COLUMN IF NOT EXISTS start_admitted_at BIGINT')
      }
      if (version < 9) {
        await transaction.query('ALTER TABLE dsh_enterprise_operation_outbox ADD COLUMN IF NOT EXISTS team_definition_revision BIGINT')
      }
      if (version < 10) {
        await transaction.query('ALTER TABLE dsh_enterprise_operation_outbox DROP CONSTRAINT IF EXISTS dsh_enterprise_operation_outbox_state_check')
        await transaction.query(
          `UPDATE dsh_enterprise_operation_outbox SET state='dead-letter',lease_owner=NULL,lease_expires_at=NULL,
            start_admitted_at=NULL,last_error='legacy team command has no definition revision'
            WHERE team_id IS NOT NULL AND team_definition_revision IS NULL AND state IN ('pending','processing','failed')`,
        )
        await transaction.query(
          "ALTER TABLE dsh_enterprise_operation_outbox ADD CONSTRAINT dsh_enterprise_operation_outbox_state_check CHECK (state IN ('pending','processing','completed','failed','dead-letter'))",
        )
      }
      if (version < 12) {
        await transaction.query('ALTER TABLE dsh_enterprise_team_runs ADD COLUMN IF NOT EXISTS definition_snapshot_json JSONB')
        await transaction.query('ALTER TABLE dsh_enterprise_team_decisions ADD COLUMN IF NOT EXISTS response_operation_id TEXT')
        await transaction.query('ALTER TABLE dsh_enterprise_team_decisions ADD COLUMN IF NOT EXISTS response_request_digest TEXT')
        await transaction.query('ALTER TABLE dsh_enterprise_team_decisions ADD COLUMN IF NOT EXISTS response_idempotency_key TEXT')
        await transaction.query(
          `UPDATE dsh_enterprise_team_runs run SET definition_snapshot_json=jsonb_strip_nulls(jsonb_build_object(
            'teamId',definition.team_id,'orgId',definition.org_id,'name',definition.name,
            'northStar',definition.north_star,'ownerUserId',definition.owner_user_id,
            'departmentId',definition.department_id,'visibility',definition.visibility,
            'allowedUserIds',definition.allowed_user_ids_json,'leaderEmployeeReleaseId',definition.leader_release_id,
            'roster',definition.roster_json,'roles',definition.roles_json,
            'verificationPolicy',definition.verification_policy_json,
            'attentionPolicy',definition.attention_policy_json,'approvalPolicy',definition.approval_policy_json,
            'revision',definition.revision,'state',definition.state,
            'createdAt',definition.created_at,'updatedAt',definition.updated_at))
          FROM dsh_enterprise_team_definitions definition
          WHERE run.definition_snapshot_json IS NULL AND definition.org_id=run.org_id
            AND definition.team_id=run.team_id AND definition.revision=run.team_definition_revision
            AND definition.roster_json=run.roster_snapshot_json`,
        )
        await transaction.query(
          `UPDATE dsh_enterprise_team_runs SET state='failed',revision=revision+1,
            failure_json=jsonb_build_object('code','legacy-definition-snapshot-unavailable',
              'message','legacy starting TeamRun cannot be replayed without its exact definition snapshot')
          WHERE definition_snapshot_json IS NULL AND state='starting'`,
        )
        await transaction.query(
          `UPDATE dsh_enterprise_team_runs SET definition_snapshot_json=jsonb_build_object(
            'teamId',team_id,'orgId',org_id,'revision',team_definition_revision,
            'roster',roster_snapshot_json,'state','archived','legacySnapshot',true)
          WHERE definition_snapshot_json IS NULL`,
        )
        await transaction.query(
          'ALTER TABLE dsh_enterprise_team_runs ALTER COLUMN definition_snapshot_json SET NOT NULL',
        )
      }
      if (version < 14) {
        await transaction.query(
          "ALTER TABLE dsh_enterprise_channel_configurations ADD COLUMN IF NOT EXISTS binding_status TEXT NOT NULL DEFAULT 'unbound' CHECK (binding_status IN ('unbound','verified'))",
        )
        await transaction.query('ALTER TABLE dsh_enterprise_channel_configurations ADD COLUMN IF NOT EXISTS bound_provider_identity_id TEXT')
        await transaction.query('ALTER TABLE dsh_enterprise_channel_configurations ADD COLUMN IF NOT EXISTS bound_provider_identity_name TEXT')
        await transaction.query('ALTER TABLE dsh_enterprise_channel_configurations ADD COLUMN IF NOT EXISTS verified_tenant_id TEXT')
        await transaction.query('ALTER TABLE dsh_enterprise_channel_configurations ADD COLUMN IF NOT EXISTS binding_verified_by TEXT')
        await transaction.query('ALTER TABLE dsh_enterprise_channel_configurations ADD COLUMN IF NOT EXISTS binding_verified_at BIGINT')
      }
      if (version < 15) {
        await transaction.query(`CREATE TABLE IF NOT EXISTS dsh_enterprise_work_start_reservations (
          org_id TEXT NOT NULL, user_id TEXT NOT NULL, idempotency_key TEXT NOT NULL,
          request_fingerprint TEXT NOT NULL, session_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
          employee_release_id TEXT NOT NULL, preset_id TEXT NOT NULL, deadline TEXT, deadline_digest TEXT,
          state TEXT NOT NULL CHECK (state IN ('starting','completed')),
          created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
          PRIMARY KEY(org_id,user_id,idempotency_key)
        )`)
      }
      if (version < 16) {
        await transaction.query(`CREATE TABLE IF NOT EXISTS dsh_enterprise_team_definition_revisions (
          org_id TEXT NOT NULL, team_id TEXT NOT NULL, revision BIGINT NOT NULL,
          name TEXT NOT NULL, north_star TEXT NOT NULL, owner_user_id TEXT NOT NULL, department_id TEXT,
          visibility TEXT NOT NULL, allowed_user_ids_json JSONB, leader_release_id TEXT NOT NULL,
          roster_json JSONB NOT NULL, roles_json JSONB NOT NULL, verification_policy_json JSONB NOT NULL,
          attention_policy_json JSONB NOT NULL, approval_policy_json JSONB NOT NULL,
          state TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
          PRIMARY KEY(org_id,team_id,revision)
        )`)
        await transaction.query(`INSERT INTO dsh_enterprise_team_definition_revisions(
          org_id,team_id,revision,name,north_star,owner_user_id,department_id,visibility,allowed_user_ids_json,
          leader_release_id,roster_json,roles_json,verification_policy_json,attention_policy_json,approval_policy_json,
          state,created_at,updated_at)
          SELECT org_id,team_id,revision,name,north_star,owner_user_id,department_id,visibility,allowed_user_ids_json,
            leader_release_id,roster_json,roles_json,verification_policy_json,attention_policy_json,approval_policy_json,
            CASE WHEN state='active' THEN 'active' ELSE 'needs-charter' END,created_at,updated_at
          FROM dsh_enterprise_team_definitions
          ON CONFLICT (org_id,team_id,revision) DO NOTHING`)
        await transaction.query("CREATE UNIQUE INDEX IF NOT EXISTS dsh_enterprise_team_definition_one_active_idx ON dsh_enterprise_team_definition_revisions(org_id,team_id) WHERE state='active'")
        await transaction.query("CREATE UNIQUE INDEX IF NOT EXISTS dsh_enterprise_team_definition_one_draft_idx ON dsh_enterprise_team_definition_revisions(org_id,team_id) WHERE state IN ('draft','needs-charter')")
      }
      if (version < ENTERPRISE_OPERATIONS_SCHEMA_VERSION) {
        await transaction.query("UPDATE dsh_enterprise_operations_meta SET value = $1 WHERE key = 'schema-version'", [String(ENTERPRISE_OPERATIONS_SCHEMA_VERSION)])
      } else if (version !== ENTERPRISE_OPERATIONS_SCHEMA_VERSION) {
        throw new Error('unsupported enterprise operations schema version')
      }
    }
  })
}
