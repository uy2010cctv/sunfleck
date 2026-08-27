import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  EnterpriseOperationsRepository, migrateEnterpriseOperations, type PostgresDatabase, type PostgresQueryResult,
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
    dsh_enterprise_fixed_team_members, dsh_enterprise_operation_outbox, dsh_enterprise_fixed_teams,
    dsh_enterprise_schedules, dsh_enterprise_approval_requests, dsh_enterprise_work_records,
    dsh_enterprise_operations_idempotency, dsh_enterprise_operations_meta CASCADE`)
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
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'dsh_enterprise_operation_outbox' AND column_name = 'team_id'",
    )
    expect(columns.rows).toHaveLength(1)

    const operations = new EnterpriseOperationsRepository(postgres, { allowUnverifiedReferences: true })
    await operations.createFixedTeam({
      teamId: 'pg-team', orgId: 'pg-org', leaderEmployeeReleaseId: 'pg-lead', members: [],
      workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: 'pg-team-create',
    })
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

  it('serializes a reused idempotency key across concurrent resources', async () => {
    const operations = new EnterpriseOperationsRepository(postgres, { allowUnverifiedReferences: true })
    for (const suffix of ['a', 'b']) {
      await operations.createFixedTeam({
        teamId: `team-${suffix}`, orgId: 'race-org', leaderEmployeeReleaseId: `lead-${suffix}`, members: [],
        workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: `team-${suffix}`,
      })
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
    expect(String((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason)).toContain('different request')
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

    const plan = await postgres.transaction(async (transaction) => {
      await transaction.query('SET LOCAL enable_seqscan = off')
      const explain = await transaction.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN (COSTS OFF) SELECT * FROM dsh_enterprise_work_records
         WHERE org_id = $1 ORDER BY updated_at DESC, session_id DESC, employee_release_id DESC LIMIT 10`, ['managed-org'],
      )
      return explain.rows.map(row => row['QUERY PLAN']).join('\n')
    })
    expect(plan).toContain('dsh_enterprise_work_records_page_idx')
  })
})
