import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  EnterpriseOperationsError, EnterpriseOperationsRepository, EnterpriseTeamControlRepository, migrateEnterpriseOperations,
  type PostgresDatabase, type PostgresQueryResult,
} from '../src/index.ts'

const databaseUrl = process.env.DSH_TEST_POSTGRES_URL

class PgTestDatabase implements PostgresDatabase {
  constructor(private readonly pool: Pool, private readonly client?: PoolClient) {}

  async query<Row extends Record<string, unknown>>(
    text: string, values: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    const result = await (this.client ?? this.pool).query<Row & QueryResultRow>(text, [...values])
    return { rows: result.rows, rowCount: result.rowCount }
  }

  async transaction<T>(operation: (database: PostgresDatabase) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await operation(new PgTestDatabase(this.pool, client))
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

const pool = databaseUrl === undefined ? undefined : new Pool({ connectionString: databaseUrl })
const database = pool === undefined ? undefined : new PgTestDatabase(pool)
const postgres = database as PgTestDatabase

async function reset(): Promise<void> {
  await database?.query(`DROP TABLE IF EXISTS
    dsh_enterprise_team_decisions, dsh_enterprise_team_autonomy_grants, dsh_enterprise_team_runs,
    dsh_enterprise_team_definitions, dsh_enterprise_fixed_team_members, dsh_enterprise_operation_outbox, dsh_enterprise_fixed_teams,
    dsh_enterprise_schedules, dsh_enterprise_approval_requests, dsh_enterprise_work_records,
    dsh_enterprise_operations_idempotency, dsh_enterprise_operations_meta CASCADE`)
}

async function activateFixedTeam(
  operations: EnterpriseOperationsRepository,
  orgId: string,
  teamId: string,
  leaderEmployeeReleaseId: string,
): Promise<void> {
  await operations.saveTeamDefinition({
    teamId, orgId, name: `Active ${teamId}`, northStar: 'Execute only from a reviewed charter.',
    ownerUserId: 'owner-a', visibility: 'organization', leaderEmployeeReleaseId,
    roles: [
      { roleId: 'owner', name: 'Owner', responsibility: 'Own the decision.' },
      { roleId: 'leader', name: 'Leader', responsibility: 'Lead execution.' },
    ],
    roster: [
      { actor: { kind: 'human', userId: 'owner-a' }, roleId: 'owner' },
      { actor: { kind: 'agent', employeeReleaseId: leaderEmployeeReleaseId }, roleId: 'leader' },
    ],
    verificationPolicy: { verifierRequired: true, rubricRefs: [], highRiskHumanReviewRequired: true },
    attentionPolicy: { decisionQueue: 'centralized' }, approvalPolicy: {}, state: 'active',
    expectedRevision: 1, idempotencyKey: `activate-${teamId}`,
  })
}

describe.skipIf(database === undefined)('enterprise operations PostgreSQL', () => {
  beforeEach(reset)
  afterAll(async () => { await reset(); await pool?.end() })

  it('migrates v1 and keeps schedule, team, state, and rollback invariants', async () => {
    await postgres.query('CREATE TABLE dsh_enterprise_operations_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    await postgres.query("INSERT INTO dsh_enterprise_operations_meta VALUES ('schema-version', '1')")
    await postgres.query(`CREATE TABLE dsh_enterprise_operation_outbox (
      command_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, schedule_id TEXT NOT NULL, occurrence_key TEXT NOT NULL,
      work_session_id TEXT NOT NULL, employee_release_id TEXT NOT NULL, payload_json JSONB NOT NULL,
      state TEXT NOT NULL, created_at BIGINT NOT NULL, UNIQUE(org_id, schedule_id, occurrence_key))`)
    await migrateEnterpriseOperations(postgres)
    const columns = await postgres.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'dsh_enterprise_operation_outbox' AND column_name IN ('team_id','start_admitted_at','team_definition_revision') ORDER BY column_name",
    )
    expect(columns.rows.map(row => row.column_name)).toEqual(['start_admitted_at', 'team_definition_revision', 'team_id'])

    const operations = new EnterpriseOperationsRepository(postgres, { allowUnverifiedReferences: true })
    await operations.createFixedTeam({
      teamId: 'pg-team', orgId: 'pg-org', leaderEmployeeReleaseId: 'pg-lead', members: [],
      workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: 'pg-team-create',
    })
    await activateFixedTeam(operations, 'pg-org', 'pg-team', 'pg-lead')
    await operations.createSchedule({
      scheduleId: 'pg-schedule', orgId: 'pg-org', target: { kind: 'team', teamId: 'pg-team' }, timezone: 'UTC',
      rule: '0 * * * *', input: {}, nextRunAt: 1, expectedRevision: 0, idempotencyKey: 'pg-schedule-create',
    })
    const fire = {
      scheduleId: 'pg-schedule', orgId: 'pg-org', expectedRevision: 1, idempotencyKey: 'pg-fire',
      occurrenceKey: 'one', sessionId: 'pg-session', firedAt: 1, nextRunAt: 2,
    }
    const fired = await operations.fireSchedule(fire)
    const retried = await operations.fireSchedule(fire)
    expect(fired.command).toMatchObject({ employeeReleaseId: 'pg-lead', teamId: 'pg-team' })
    expect(retried).toEqual(fired)

    await postgres.query("UPDATE dsh_enterprise_schedules SET state = 'paused' WHERE schedule_id = 'pg-schedule'")
    await expect(operations.fireSchedule({
      scheduleId: 'pg-schedule', orgId: 'pg-org', expectedRevision: 2, idempotencyKey: 'pg-paused',
      occurrenceKey: 'two', sessionId: 'pg-paused-session', firedAt: 2, nextRunAt: 3,
    })).rejects.toThrow('is not active')

    await postgres.query("UPDATE dsh_enterprise_schedules SET state = 'active' WHERE schedule_id = 'pg-schedule'")
    await postgres.query('ALTER TABLE dsh_enterprise_operation_outbox ADD CONSTRAINT reject_outbox CHECK (FALSE) NOT VALID')
    await expect(operations.fireSchedule({
      scheduleId: 'pg-schedule', orgId: 'pg-org', expectedRevision: 2, idempotencyKey: 'pg-rollback',
      occurrenceKey: 'three', sessionId: 'pg-rollback-session', firedAt: 3, nextRunAt: 4,
    })).rejects.toThrow()
    await expect(operations.getWorkRecord('pg-org', 'pg-rollback-session', 'pg-lead')).resolves.toBeUndefined()
  })

  it('persists TeamRun and Decision projections plus terminal explicit autonomy grants', async () => {
    let now = 100
    const operations = new EnterpriseOperationsRepository(postgres, { allowUnverifiedReferences: true })
    const projections = new EnterpriseTeamControlRepository(postgres, {
      now: () => ++now, cursorSigningKey: Buffer.from('team-control-real-postgres-cursor-key'),
    })
    await operations.createTeamDefinition({
      teamId: 'control-team', orgId: 'control-org', name: 'Control team', northStar: 'Execute reviewed work.',
      ownerUserId: 'owner-a', visibility: 'organization', leaderEmployeeReleaseId: 'release-a',
      roles: [{ roleId: 'lead', name: 'Lead', responsibility: 'Lead.' }],
      roster: [
        { actor: { kind: 'human', userId: 'owner-a' }, roleId: 'lead' },
        { actor: { kind: 'agent', employeeReleaseId: 'release-a' }, roleId: 'lead' },
      ],
      verificationPolicy: { verifierRequired: true, rubricRefs: [], highRiskHumanReviewRequired: true },
      attentionPolicy: { decisionQueue: 'centralized' }, approvalPolicy: {}, state: 'active',
      expectedRevision: 0, idempotencyKey: 'control-definition',
    })
    await projections.createTeamRunStarting({
      orgId: 'control-org', teamId: 'control-team', expectedTeamRevision: 1,
      workspaceId: 'workspace-a', createdBy: 'owner-a', source: 'console',
      idempotencyKey: 'start-a', idempotencyFingerprint: 'fingerprint-a',
    }, () => 'run-a')
    await expect(projections.createTeamRunStarting({
      orgId: 'control-org', teamId: 'control-team', expectedTeamRevision: 1,
      workspaceId: 'workspace-a', createdBy: 'owner-a', source: 'console',
      idempotencyKey: 'start-a', idempotencyFingerprint: 'fingerprint-a',
    }, () => 'run-unused'))
      .resolves.toMatchObject({ created: false, run: { runId: 'run-a' } })
    const active = await projections.projectTeamRun({ orgId: 'control-org', runId: 'run-a', expectedRevision: 1,
      state: 'active', rootSessionId: 'session-a', runtimeRevision: 1, sourceEventSeq: 4 })
    expect(active).toMatchObject({ state: 'active', runtimeRevision: 1, sourceEventSeq: 4 })
    await expect(projections.getTeamRun('other-org', 'run-a')).resolves.toBeUndefined()

    const decision = await projections.projectDecision({
      decisionId: 'decision-a', orgId: 'control-org', runId: 'run-a', kind: 'approval', question: 'Proceed?',
      options: ['yes', 'no'], contextDigest: 'digest-a', assigneeUserId: 'member-a', state: 'open',
      runtimeRevision: 2, sourceEventSeq: 5, revision: 1, createdAt: 103, updatedAt: 103,
    })
    const response = await projections.reserveDecisionResponse({
      orgId: 'control-org', decisionId: decision.decisionId, expectedRevision: 1,
      idempotencyKey: 'answer-a', idempotencyFingerprint: 'answer-fingerprint-a',
    })
    await expect(projections.answerDecision({
      orgId: 'control-org', decisionId: decision.decisionId,
      expectedRevision: 1, answer: 'yes', runtimeRevision: 3, sourceEventSeq: 6,
      idempotencyKey: 'answer-a', idempotencyFingerprint: 'answer-fingerprint-a',
      operationId: response.operationId,
    }))
      .resolves.toMatchObject({ state: 'answered', answer: 'yes' })

    await projections.projectDecision({
      decisionId: 'decision-concurrent', orgId: 'control-org', runId: 'run-a', kind: 'approval',
      question: 'Concurrent?', options: ['yes', 'no'], contextDigest: 'digest-concurrent',
      assigneeUserId: 'member-a', state: 'open', runtimeRevision: 4,
      revision: 1, createdAt: 104, updatedAt: 104,
    })
    const responseRace = await Promise.allSettled([
      projections.reserveDecisionResponse({ orgId: 'control-org', decisionId: 'decision-concurrent',
        expectedRevision: 1, idempotencyKey: 'response-one', idempotencyFingerprint: 'digest-one' }),
      projections.reserveDecisionResponse({ orgId: 'control-org', decisionId: 'decision-concurrent',
        expectedRevision: 1, idempotencyKey: 'response-two', idempotencyFingerprint: 'digest-two' }),
    ])
    expect(responseRace.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(responseRace.filter(result => result.status === 'rejected')).toHaveLength(1)

    const grant = await projections.saveAutonomyGrant({ orgId: 'control-org', teamId: 'control-team',
      employeeReleaseId: 'release-a', taskType: 'close', capabilityScope: 'ledger.read', level: 'propose',
      grantedBy: 'owner-a', evidenceRefs: ['evidence-a'], expectedRevision: 0, idempotencyKey: 'grant-a' })
    await projections.saveAutonomyGrant({ orgId: 'control-org', teamId: 'control-team',
      employeeReleaseId: 'release-a', taskType: 'reconcile', capabilityScope: 'ledger.read', level: 'observe',
      grantedBy: 'owner-a', evidenceRefs: [], expectedRevision: 0, idempotencyKey: 'grant-b' })
    const grantRace = await Promise.allSettled([
      projections.saveAutonomyGrant({ orgId: 'control-org', teamId: 'control-team',
        employeeReleaseId: 'release-a', taskType: 'race', capabilityScope: 'ledger.read', level: 'observe',
        grantedBy: 'owner-a', evidenceRefs: [], expectedRevision: 0, idempotencyKey: 'grant-race-one' }),
      projections.saveAutonomyGrant({ orgId: 'control-org', teamId: 'control-team',
        employeeReleaseId: 'release-a', taskType: 'race', capabilityScope: 'ledger.read', level: 'propose',
        grantedBy: 'owner-a', evidenceRefs: [], expectedRevision: 0, idempotencyKey: 'grant-race-two' }),
    ])
    expect(grantRace.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(grantRace.filter(result => result.status === 'rejected')).toHaveLength(1)
    const grantPage = await projections.listAutonomyGrants({
      orgId: 'control-org', readScope: { userId: 'owner-a', isAdministrator: false }, limit: 1,
    })
    expect(grantPage.nextCursor).toBeTypeOf('string')
    await expect(projections.listAutonomyGrants({
      orgId: 'control-org', readScope: { userId: 'owner-a', isAdministrator: false },
      limit: 1, cursor: grantPage.nextCursor,
    })).resolves.toMatchObject({ items: [expect.objectContaining({ teamId: 'control-team' })] })
    const revoked = await projections.revokeAutonomyGrant({ orgId: 'control-org', teamId: 'control-team',
      employeeReleaseId: 'release-a', taskType: 'close', capabilityScope: 'ledger.read',
      expectedRevision: grant.revision, idempotencyKey: 'revoke-a' })
    expect(revoked.state).toBe('revoked')
    await expect(projections.saveAutonomyGrant({ ...grant, level: 'execute-reviewed', expectedRevision: revoked.revision,
      idempotencyKey: 'resurrect-a' })).rejects.toMatchObject({ code: 'invalid-transition' })
  })

  it('serializes a reused idempotency key across concurrent resources', async () => {
    const operations = new EnterpriseOperationsRepository(postgres, { allowUnverifiedReferences: true })
    for (const suffix of ['a', 'b']) {
      await operations.createFixedTeam({
        teamId: `team-${suffix}`, orgId: 'race-org', leaderEmployeeReleaseId: `lead-${suffix}`, members: [],
        workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: `team-${suffix}`,
      })
      await activateFixedTeam(operations, 'race-org', `team-${suffix}`, `lead-${suffix}`)
      await operations.createSchedule({
        scheduleId: `schedule-${suffix}`, orgId: 'race-org', target: { kind: 'team', teamId: `team-${suffix}` }, timezone: 'UTC',
        rule: '* * * * *', input: {}, nextRunAt: 1, expectedRevision: 0, idempotencyKey: `schedule-${suffix}`,
      })
    }
    const results = await Promise.allSettled(['a', 'b'].map(suffix => operations.fireSchedule({
      scheduleId: `schedule-${suffix}`, orgId: 'race-org', expectedRevision: 1, idempotencyKey: 'same-fire-key',
      occurrenceKey: suffix, sessionId: `session-${suffix}`, firedAt: 1, nextRunAt: 2,
    })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const rejected = results.find(result => result.status === 'rejected')
    const reason: unknown = rejected?.status === 'rejected' ? rejected.reason : undefined
    expect(reason).toBeInstanceOf(EnterpriseOperationsError)
    expect(reason).toMatchObject({ code: 'idempotency-conflict' })
  })

  it('migrates legacy teams and enforces definition CAS in PostgreSQL', async () => {
    const operations = new EnterpriseOperationsRepository(postgres, {
      allowUnverifiedReferences: true,
      cursorSigningKey: Buffer.from('operations-real-postgres-cursor-key'),
    })
    await migrateEnterpriseOperations(postgres)
    await postgres.query(`INSERT INTO dsh_enterprise_fixed_teams(
      team_id,org_id,leader_release_id,workflow_template_json,approval_policy_json,revision,created_at,updated_at)
      VALUES ('legacy-definition','definition-org','release-a','{}'::jsonb,'{"review":true}'::jsonb,1,1,1)`)
    await postgres.query(`INSERT INTO dsh_enterprise_fixed_team_members(team_id,employee_release_id,role)
      VALUES ('legacy-definition','release-a','analyst')`)
    await migrateEnterpriseOperations(postgres)
    await migrateEnterpriseOperations(postgres)
    await expect(operations.listTeamDefinitions({
      orgId: 'definition-org', readScope: { userId: 'admin-a', isAdministrator: true }, limit: 10,
    })).resolves.toMatchObject({
      items: [{ teamId: 'legacy-definition', state: 'needs-charter', name: '', northStar: '' }],
    })

    const input = {
      teamId: 'active-definition', orgId: 'definition-org', name: 'Finance', northStar: 'Verified close.',
      ownerUserId: 'owner-a', visibility: 'organization' as const, leaderEmployeeReleaseId: 'release-a',
      roles: [{ roleId: 'owner', name: 'Owner', responsibility: 'Own.' }],
      roster: [
        { actor: { kind: 'human' as const, userId: 'owner-a' }, roleId: 'owner' },
        { actor: { kind: 'agent' as const, employeeReleaseId: 'release-a' }, roleId: 'owner' },
      ],
      verificationPolicy: { verifierRequired: true, rubricRefs: [], highRiskHumanReviewRequired: true },
      attentionPolicy: { decisionQueue: 'centralized' as const }, approvalPolicy: {}, state: 'active' as const,
      expectedRevision: 0, idempotencyKey: 'active-definition',
    }
    const created = await operations.createTeamDefinition(input)
    await expect(operations.createTeamDefinition(input)).resolves.toEqual(created)
    await expect(operations.saveTeamDefinition({
      ...input, name: 'Finance v2', expectedRevision: 1, idempotencyKey: 'active-definition-save',
    })).resolves.toMatchObject({ revision: 2, name: 'Finance v2' })
    await expect(operations.saveTeamDefinition({
      ...input, expectedRevision: 1, idempotencyKey: 'active-definition-stale',
    })).rejects.toMatchObject({ code: 'conflict', resourceType: 'team-definition' })
  })

  it('filters definition visibility in PostgreSQL before cursor pagination', async () => {
    let now = 100
    const operations = new EnterpriseOperationsRepository(postgres, {
      allowUnverifiedReferences: true, now: () => ++now,
      cursorSigningKey: Buffer.from('operations-real-postgres-cursor-key'),
    })
    const base = {
      orgId: 'visibility-org', name: '', northStar: '', ownerUserId: 'owner-a',
      leaderEmployeeReleaseId: 'release-a', roster: [], roles: [], verificationPolicy: {}, attentionPolicy: {},
      approvalPolicy: {}, state: 'needs-charter' as const, expectedRevision: 0,
    }
    await operations.createTeamDefinition({
      ...base, teamId: 'visible-old', visibility: 'organization', allowedUserIds: [], idempotencyKey: 'visible-old',
    })
    await operations.createTeamDefinition({
      ...base, teamId: 'hidden-middle', visibility: 'private', allowedUserIds: [], idempotencyKey: 'hidden-middle',
    })
    await operations.createTeamDefinition({
      ...base, teamId: 'visible-new', visibility: 'restricted', allowedUserIds: ['viewer-a'], idempotencyKey: 'visible-new',
    })
    const readScope = { userId: 'viewer-a', isAdministrator: false }
    const first = await operations.listTeamDefinitions({ orgId: 'visibility-org', readScope, limit: 1 })
    const second = await operations.listTeamDefinitions({
      orgId: 'visibility-org', readScope, limit: 1, cursor: first.nextCursor,
    })
    expect(first.items.map(item => item.teamId)).toEqual(['visible-new'])
    expect(second.items.map(item => item.teamId)).toEqual(['visible-old'])
    expect(second.nextCursor).toBeUndefined()
  })

  it('serializes admission against archive and exposes only committed admission markers', async () => {
    const operations = new EnterpriseOperationsRepository(postgres, { allowUnverifiedReferences: true })
    await operations.createFixedTeam({
      teamId: 'pg-admission-team', orgId: 'pg-admission-org', leaderEmployeeReleaseId: 'release-a', members: [],
      workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: 'pg-admission-team',
    })
    await activateFixedTeam(operations, 'pg-admission-org', 'pg-admission-team', 'release-a')
    await postgres.query(`INSERT INTO dsh_enterprise_operation_outbox(
      command_id,org_id,schedule_id,occurrence_key,work_session_id,employee_release_id,team_id,
      team_definition_revision,payload_json,state,attempt_count,lease_owner,lease_expires_at,created_at)
      VALUES ('pg-admission-command','pg-admission-org','seeded','one','session-one','release-a',
        'pg-admission-team',2,'{}'::jsonb,'processing',1,'worker-a',9999999999999,1)`)
    const settled = await Promise.allSettled([
      operations.admitOutboxStart({
        orgId: 'pg-admission-org', commandId: 'pg-admission-command', workerId: 'worker-a',
      }),
      operations.archiveTeamDefinition({
        orgId: 'pg-admission-org', teamId: 'pg-admission-team', expectedRevision: 2,
        idempotencyKey: 'pg-admission-archive',
      }),
    ])
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const marker = await postgres.query<{ start_admitted_at: string | null }>(
      "SELECT start_admitted_at FROM dsh_enterprise_operation_outbox WHERE command_id='pg-admission-command'",
    )
    const admissionWon = settled[0]?.status === 'fulfilled'
    expect(marker.rows[0]?.start_admitted_at === null).toBe(!admissionWon)
  })

  it('serializes FixedTeam and Definition writes with one global team lock', async () => {
    const operations = new EnterpriseOperationsRepository(postgres, { allowUnverifiedReferences: true })
    await operations.createFixedTeam({
      teamId: 'pg-shared-lock', orgId: 'pg-lock-org', leaderEmployeeReleaseId: 'release-a', members: [],
      workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: 'pg-shared-lock',
    })
    const definition = {
      teamId: 'pg-shared-lock', orgId: 'pg-lock-org', name: 'Lock team', northStar: 'Serialize writes.',
      ownerUserId: 'owner-a', visibility: 'organization' as const, allowedUserIds: [],
      leaderEmployeeReleaseId: 'release-a', roles: [{ roleId: 'lead', name: 'Lead', responsibility: 'Lead.' }],
      roster: [
        { actor: { kind: 'human' as const, userId: 'owner-a' }, roleId: 'lead' },
        { actor: { kind: 'agent' as const, employeeReleaseId: 'release-a' }, roleId: 'lead' },
      ],
      verificationPolicy: { verifierRequired: true, rubricRefs: [], highRiskHumanReviewRequired: true },
      attentionPolicy: { decisionQueue: 'centralized' as const }, approvalPolicy: {}, state: 'active' as const,
    }
    const settled = await Promise.allSettled([
      operations.saveTeamDefinition({ ...definition, expectedRevision: 1, idempotencyKey: 'pg-lock-activate' }),
      operations.saveFixedTeam({
        teamId: 'pg-shared-lock', orgId: 'pg-lock-org', leaderEmployeeReleaseId: 'release-b', members: [],
        workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 1, idempotencyKey: 'pg-lock-legacy',
      }),
    ])
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter(result => result.status === 'rejected')).toHaveLength(1)
  })

  it('migrates v9 team commands without captured definition revisions to dead-letter', async () => {
    await migrateEnterpriseOperations(postgres)
    await postgres.query("UPDATE dsh_enterprise_operations_meta SET value='9' WHERE key='schema-version'")
    await postgres.query(`INSERT INTO dsh_enterprise_operation_outbox(
      command_id,org_id,schedule_id,occurrence_key,work_session_id,employee_release_id,team_id,
      team_definition_revision,payload_json,state,attempt_count,lease_owner,lease_expires_at,start_admitted_at,created_at)
      VALUES ('legacy-null','legacy-org','legacy-schedule','one','legacy-session','release-a','legacy-team',
        NULL,'{}'::jsonb,'processing',1,'worker-a',9999999999999,1,1)`)
    await migrateEnterpriseOperations(postgres)
    const row = await postgres.query<{
      state: string
      lease_owner: string | null
      lease_expires_at: string | null
      start_admitted_at: string | null
      last_error: string | null
    }>("SELECT state,lease_owner,lease_expires_at,start_admitted_at,last_error FROM dsh_enterprise_operation_outbox WHERE command_id='legacy-null'")
    expect(row.rows[0]).toEqual({
      state: 'dead-letter', lease_owner: null, lease_expires_at: null, start_admitted_at: null,
      last_error: 'legacy team command has no definition revision',
    })
  })

  it('pages management queries, applies CAS updates, and uses pagination indexes', async () => {
    const operations = new EnterpriseOperationsRepository(postgres, {
      allowUnverifiedReferences: true,
      cursorSigningKey: Buffer.from('operations-real-postgres-cursor-key'),
    })
    for (const suffix of ['a', 'b', 'c']) {
      await operations.upsertWorkRecord({
        orgId: 'managed-org', sessionId: `managed-session-${suffix}`, employeeReleaseId: `managed-release-${suffix}`,
        source: suffix === 'c' ? 'wecom' : 'console', businessState: suffix === 'c' ? 'failed' : 'active',
        sourceReferences: { suffix }, expectedRevision: 0, idempotencyKey: `managed-work-${suffix}`,
      })
      await operations.createApprovalRequest({
        approvalId: `managed-approval-${suffix}`, orgId: 'managed-org', kind: suffix === 'c' ? 'tool' : 'publish',
        subjectType: 'release', subjectId: suffix, requestedBy: suffix === 'c' ? 'other' : 'owner',
        idempotencyKey: `managed-approval-create-${suffix}`,
      })
    }
    const workPage = await operations.listWorkRecords({
      orgId: 'managed-org', businessState: 'active', source: 'console', limit: 1,
    })
    expect(workPage).toMatchObject({ items: [{ source: 'console', businessState: 'active' }] })
    expect((await operations.listWorkRecords({
      orgId: 'managed-org', businessState: 'active', source: 'console', limit: 1, cursor: workPage.nextCursor,
    })).items).toHaveLength(1)
    const approvals = await operations.listApprovals({ orgId: 'managed-org', kind: 'publish', requestedBy: 'owner', limit: 1 })
    expect(approvals.nextCursor).toBeTypeOf('string')
    await expect(operations.transitionApproval({
      approvalId: 'managed-approval-a', orgId: 'managed-org', state: 'cancelled', actorUserId: 'owner',
      reason: 'withdrawn', expectedRevision: 1, idempotencyKey: 'managed-cancel-a',
    })).resolves.toMatchObject({ state: 'cancelled', reviewerUserId: 'owner' })

    await operations.createFixedTeam({
      teamId: 'managed-team', orgId: 'managed-org', leaderEmployeeReleaseId: 'managed-release-a', members: [],
      workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: 'managed-team-create',
    })
    await expect(operations.saveFixedTeam({
      teamId: 'managed-team', orgId: 'managed-org', leaderEmployeeReleaseId: 'managed-release-b',
      members: [{ employeeReleaseId: 'managed-release-c', role: 'reviewer' }], workflowTemplate: { v: 2 }, approvalPolicy: {},
      expectedRevision: 1, idempotencyKey: 'managed-team-save',
    })).resolves.toMatchObject({ revision: 2, members: [{ employeeReleaseId: 'managed-release-c', role: 'reviewer' }] })

    await postgres.query(`INSERT INTO dsh_enterprise_work_records(
      org_id,session_id,employee_release_id,source,business_state,source_references_json,revision,created_at,updated_at)
      SELECT 'managed-org','bulk-session-'||value,'bulk-release-'||value,'console',
        CASE WHEN value % 20 = 0 THEN 'active' ELSE 'failed' END,'{}'::jsonb,1,1000+value,1000+value
      FROM generate_series(1,1000) AS generated(value)`)
    await postgres.query(`INSERT INTO dsh_enterprise_approval_requests(
      approval_id,org_id,kind,subject_type,subject_id,requested_by,state,revision,created_at,updated_at)
      SELECT 'bulk-approval-'||value,'managed-org',CASE WHEN value % 20 = 0 THEN 'publish' ELSE 'tool' END,
        'release','bulk-'||value,'bulk-owner',CASE WHEN value % 40 = 0 THEN 'pending' ELSE 'rejected' END,1,1000+value,1000+value
      FROM generate_series(1,1000) AS generated(value)`)
    await postgres.query(`INSERT INTO dsh_enterprise_schedules(
      schedule_id,org_id,target_json,timezone,rule,input_json,state,next_run_at,last_run_at,revision,created_at,updated_at)
      SELECT 'bulk-schedule-'||value,'managed-org','{"kind":"employee","employeeReleaseId":"bulk"}'::jsonb,
        'UTC','* * * * *','{}'::jsonb,CASE WHEN value % 20 = 0 THEN 'active' ELSE 'paused' END,NULL,NULL,1,1000+value,1000+value
      FROM generate_series(1,1000) AS generated(value)`)
    await postgres.query('ANALYZE dsh_enterprise_work_records')
    await postgres.query('ANALYZE dsh_enterprise_approval_requests')
    await postgres.query('ANALYZE dsh_enterprise_schedules')

    const plans = await postgres.transaction(async (transaction) => {
      await transaction.query('SET LOCAL enable_seqscan = off')
      const explain = async (sql: string, values: readonly unknown[]): Promise<string> => {
        const result = await transaction.query<{ 'QUERY PLAN': string }>(`EXPLAIN (COSTS OFF) ${sql}`, values)
        return result.rows.map(row => row['QUERY PLAN']).join('\n')
      }
      return {
        state: await explain(
          'SELECT * FROM dsh_enterprise_work_records WHERE org_id=$1 AND business_state=$2 ORDER BY created_at DESC,session_id DESC,employee_release_id DESC LIMIT 10',
          ['managed-org', 'active'],
        ),
        stateSource: await explain(
          'SELECT * FROM dsh_enterprise_work_records WHERE org_id=$1 AND business_state=$2 AND source=$3 ORDER BY created_at DESC,session_id DESC,employee_release_id DESC LIMIT 10',
          ['managed-org', 'active', 'console'],
        ),
        approvalKind: await explain(
          'SELECT * FROM dsh_enterprise_approval_requests WHERE org_id=$1 AND kind=$2 ORDER BY created_at DESC,approval_id DESC LIMIT 10',
          ['managed-org', 'publish'],
        ),
        approvalKindState: await explain(
          'SELECT * FROM dsh_enterprise_approval_requests WHERE org_id=$1 AND kind=$2 AND state=$3 ORDER BY created_at DESC,approval_id DESC LIMIT 10',
          ['managed-org', 'publish', 'pending'],
        ),
        scheduleState: await explain(
          'SELECT * FROM dsh_enterprise_schedules WHERE org_id=$1 AND state=$2 ORDER BY created_at DESC,schedule_id DESC LIMIT 10',
          ['managed-org', 'active'],
        ),
      }
    })
    expect(plans.state).toContain('dsh_enterprise_work_records_state_created_idx')
    expect(plans.stateSource).toContain('dsh_enterprise_work_records_state_source_created_idx')
    expect(plans.approvalKind).toContain('dsh_enterprise_approvals_kind_created_idx')
    expect(plans.approvalKindState).toContain('dsh_enterprise_approvals_kind_state_created_idx')
    expect(plans.scheduleState).toContain('dsh_enterprise_schedules_state_created_idx')
  })
})
