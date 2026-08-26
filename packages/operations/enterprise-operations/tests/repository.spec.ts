/* eslint-disable typescript/no-base-to-string -- the SQL double stringifies repository parameter primitives. */
import { describe, expect, it } from 'vitest'
import {
  ApprovalRevisionConflictError,
  EnterpriseOperationsRepository,
  type PostgresDatabase,
  type PostgresQueryResult,
} from '../src/index.ts'

interface WorkRecordRow {
  org_id: string
  session_id: string
  employee_release_id: string
  team_id: string | null
  source: string
  business_state: string
  source_references_json: unknown
  revision: number
  created_at: number
  updated_at: number
}

interface ApprovalRow {
  approval_id: string
  org_id: string
  kind: string
  subject_type: string
  subject_id: string
  requested_by: string
  state: string
  reviewer_user_id: string | null
  reason: string | null
  revision: number
  created_at: number
  updated_at: number
}

interface ScheduleRow {
  schedule_id: string
  org_id: string
  target_json: unknown
  timezone: string
  rule: string
  input_json: unknown
  state: string
  next_run_at: number | null
  last_run_at: number | null
  revision: number
  created_at: number
  updated_at: number
}

interface TeamRow {
  team_id: string
  org_id: string
  leader_release_id: string
  workflow_template_json: unknown
  approval_policy_json: unknown
  revision: number
  created_at: number
  updated_at: number
}

interface TeamMemberRow {
  team_id: string
  employee_release_id: string
  role: string
}

interface OutboxRow {
  command_id: string
  org_id: string
  schedule_id: string
  occurrence_key: string
  work_session_id: string
  employee_release_id: string
  payload_json: unknown
  state: string
  created_at: number
}

/** Transactional in-memory PostgreSQL double for the operations repository. */
class MemoryPostgresDatabase implements PostgresDatabase {
  private readonly meta = new Map<string, string>()
  private readonly workRecords = new Map<string, WorkRecordRow>()
  private readonly approvals = new Map<string, ApprovalRow>()
  private readonly schedules = new Map<string, ScheduleRow>()
  private readonly teams = new Map<string, TeamRow>()
  private readonly members = new Map<string, TeamMemberRow>()
  private readonly outbox = new Map<string, OutboxRow>()
  private readonly idempotency = new Map<string, unknown>()
  private tail = Promise.resolve()
  failNextOutboxInsert = false

