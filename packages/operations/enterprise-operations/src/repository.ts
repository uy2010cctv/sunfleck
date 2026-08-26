/** Transactional enterprise operations repository. */
import { createHash, randomUUID } from 'node:crypto'
import type {
  ApprovalKind,
  ApprovalView,
  BusinessState,
  EnterpriseOperationsRepositoryOptions,
  FixedTeamView,
  PostgresDatabase,
  ScheduleFireView,
  ScheduleTarget,
  ScheduleView,
  OutboxCommandView,
  OutboxState,
  WorkRecordInput,
  WorkRecordPage,
  WorkRecordView,
} from './types.ts'
import { migrateEnterpriseOperations } from './schema.ts'
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]),
  )
}
function parse(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}
function record(value: unknown): Record<string, unknown> {
  const parsed = parse(value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('operations JSON value is not an object')
  return parsed as Record<string, unknown>
}
function scheduleTarget(value: unknown): ScheduleTarget {
  const target = record(value)
  if (target.kind === 'employee' && typeof target.employeeReleaseId === 'string')
    return { kind: 'employee', employeeReleaseId: target.employeeReleaseId }
  if (target.kind === 'team' && typeof target.teamId === 'string') return { kind: 'team', teamId: target.teamId }
  throw new Error('operations schedule target is invalid')
}
function required<Row>(row: Row | undefined, entity: string): Row {
  if (row === undefined) throw new Error(`${entity} insert returned no row`)
  return row
}
function requestDigest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
}
function assertSourceImmutable(before: WorkRecordView, after: WorkRecordInput): void {
  if (
    JSON.stringify(canonical(before.sourceReferences)) !== JSON.stringify(canonical(after.sourceReferences)) ||
    before.sessionId !== after.sessionId ||
    before.employeeReleaseId !== after.employeeReleaseId ||
    before.source !== after.source
  )
    throw new Error('source references are immutable')
}
function assertBusinessTransition(before: BusinessState, after: BusinessState): void {
  if (before === after) return
  const allowed: Record<BusinessState, readonly BusinessState[]> = {
    active: ['waiting-approval', 'completed', 'failed'],
    'waiting-approval': ['active', 'completed', 'failed'],
    completed: [],
    failed: ['active'],
  }
  if (!allowed[before].includes(after)) throw new Error(`invalid work record state transition: ${before} -> ${after}`)
}
export class ApprovalRevisionConflictError extends Error {
  constructor(
    readonly approvalId: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`approval ${approvalId} revision conflict: expected ${String(expected)}, actual ${String(actual)}`)
  }
}
interface WorkRow extends Record<string, unknown> {
  org_id: string
  session_id: string
  employee_release_id: string
  team_id: string | null
  source: WorkRecordInput['source']
  business_state: BusinessState
  source_references_json: unknown
  revision: number | string
  created_at: number | string
  updated_at: number | string
}
interface ApprovalRow extends Record<string, unknown> {
  approval_id: string
  org_id: string
  kind: ApprovalKind
  subject_type: string
  subject_id: string
  requested_by: string
  state: ApprovalView['state']
  reviewer_user_id: string | null
  reason: string | null
  revision: number | string
  created_at: number | string
  updated_at: number | string
}
interface ScheduleRow extends Record<string, unknown> {
  schedule_id: string
  org_id: string
  target_json: unknown
  timezone: string
  rule: string
  input_json: unknown
  state: ScheduleView['state']
  next_run_at: number | string | null
  last_run_at: number | string | null
  revision: number | string
  created_at: number | string
  updated_at: number | string
}
interface TeamRow extends Record<string, unknown> {
  team_id: string
  org_id: string
  leader_release_id: string
  workflow_template_json: unknown
  approval_policy_json: unknown
  revision: number | string
  created_at: number | string
  updated_at: number | string
}
interface OutboxRow extends Record<string, unknown> {
  command_id: string
  org_id: string
  schedule_id: string
  occurrence_key: string
  work_session_id: string
  employee_release_id: string
  team_id: string | null
  payload_json: unknown
  state: OutboxState
  attempt_count: number | string
  lease_owner: string | null
  lease_expires_at: number | string | null
  last_error: string | null
  completed_at: number | string | null
  created_at: number | string
}