  async transaction<T>(operation: (database: MemoryPostgresDatabase) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const checkpoint = structuredClone({
        meta: this.meta,
        workRecords: this.workRecords,
        approvals: this.approvals,
        schedules: this.schedules,
        teams: this.teams,
        members: this.members,
        outbox: this.outbox,
        idempotency: this.idempotency,
      })
      try {
        return await operation(this)
      } catch (error: unknown) {
        this.restore(checkpoint)
        throw error
      }
    })
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    const rows = this.rows(text, values)
    return { rows: rows as Row[], rowCount: rows.length }
  }

  private rows(text: string, values: readonly unknown[]): Record<string, unknown>[] {
    if (text.startsWith('CREATE ') || text.startsWith('SELECT pg_advisory_xact_lock')) return []
    if (text.startsWith('SELECT value FROM dsh_enterprise_operations_meta')) {
      const value = this.meta.get('schema-version')
      return value === undefined ? [] : [{ value }]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_operations_meta')) {
      this.meta.set('schema-version', String(values[0]))
      return []
    }
    if (text.startsWith('SELECT result_json FROM dsh_enterprise_operations_idempotency')) {
      const value = this.idempotency.get(`${String(values[0])}:${String(values[1])}:${String(values[2])}`)
      return value === undefined ? [] : [{ result_json: clone(value) }]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_operations_idempotency')) {
      this.idempotency.set(`${String(values[0])}:${String(values[1])}:${String(values[2])}`, parse(values[3]))
      return []
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_work_records')) {
      if (text.includes('WHERE session_id = $1')) {
        const row = this.workRecords.get(`${String(values[0])}:${String(values[1])}`)
        return row === undefined ? [] : [clone(row)]
      }
      return [...this.workRecords.values()]
        .filter(row => row.org_id === String(values[0]))
        .filter(row => !text.includes('business_state = $2') || row.business_state === String(values[1]))
        .sort((left, right) => right.updated_at - left.updated_at || left.session_id.localeCompare(right.session_id))
        .map(clone)
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_work_records')) {
      const row: WorkRecordRow = {
        org_id: String(values[0]),
        session_id: String(values[1]),
        employee_release_id: String(values[2]),
        team_id: values[3] === null ? null : String(values[3]),
        source: String(values[4]),
        business_state: String(values[5]),
        source_references_json: parse(values[6]),
        revision: 1,
        created_at: Number(values[7]),
        updated_at: Number(values[7]),
      }
      this.workRecords.set(`${row.session_id}:${row.employee_release_id}`, row)
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_work_records')) {
      const row = this.workRecords.get(`${String(values.at(-2))}:${String(values.at(-1))}`)
      if (row === undefined) return []
      row.team_id = values[0] === null ? null : String(values[0])
      row.business_state = String(values[1])
      row.revision += 1
      row.updated_at = Number(values[2])
      return [clone(row)]
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_approval_requests')) {
      const row = this.approvals.get(String(values[0]))
      return row === undefined ? [] : [clone(row)]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_approval_requests')) {
      const row: ApprovalRow = {
        approval_id: String(values[0]),
        org_id: String(values[1]),
        kind: String(values[2]),
        subject_type: String(values[3]),
        subject_id: String(values[4]),
        requested_by: String(values[5]),
        state: 'pending',
        reviewer_user_id: null,
        reason: null,
        revision: 1,
        created_at: Number(values[6]),
        updated_at: Number(values[6]),
      }
      this.approvals.set(row.approval_id, row)
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_approval_requests')) {
      const row = this.approvals.get(String(values[4]))
      if (row === undefined || row.org_id !== String(values[5]) || row.revision !== Number(values[6])) return []
      row.state = String(values[0])
      row.reviewer_user_id = String(values[1])
      row.reason = values[2] === null ? null : String(values[2])
      row.updated_at = Number(values[3])
      row.revision += 1
      return [clone(row)]
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_schedules')) {
      const row = this.schedules.get(String(values[0]))
      return row === undefined ? [] : [clone(row)]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_schedules')) {
      const row: ScheduleRow = {
        schedule_id: String(values[0]),
        org_id: String(values[1]),
        target_json: parse(values[2]),
        timezone: String(values[3]),
        rule: String(values[4]),
        input_json: parse(values[5]),
        state: 'active',
        next_run_at: values[6] as number | null,
        last_run_at: null,
        revision: 1,
        created_at: Number(values[7]),
        updated_at: Number(values[7]),
      }
      this.schedules.set(row.schedule_id, row)
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_schedules SET last_run_at')) {
      const row = this.schedules.get(String(values[2]))
      if (row === undefined || row.org_id !== String(values[3]) || row.revision !== Number(values[4])) return []
      row.last_run_at = Number(values[0])
      row.next_run_at = values[1] as number | null
      row.updated_at = Number(values[0])
      row.revision += 1
      return [clone(row)]
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_operation_outbox')) {
      const row = [...this.outbox.values()].find(
        candidate => candidate.schedule_id === String(values[0]) && candidate.occurrence_key === String(values[1]),
      )
      return row === undefined ? [] : [clone(row)]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_operation_outbox')) {
      if (this.failNextOutboxInsert) {
        this.failNextOutboxInsert = false
        throw new Error('injected outbox failure')
      }
      const row: OutboxRow = {
        command_id: String(values[0]),
        org_id: String(values[1]),
        schedule_id: String(values[2]),
        occurrence_key: String(values[3]),
        work_session_id: String(values[4]),
        employee_release_id: String(values[5]),
        payload_json: parse(values[6]),
        state: 'pending',
        created_at: Number(values[7]),
      }
      this.outbox.set(row.command_id, row)
      return [clone(row)]
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_fixed_teams')) {
      const row = this.teams.get(String(values[0]))
      return row === undefined ? [] : [clone(row)]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_fixed_teams')) {
      const row: TeamRow = {
        team_id: String(values[0]),
        org_id: String(values[1]),
        leader_release_id: String(values[2]),
        workflow_template_json: parse(values[3]),
        approval_policy_json: parse(values[4]),
        revision: 1,
        created_at: Number(values[5]),
        updated_at: Number(values[5]),
      }
      this.teams.set(row.team_id, row)
      return [clone(row)]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_fixed_team_members')) {
      const row: TeamMemberRow = { team_id: String(values[0]), employee_release_id: String(values[1]), role: String(values[2]) }
      this.members.set(`${row.team_id}:${row.employee_release_id}`, row)
      return []
    }
    if (text.startsWith('SELECT employee_release_id, role FROM dsh_enterprise_fixed_team_members')) {
      return [...this.members.values()].filter(row => row.team_id === String(values[0])).map(clone)
    }
    throw new Error(`unhandled operations PostgreSQL test query: ${text}`)
  }

  private restore(snapshot: {
    meta: Map<string, string>
    workRecords: Map<string, WorkRecordRow>
    approvals: Map<string, ApprovalRow>
    schedules: Map<string, ScheduleRow>
    teams: Map<string, TeamRow>
    members: Map<string, TeamMemberRow>
    outbox: Map<string, OutboxRow>
    idempotency: Map<string, unknown>
  }): void {
    const stores = [
      [this.meta, snapshot.meta],
      [this.workRecords, snapshot.workRecords],
      [this.approvals, snapshot.approvals],
      [this.schedules, snapshot.schedules],
      [this.teams, snapshot.teams],
      [this.members, snapshot.members],
      [this.outbox, snapshot.outbox],
      [this.idempotency, snapshot.idempotency],
    ] as const
    for (const [target, source] of stores) {
      target.clear()
      for (const [key, value] of source) target.set(key, value)
    }
  }
}

function parse(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}
function clone<T>(value: T): T {
  return structuredClone(value)
}

const work = {
  orgId: 'org-a',
  sessionId: 'session-a',
  employeeReleaseId: 'release-a',
  teamId: undefined,
  source: 'console' as const,
  businessState: 'active' as const,
  sourceReferences: { nativeSessionId: 'session-a' },
  expectedRevision: 0,
  idempotencyKey: 'work-a',
}

describe('EnterpriseOperationsRepository', () => {
  it('keeps native session source references immutable while projecting one work record', async () => {
    const repository = new EnterpriseOperationsRepository(new MemoryPostgresDatabase(), { now: () => 100 })
    const created = await repository.upsertWorkRecord(work)
    const retried = await repository.upsertWorkRecord({ ...work, businessState: 'completed' })

    expect(retried).toEqual(created)
    await expect(
      repository.upsertWorkRecord({
        ...work,
        expectedRevision: 1,
        idempotencyKey: 'work-mutate-source',
        sourceReferences: { nativeSessionId: 'other' },
      }),
    ).rejects.toThrow('source references are immutable')
  })

  it('allows one pending approval transition and rejects a concurrent stale reviewer', async () => {
    const repository = new EnterpriseOperationsRepository(new MemoryPostgresDatabase())
    await repository.createApprovalRequest({
      approvalId: 'approval-a',
      orgId: 'org-a',
      kind: 'publish',
      subjectType: 'employee-release',
      subjectId: 'release-a',
      requestedBy: 'owner-a',
      idempotencyKey: 'approval-create',
    })
    const settled = await Promise.allSettled([
      repository.transitionApproval({
        approvalId: 'approval-a',
        orgId: 'org-a',
        expectedRevision: 1,
        idempotencyKey: 'approve-a',
        state: 'approved',
        reviewerUserId: 'reviewer-a',
      }),
      repository.transitionApproval({
        approvalId: 'approval-a',
        orgId: 'org-a',
        expectedRevision: 1,
        idempotencyKey: 'reject-a',
        state: 'rejected',
        reviewerUserId: 'reviewer-b',
        reason: 'needs revision',
      }),
    ])

    expect(settled.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter(item => item.status === 'rejected')[0]?.status).toBe('rejected')
    const failure = settled.find(item => item.status === 'rejected')
    expect(failure?.status === 'rejected' && failure.reason).toBeInstanceOf(ApprovalRevisionConflictError)
  })

  it('fires a schedule once per occurrence and creates one session command outbox record', async () => {
    const repository = new EnterpriseOperationsRepository(new MemoryPostgresDatabase(), { now: () => 200 })
    await repository.createSchedule({
      scheduleId: 'schedule-a',
      orgId: 'org-a',
      target: { kind: 'employee', employeeReleaseId: 'release-a' },
      timezone: 'Asia/Shanghai',
      rule: '0 10 * * *',
      input: { prompt: 'daily brief' },
      nextRunAt: 200,
      expectedRevision: 0,
      idempotencyKey: 'schedule-create',
    })
    const fire = {
      scheduleId: 'schedule-a',
      orgId: 'org-a',
      expectedRevision: 1,
      idempotencyKey: 'fire-a',
      occurrenceKey: '2026-08-27T10:00:00+08:00',
      sessionId: 'session-scheduled-a',
      firedAt: 200,
      nextRunAt: 300,
    }
    const [first, second] = await Promise.all([repository.fireSchedule(fire), repository.fireSchedule(fire)])

    expect(second).toEqual(first)
    expect(first.workRecord.source).toBe('schedule')
    expect(first.command.kind).toBe('start-session')
    expect((await repository.listWorkRecords({ orgId: 'org-a' })).items).toHaveLength(1)
  })

  it('does not reveal or mutate records outside the requested organization', async () => {
    const repository = new EnterpriseOperationsRepository(new MemoryPostgresDatabase())
    await repository.upsertWorkRecord(work)

    await expect(repository.getWorkRecord('org-b', 'session-a', 'release-a')).resolves.toBeUndefined()
    await expect(repository.upsertWorkRecord({ ...work, orgId: 'org-b', expectedRevision: 0, idempotencyKey: 'org-b' })).rejects.toThrow(
      'outside organization org-b',
    )
  })

  it('rolls back schedule state and work record when outbox creation fails', async () => {
    const database = new MemoryPostgresDatabase()
    const repository = new EnterpriseOperationsRepository(database)
    await repository.createSchedule({
      scheduleId: 'schedule-b',
      orgId: 'org-a',
      target: { kind: 'employee', employeeReleaseId: 'release-a' },
      timezone: 'UTC',
      rule: '0 * * * *',
      input: {},
      nextRunAt: 100,
      expectedRevision: 0,
      idempotencyKey: 'schedule-b-create',
    })
    database.failNextOutboxInsert = true

    await expect(
      repository.fireSchedule({
        scheduleId: 'schedule-b',
        orgId: 'org-a',
        expectedRevision: 1,
        idempotencyKey: 'schedule-b-fire',
        occurrenceKey: 'occurrence-b',
        sessionId: 'session-b',
        firedAt: 100,
        nextRunAt: 200,
      }),
    ).rejects.toThrow('injected outbox failure')
    await expect(repository.getWorkRecord('org-a', 'session-b', 'release-a')).resolves.toBeUndefined()
    await expect(repository.getSchedule('org-a', 'schedule-b')).resolves.toMatchObject({ revision: 1, lastRunAt: null })
  })

  it('stores a fixed team without bidding or shared-blackboard fields', async () => {
    const repository = new EnterpriseOperationsRepository(new MemoryPostgresDatabase())
    const team = await repository.createFixedTeam({
      teamId: 'team-a',
      orgId: 'org-a',
      leaderEmployeeReleaseId: 'release-lead',
      members: [{ employeeReleaseId: 'release-worker', role: 'researcher' }],
      workflowTemplate: { name: 'handoff' },
      approvalPolicy: { handoff: 'required' },
      expectedRevision: 0,
      idempotencyKey: 'team-a-create',
    })

    expect(team).toMatchObject({
      teamId: 'team-a',
      leaderEmployeeReleaseId: 'release-lead',
      members: [{ employeeReleaseId: 'release-worker', role: 'researcher' }],
    })
  })
})