export class EnterpriseOperationsRepository {
  private initialized: Promise<void> | undefined
  constructor(
    private readonly database: PostgresDatabase,
    private readonly options: EnterpriseOperationsRepositoryOptions = {},
  ) {
    if (options.requireNativeReferences === true && options.allowUnverifiedReferences === true)
      throw new Error('requireNativeReferences and allowUnverifiedReferences cannot both be enabled')
  }
  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
  private initialize(): Promise<void> {
    this.initialized ??= migrateEnterpriseOperations(this.database)
    return this.initialized
  }
  private async lock(database: PostgresDatabase, key: string): Promise<void> {
    await database.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key])
  }
  private async requireSession(orgId: string, sessionId: string): Promise<void> {
    if (this.options.resolveSession === undefined && this.options.allowUnverifiedReferences !== true)
      throw new Error('native session resolver is required')
    if (this.options.resolveSession !== undefined && !(await this.options.resolveSession(orgId, sessionId)))
      throw new Error(`native session ${sessionId} was not found in organization ${orgId}`)
  }
  private async requireRelease(orgId: string, releaseId: string): Promise<void> {
    if (this.options.resolveRelease === undefined && this.options.allowUnverifiedReferences !== true)
      throw new Error('native employee release resolver is required')
    if (this.options.resolveRelease !== undefined && !(await this.options.resolveRelease(orgId, releaseId)))
      throw new Error(`native employee release ${releaseId} was not found in organization ${orgId}`)
  }
  private async teamTarget(database: PostgresDatabase, orgId: string, teamId: string): Promise<TeamRow> {
    const result = await database.query<TeamRow>('SELECT * FROM dsh_enterprise_fixed_teams WHERE team_id = $1 AND org_id = $2', [
      teamId,
      orgId,
    ])
    const team = result.rows[0]
    if (team === undefined || team.org_id !== orgId) throw new Error(`fixed team ${teamId} was not found in organization ${orgId}`)
    return team
  }
  private async idempotent<T>(
    database: PostgresDatabase,
    orgId: string,
    operation: string,
    key: string,
    request: unknown,
  ): Promise<T | undefined> {
    const result = await database.query<{ result_json: unknown }>(
      'SELECT result_json FROM dsh_enterprise_operations_idempotency WHERE org_id = $1 AND operation = $2 AND key = $3',
      [orgId, operation, key],
    )
    if (result.rows[0] === undefined) return undefined
    const envelope = record(result.rows[0].result_json)
    if (envelope.requestDigest !== '' && envelope.requestDigest !== requestDigest(request))
      throw new Error(`idempotency key ${key} was reused with a different request`)
    return envelope.result as T
  }
  private async lockIdempotency(database: PostgresDatabase, orgId: string, operation: string, key: string): Promise<void> {
    await this.lock(database, `idempotency:${orgId}:${operation}:${key}`)
  }
  private async remember(
    database: PostgresDatabase,
    orgId: string,
    operation: string,
    key: string,
    request: unknown,
    value: unknown,
  ): Promise<void> {
    await database.query(
      'INSERT INTO dsh_enterprise_operations_idempotency(org_id, operation, key, result_json) VALUES ($1, $2, $3, $4::jsonb)',
      [orgId, operation, key, JSON.stringify({ requestDigest: requestDigest(request), result: value })],
    )
  }
  async upsertWorkRecord(input: WorkRecordInput): Promise<WorkRecordView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `work:${input.sessionId}:${input.employeeReleaseId}`)
      await this.lockIdempotency(database, input.orgId, 'work', input.idempotencyKey)
      const prior = await this.idempotent<WorkRecordView>(database, input.orgId, 'work', input.idempotencyKey, input)
      if (prior !== undefined) return prior
      const owner = await database.query<WorkRow>(
        'SELECT * FROM dsh_enterprise_work_records WHERE session_id = $1 AND employee_release_id = $2 FOR UPDATE',
        [input.sessionId, input.employeeReleaseId],
      )
      if (owner.rows[0] !== undefined && owner.rows[0].org_id !== input.orgId)
        throw new Error(`work record ${input.sessionId} is outside organization ${input.orgId}`)
      await Promise.all([this.requireSession(input.orgId, input.sessionId), this.requireRelease(input.orgId, input.employeeReleaseId)])
      if (input.teamId !== undefined) await this.teamTarget(database, input.orgId, input.teamId)
      const result = await database.query<WorkRow>(
        'SELECT * FROM dsh_enterprise_work_records WHERE org_id = $1 AND session_id = $2 AND employee_release_id = $3 FOR UPDATE',
        [input.orgId, input.sessionId, input.employeeReleaseId],
      )
      const current = result.rows[0]
      const now = this.now()
      if (current === undefined) {
        if (input.expectedRevision !== 0) throw new Error(`work record ${input.sessionId} revision conflict`)
        const inserted = await database.query<WorkRow>(
          'INSERT INTO dsh_enterprise_work_records(org_id, session_id, employee_release_id, team_id, source, ' +
            'business_state, source_references_json, revision, created_at, updated_at) ' +
            'VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,1,$8,$8) RETURNING *',
          [
            input.orgId,
            input.sessionId,
            input.employeeReleaseId,
            input.teamId ?? null,
            input.source,
            input.businessState,
            JSON.stringify(input.sourceReferences),
            now,
          ],
        )
        const view = this.work(required(inserted.rows[0], 'work record'))
        await this.remember(database, input.orgId, 'work', input.idempotencyKey, input, view)
        return view
      }
      const before = this.work(current)
      assertSourceImmutable(before, input)
      assertBusinessTransition(before.businessState, input.businessState)
      if (before.revision !== input.expectedRevision) throw new Error(`work record ${input.sessionId} revision conflict`)
      const updated = await database.query<WorkRow>(
        'UPDATE dsh_enterprise_work_records SET team_id = $1, business_state = $2, updated_at = $3, ' +
          'revision = revision + 1 WHERE org_id = $4 AND revision = $5 AND session_id = $6 ' +
          'AND employee_release_id = $7 RETURNING *',
        [input.teamId ?? null, input.businessState, now, input.orgId, input.expectedRevision, input.sessionId, input.employeeReleaseId],
      )
      if (updated.rows[0] === undefined) throw new Error(`work record ${input.sessionId} revision conflict`)
      const view = this.work(updated.rows[0])
      await this.remember(database, input.orgId, 'work', input.idempotencyKey, input, view)
      return view
    })
  }
  async getWorkRecord(orgId: string, sessionId: string, employeeReleaseId: string): Promise<WorkRecordView | undefined> {
    await this.initialize()
    const result = await this.database.query<WorkRow>(
      'SELECT * FROM dsh_enterprise_work_records WHERE org_id = $1 AND session_id = $2 AND employee_release_id = $3',
      [orgId, sessionId, employeeReleaseId],
    )
    const row = result.rows[0]
    return row === undefined || row.org_id !== orgId ? undefined : this.work(row)
  }
  async listWorkRecords(input: { orgId: string; businessState?: BusinessState }): Promise<WorkRecordPage> {
    await this.initialize()
    const result = await this.database.query<WorkRow>(
      input.businessState === undefined
        ? 'SELECT * FROM dsh_enterprise_work_records WHERE org_id = $1 ORDER BY updated_at DESC, session_id'
        : 'SELECT * FROM dsh_enterprise_work_records WHERE org_id = $1 AND business_state = $2 ORDER BY updated_at DESC, session_id',
      input.businessState === undefined ? [input.orgId] : [input.orgId, input.businessState],
    )
    return { items: result.rows.map(row => this.work(row)) }
  }
  async createApprovalRequest(input: {
    approvalId: string
    orgId: string
    kind: ApprovalKind
    subjectType: string
    subjectId: string
    requestedBy: string
    idempotencyKey: string
  }): Promise<ApprovalView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `approval:${input.approvalId}`)
      await this.lockIdempotency(database, input.orgId, 'approval-create', input.idempotencyKey)
      const prior = await this.idempotent<ApprovalView>(database, input.orgId, 'approval-create', input.idempotencyKey, input)
      if (prior !== undefined) return prior
      const now = this.now()
      const result = await database.query<ApprovalRow>(
        'INSERT INTO dsh_enterprise_approval_requests(approval_id,org_id,kind,subject_type,subject_id,' +
          "requested_by,state,revision,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'pending',1,$7,$7) RETURNING *",
        [input.approvalId, input.orgId, input.kind, input.subjectType, input.subjectId, input.requestedBy, now],
      )
      const view = this.approval(required(result.rows[0], 'approval request'))
      await this.remember(database, input.orgId, 'approval-create', input.idempotencyKey, input, view)
      return view
    })
  }
  async transitionApproval(input: {
    approvalId: string
    orgId: string
    expectedRevision: number
    idempotencyKey: string
    state: 'approved' | 'rejected'
    reviewerUserId: string
    reason?: string
  }): Promise<ApprovalView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `approval:${input.approvalId}`)
      await this.lockIdempotency(database, input.orgId, 'approval-transition', input.idempotencyKey)
      const prior = await this.idempotent<ApprovalView>(database, input.orgId, 'approval-transition', input.idempotencyKey, input)
      if (prior !== undefined) return prior
      const result = await database.query<ApprovalRow>(
        'SELECT * FROM dsh_enterprise_approval_requests WHERE approval_id = $1 AND org_id = $2 FOR UPDATE',
        [input.approvalId, input.orgId],
      )
      const current = result.rows[0]
      if (current === undefined || current.org_id !== input.orgId) throw new Error('approval request not found')
      if (Number(current.revision) !== input.expectedRevision)
        throw new ApprovalRevisionConflictError(input.approvalId, input.expectedRevision, Number(current.revision))
      if (current.state !== 'pending') throw new Error(`approval ${input.approvalId} is not pending`)
      const updated = await database.query<ApprovalRow>(
        'UPDATE dsh_enterprise_approval_requests SET state=$1, reviewer_user_id=$2, reason=$3, updated_at=$4, ' +
          'revision=revision+1 WHERE approval_id=$5 AND org_id=$6 AND revision=$7 RETURNING *',
        [input.state, input.reviewerUserId, input.reason ?? null, this.now(), input.approvalId, input.orgId, input.expectedRevision],
      )
      if (updated.rows[0] === undefined)
        throw new ApprovalRevisionConflictError(input.approvalId, input.expectedRevision, Number(current.revision))
      const view = this.approval(updated.rows[0])
      await this.remember(database, input.orgId, 'approval-transition', input.idempotencyKey, input, view)
      return view
    })
  }
  async createSchedule(input: {
    scheduleId: string
    orgId: string
    target: ScheduleTarget
    timezone: string
    rule: string
    input: Readonly<Record<string, unknown>>
    nextRunAt: number | null
    expectedRevision: number
    idempotencyKey: string
  }): Promise<ScheduleView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `schedule:${input.scheduleId}`)
      await this.lockIdempotency(database, input.orgId, 'schedule-create', input.idempotencyKey)
      const prior = await this.idempotent<ScheduleView>(database, input.orgId, 'schedule-create', input.idempotencyKey, input)
      if (prior !== undefined) return prior
      if (input.expectedRevision !== 0) throw new Error(`schedule ${input.scheduleId} revision conflict`)
      if (input.target.kind === 'employee') await this.requireRelease(input.orgId, input.target.employeeReleaseId)
      else await this.teamTarget(database, input.orgId, input.target.teamId)
      const now = this.now()
      const result = await database.query<ScheduleRow>(
        'INSERT INTO dsh_enterprise_schedules(schedule_id,org_id,target_json,timezone,rule,input_json,state,' +
          "next_run_at,revision,created_at,updated_at) VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb,'active',$7,1,$8,$8) RETURNING *",
        [
          input.scheduleId,
          input.orgId,
          JSON.stringify(input.target),
          input.timezone,
          input.rule,
          JSON.stringify(input.input),
          input.nextRunAt,
          now,
        ],
      )
      const view = this.schedule(required(result.rows[0], 'schedule'))
      await this.remember(database, input.orgId, 'schedule-create', input.idempotencyKey, input, view)
      return view
    })
  }
  async getSchedule(orgId: string, scheduleId: string): Promise<ScheduleView | undefined> {
    await this.initialize()
    const result = await this.database.query<ScheduleRow>('SELECT * FROM dsh_enterprise_schedules WHERE schedule_id = $1 AND org_id = $2', [
      scheduleId,
      orgId,
    ])
    const row = result.rows[0]
    return row === undefined || row.org_id !== orgId ? undefined : this.schedule(row)
  }
  async listSchedules(orgId: string): Promise<readonly ScheduleView[]> {
    await this.initialize()
    const result = await this.database.query<ScheduleRow>(
      'SELECT * FROM dsh_enterprise_schedules WHERE org_id = $1 ORDER BY updated_at DESC, schedule_id',
      [orgId],
    )
    return result.rows.map(row => this.schedule(row))
  }
  async transitionSchedule(input: {
    orgId: string
    scheduleId: string
    expectedRevision: number
    state: 'active' | 'paused' | 'archived'
    idempotencyKey: string
  }): Promise<ScheduleView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `schedule:${input.scheduleId}`)
      await this.lockIdempotency(database, input.orgId, 'schedule-transition', input.idempotencyKey)
      const prior = await this.idempotent<ScheduleView>(database, input.orgId, 'schedule-transition', input.idempotencyKey, input)
      if (prior !== undefined) return prior
      const current = await database.query<ScheduleRow>(
        'SELECT * FROM dsh_enterprise_schedules WHERE schedule_id = $1 AND org_id = $2 FOR UPDATE',
        [input.scheduleId, input.orgId],
      )
      const row = current.rows[0]
      if (row === undefined) throw new Error('schedule not found')
      if (Number(row.revision) !== input.expectedRevision) throw new Error(`schedule ${input.scheduleId} revision conflict`)
      if (row.state === 'archived' && input.state !== 'archived') throw new Error('archived schedule cannot be resumed')
      const updated = await database.query<ScheduleRow>(
        'UPDATE dsh_enterprise_schedules SET state = $1, updated_at = $2, revision = revision + 1 WHERE schedule_id = $3 AND org_id = $4 AND revision = $5 RETURNING *',
        [input.state, this.now(), input.scheduleId, input.orgId, input.expectedRevision],
      )
      const view = this.schedule(required(updated.rows[0], 'schedule'))
      await this.remember(database, input.orgId, 'schedule-transition', input.idempotencyKey, input, view)
      return view
    })
  }
  async fireSchedule(input: {
    scheduleId: string
    orgId: string
    expectedRevision: number
    idempotencyKey: string
    occurrenceKey: string
    sessionId: string
    firedAt: number
    nextRunAt: number | null
  }): Promise<ScheduleFireView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `schedule:${input.scheduleId}`)
      await this.lockIdempotency(database, input.orgId, 'schedule-fire', input.idempotencyKey)
      const prior = await this.idempotent<ScheduleFireView>(database, input.orgId, 'schedule-fire', input.idempotencyKey, input)
      if (prior !== undefined) return prior
      const occurrence = await database.query<OutboxRow>(
        'SELECT * FROM dsh_enterprise_operation_outbox WHERE schedule_id = $1 AND occurrence_key = $2 AND org_id = $3',
        [input.scheduleId, input.occurrenceKey, input.orgId],
      )
      const existing = occurrence.rows[0]
      if (existing !== undefined) {
        const work = await database.query<WorkRow>(
          'SELECT * FROM dsh_enterprise_work_records WHERE org_id = $1 AND session_id = $2 AND employee_release_id = $3',
          [input.orgId, existing.work_session_id, existing.employee_release_id],
        )
        const view: ScheduleFireView = {
          workRecord: this.work(required(work.rows[0], 'existing schedule work record')),
          command: {
            kind: 'start-session',
            sessionId: existing.work_session_id,
            employeeReleaseId: existing.employee_release_id,
            ...(existing.team_id === null ? {} : { teamId: existing.team_id }),
          },
        }
        await this.remember(database, input.orgId, 'schedule-fire', input.idempotencyKey, input, view)
        return view
      }
      const scheduleResult = await database.query<ScheduleRow>(
        'SELECT * FROM dsh_enterprise_schedules WHERE schedule_id = $1 AND org_id = $2 FOR UPDATE',
        [input.scheduleId, input.orgId],
      )
      const schedule = scheduleResult.rows[0]
      if (schedule === undefined || schedule.org_id !== input.orgId) throw new Error('schedule not found')
      if (schedule.state !== 'active') throw new Error(`schedule ${input.scheduleId} is not active`)
      if (Number(schedule.revision) !== input.expectedRevision) throw new Error(`schedule ${input.scheduleId} revision conflict`)
      const target = scheduleTarget(schedule.target_json)
      const team = target.kind === 'team' ? await this.teamTarget(database, input.orgId, target.teamId) : undefined
      const employeeReleaseId = target.kind === 'employee' ? target.employeeReleaseId : required(team, 'fixed team').leader_release_id
      const teamId = target.kind === 'team' ? target.teamId : undefined
      await this.requireRelease(input.orgId, employeeReleaseId)
      const work = await database.query<WorkRow>(
        'INSERT INTO dsh_enterprise_work_records(org_id, session_id, employee_release_id, team_id, source, ' +
          'business_state, source_references_json, revision, created_at, updated_at) ' +
          'VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,1,$8,$8) RETURNING *',
        [
          input.orgId,
          input.sessionId,
          employeeReleaseId,
          teamId ?? null,
          'schedule',
          'active',
          JSON.stringify({ scheduleId: input.scheduleId, occurrenceKey: input.occurrenceKey }),
          input.firedAt,
        ],
      )
      const outbox = await database.query(
        'INSERT INTO dsh_enterprise_operation_outbox(command_id,org_id,schedule_id,occurrence_key,work_session_id,' +
          "employee_release_id,team_id,payload_json,state,attempt_count,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'pending',0,$9) RETURNING *",
        [
          randomUUID(),
          input.orgId,
          input.scheduleId,
          input.occurrenceKey,
          input.sessionId,
          employeeReleaseId,
          teamId ?? null,
          JSON.stringify({ input: parse(schedule.input_json) }),
          input.firedAt,
        ],
      )
      void outbox
      const updated = await database.query<ScheduleRow>(
        'UPDATE dsh_enterprise_schedules SET last_run_at=$1,next_run_at=$2,updated_at=$1,revision=revision+1 ' +
          'WHERE schedule_id=$3 AND org_id=$4 AND revision=$5 RETURNING *',
        [input.firedAt, input.nextRunAt, input.scheduleId, input.orgId, input.expectedRevision],
      )
      if (updated.rows[0] === undefined) throw new Error(`schedule ${input.scheduleId} revision conflict`)
      const view: ScheduleFireView = {
        workRecord: this.work(required(work.rows[0], 'work record')),
        command: { kind: 'start-session', sessionId: input.sessionId, employeeReleaseId, ...(teamId === undefined ? {} : { teamId }) },
      }
      await this.remember(database, input.orgId, 'schedule-fire', input.idempotencyKey, input, view)
      return view
    })
  }
  /** Claim pending or expired outbox commands using a worker lease (fencing token). */
  async claimOutbox(input: { orgId: string; workerId: string; leaseMs: number; limit?: number }): Promise<readonly OutboxCommandView[]> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      const now = this.now()
      const limit = Math.max(1, Math.min(100, input.limit ?? 10))
      const rows = await database.query<OutboxRow>(
        "SELECT * FROM dsh_enterprise_operation_outbox WHERE org_id = $1 AND (state = 'pending' OR (state = 'processing' AND lease_expires_at IS NOT NULL AND lease_expires_at < $2) OR state = 'failed') ORDER BY created_at, command_id FOR UPDATE SKIP LOCKED LIMIT $3",
        [input.orgId, now, limit],
      )
      const claimed: OutboxCommandView[] = []
      for (const row of rows.rows) {
        const result = await database.query<OutboxRow>(
          "UPDATE dsh_enterprise_operation_outbox SET state = 'processing', lease_owner = $1, lease_expires_at = $2, attempt_count = attempt_count + 1, last_error = NULL WHERE command_id = $3 RETURNING *",
          [input.workerId, now + input.leaseMs, row.command_id],
        )
        if (result.rows[0] !== undefined) claimed.push(this.outbox(result.rows[0]))
      }
      return claimed
    })
  }
  async completeOutbox(input: { orgId: string; commandId: string; workerId: string }): Promise<OutboxCommandView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      const result = await database.query<OutboxRow>(
        "UPDATE dsh_enterprise_operation_outbox SET state = 'completed', lease_owner = NULL, lease_expires_at = NULL, completed_at = $1 WHERE command_id = $2 AND org_id = $3 AND state = 'processing' AND lease_owner = $4 RETURNING *",
        [this.now(), input.commandId, input.orgId, input.workerId],
      )
      return this.outbox(required(result.rows[0], 'outbox command'))
    })
  }
  async failOutbox(input: {
    orgId: string
    commandId: string
    workerId: string
    error: string
    retryable: boolean
  }): Promise<OutboxCommandView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      const state: OutboxState = input.retryable ? 'pending' : 'failed'
      const result = await database.query<OutboxRow>(
        "UPDATE dsh_enterprise_operation_outbox SET state = $1, lease_owner = NULL, lease_expires_at = NULL, last_error = $2 WHERE command_id = $3 AND org_id = $4 AND state = 'processing' AND lease_owner = $5 RETURNING *",
        [state, input.error.slice(0, 2000), input.commandId, input.orgId, input.workerId],
      )
      return this.outbox(required(result.rows[0], 'outbox command'))
    })
  }
  async createFixedTeam(input: {
    teamId: string
    orgId: string
    leaderEmployeeReleaseId: string
    members: readonly { employeeReleaseId: string; role: string }[]
    workflowTemplate: Readonly<Record<string, unknown>>
    approvalPolicy: Readonly<Record<string, unknown>>
    expectedRevision: number
    idempotencyKey: string
  }): Promise<FixedTeamView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `team:${input.teamId}`)
      await this.lockIdempotency(database, input.orgId, 'team-create', input.idempotencyKey)
      const prior = await this.idempotent<FixedTeamView>(database, input.orgId, 'team-create', input.idempotencyKey, input)
      if (prior !== undefined) return prior
      if (input.expectedRevision !== 0) throw new Error(`fixed team ${input.teamId} revision conflict`)
      await Promise.all([
        this.requireRelease(input.orgId, input.leaderEmployeeReleaseId),
        ...input.members.map(member => this.requireRelease(input.orgId, member.employeeReleaseId)),
      ])
      const now = this.now()
      const result = await database.query<TeamRow>(
        'INSERT INTO dsh_enterprise_fixed_teams(team_id,org_id,leader_release_id,workflow_template_json,' +
          'approval_policy_json,revision,created_at,updated_at) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,1,$6,$6) RETURNING *',
        [
          input.teamId,
          input.orgId,
          input.leaderEmployeeReleaseId,
          JSON.stringify(input.workflowTemplate),
          JSON.stringify(input.approvalPolicy),
          now,
        ],
      )
      for (const member of input.members)
        await database.query('INSERT INTO dsh_enterprise_fixed_team_members(team_id,employee_release_id,role) VALUES ($1,$2,$3)', [
          input.teamId,
          member.employeeReleaseId,
          member.role,
        ])
      const view = this.team(required(result.rows[0], 'fixed team'), input.members)
      await this.remember(database, input.orgId, 'team-create', input.idempotencyKey, input, view)
      return view
    })
  }
  private work(row: WorkRow): WorkRecordView {
    return {
      orgId: row.org_id,
      sessionId: row.session_id,
      employeeReleaseId: row.employee_release_id,
      ...(row.team_id === null ? {} : { teamId: row.team_id }),
      source: row.source,
      businessState: row.business_state,
      sourceReferences: record(row.source_references_json),
      revision: Number(row.revision),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }
  private approval(row: ApprovalRow): ApprovalView {
    return {
      approvalId: row.approval_id,
      orgId: row.org_id,
      kind: row.kind,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      requestedBy: row.requested_by,
      state: row.state,
      ...(row.reviewer_user_id === null ? {} : { reviewerUserId: row.reviewer_user_id }),
      ...(row.reason === null ? {} : { reason: row.reason }),
      revision: Number(row.revision),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }
  private schedule(row: ScheduleRow): ScheduleView {
    return {
      scheduleId: row.schedule_id,
      orgId: row.org_id,
      target: scheduleTarget(row.target_json),
      timezone: row.timezone,
      rule: row.rule,
      input: record(row.input_json),
      state: row.state,
      nextRunAt: row.next_run_at === null ? null : Number(row.next_run_at),
      lastRunAt: row.last_run_at === null ? null : Number(row.last_run_at),
      revision: Number(row.revision),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }
  private outbox(row: OutboxRow): OutboxCommandView {
    return {
      commandId: row.command_id,
      orgId: row.org_id,
      scheduleId: row.schedule_id,
      occurrenceKey: row.occurrence_key,
      workSessionId: row.work_session_id,
      employeeReleaseId: row.employee_release_id,
      ...(row.team_id === null ? {} : { teamId: row.team_id }),
      payload: record(row.payload_json),
      state: row.state,
      attemptCount: Number(row.attempt_count),
      ...(row.lease_owner === null ? {} : { leaseOwner: row.lease_owner }),
      ...(row.lease_expires_at === null ? {} : { leaseExpiresAt: Number(row.lease_expires_at) }),
      ...(row.last_error === null ? {} : { lastError: row.last_error }),
      ...(row.completed_at === null ? {} : { completedAt: Number(row.completed_at) }),
      createdAt: Number(row.created_at),
    }
  }
  private team(row: TeamRow, members: readonly { employeeReleaseId: string; role: string }[]): FixedTeamView {
    return {
      teamId: row.team_id,
      orgId: row.org_id,
      leaderEmployeeReleaseId: row.leader_release_id,
      members,
      workflowTemplate: record(row.workflow_template_json),
      approvalPolicy: record(row.approval_policy_json),
      revision: Number(row.revision),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }
}
