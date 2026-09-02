/* eslint-disable typescript/no-base-to-string -- the SQL double stringifies repository parameter primitives. */
import { describe, expect, it } from 'vitest'
import {
  ApprovalRevisionConflictError,
  EnterpriseOperationsRepository,
  EnterpriseOperationsService,
  EnterpriseOperationsWorker,
  migrateEnterpriseOperations,
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

interface TeamDefinitionRow {
  org_id: string
  team_id: string
  name: string
  north_star: string
  owner_user_id: string
  department_id: string | null
  visibility: string
  allowed_user_ids_json: unknown | null
  leader_release_id: string
  roster_json: unknown
  roles_json: unknown
  verification_policy_json: unknown
  attention_policy_json: unknown
  approval_policy_json: unknown
  state: string
  revision: number
  created_at: number
  updated_at: number
}

interface OutboxRow {
  command_id: string
  org_id: string
  schedule_id: string
  occurrence_key: string
  work_session_id: string
  employee_release_id: string
  team_id: string | null
  payload_json: unknown
  state: string
  attempt_count: number
  lease_owner: string | null
  lease_expires_at: number | null
  last_error: string | null
  completed_at: number | null
  start_admitted_at: number | null
  team_definition_revision: number | null
  created_at: number
}

interface ChannelConfigurationRow {
  org_id: string
  channel_id: string
  name: string
  provider: string
  tenant_id: string | null
  account_id: string
  credential_ref: string | null
  default_employee_release_id: string | null
  inbound_enabled: boolean
  state: string
  binding_status: string
  bound_provider_identity_id: string | null
  bound_provider_identity_name: string | null
  verified_tenant_id: string | null
  binding_verified_by: string | null
  binding_verified_at: number | null
  created_by: string
  revision: number
  created_at: number
  updated_at: number
}

/** Transactional in-memory PostgreSQL double for the operations repository. */
class MemoryPostgresDatabase implements PostgresDatabase {
  private readonly meta = new Map<string, string>()
  private readonly workRecords = new Map<string, WorkRecordRow>()
  private readonly approvals = new Map<string, ApprovalRow>()
  private readonly schedules = new Map<string, ScheduleRow>()
  private readonly teams = new Map<string, TeamRow>()
  private readonly members = new Map<string, TeamMemberRow>()
  private readonly teamDefinitions = new Map<string, TeamDefinitionRow>()
  private readonly channels = new Map<string, ChannelConfigurationRow>()
  private readonly outbox = new Map<string, OutboxRow>()
  private readonly idempotency = new Map<string, unknown>()
  private tail = Promise.resolve()
  failNextOutboxInsert = false

  constructor(schemaVersion?: number) {
    if (schemaVersion !== undefined) this.meta.set('schema-version', String(schemaVersion))
  }

  get schemaVersion(): string | undefined {
    return this.meta.get('schema-version')
  }

  setScheduleState(scheduleId: string, state: string): void {
    const row = this.schedules.get(scheduleId)
    if (row !== undefined) row.state = state
  }

  seedOutbox(input: {
    commandId: string
    orgId: string
    teamId: string
    state: 'pending' | 'processing' | 'failed' | 'dead-letter'
    workerId?: string
    leaseExpiresAt?: number
    teamDefinitionRevision?: number
  }): void {
    this.outbox.set(input.commandId, {
      command_id: input.commandId, org_id: input.orgId, schedule_id: 'seeded', occurrence_key: input.commandId,
      work_session_id: `session-${input.commandId}`, employee_release_id: 'release-a', team_id: input.teamId,
      payload_json: {}, state: input.state, attempt_count: 1, lease_owner: input.workerId ?? null,
      lease_expires_at: input.leaseExpiresAt ?? null, last_error: null, completed_at: null,
      start_admitted_at: null, created_at: 1,
      team_definition_revision: input.teamDefinitionRevision ?? null,
    })
  }

  expireOutbox(commandId: string, at: number): void {
    const row = this.outbox.get(commandId)
    if (row !== undefined) row.lease_expires_at = at
  }

  outboxState(commandId: string): string | undefined { return this.outbox.get(commandId)?.state }
  outboxLease(commandId: string): { owner: string | null; expiresAt: number | null; admittedAt: number | null } | undefined {
    const row = this.outbox.get(commandId)
    return row === undefined ? undefined : {
      owner: row.lease_owner, expiresAt: row.lease_expires_at, admittedAt: row.start_admitted_at,
    }
  }

  async transaction<T>(operation: (database: MemoryPostgresDatabase) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const checkpoint = structuredClone({
        meta: this.meta,
        workRecords: this.workRecords,
        approvals: this.approvals,
        schedules: this.schedules,
        teams: this.teams,
        members: this.members,
        teamDefinitions: this.teamDefinitions,
        channels: this.channels,
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
    if (text.startsWith('CREATE ') || text.startsWith('ALTER ') || text.startsWith('SELECT pg_advisory_xact_lock')) return []
    if (text.startsWith('UPDATE dsh_enterprise_team_runs')) return []
    if (text.startsWith('SELECT value FROM dsh_enterprise_operations_meta')) {
      const value = this.meta.get('schema-version')
      return value === undefined ? [] : [{ value }]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_operations_meta')) {
      this.meta.set('schema-version', String(values[0]))
      return []
    }
    if (text.startsWith('UPDATE dsh_enterprise_operations_meta')) {
      this.meta.set('schema-version', String(values[0]))
      return []
    }
    if (text.startsWith("UPDATE dsh_enterprise_operation_outbox SET state='dead-letter'")) {
      for (const row of this.outbox.values()) {
        if (row.team_id === null || row.team_definition_revision !== null
          || !['pending', 'processing', 'failed'].includes(row.state)) continue
        row.state = 'dead-letter'; row.lease_owner = null; row.lease_expires_at = null
        row.start_admitted_at = null; row.last_error = 'legacy team command has no definition revision'
      }
      return []
    }
    if (text.startsWith('UPDATE dsh_enterprise_operation_outbox SET state') && !text.includes('RETURNING')) return []
    if (text.startsWith('UPDATE dsh_enterprise_operations_idempotency SET result_json')) {
      for (const [key, value] of this.idempotency) {
        if (typeof value === 'object' && value !== null && 'result' in value) continue
        this.idempotency.set(key, { requestDigest: '', result: value })
      }
      return []
    }
    if (text.startsWith('SELECT result_json FROM dsh_enterprise_operations_idempotency')) {
      const value = this.idempotency.get(`${String(values[0])}:${String(values[1])}:${String(values[2])}`)
      return value === undefined ? [] : [{ result_json: clone(value) }]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_operations_idempotency')) {
      const key = `${String(values[0])}:${String(values[1])}:${String(values[2])}`
      if (this.idempotency.has(key)) throw new Error('duplicate idempotency key')
      this.idempotency.set(key, parse(values[3]))
      return []
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_team_definitions') && text.includes('SELECT fixed.org_id')) {
      for (const fixed of this.teams.values()) {
        const key = `${fixed.org_id}:${fixed.team_id}`
        if (this.teamDefinitions.has(key)) continue
        const members = [...this.members.values()]
          .filter(member => member.team_id === fixed.team_id)
          .sort((left, right) => left.employee_release_id.localeCompare(right.employee_release_id))
        const roles = [...new Set(members.map(member => member.role))].sort()
        this.teamDefinitions.set(key, {
          org_id: fixed.org_id, team_id: fixed.team_id, name: '', north_star: '', owner_user_id: String(values[0]),
          department_id: null, visibility: 'organization', allowed_user_ids_json: null,
          leader_release_id: fixed.leader_release_id,
          roster_json: members.map(member => ({
            actor: { kind: 'agent', employeeReleaseId: member.employee_release_id }, roleId: member.role,
          })),
          roles_json: roles.map(role => ({ roleId: role, name: role, responsibility: '' })),
          verification_policy_json: {}, attention_policy_json: {}, approval_policy_json: clone(fixed.approval_policy_json),
          state: 'needs-charter', revision: 1, created_at: fixed.created_at, updated_at: fixed.updated_at,
        })
      }
      return []
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_team_definitions')) {
      if (text.includes('ORDER BY created_at')) {
        const administrator = Boolean(values[1]); const userId = String(values[2])
        let rows = [...this.teamDefinitions.values()].filter(row => row.org_id === String(values[0]))
          .filter(row => administrator || row.visibility === 'organization' || row.owner_user_id === userId
            || (row.visibility === 'restricted' && Array.isArray(row.allowed_user_ids_json)
              && row.allowed_user_ids_json.includes(userId)))
        if (text.includes('(created_at,team_id)<')) {
          const createdAt = Number(values[3]); const teamId = String(values[4])
          rows = rows.filter(row => row.created_at < createdAt || (row.created_at === createdAt && row.team_id < teamId))
        }
        return rows.sort((left, right) => right.created_at - left.created_at || right.team_id.localeCompare(left.team_id))
          .slice(0, Number(values.at(-1))).map(clone)
      }
      const row = values.length === 1
        ? [...this.teamDefinitions.values()].find(candidate => candidate.team_id === String(values[0]))
        : this.teamDefinitions.get(`${String(values[0])}:${String(values[1])}`)
      if (row === undefined) return []
      if (values[2] !== undefined) {
        const administrator = Boolean(values[2]); const userId = String(values[3])
        const visible = administrator || row.visibility === 'organization' || row.owner_user_id === userId
          || (row.visibility === 'restricted' && Array.isArray(row.allowed_user_ids_json)
            && row.allowed_user_ids_json.includes(userId))
        if (!visible) return []
      }
      return [clone(row)]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_team_definitions')) {
      const row: TeamDefinitionRow = {
        org_id: String(values[0]), team_id: String(values[1]), name: String(values[2]), north_star: String(values[3]),
        owner_user_id: String(values[4]), department_id: values[5] === null ? null : String(values[5]),
        visibility: String(values[6]), allowed_user_ids_json: values[7] === null ? null : parse(values[7]),
        leader_release_id: String(values[8]), roster_json: parse(values[9]), roles_json: parse(values[10]),
        verification_policy_json: parse(values[11]), attention_policy_json: parse(values[12]),
        approval_policy_json: parse(values[13]), state: String(values[14]), revision: 1,
        created_at: Number(values[15]), updated_at: Number(values[15]),
      }
      this.teamDefinitions.set(`${row.org_id}:${row.team_id}`, row)
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_team_definitions SET') && text.includes('name=$1')) {
      const row = this.teamDefinitions.get(`${String(values[14])}:${String(values[15])}`)
      if (row === undefined || row.revision !== Number(values[16])) return []
      row.name = String(values[0]); row.north_star = String(values[1]); row.owner_user_id = String(values[2])
      row.department_id = values[3] === null ? null : String(values[3]); row.visibility = String(values[4])
      row.allowed_user_ids_json = values[5] === null ? null : parse(values[5]); row.leader_release_id = String(values[6])
      row.roster_json = parse(values[7]); row.roles_json = parse(values[8]); row.verification_policy_json = parse(values[9])
      row.attention_policy_json = parse(values[10]); row.approval_policy_json = parse(values[11]); row.state = String(values[12])
      row.updated_at = Number(values[13]); row.revision += 1
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_team_definitions SET leader_release_id=')) {
      const row = this.teamDefinitions.get(`${String(values[5])}:${String(values[6])}`)
      if (row === undefined || row.state !== 'needs-charter') return []
      row.leader_release_id = String(values[0]); row.roster_json = parse(values[1]); row.roles_json = parse(values[2])
      row.approval_policy_json = parse(values[3]); row.updated_at = Number(values[4]); row.revision += 1
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_team_definitions SET state=')) {
      const row = this.teamDefinitions.get(`${String(values[1])}:${String(values[2])}`)
      if (row === undefined || row.revision !== Number(values[3]) || row.state === 'archived') return []
      row.state = 'archived'; row.updated_at = Number(values[0]); row.revision += 1
      return [clone(row)]
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_work_records')) {
      if (text.includes('WHERE org_id = $1') && text.includes('session_id = $2')) {
        const row = this.workRecords.get(`${String(values[0])}:${String(values[1])}:${String(values[2])}`)
        return row === undefined ? [] : [clone(row)]
      }
      if (text.includes('WHERE session_id = $1')) {
        const row = [...this.workRecords.values()].find(
          candidate => candidate.session_id === String(values[0]) && candidate.employee_release_id === String(values[1]),
        )
        return row === undefined ? [] : [clone(row)]
      }
      let index = 1
      const businessState = text.includes('business_state = $') ? String(values[index++]) : undefined
      const source = text.includes('source = $') ? String(values[index++]) : undefined
      const teamId = text.includes('team_id = $') ? String(values[index++]) : undefined
      const cursorCreatedAt = text.includes('(created_at, session_id, employee_release_id) <') ? Number(values[index++]) : undefined
      const cursorSessionId = cursorCreatedAt === undefined ? undefined : String(values[index++])
      const cursorReleaseId = cursorCreatedAt === undefined ? undefined : String(values[index++])
      return [...this.workRecords.values()]
        .filter(row => row.org_id === String(values[0]))
        .filter(row => businessState === undefined || row.business_state === businessState)
        .filter(row => source === undefined || row.source === source)
        .filter(row => teamId === undefined || row.team_id === teamId)
        .filter(row => cursorCreatedAt === undefined || row.created_at < cursorCreatedAt
          || (row.created_at === cursorCreatedAt && row.session_id < (cursorSessionId as string))
          || (row.created_at === cursorCreatedAt && row.session_id === cursorSessionId
            && row.employee_release_id < (cursorReleaseId as string)))
        .sort((left, right) => right.created_at - left.created_at
          || right.session_id.localeCompare(left.session_id)
          || right.employee_release_id.localeCompare(left.employee_release_id))
        .slice(0, Number(values.at(-1))).map(clone)
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
      this.workRecords.set(`${row.org_id}:${row.session_id}:${row.employee_release_id}`, row)
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_work_records')) {
      const row = this.workRecords.get(`${String(values[3])}:${String(values.at(-2))}:${String(values.at(-1))}`)
      if (row === undefined) return []
      row.team_id = values[0] === null ? null : String(values[0])
      row.business_state = String(values[1])
      row.revision += 1
      row.updated_at = Number(values[2])
      return [clone(row)]
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_approval_requests')) {
      if (text.includes('ORDER BY created_at')) {
        let index = 1
        const kind = text.includes('kind = $') ? String(values[index++]) : undefined
        const state = text.includes('state = $') ? String(values[index++]) : undefined
        const requestedBy = text.includes('requested_by = $') ? String(values[index++]) : undefined
        const cursorCreatedAt = text.includes('(created_at, approval_id) <') ? Number(values[index++]) : undefined
        const cursorId = cursorCreatedAt === undefined ? undefined : String(values[index++])
        const limit = Number(values.at(-1))
        return [...this.approvals.values()]
          .filter(row => row.org_id === String(values[0]))
          .filter(row => kind === undefined || row.kind === kind)
          .filter(row => state === undefined || row.state === state)
          .filter(row => requestedBy === undefined || row.requested_by === requestedBy)
          .filter(row => cursorCreatedAt === undefined || row.created_at < cursorCreatedAt
            || (row.created_at === cursorCreatedAt && row.approval_id < (cursorId as string)))
          .sort((left, right) => right.created_at - left.created_at || right.approval_id.localeCompare(left.approval_id))
          .slice(0, limit).map(clone)
      }
      const row = this.approvals.get(String(values[0]))
      return row === undefined || row.org_id !== String(values[1]) ? [] : [clone(row)]
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
      if (text.includes('ORDER BY created_at')) {
        return [...this.schedules.values()].filter(row => row.org_id === String(values[0]))
          .filter(row => !text.includes('state = $') || row.state === String(values[1]))
          .sort((left, right) => right.created_at - left.created_at || right.schedule_id.localeCompare(left.schedule_id))
          .slice(0, Number(values.at(-1))).map(clone)
      }
      const row = this.schedules.get(String(values[0]))
      return row === undefined || row.org_id !== String(values[1]) ? [] : [clone(row)]
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
    if (text.startsWith('UPDATE dsh_enterprise_schedules SET target_json')) {
      const row = this.schedules.get(String(values[6]))
      if (row === undefined || row.org_id !== String(values[7]) || row.revision !== Number(values[8])) return []
      row.target_json = parse(values[0]); row.timezone = String(values[1]); row.rule = String(values[2])
      row.input_json = parse(values[3]); row.next_run_at = values[4] as number | null
      row.updated_at = Number(values[5]); row.revision += 1
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_schedules SET state =')) {
      const row = this.schedules.get(String(values[2]))
      if (row === undefined || row.org_id !== String(values[3]) || row.revision !== Number(values[4])) return []
      row.state = String(values[0]); row.updated_at = Number(values[1]); row.revision += 1
      return [clone(row)]
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_operation_outbox')) {
      if (text.includes('start_admitted_at IS NOT NULL')) {
        return [...this.outbox.values()].some(row => row.org_id === String(values[0]) && row.team_id === String(values[1])
          && row.state === 'processing' && row.start_admitted_at !== null
          && row.lease_expires_at !== null && row.lease_expires_at >= Number(values[2])) ? [{ '?column?': 1 }] : []
      }
      if (text.includes('command_id=$1')) {
        const row = this.outbox.get(String(values[0]))
        return row === undefined || row.org_id !== String(values[1]) ? [] : [clone(row)]
      }
      if (text.includes('ORDER BY created_at, command_id')) {
        return [...this.outbox.values()].filter(row => row.org_id === String(values[0])
          && (row.state === 'pending' || row.state === 'failed'
            || (row.state === 'processing' && row.lease_expires_at !== null
              && row.lease_expires_at < Number(values[1]))))
          .slice(0, Number(values[2])).map(clone)
      }
      const row = [...this.outbox.values()].find(
        candidate =>
          candidate.schedule_id === String(values[0]) &&
          candidate.occurrence_key === String(values[1]) &&
          candidate.org_id === String(values[2]),
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
        team_id: values[6] === null ? null : String(values[6]),
        payload_json: parse(values[8]),
        state: 'pending',
        attempt_count: 0,
        lease_owner: null,
        lease_expires_at: null,
        last_error: null,
        completed_at: null,
        start_admitted_at: null,
        team_definition_revision: values[7] === undefined || values[7] === null ? null : Number(values[7]),
        created_at: Number(values[9]),
      }
      this.outbox.set(row.command_id, row)
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_operation_outbox SET start_admitted_at')) {
      const row = this.outbox.get(String(values[1]))
      if (row === undefined || row.org_id !== String(values[2]) || row.state !== 'processing'
        || row.lease_owner !== String(values[3]) || row.lease_expires_at === null
        || row.lease_expires_at < Number(values[0])) return []
      row.start_admitted_at = Number(values[0])
      return [clone(row)]
    }
    if (text.startsWith("UPDATE dsh_enterprise_operation_outbox SET state = 'processing'")) {
      const row = this.outbox.get(String(values[2]))
      if (row === undefined) return []
      row.state = 'processing'; row.lease_owner = String(values[0]); row.lease_expires_at = Number(values[1])
      row.attempt_count += 1; row.last_error = null; row.start_admitted_at = null
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_operation_outbox SET state = $1')) {
      const row = this.outbox.get(String(values[2]))
      if (row === undefined || row.org_id !== String(values[3]) || row.state !== 'processing'
        || row.lease_owner !== String(values[4])) return []
      row.state = String(values[0]); row.lease_owner = null; row.lease_expires_at = null
      row.start_admitted_at = null; row.last_error = String(values[1])
      return [clone(row)]
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_fixed_teams')) {
      if (text.includes('ORDER BY created_at')) {
        return [...this.teams.values()].filter(row => row.org_id === String(values[0]))
          .sort((left, right) => right.created_at - left.created_at || right.team_id.localeCompare(left.team_id))
          .slice(0, Number(values.at(-1))).map(clone)
      }
      const row = this.teams.get(String(values[0]))
      return row === undefined || (values[1] !== undefined && row.org_id !== String(values[1])) ? [] : [clone(row)]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_fixed_teams')) {
      if (text.includes("'{}'::jsonb")) {
        const row: TeamRow = {
          team_id: String(values[0]), org_id: String(values[1]), leader_release_id: String(values[2]),
          workflow_template_json: {}, approval_policy_json: parse(values[3]), revision: 1,
          created_at: Number(values[4]), updated_at: Number(values[4]),
        }
        this.teams.set(row.team_id, row)
        return [clone(row)]
      }
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
    if (text.startsWith('UPDATE dsh_enterprise_fixed_teams SET leader_release_id=$1,approval_policy_json')) {
      const row = this.teams.get(String(values[3]))
      if (row === undefined || row.org_id !== String(values[4])) return []
      row.leader_release_id = String(values[0]); row.approval_policy_json = parse(values[1])
      row.updated_at = Number(values[2]); row.revision += 1
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_fixed_teams SET leader_release_id')) {
      const row = this.teams.get(String(values[4]))
      if (row === undefined || row.org_id !== String(values[5]) || row.revision !== Number(values[6])) return []
      row.leader_release_id = String(values[0]); row.workflow_template_json = parse(values[1])
      row.approval_policy_json = parse(values[2]); row.updated_at = Number(values[3]); row.revision += 1
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_fixed_teams SET workflow_template_json')) {
      const row = this.teams.get(String(values[2]))
      if (row === undefined || row.org_id !== String(values[3]) || row.revision !== Number(values[4])) return []
      row.workflow_template_json = parse(values[0]); row.updated_at = Number(values[1]); row.revision += 1
      return [clone(row)]
    }
    if (text.startsWith('DELETE FROM dsh_enterprise_fixed_team_members')) {
      for (const [key, row] of this.members) if (row.team_id === String(values[0])) this.members.delete(key)
      return []
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_fixed_team_members')) {
      const row: TeamMemberRow = { team_id: String(values[0]), employee_release_id: String(values[1]), role: String(values[2]) }
      this.members.set(`${row.team_id}:${row.employee_release_id}`, row)
      return []
    }
    if (text.startsWith('SELECT employee_release_id, role FROM dsh_enterprise_fixed_team_members')) {
      return [...this.members.values()].filter(row => row.team_id === String(values[0])).map(clone)
    }
    if (text.startsWith('SELECT * FROM dsh_enterprise_channel_configurations WHERE org_id=$1 AND channel_id=$2')) {
      const row = this.channels.get(`${String(values[0])}:${String(values[1])}`)
      return row === undefined ? [] : [clone(row)]
    }
    if (text.startsWith('SELECT * FROM dsh_enterprise_channel_configurations WHERE org_id=$1 ORDER BY')) {
      return [...this.channels.values()].filter(row => row.org_id === String(values[0]))
        .sort((left, right) => right.created_at - left.created_at || right.channel_id.localeCompare(left.channel_id))
        .map(clone)
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_channel_configurations')) {
      const row: ChannelConfigurationRow = {
        org_id: String(values[0]), channel_id: String(values[1]), name: String(values[2]),
        provider: String(values[3]), tenant_id: values[4] === null ? null : String(values[4]),
        account_id: String(values[5]), credential_ref: values[6] === null ? null : String(values[6]),
        default_employee_release_id: values[7] === null ? null : String(values[7]),
        inbound_enabled: Boolean(values[8]), state: String(values[9]), created_by: String(values[10]),
        binding_status: 'unbound', bound_provider_identity_id: null, bound_provider_identity_name: null,
        verified_tenant_id: null, binding_verified_by: null, binding_verified_at: null,
        revision: 1, created_at: Number(values[11]), updated_at: Number(values[11]),
      }
      const key = `${row.org_id}:${row.channel_id}`
      if (this.channels.has(key)) return []
      this.channels.set(key, row)
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_channel_configurations SET\n            name=')) {
      const key = `${String(values[10])}:${String(values[11])}`
      const row = this.channels.get(key)
      if (row === undefined || row.revision !== Number(values[12])) return []
      row.name = String(values[0]); row.provider = String(values[1])
      row.tenant_id = values[2] === null ? null : String(values[2]); row.account_id = String(values[3])
      row.credential_ref = values[4] === null ? null : String(values[4])
      row.default_employee_release_id = values[5] === null ? null : String(values[5])
      row.inbound_enabled = Boolean(values[6]); row.state = String(values[7]); row.updated_at = Number(values[9])
      if (Boolean(values[8])) {
        row.binding_status = 'unbound'; row.bound_provider_identity_id = null
        row.bound_provider_identity_name = null; row.verified_tenant_id = null
        row.binding_verified_by = null; row.binding_verified_at = null
      }
      row.revision += 1
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_channel_configurations SET binding_status=')) {
      const key = `${String(values[5])}:${String(values[6])}`
      const row = this.channels.get(key)
      if (row === undefined || row.revision !== Number(values[7]) || row.state === 'archived') return []
      row.binding_status = 'verified'; row.bound_provider_identity_id = String(values[0])
      row.bound_provider_identity_name = values[1] === null ? null : String(values[1])
      row.verified_tenant_id = values[2] === null ? null : String(values[2])
      row.binding_verified_by = String(values[3]); row.binding_verified_at = Number(values[4])
      row.updated_at = Number(values[4]); row.revision += 1
      return [clone(row)]
    }
    if (text.startsWith("UPDATE dsh_enterprise_channel_configurations SET state='archived'")) {
      const key = `${String(values[1])}:${String(values[2])}`
      const row = this.channels.get(key)
      if (row === undefined || row.revision !== Number(values[3]) || row.state === 'archived') return []
      row.state = 'archived'; row.updated_at = Number(values[0]); row.revision += 1
      return [clone(row)]
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
    teamDefinitions: Map<string, TeamDefinitionRow>
    channels: Map<string, ChannelConfigurationRow>
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
      [this.teamDefinitions, snapshot.teamDefinitions],
      [this.channels, snapshot.channels],
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

const references = {
  resolveSession: async (_database: PostgresDatabase, orgId: string, sessionId: string) =>
    orgId === 'org-a' && !sessionId.startsWith('missing'),
  resolveRelease: async (_database: PostgresDatabase, orgId: string, releaseId: string) =>
    orgId === 'org-a' && !releaseId.startsWith('missing'),
  resolveUser: async (_database: PostgresDatabase, orgId: string, userId: string) =>
    orgId === 'org-a' && !userId.startsWith('missing'),
  resolveDepartment: async (_database: PostgresDatabase, orgId: string, departmentId: string) =>
    orgId === 'org-a' && !departmentId.startsWith('missing'),
}

function repository(database = new MemoryPostgresDatabase(), now?: () => number): EnterpriseOperationsRepository {
  return new EnterpriseOperationsRepository(database, {
    ...references,
    cursorSigningKey: Buffer.from('operations-cursor-signing-key-32b!'),
    ...(now === undefined ? {} : { now }),
  })
}

describe('EnterpriseOperationsRepository', () => {
  it('rejects cursor signing keys shorter than 32 bytes', () => {
    expect(() => new EnterpriseOperationsRepository(new MemoryPostgresDatabase(), {
      ...references, cursorSigningKey: 'short',
    })).toThrow('at least 32 bytes')
  })

  it('migrates an existing schema version one database to the latest version', async () => {
    const database = new MemoryPostgresDatabase(1)
    const operations = new EnterpriseOperationsRepository(database)

    await operations.createApprovalRequest({
      approvalId: 'approval-migration',
      orgId: 'org-a',
      kind: 'publish',
      subjectType: 'employee-release',
      subjectId: 'release-a',
      requestedBy: 'owner-a',
      idempotencyKey: 'approval-migration-create',
    })

    expect(database.schemaVersion).toBe('14')
  })

  it('permits unverified local writes only through explicit configuration', async () => {
    const operations = new EnterpriseOperationsRepository(new MemoryPostgresDatabase(), { allowUnverifiedReferences: true })

    await expect(operations.upsertWorkRecord(work)).resolves.toMatchObject({ sessionId: 'session-a' })
    await expect(new EnterpriseOperationsRepository(new MemoryPostgresDatabase()).upsertWorkRecord(work))
      .rejects.toThrow('native session resolver is required')
  })

  it('keeps native session source references immutable while projecting one work record', async () => {
    const operations = repository(new MemoryPostgresDatabase(), () => 100)
    const created = await operations.upsertWorkRecord(work)
    const retried = await operations.upsertWorkRecord(work)

    expect(retried).toEqual(created)
    await expect(operations.upsertWorkRecord({ ...work, businessState: 'completed' }))
      .rejects.toMatchObject({ code: 'idempotency-conflict', resourceType: 'work-record' })
    await expect(
      operations.upsertWorkRecord({
        ...work,
        expectedRevision: 1,
        idempotencyKey: 'work-mutate-source',
        sourceReferences: { nativeSessionId: 'other' },
      }),
    ).rejects.toMatchObject({ code: 'immutable-source', resourceType: 'work-record' })
  })

  it('allows one pending approval transition and rejects a concurrent stale reviewer', async () => {
    const operations = repository()
    await operations.createApprovalRequest({
      approvalId: 'approval-a',
      orgId: 'org-a',
      kind: 'publish',
      subjectType: 'employee-release',
      subjectId: 'release-a',
      requestedBy: 'owner-a',
      idempotencyKey: 'approval-create',
    })
    const settled = await Promise.allSettled([
      operations.transitionApproval({
        approvalId: 'approval-a',
        orgId: 'org-a',
        expectedRevision: 1,
        idempotencyKey: 'approve-a',
        state: 'approved',
        reviewerUserId: 'reviewer-a',
      }),
      operations.transitionApproval({
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
    const operations = repository(new MemoryPostgresDatabase(), () => 200)
    await operations.createSchedule({
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
    const [first, second] = await Promise.all([operations.fireSchedule(fire), operations.fireSchedule(fire)])
    const replayedOccurrence = await operations.fireSchedule({
      ...fire,
      expectedRevision: 0,
      idempotencyKey: 'fire-a-fresh-key',
      sessionId: 'missing-session-is-ignored-for-an-existing-occurrence',
    })

    expect(second).toEqual(first)
    expect(replayedOccurrence).toEqual(first)
    expect(first.workRecord.source).toBe('schedule')
    expect(first.command.kind).toBe('start-session')
    expect((await operations.listWorkRecords({ orgId: 'org-a' })).items).toHaveLength(1)
  })

  it('does not reveal or mutate records outside the requested organization', async () => {
    const operations = repository()
    await operations.upsertWorkRecord(work)

    await expect(operations.getWorkRecord('org-b', 'session-a', 'release-a')).resolves.toBeUndefined()
    await expect(operations.upsertWorkRecord({ ...work, orgId: 'org-b', expectedRevision: 0, idempotencyKey: 'org-b' }))
      .rejects.toMatchObject({ code: 'not-found', resourceType: 'work-record' })
  })

  it('rolls back schedule state and work record when outbox creation fails', async () => {
    const database = new MemoryPostgresDatabase()
    const operations = repository(database)
    await operations.createSchedule({
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
      operations.fireSchedule({
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
    await expect(operations.getWorkRecord('org-a', 'session-b', 'release-a')).resolves.toBeUndefined()
    await expect(operations.getSchedule('org-a', 'schedule-b')).resolves.toMatchObject({ revision: 1, lastRunAt: null })
  })

  it('stores a fixed team without bidding or shared-blackboard fields', async () => {
    const operations = repository()
    const team = await operations.createFixedTeam({
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
    await expect(operations.getTeamDefinition('org-a', 'team-a', adminReadScope)).resolves.toMatchObject({
      teamId: 'team-a', state: 'needs-charter', name: '', northStar: '',
      leaderEmployeeReleaseId: 'release-lead',
    })
  })

  it('fires a team schedule through the organization-owned team leader', async () => {
    const operations = repository()
    await operations.createFixedTeam({
      teamId: 'team-scheduled',
      orgId: 'org-a',
      leaderEmployeeReleaseId: 'release-lead',
      members: [{ employeeReleaseId: 'release-worker', role: 'researcher' }],
      workflowTemplate: {},
      approvalPolicy: {},
      expectedRevision: 0,
      idempotencyKey: 'team-scheduled-create',
    })
    await expect(operations.createSchedule({
      scheduleId: 'schedule-team-blocked',
      orgId: 'org-a',
      target: { kind: 'team', teamId: 'team-scheduled' },
      timezone: 'UTC',
      rule: '0 9 * * *',
      input: {},
      nextRunAt: 100,
      expectedRevision: 0,
      idempotencyKey: 'schedule-team-blocked',
    })).rejects.toMatchObject({ code: 'invalid-state', resourceType: 'team-definition' })
    const activeDefinition = {
      teamId: 'team-scheduled', orgId: 'org-a', name: 'Scheduled research', northStar: 'Deliver reviewed research.',
      ownerUserId: 'owner-a', visibility: 'organization', leaderEmployeeReleaseId: 'release-chartered-lead',
      roles: [
        { roleId: 'owner', name: 'Owner', responsibility: 'Own delivery.' },
        { roleId: 'researcher', name: 'Researcher', responsibility: 'Research.' },
      ],
      roster: [
        { actor: { kind: 'human', userId: 'owner-a' }, roleId: 'owner' },
        { actor: { kind: 'agent', employeeReleaseId: 'release-chartered-lead' }, roleId: 'owner' },
        { actor: { kind: 'agent', employeeReleaseId: 'release-worker' }, roleId: 'researcher' },
      ],
      verificationPolicy: { verifierRequired: true, rubricRefs: [], highRiskHumanReviewRequired: true },
      attentionPolicy: { decisionQueue: 'centralized' }, approvalPolicy: {}, state: 'active',
    } as const
    await operations.saveTeamDefinition({
      ...activeDefinition, expectedRevision: 1, idempotencyKey: 'team-scheduled-charter',
    })
    await operations.createSchedule({
      scheduleId: 'schedule-team',
      orgId: 'org-a',
      target: { kind: 'team', teamId: 'team-scheduled' },
      timezone: 'UTC',
      rule: '0 9 * * *',
      input: {},
      nextRunAt: 100,
      expectedRevision: 0,
      idempotencyKey: 'schedule-team-create',
    })

    await operations.saveTeamDefinition({
      ...activeDefinition, state: 'needs-charter', expectedRevision: 2,
      idempotencyKey: 'team-scheduled-charter-invalidated',
    })
    await expect(operations.fireSchedule({
      scheduleId: 'schedule-team', orgId: 'org-a', expectedRevision: 1,
      idempotencyKey: 'schedule-team-fire-blocked', occurrenceKey: 'blocked-occurrence',
      sessionId: 'session-team-blocked', firedAt: 100, nextRunAt: 200,
    })).rejects.toMatchObject({ code: 'invalid-state', resourceType: 'team-definition' })
    await operations.saveTeamDefinition({
      ...activeDefinition, expectedRevision: 3, idempotencyKey: 'team-scheduled-charter-reactivated',
    })

    const fired = await operations.fireSchedule({
      scheduleId: 'schedule-team',
      orgId: 'org-a',
      expectedRevision: 1,
      idempotencyKey: 'schedule-team-fire',
      occurrenceKey: 'team-occurrence',
      sessionId: 'session-team',
      firedAt: 100,
      nextRunAt: 200,
    })

    expect(fired.workRecord).toMatchObject({ teamId: 'team-scheduled', employeeReleaseId: 'release-chartered-lead' })
    expect(fired.command).toMatchObject({ teamId: 'team-scheduled', employeeReleaseId: 'release-chartered-lead' })
  })

  it('creates a scheduled session without requiring that new session to exist', async () => {
    const operations = repository()
    await operations.createSchedule({
      scheduleId: 'schedule-new-session', orgId: 'org-a', target: { kind: 'employee', employeeReleaseId: 'release-a' },
      timezone: 'UTC', rule: '0 9 * * *', input: {}, nextRunAt: 100, expectedRevision: 0, idempotencyKey: 'new-session-create',
    })

    await expect(operations.fireSchedule({
      scheduleId: 'schedule-new-session', orgId: 'org-a', expectedRevision: 1, idempotencyKey: 'new-session-fire',
      occurrenceKey: 'new-session-occurrence', sessionId: 'missing-new-session', firedAt: 100, nextRunAt: 200,
    })).resolves.toMatchObject({ command: { sessionId: 'missing-new-session' } })
  })

  it('rejects a paused schedule without creating work', async () => {
    const database = new MemoryPostgresDatabase()
    const operations = repository(database)
    await operations.createSchedule({
      scheduleId: 'schedule-paused', orgId: 'org-a', target: { kind: 'employee', employeeReleaseId: 'release-a' },
      timezone: 'UTC', rule: '0 9 * * *', input: {}, nextRunAt: 100, expectedRevision: 0, idempotencyKey: 'paused-create',
    })
    database.setScheduleState('schedule-paused', 'paused')

    await expect(operations.fireSchedule({
      scheduleId: 'schedule-paused', orgId: 'org-a', expectedRevision: 1, idempotencyKey: 'paused-fire',
      occurrenceKey: 'paused-occurrence', sessionId: 'session-paused', firedAt: 100, nextRunAt: 200,
    })).rejects.toThrow('schedule schedule-paused is not active')
    await expect(operations.getWorkRecord('org-a', 'session-paused', 'release-a')).resolves.toBeUndefined()
  })

  it('rejects work records whose native session or release cannot be resolved', async () => {
    const operations = repository()

    await expect(
      operations.upsertWorkRecord({
        ...work,
        employeeReleaseId: 'missing-release',
        idempotencyKey: 'missing-release-work',
      }),
    ).rejects.toThrow('native employee release missing-release was not found in organization org-a')
  })

  it('rejects a work record that references a team outside the organization', async () => {
    const operations = repository()

    await expect(
      operations.upsertWorkRecord({
        ...work,
        teamId: 'missing-team',
        idempotencyKey: 'missing-team-work',
      }),
    ).rejects.toThrow('fixed team missing-team was not found in organization org-a')
  })

  it('gets, filters, cancels, and cursor-pages approvals', async () => {
    const operations = repository()
    for (const [approvalId, kind, requestedBy] of [
      ['approval-1', 'publish', 'owner-a'],
      ['approval-2', 'tool', 'owner-b'],
      ['approval-3', 'publish', 'owner-a'],
    ] as const) await operations.createApprovalRequest({
      approvalId, orgId: 'org-a', kind, subjectType: 'release', subjectId: approvalId,
      requestedBy, idempotencyKey: `create-${approvalId}`,
    })

    const first = await operations.listApprovals({ orgId: 'org-a', kind: 'publish', requestedBy: 'owner-a', limit: 1 })
    expect(first.items).toHaveLength(1)
    expect(first.nextCursor).toBeTypeOf('string')
    const second = await operations.listApprovals({
      orgId: 'org-a', kind: 'publish', requestedBy: 'owner-a', limit: 1, cursor: first.nextCursor,
    })
    expect(second.items).toHaveLength(1)
    expect(second.items[0]?.approvalId).not.toBe(first.items[0]?.approvalId)
    await expect(operations.getApproval('org-b', 'approval-1')).resolves.toBeUndefined()
    await expect(operations.transitionApproval({
      approvalId: 'approval-1', orgId: 'org-a', expectedRevision: 1, idempotencyKey: 'cancel-1',
      state: 'cancelled', actorUserId: 'owner-a', reason: 'withdrawn',
    })).resolves.toMatchObject({ state: 'cancelled', reviewerUserId: 'owner-a', reason: 'withdrawn' })
  })

  it('cursor-pages work records with source, state, and team scope', async () => {
    const operations = repository()
    for (const [sessionId, source, businessState] of [
      ['work-1', 'console', 'active'], ['work-2', 'console', 'active'], ['work-3', 'wecom', 'failed'],
    ] as const) await operations.upsertWorkRecord({
      ...work, sessionId, source, businessState, idempotencyKey: `create-${sessionId}`,
      sourceReferences: { nativeSessionId: sessionId },
    })
    const first = await operations.listWorkRecords({ orgId: 'org-a', source: 'console', businessState: 'active', limit: 1 })
    expect(first.items).toHaveLength(1)
    const second = await operations.listWorkRecords({
      orgId: 'org-a', source: 'console', businessState: 'active', limit: 1, cursor: first.nextCursor,
    })
    expect(second.items).toHaveLength(1)
    await expect(operations.listWorkRecords({ orgId: 'org-a', source: 'wecom', cursor: first.nextCursor }))
      .rejects.toMatchObject({ code: 'cursor-invalid', resourceType: 'work-record' })
  })

  it('uses immutable creation order so updates between pages are not omitted', async () => {
    let now = 1
    const operations = repository(new MemoryPostgresDatabase(), () => now)
    for (const sessionId of ['immutable-1', 'immutable-2', 'immutable-3']) {
      await operations.upsertWorkRecord({
        ...work, sessionId, sourceReferences: { nativeSessionId: sessionId }, idempotencyKey: `create-${sessionId}`,
      })
      now += 1
    }
    const first = await operations.listWorkRecords({ orgId: 'org-a', limit: 1 })
    const cursorPayload = JSON.parse(Buffer.from(first.nextCursor?.split('.')[0] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
    expect(cursorPayload).toMatchObject({ version: 2, createdAt: 3, ids: ['immutable-3', 'release-a'] })
    expect(cursorPayload).not.toHaveProperty('updatedAt')
    now = 10
    await operations.upsertWorkRecord({
      ...work, sessionId: 'immutable-1', sourceReferences: { nativeSessionId: 'immutable-1' },
      businessState: 'completed', expectedRevision: 1, idempotencyKey: 'update-immutable-1',
    })
    const second = await operations.listWorkRecords({ orgId: 'org-a', limit: 1, cursor: first.nextCursor })
    const third = await operations.listWorkRecords({ orgId: 'org-a', limit: 1, cursor: second.nextCursor })
    expect([first.items[0]?.sessionId, second.items[0]?.sessionId, third.items[0]?.sessionId])
      .toEqual(['immutable-3', 'immutable-2', 'immutable-1'])
  })

  it('passes the active transaction database to native reference resolvers', async () => {
    const database = new MemoryPostgresDatabase()
    const seen: unknown[] = []
    const operations = new EnterpriseOperationsRepository(database, {
      cursorSigningKey: Buffer.from('operations-cursor-signing-key-32b!'),
      resolveSession: async (transaction, orgId, sessionId) => {
        seen.push(transaction)
        return orgId === 'org-a' && sessionId === 'session-a'
      },
      resolveRelease: async (transaction, orgId, releaseId) => {
        seen.push(transaction)
        return orgId === 'org-a' && releaseId === 'release-a'
      },
    })
    await operations.upsertWorkRecord(work)
    expect(seen).toEqual([database, database])
  })

  it('updates fixed teams and schedules with CAS and keeps archived schedules terminal', async () => {
    const operations = repository()
    await operations.createFixedTeam({
      teamId: 'team-update', orgId: 'org-a', leaderEmployeeReleaseId: 'release-lead',
      members: [{ employeeReleaseId: 'release-old', role: 'old' }], workflowTemplate: {}, approvalPolicy: {},
      expectedRevision: 0, idempotencyKey: 'team-update-create',
    })
    const updatedTeam = await operations.saveFixedTeam({
      teamId: 'team-update', orgId: 'org-a', leaderEmployeeReleaseId: 'release-new-lead',
      members: [{ employeeReleaseId: 'release-new', role: 'new' }], workflowTemplate: { v: 2 }, approvalPolicy: {},
      expectedRevision: 1, idempotencyKey: 'team-update-save',
    })
    expect(updatedTeam).toMatchObject({ revision: 2, members: [{ employeeReleaseId: 'release-new', role: 'new' }] })
    await expect(operations.getFixedTeam('org-a', 'team-update')).resolves.toEqual(updatedTeam)

    await operations.createSchedule({
      scheduleId: 'schedule-update', orgId: 'org-a', target: { kind: 'employee', employeeReleaseId: 'release-a' },
      timezone: 'UTC', rule: '0 * * * *', input: {}, nextRunAt: 1, expectedRevision: 0, idempotencyKey: 'schedule-update-create',
    })
    const updatedSchedule = await operations.saveSchedule({
      scheduleId: 'schedule-update', orgId: 'org-a', target: { kind: 'employee', employeeReleaseId: 'release-b' },
      timezone: 'Asia/Shanghai', rule: '0 9 * * *', input: { v: 2 }, nextRunAt: 2,
      expectedRevision: 1, idempotencyKey: 'schedule-update-save',
    })
    expect(updatedSchedule).toMatchObject({ revision: 2, timezone: 'Asia/Shanghai', nextRunAt: 2 })
    await operations.transitionSchedule({
      scheduleId: 'schedule-update', orgId: 'org-a', state: 'archived', expectedRevision: 2, idempotencyKey: 'archive-update',
    })
    await expect(operations.saveSchedule({
      scheduleId: 'schedule-update', orgId: 'org-a', target: { kind: 'employee', employeeReleaseId: 'release-c' },
      timezone: 'UTC', rule: '* * * * *', input: {}, nextRunAt: 3, expectedRevision: 3, idempotencyKey: 'edit-archived',
    })).rejects.toMatchObject({ code: 'invalid-state', resourceType: 'schedule' })
  })
})

describe('enterprise channel settings', () => {
  it('creates, lists, pauses, and archives one organization-scoped channel idempotently', async () => {
    const database = new MemoryPostgresDatabase()
    const repository = new EnterpriseOperationsRepository(database, { allowUnverifiedReferences: true }) as unknown as {
      saveChannelConfiguration(input: Record<string, unknown>): Promise<Record<string, unknown>>
      listChannelConfigurations(orgId: string): Promise<{ items: readonly Record<string, unknown>[] }>
      archiveChannelConfiguration(input: Record<string, unknown>): Promise<Record<string, unknown>>
    }
    const create = {
      orgId: 'org-a', channelId: 'finance-wecom', name: '财务企业微信', provider: 'wecom',
      tenantId: 'corp-a', accountId: 'app-a', credentialRef: 'WECOM_FINANCE_SECRET',
      defaultEmployeeReleaseId: 'release-a', inboundEnabled: true, state: 'active',
      actorUserId: 'admin-a',
      expectedRevision: 0, idempotencyKey: 'channel-create-a',
    }

    const first = await repository.saveChannelConfiguration(create)
    expect(first).toMatchObject({ bindingStatus: 'unbound' })
    await expect(repository.saveChannelConfiguration(create)).resolves.toEqual(first)
    await expect(repository.listChannelConfigurations('org-b')).resolves.toEqual({ items: [] })
    await expect(repository.listChannelConfigurations('org-a')).resolves.toMatchObject({
      items: [expect.objectContaining({ channelId: 'finance-wecom', state: 'active', revision: 1 })],
    })
    const paused = await repository.saveChannelConfiguration({
      ...create, state: 'paused', expectedRevision: 1, idempotencyKey: 'channel-pause-a',
    })
    await expect(repository.archiveChannelConfiguration({
      orgId: 'org-a', channelId: 'finance-wecom', actorUserId: 'admin-a', expectedRevision: paused['revision'],
      idempotencyKey: 'channel-archive-a',
    })).resolves.toMatchObject({ state: 'archived', revision: 3 })
  })

  it('verifies, retries, fences, scopes, rebinds, and rejects archived channel bindings', async () => {
    let now = 20
    const operations = new EnterpriseOperationsRepository(
      new MemoryPostgresDatabase(), { allowUnverifiedReferences: true, now: () => ++now },
    ) as unknown as {
      saveChannelConfiguration(input: Record<string, unknown>): Promise<Record<string, unknown>>
      verifyChannelBinding(input: Record<string, unknown>): Promise<Record<string, unknown>>
      archiveChannelConfiguration(input: Record<string, unknown>): Promise<Record<string, unknown>>
    }
    const created = await operations.saveChannelConfiguration({
      orgId: 'org-a', channelId: 'support-wecom', name: 'Support', provider: 'wecom', tenantId: 'corp-a',
      accountId: 'app-a', credentialRef: 'WECOM_SUPPORT_SECRET', inboundEnabled: true, state: 'active',
      actorUserId: 'admin-a', expectedRevision: 0, idempotencyKey: 'channel-create-binding',
    })
    const verify = {
      orgId: 'org-a', channelId: 'support-wecom', expectedRevision: created['revision'], actorUserId: 'admin-a',
      idempotencyKey: 'channel-verify-a', providerIdentityId: '  provider-user-a  ',
      providerIdentityName: '  Support Bot  ', verifiedTenantId: '  tenant-verified  ',
    }
    const verified = await operations.verifyChannelBinding(verify)
    expect(verified).toMatchObject({
      bindingStatus: 'verified', boundProviderIdentityId: 'provider-user-a',
      boundProviderIdentityName: 'Support Bot', verifiedTenantId: 'tenant-verified',
      bindingVerifiedBy: 'admin-a', bindingVerifiedAt: 22, revision: 2,
    })
    await expect(operations.verifyChannelBinding(verify)).resolves.toEqual(verified)
    await expect(operations.verifyChannelBinding({
      ...verify, idempotencyKey: 'channel-verify-stale', providerIdentityId: 'provider-user-b',
    })).rejects.toMatchObject({ code: 'conflict', resourceType: 'channel' })
    await expect(operations.verifyChannelBinding({
      ...verify, orgId: 'org-b', idempotencyKey: 'channel-verify-cross-org',
    })).rejects.toMatchObject({ code: 'not-found', resourceType: 'channel' })

    const rebound = await operations.verifyChannelBinding({
      ...verify, expectedRevision: verified['revision'], idempotencyKey: 'channel-rebind',
      providerIdentityId: 'provider-user-b', providerIdentityName: '   ', verifiedTenantId: '',
    })
    expect(rebound).toMatchObject({
      bindingStatus: 'verified', boundProviderIdentityId: 'provider-user-b', bindingVerifiedBy: 'admin-a', revision: 3,
    })
    expect(rebound).not.toHaveProperty('boundProviderIdentityName')
    expect(rebound).not.toHaveProperty('verifiedTenantId')

    const archived = await operations.archiveChannelConfiguration({
      orgId: 'org-a', channelId: 'support-wecom', actorUserId: 'admin-a', expectedRevision: rebound['revision'],
      idempotencyKey: 'channel-archive-binding',
    })
    expect(archived).toMatchObject({ bindingStatus: 'verified', boundProviderIdentityId: 'provider-user-b' })
    await expect(operations.verifyChannelBinding({
      ...verify, expectedRevision: archived['revision'], idempotencyKey: 'channel-verify-archived',
    })).rejects.toMatchObject({ code: 'invalid-state', resourceType: 'channel' })
  })

  it('preserves binding evidence for presentation edits and clears it for identity configuration changes', async () => {
    const operations = new EnterpriseOperationsRepository(
      new MemoryPostgresDatabase(), { allowUnverifiedReferences: true },
    ) as unknown as {
      saveChannelConfiguration(input: Record<string, unknown>): Promise<Record<string, unknown>>
      verifyChannelBinding(input: Record<string, unknown>): Promise<Record<string, unknown>>
    }
    const base = {
      orgId: 'org-a', channelId: 'finance-binding', name: 'Finance', provider: 'wecom', tenantId: 'corp-a',
      accountId: 'app-a', credentialRef: 'WECOM_FINANCE_SECRET', defaultEmployeeReleaseId: 'release-a',
      inboundEnabled: true, state: 'active', actorUserId: 'admin-a',
    }
    const created = await operations.saveChannelConfiguration({
      ...base, expectedRevision: 0, idempotencyKey: 'binding-clear-create',
    })
    const verified = await operations.verifyChannelBinding({
      orgId: 'org-a', channelId: 'finance-binding', expectedRevision: created['revision'], actorUserId: 'admin-a',
      idempotencyKey: 'binding-clear-verify', providerIdentityId: 'finance-bot',
    })
    const presentationEdit = await operations.saveChannelConfiguration({
      ...base, name: 'Finance renamed', defaultEmployeeReleaseId: 'release-b', inboundEnabled: false, state: 'paused',
      expectedRevision: verified['revision'], idempotencyKey: 'binding-preserve-save',
    })
    expect(presentationEdit).toMatchObject({ bindingStatus: 'verified', boundProviderIdentityId: 'finance-bot' })
    Object.assign(base, { defaultEmployeeReleaseId: 'release-b' })

    for (const [field, value] of [
      ['provider', 'feishu'], ['tenantId', 'corp-b'], ['accountId', 'app-b'], ['credentialRef', 'WECOM_FINANCE_SECRET_V2'],
    ] as const) {
      const rebound = await operations.verifyChannelBinding({
        orgId: 'org-a', channelId: 'finance-binding', expectedRevision: presentationEdit['revision'],
        actorUserId: 'admin-a', idempotencyKey: `binding-${field}-verify`, providerIdentityId: `bot-${field}`,
      })
      Object.assign(presentationEdit, rebound)
      const changed = await operations.saveChannelConfiguration({
        ...base, name: 'Finance renamed', inboundEnabled: false, state: 'paused', [field]: value,
        expectedRevision: rebound['revision'], idempotencyKey: `binding-${field}-clear`,
      })
      expect(changed).toMatchObject({ bindingStatus: 'unbound' })
      expect(changed).not.toHaveProperty('boundProviderIdentityId')
      Object.assign(presentationEdit, changed)
      Object.assign(base, { [field]: value })
    }
  })

  it('rejects blank or oversized provider binding identities', async () => {
    const operations = new EnterpriseOperationsRepository(
      new MemoryPostgresDatabase(), { allowUnverifiedReferences: true },
    ) as unknown as { verifyChannelBinding(input: Record<string, unknown>): Promise<unknown> }
    const input = {
      orgId: 'org-a', channelId: 'channel-a', expectedRevision: 1, actorUserId: 'admin-a',
      idempotencyKey: 'invalid-binding',
    }
    await expect(operations.verifyChannelBinding({ ...input, providerIdentityId: '   ' }))
      .rejects.toThrow(/provider identity id is required/)
    await expect(operations.verifyChannelBinding({ ...input, providerIdentityId: 'x'.repeat(257) }))
      .rejects.toThrow(/256/)
    await expect(operations.verifyChannelBinding({ ...input, actorUserId: '   ', providerIdentityId: 'provider-a' }))
      .rejects.toThrow(/actor user id is required/)
  })

  it('authorizes, audits, and principal-scopes provider binding verification through the service', async () => {
    const audit: Record<string, unknown>[] = []
    const service = new EnterpriseOperationsService(
      new EnterpriseOperationsRepository(new MemoryPostgresDatabase(), { allowUnverifiedReferences: true }),
      { authorize: async () => true, audit: async (event) => { audit.push(event as unknown as Record<string, unknown>) } },
    )
    const principal = { orgId: 'org-a', userId: 'admin-a', roles: ['administrator'] }
    const created = await service.saveChannelConfiguration(principal, {
      channelId: 'service-binding', name: 'Service', provider: 'wecom', tenantId: 'corp-a', accountId: 'app-a',
      credentialRef: 'WECOM_SERVICE_SECRET', inboundEnabled: true, state: 'active',
      expectedRevision: 0, idempotencyKey: 'service-binding-create',
    })
    await expect(service.verifyChannelBinding(principal, {
      orgId: 'org-b', channelId: created.channelId, expectedRevision: created.revision,
      idempotencyKey: 'service-binding-cross-org', providerIdentityId: 'service-bot',
    })).rejects.toMatchObject({ code: 'organization-mismatch' })
    await expect(service.verifyChannelBinding(principal, {
      channelId: created.channelId, expectedRevision: created.revision,
      idempotencyKey: 'service-binding-verify', providerIdentityId: 'service-bot',
    })).resolves.toMatchObject({
      orgId: 'org-a', bindingStatus: 'verified', bindingVerifiedBy: 'admin-a',
    })
    expect(audit).toContainEqual(expect.objectContaining({
      endpoint: 'enterpriseChannel.verifyBinding', resourceType: 'channel', resourceId: 'service-binding',
    }))
  })

  it('enforces personal-WeChat and active-channel safety boundaries', async () => {
    const repository = new EnterpriseOperationsRepository(
      new MemoryPostgresDatabase(), { allowUnverifiedReferences: true },
    ) as unknown as { saveChannelConfiguration(input: Record<string, unknown>): Promise<unknown> }
    await expect(repository.saveChannelConfiguration({
      orgId: 'org-a', channelId: 'personal', name: '个人微信提醒', provider: 'wechat',
      accountId: 'owner-a', credentialRef: 'WECHAT_NOTIFY', inboundEnabled: true,
      actorUserId: 'admin-a',
      state: 'active', expectedRevision: 0, idempotencyKey: 'unsafe-personal',
    })).rejects.toThrow(/personal WeChat.*inbound/)
    await expect(repository.saveChannelConfiguration({
      orgId: 'org-a', channelId: 'wecom-missing-secret', name: '企业微信', provider: 'wecom',
      tenantId: 'corp-a', accountId: 'app-a', inboundEnabled: true,
      actorUserId: 'admin-a',
      state: 'active', expectedRevision: 0, idempotencyKey: 'missing-secret',
    })).rejects.toThrow(/Credential reference/)
  })
})

const teamDefinition = {
  teamId: 'definition-a', orgId: 'org-a', name: 'Finance close', northStar: 'Close with verified evidence.',
  ownerUserId: 'owner-a', departmentId: 'finance', visibility: 'restricted' as const,
  allowedUserIds: ['owner-a'], leaderEmployeeReleaseId: 'release-a',
  roles: [
    { roleId: 'owner', name: 'Owner', responsibility: 'Own the close decision.' },
    { roleId: 'analyst', name: 'Analyst', responsibility: 'Prepare evidence.' },
  ],
  roster: [
    { actor: { kind: 'human' as const, userId: 'owner-a' }, roleId: 'owner' },
    { actor: { kind: 'agent' as const, employeeReleaseId: 'release-a' }, roleId: 'analyst' },
  ],
  verificationPolicy: {
    verifierRequired: true, rubricRefs: ['rubric://finance-close'], highRiskHumanReviewRequired: true,
  },
  attentionPolicy: { decisionQueue: 'centralized' as const, openDecisionLimit: 5 },
  approvalPolicy: {}, state: 'active' as const, expectedRevision: 0, idempotencyKey: 'definition-create',
}
const adminReadScope = { userId: 'admin-a', isAdministrator: true } as const

describe('EnterpriseOperationsRepository team definitions', () => {
  it('creates, reads, lists, saves, and archives definitions with CAS and idempotency', async () => {
    let now = 10
    const operations = repository(new MemoryPostgresDatabase(), () => ++now)
    const created = await operations.createTeamDefinition(teamDefinition)
    await expect(operations.createTeamDefinition(teamDefinition)).resolves.toEqual(created)
    await expect(operations.createTeamDefinition({
      ...teamDefinition, idempotencyKey: 'definition-duplicate',
    })).rejects.toMatchObject({ code: 'conflict', resourceType: 'team-definition' })
    await expect(operations.getTeamDefinition('org-a', teamDefinition.teamId, adminReadScope)).resolves.toEqual(created)
    await expect(operations.getTeamDefinition('org-b', teamDefinition.teamId, adminReadScope)).resolves.toBeUndefined()
    await expect(operations.listTeamDefinitions({ orgId: 'org-a', readScope: adminReadScope, limit: 10 })).resolves.toEqual({ items: [created] })
    await expect(operations.listTeamDefinitions({ orgId: 'org-b', readScope: adminReadScope, limit: 10 })).resolves.toEqual({ items: [] })

    const saved = await operations.saveTeamDefinition({
      ...teamDefinition, name: 'Finance close v2', expectedRevision: 1, idempotencyKey: 'definition-save',
    })
    await expect(operations.saveTeamDefinition({
      ...teamDefinition, name: 'stale', expectedRevision: 1, idempotencyKey: 'definition-stale',
    })).rejects.toMatchObject({ code: 'conflict', resourceType: 'team-definition' })
    await expect(operations.saveTeamDefinition({
      ...teamDefinition, state: 'archived', expectedRevision: saved.revision, idempotencyKey: 'definition-direct-archive',
    })).rejects.toMatchObject({ code: 'invalid-transition', resourceType: 'team-definition' })
    const archived = await operations.archiveTeamDefinition({
      orgId: 'org-a', teamId: teamDefinition.teamId, expectedRevision: saved.revision,
      idempotencyKey: 'definition-archive',
    })
    expect(archived.state).toBe('archived')
    await expect(operations.archiveTeamDefinition({
      orgId: 'org-a', teamId: teamDefinition.teamId, expectedRevision: saved.revision,
      idempotencyKey: 'definition-archive',
    })).resolves.toEqual(archived)
    await expect(operations.archiveTeamDefinition({
      orgId: 'org-a', teamId: teamDefinition.teamId, expectedRevision: archived.revision,
      idempotencyKey: 'definition-archive',
    })).rejects.toMatchObject({ code: 'idempotency-conflict' })
    await expect(operations.archiveTeamDefinition({
      orgId: 'org-a', teamId: teamDefinition.teamId, expectedRevision: archived.revision,
      idempotencyKey: 'definition-archive-new-key',
    })).rejects.toMatchObject({ code: 'conflict', resourceType: 'team-definition' })
    await expect(operations.saveTeamDefinition({
      ...teamDefinition, expectedRevision: archived.revision, idempotencyKey: 'definition-reactivate',
    })).rejects.toMatchObject({ code: 'invalid-transition', resourceType: 'team-definition' })
    await expect(operations.saveTeamDefinition({
      ...teamDefinition, name: 'edit archived', state: 'archived', expectedRevision: archived.revision,
      idempotencyKey: 'definition-edit-archived',
    })).rejects.toMatchObject({ code: 'invalid-transition', resourceType: 'team-definition' })
  })

  it('rejects direct creation in the archived terminal state', async () => {
    const operations = repository()
    await expect(operations.createTeamDefinition({
      ...teamDefinition, teamId: 'direct-archived', state: 'archived', idempotencyKey: 'direct-archived',
    })).rejects.toMatchObject({ code: 'invalid-transition', resourceType: 'team-definition' })
  })

  it('pages definitions with bounded limits and rejects a cursor from another organization scope', async () => {
    let now = 20
    const operations = repository(new MemoryPostgresDatabase(), () => ++now)
    for (const suffix of ['a', 'b', 'c']) {
      await operations.createTeamDefinition({
        ...teamDefinition, teamId: `paged-${suffix}`, idempotencyKey: `paged-${suffix}`,
      })
    }
    const first = await operations.listTeamDefinitions({ orgId: 'org-a', readScope: adminReadScope, limit: 1 })
    expect(first.items.map(item => item.teamId)).toEqual(['paged-c'])
    expect(first.nextCursor).toBeTypeOf('string')
    const second = await operations.listTeamDefinitions({ orgId: 'org-a', readScope: adminReadScope, limit: 1, cursor: first.nextCursor })
    expect(second.items.map(item => item.teamId)).toEqual(['paged-b'])
    await expect(operations.listTeamDefinitions({
      orgId: 'org-b', readScope: adminReadScope, limit: 1, cursor: first.nextCursor,
    })).rejects.toMatchObject({ code: 'cursor-invalid' })
    await expect(operations.listTeamDefinitions({ orgId: 'org-a', readScope: adminReadScope, limit: 0 })).rejects.toThrow('1 to 100')
    await expect(operations.listTeamDefinitions({ orgId: 'org-a', readScope: adminReadScope, limit: 101 })).rejects.toThrow('1 to 100')
    await expect(operations.listTeamDefinitions({ orgId: 'org-a', readScope: adminReadScope, limit: 1.5 })).rejects.toThrow('1 to 100')
  })

  it('migrates each fixed team once as a non-executable needs-charter definition', async () => {
    const database = new MemoryPostgresDatabase()
    const operations = repository(database, () => 10)
    await database.query(
      'INSERT INTO dsh_enterprise_fixed_teams(team_id,org_id,leader_release_id,workflow_template_json,' +
        'approval_policy_json,revision,created_at,updated_at) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,1,$6,$6) RETURNING *',
      ['legacy-team', 'org-a', 'release-a', '{}', '{"review":true}', 10],
    )
    await database.query(
      'INSERT INTO dsh_enterprise_fixed_team_members(team_id,employee_release_id,role) VALUES ($1,$2,$3)',
      ['legacy-team', 'release-a', 'analyst'],
    )

    await migrateEnterpriseOperations(database)
    await migrateEnterpriseOperations(database)

    const page = await operations.listTeamDefinitions({ orgId: 'org-a', readScope: adminReadScope, limit: 10 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0]).toMatchObject({
      teamId: 'legacy-team', state: 'needs-charter', name: '', northStar: '',
      leaderEmployeeReleaseId: 'release-a',
      roster: [{ actor: { kind: 'agent', employeeReleaseId: 'release-a' }, roleId: 'analyst' }],
      roles: [{ roleId: 'analyst', name: 'analyst', responsibility: '' }],
      approvalPolicy: { review: true },
    })
  })

  it('keeps fixed-team CRUD working beside definitions', async () => {
    const operations = repository()
    const fixed = await operations.createFixedTeam({
      teamId: 'fixed-compatible', orgId: 'org-a', leaderEmployeeReleaseId: 'release-a',
      members: [{ employeeReleaseId: 'release-a', role: 'lead' }], workflowTemplate: {}, approvalPolicy: {},
      expectedRevision: 0, idempotencyKey: 'fixed-compatible',
    })
    await expect(operations.getFixedTeam('org-a', 'fixed-compatible')).resolves.toEqual(fixed)
  })

  it('synchronizes needs-charter definitions on legacy save and rejects drift after activation', async () => {
    const operations = repository()
    await operations.createFixedTeam({
      teamId: 'sync-team', orgId: 'org-a', leaderEmployeeReleaseId: 'release-old-lead',
      members: [{ employeeReleaseId: 'release-old', role: 'old' }], workflowTemplate: {}, approvalPolicy: {},
      expectedRevision: 0, idempotencyKey: 'sync-create',
    })
    await operations.saveFixedTeam({
      teamId: 'sync-team', orgId: 'org-a', leaderEmployeeReleaseId: 'release-new-lead',
      members: [
        { employeeReleaseId: 'release-new-lead', role: 'legacy-lead' },
        { employeeReleaseId: 'release-new', role: 'legacy-review' },
      ], workflowTemplate: {}, approvalPolicy: { legacy: true },
      expectedRevision: 1, idempotencyKey: 'sync-save',
    })
    await expect(operations.getTeamDefinition('org-a', 'sync-team', adminReadScope)).resolves.toMatchObject({
      state: 'needs-charter', leaderEmployeeReleaseId: 'release-new-lead', revision: 2,
      roster: [
        { actor: { kind: 'agent', employeeReleaseId: 'release-new-lead' }, roleId: 'legacy-lead' },
        { actor: { kind: 'agent', employeeReleaseId: 'release-new' }, roleId: 'legacy-review' },
      ],
    })
    const active = {
      ...teamDefinition, teamId: 'sync-team', departmentId: undefined, visibility: 'organization' as const,
      allowedUserIds: [], leaderEmployeeReleaseId: 'release-new-lead',
      roster: [
        { actor: { kind: 'human' as const, userId: 'owner-a' }, roleId: 'owner' },
        { actor: { kind: 'agent' as const, employeeReleaseId: 'release-new-lead' }, roleId: 'formal-lead' },
        { actor: { kind: 'agent' as const, employeeReleaseId: 'release-new' }, roleId: 'formal-review' },
      ],
      roles: [
        { roleId: 'owner', name: 'Owner', responsibility: 'Own.' },
        { roleId: 'formal-lead', name: 'Formal lead', responsibility: 'Lead.' },
        { roleId: 'formal-review', name: 'Formal reviewer', responsibility: 'Review.' },
      ],
      approvalPolicy: { formal: true },
      expectedRevision: 2, idempotencyKey: 'sync-activate',
    }
    await operations.saveTeamDefinition(active)
    await expect(operations.getFixedTeam('org-a', 'sync-team')).resolves.toMatchObject({
      leaderEmployeeReleaseId: 'release-new-lead', revision: 3,
      members: [{ employeeReleaseId: 'release-new', role: 'formal-review' }],
      approvalPolicy: { formal: true }, workflowTemplate: {},
    })
    const noOp = await operations.saveFixedTeam({
      teamId: 'sync-team', orgId: 'org-a', leaderEmployeeReleaseId: 'release-new-lead',
      members: [{ employeeReleaseId: 'release-new', role: 'formal-review' }],
      workflowTemplate: {}, approvalPolicy: { formal: true },
      expectedRevision: 3, idempotencyKey: 'sync-active-noop',
    })
    expect(noOp.revision).toBe(3)
    const workflowOnly = await operations.saveFixedTeam({
      teamId: 'sync-team', orgId: 'org-a', leaderEmployeeReleaseId: 'release-new-lead',
      members: [{ employeeReleaseId: 'release-new', role: 'formal-review' }],
      workflowTemplate: { version: 2 }, approvalPolicy: { formal: true }, expectedRevision: 3,
      idempotencyKey: 'sync-active-workflow',
    })
    expect(workflowOnly).toMatchObject({ revision: 4, workflowTemplate: { version: 2 } })
    await expect(operations.saveFixedTeam({
      teamId: 'sync-team', orgId: 'org-a', leaderEmployeeReleaseId: 'release-drift',
      members: [], workflowTemplate: { version: 2 }, approvalPolicy: { formal: true }, expectedRevision: 4, idempotencyKey: 'sync-drift',
    })).rejects.toMatchObject({ code: 'invalid-state', resourceType: 'team-definition' })
    await expect(operations.getFixedTeam('org-a', 'sync-team')).resolves.toMatchObject({
      revision: 4, leaderEmployeeReleaseId: 'release-new-lead', workflowTemplate: { version: 2 },
    })
    const archived = await operations.archiveTeamDefinition({
      orgId: 'org-a', teamId: 'sync-team', expectedRevision: 3, idempotencyKey: 'sync-archive',
    })
    expect(archived.state).toBe('archived')
    const archivedNoOp = await operations.saveFixedTeam({
      teamId: 'sync-team', orgId: 'org-a', leaderEmployeeReleaseId: 'release-new-lead',
      members: [{ employeeReleaseId: 'release-new', role: 'formal-review' }],
      workflowTemplate: { version: 2 }, approvalPolicy: { formal: true }, expectedRevision: 4,
      idempotencyKey: 'sync-archived-noop',
    })
    expect(archivedNoOp.revision).toBe(4)
    await expect(operations.saveFixedTeam({
      teamId: 'sync-team', orgId: 'org-a', leaderEmployeeReleaseId: 'release-new-lead',
      members: [{ employeeReleaseId: 'release-new', role: 'formal-review' }],
      workflowTemplate: { version: 2 }, approvalPolicy: { formal: true }, expectedRevision: 4,
      idempotencyKey: 'sync-archived-noop',
    })).resolves.toEqual(archivedNoOp)
    await expect(operations.saveFixedTeam({
      teamId: 'sync-team', orgId: 'org-a', leaderEmployeeReleaseId: 'release-drift',
      members: [], workflowTemplate: { version: 2 }, approvalPolicy: { formal: true }, expectedRevision: 4, idempotencyKey: 'sync-drift-archived',
    })).rejects.toMatchObject({ code: 'invalid-state', resourceType: 'team-definition' })
  })

  it('atomically rejects fixed-team creation when a definition already owns the identity', async () => {
    const operations = repository()
    await operations.createTeamDefinition({
      ...teamDefinition, teamId: 'definition-first', state: 'needs-charter', name: '', northStar: '',
      verificationPolicy: {}, attentionPolicy: {}, expectedRevision: 0, idempotencyKey: 'definition-first',
    })
    await expect(operations.createFixedTeam({
      teamId: 'definition-first', orgId: 'org-a', leaderEmployeeReleaseId: 'release-a', members: [],
      workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: 'fixed-conflict',
    })).rejects.toMatchObject({ code: 'conflict', resourceType: 'team-definition' })
    await expect(operations.getFixedTeam('org-a', 'definition-first')).resolves.toBeUndefined()
  })

  it('canonicalizes allowed users before validation, storage, and idempotency hashing', async () => {
    const operations = repository()
    const input = {
      ...teamDefinition, teamId: 'canonical-users', allowedUserIds: [' user-b ', 'user-a', 'user-a'],
      idempotencyKey: 'canonical-users',
    }
    const created = await operations.createTeamDefinition(input)
    expect(created.allowedUserIds).toEqual(['user-a', 'user-b'])
    await expect(operations.createTeamDefinition({
      ...input, allowedUserIds: ['user-b', 'user-a'],
    })).resolves.toEqual(created)
  })

  it('resolves every active human, allowlisted user, and department in the organization', async () => {
    const users: string[] = []
    const departments: string[] = []
    const operations = new EnterpriseOperationsRepository(new MemoryPostgresDatabase(), {
      ...references,
      cursorSigningKey: Buffer.from('operations-cursor-signing-key-32b!'),
      resolveUser: async (_database, orgId, userId) => { users.push(`${orgId}:${userId}`); return !userId.startsWith('missing') },
      resolveDepartment: async (_database, orgId, departmentId) => { departments.push(`${orgId}:${departmentId}`); return true },
    })
    await operations.createTeamDefinition({
      ...teamDefinition, teamId: 'identity-refs', ownerUserId: 'owner-a',
      roster: [
        ...teamDefinition.roster,
        { actor: { kind: 'human', userId: 'reviewer-a' }, roleId: 'owner' },
      ],
      allowedUserIds: ['allowed-a'], idempotencyKey: 'identity-refs',
    })
    expect(users.sort()).toEqual(['org-a:allowed-a', 'org-a:owner-a', 'org-a:reviewer-a'])
    expect(departments).toEqual(['org-a:finance'])
    await expect(operations.createTeamDefinition({
      ...teamDefinition, teamId: 'missing-identity', ownerUserId: 'missing-owner',
      roster: [
        { actor: { kind: 'human', userId: 'missing-owner' }, roleId: 'owner' },
        { actor: { kind: 'agent', employeeReleaseId: 'release-a' }, roleId: 'analyst' },
      ],
      idempotencyKey: 'missing-identity',
    })).rejects.toThrow('native enterprise user missing-owner was not found')
    const missingDepartment = new EnterpriseOperationsRepository(new MemoryPostgresDatabase(), {
      ...references,
      cursorSigningKey: Buffer.from('operations-cursor-signing-key-32b!'),
      resolveDepartment: async () => false,
    })
    await expect(missingDepartment.createTeamDefinition({
      ...teamDefinition, teamId: 'missing-department', departmentId: 'dept-other-org',
      idempotencyKey: 'missing-department',
    })).rejects.toThrow('native enterprise department dept-other-org was not found')
  })

  it('queries only visible definitions before applying keyset pagination', async () => {
    let now = 40
    const operations = repository(new MemoryPostgresDatabase(), () => ++now)
    await operations.createTeamDefinition({ ...teamDefinition, teamId: 'visible-old', visibility: 'organization', allowedUserIds: [], idempotencyKey: 'visible-old' })
    await operations.createTeamDefinition({ ...teamDefinition, teamId: 'hidden-newer', visibility: 'private', allowedUserIds: [], idempotencyKey: 'hidden-newer' })
    await operations.createTeamDefinition({ ...teamDefinition, teamId: 'visible-newest', visibility: 'restricted', allowedUserIds: ['viewer-a'], idempotencyKey: 'visible-newest' })
    const scope = { userId: 'viewer-a', isAdministrator: false }
    const first = await operations.listTeamDefinitions({ orgId: 'org-a', readScope: scope, limit: 1 })
    expect(first.items.map(item => item.teamId)).toEqual(['visible-newest'])
    const second = await operations.listTeamDefinitions({ orgId: 'org-a', readScope: scope, limit: 1, cursor: first.nextCursor })
    expect(second.items.map(item => item.teamId)).toEqual(['visible-old'])
    expect(second.nextCursor).toBeUndefined()
    await expect(operations.listTeamDefinitions({
      orgId: 'org-a', readScope: adminReadScope, limit: 1, cursor: first.nextCursor,
    })).rejects.toMatchObject({ code: 'cursor-invalid' })
    await expect(operations.getTeamDefinition('org-a', 'hidden-newer', scope)).resolves.toBeUndefined()
  })

  it('allows an existing team work record to settle after its definition is archived', async () => {
    const operations = repository()
    await operations.createFixedTeam({
      teamId: 'settle-team', orgId: 'org-a', leaderEmployeeReleaseId: 'release-a', members: [],
      workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: 'settle-team',
    })
    await operations.saveTeamDefinition({
      ...teamDefinition, teamId: 'settle-team', departmentId: undefined, visibility: 'organization', allowedUserIds: [],
      expectedRevision: 1, idempotencyKey: 'settle-team-active',
    })
    await expect(operations.upsertWorkRecord({
      ...work, sessionId: 'session-outsider', employeeReleaseId: 'release-outsider',
      teamId: 'settle-team', idempotencyKey: 'settle-outsider',
    })).rejects.toMatchObject({ code: 'invalid-state', resourceType: 'team-definition' })
    const active = await operations.upsertWorkRecord({
      ...work, teamId: 'settle-team', idempotencyKey: 'settle-work',
    })
    await operations.archiveTeamDefinition({
      orgId: 'org-a', teamId: 'settle-team', expectedRevision: 2, idempotencyKey: 'settle-archive',
    })
    await expect(operations.upsertWorkRecord({
      ...work, teamId: 'settle-team', businessState: 'completed', expectedRevision: active.revision,
      idempotencyKey: 'settle-completed',
    })).resolves.toMatchObject({ businessState: 'completed', revision: 2 })
  })

  it('revalidates team eligibility whenever failed work re-enters active', async () => {
    const operations = repository()
    const createActiveTeam = async (teamId: string, roster = teamDefinition.roster) => {
      await operations.createFixedTeam({
        teamId, orgId: 'org-a', leaderEmployeeReleaseId: 'release-a', members: [],
        workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: `${teamId}-fixed`,
      })
      await operations.saveTeamDefinition({
        ...teamDefinition, teamId, departmentId: undefined, visibility: 'organization', allowedUserIds: [], roster,
        expectedRevision: 1, idempotencyKey: `${teamId}-active`,
      })
    }
    const createAndFail = async (teamId: string, employeeReleaseId = 'release-a') => {
      const active = await operations.upsertWorkRecord({
        ...work, sessionId: `session-${teamId}`, employeeReleaseId, teamId,
        idempotencyKey: `${teamId}-work`,
      })
      return operations.upsertWorkRecord({
        ...work, sessionId: `session-${teamId}`, employeeReleaseId, teamId,
        businessState: 'failed', expectedRevision: active.revision, idempotencyKey: `${teamId}-failed`,
      })
    }

    await createActiveTeam('reopen-valid')
    const validFailed = await createAndFail('reopen-valid')
    await expect(operations.upsertWorkRecord({
      ...work, sessionId: 'session-reopen-valid', teamId: 'reopen-valid',
      businessState: 'active', expectedRevision: validFailed.revision, idempotencyKey: 'reopen-valid-active',
    })).resolves.toMatchObject({ businessState: 'active' })

    await createActiveTeam('reopen-archived')
    const archivedFailed = await createAndFail('reopen-archived')
    await operations.archiveTeamDefinition({
      orgId: 'org-a', teamId: 'reopen-archived', expectedRevision: 2, idempotencyKey: 'reopen-archived-archive',
    })
    await expect(operations.upsertWorkRecord({
      ...work, sessionId: 'session-reopen-archived', teamId: 'reopen-archived',
      businessState: 'active', expectedRevision: archivedFailed.revision, idempotencyKey: 'reopen-archived-active',
    })).rejects.toMatchObject({ code: 'invalid-state', resourceType: 'team-definition' })

    await createActiveTeam('reopen-charter')
    const charterFailed = await createAndFail('reopen-charter')
    await operations.saveTeamDefinition({
      ...teamDefinition, teamId: 'reopen-charter', departmentId: undefined,
      visibility: 'organization', allowedUserIds: [], state: 'needs-charter',
      expectedRevision: 2, idempotencyKey: 'reopen-charter-needs',
    })
    await expect(operations.upsertWorkRecord({
      ...work, sessionId: 'session-reopen-charter', teamId: 'reopen-charter',
      businessState: 'active', expectedRevision: charterFailed.revision, idempotencyKey: 'reopen-charter-active',
    })).rejects.toMatchObject({ code: 'invalid-state', resourceType: 'team-definition' })

    const rosterWithWorker = [
      ...teamDefinition.roster,
      { actor: { kind: 'agent' as const, employeeReleaseId: 'release-b' }, roleId: 'analyst' },
    ]
    await createActiveTeam('reopen-removed', rosterWithWorker)
    const removedFailed = await createAndFail('reopen-removed', 'release-b')
    await operations.saveTeamDefinition({
      ...teamDefinition, teamId: 'reopen-removed', departmentId: undefined,
      visibility: 'organization', allowedUserIds: [], name: 'Worker removed',
      expectedRevision: 2, idempotencyKey: 'reopen-removed-definition',
    })
    await expect(operations.upsertWorkRecord({
      ...work, sessionId: 'session-reopen-removed', employeeReleaseId: 'release-b', teamId: 'reopen-removed',
      businessState: 'active', expectedRevision: removedFailed.revision, idempotencyKey: 'reopen-removed-active',
    })).rejects.toMatchObject({ code: 'invalid-state', resourceType: 'team-definition' })
  })

  it('admits start in a short transaction and fences archive only until the lease expires', async () => {
    let now = 100
    const database = new MemoryPostgresDatabase()
    const operations = repository(database, () => now)
    await operations.createFixedTeam({
      teamId: 'admission-team', orgId: 'org-a', leaderEmployeeReleaseId: 'release-a', members: [],
      workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: 'admission-team',
    })
    await operations.saveTeamDefinition({
      ...teamDefinition, teamId: 'admission-team', departmentId: undefined,
      visibility: 'organization', allowedUserIds: [], expectedRevision: 1, idempotencyKey: 'admission-active',
    })
    database.seedOutbox({
      commandId: 'admission-command', orgId: 'org-a', teamId: 'admission-team',
      state: 'processing', workerId: 'worker-a', leaseExpiresAt: 200, teamDefinitionRevision: 2,
    })
    let admittedAt: number | undefined
    const worker = new EnterpriseOperationsWorker({
      claimOutbox: async () => ({
        commandId: 'admission-command', attempt: 1,
        command: { kind: 'start-session', sessionId: 'session-admission', employeeReleaseId: 'release-a', teamId: 'admission-team' },
      }),
      admit: async () => {
        admittedAt = (await operations.admitOutboxStart({
          orgId: 'org-a', commandId: 'admission-command', workerId: 'worker-a',
        })).startAdmittedAt
      },
      createSession: async () => { await database.query('SELECT pg_advisory_xact_lock($1)', [1]) },
      complete: async () => undefined,
      fail: async () => { throw new Error('unexpected admission failure') },
      nextAttemptAt: value => value,
    })
    await expect(worker.runOnce(100)).resolves.toBe(true)
    expect(admittedAt).toBe(100)
    await expect(operations.saveTeamDefinition({
      ...teamDefinition, teamId: 'admission-team', departmentId: undefined,
      visibility: 'organization', allowedUserIds: [], name: 'Blocked edit', expectedRevision: 2,
      idempotencyKey: 'admission-save-live',
    })).rejects.toMatchObject({ code: 'conflict', resourceType: 'team-definition' })
    await expect(operations.archiveTeamDefinition({
      orgId: 'org-a', teamId: 'admission-team', expectedRevision: 2, idempotencyKey: 'admission-archive-live',
    })).rejects.toMatchObject({ code: 'conflict', resourceType: 'team-definition' })
    now = 201
    database.expireOutbox('admission-command', 200)
    await expect(operations.archiveTeamDefinition({
      orgId: 'org-a', teamId: 'admission-team', expectedRevision: 2, idempotencyKey: 'admission-archive-expired',
    })).resolves.toMatchObject({ state: 'archived' })
  })

  it('allows pending commands to be archived and rejects their later worker admission', async () => {
    const database = new MemoryPostgresDatabase()
    const operations = repository(database, () => 100)
    await operations.createFixedTeam({
      teamId: 'pending-team', orgId: 'org-a', leaderEmployeeReleaseId: 'release-a', members: [],
      workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: 'pending-team',
    })
    await operations.saveTeamDefinition({
      ...teamDefinition, teamId: 'pending-team', departmentId: undefined,
      visibility: 'organization', allowedUserIds: [], expectedRevision: 1, idempotencyKey: 'pending-active',
    })
    database.seedOutbox({ commandId: 'pending-command', orgId: 'org-a', teamId: 'pending-team', state: 'pending' })
    await operations.archiveTeamDefinition({
      orgId: 'org-a', teamId: 'pending-team', expectedRevision: 2, idempotencyKey: 'pending-archive',
    })
    database.seedOutbox({
      commandId: 'pending-command', orgId: 'org-a', teamId: 'pending-team',
      state: 'processing', workerId: 'worker-a', leaseExpiresAt: 200, teamDefinitionRevision: 2,
    })
    await expect(operations.admitOutboxStart({
      orgId: 'org-a', commandId: 'pending-command', workerId: 'worker-a',
    })).rejects.toMatchObject({ code: 'invalid-state', resourceType: 'team-definition' })
  })

  it('returns retryable fencing errors for expired or lost leases and permits reclaim', async () => {
    const database = new MemoryPostgresDatabase()
    const operations = repository(database, () => 100)
    database.seedOutbox({
      commandId: 'expired-fence', orgId: 'org-a', teamId: 'team-a', state: 'processing',
      workerId: 'worker-a', leaseExpiresAt: 99, teamDefinitionRevision: 1,
    })
    await expect(operations.admitOutboxStart({
      orgId: 'org-a', commandId: 'expired-fence', workerId: 'worker-a',
    })).rejects.toMatchObject({ code: 'fencing-lost', resourceType: 'operation-outbox' })
    await expect(operations.claimOutbox({ orgId: 'org-a', workerId: 'worker-b', leaseMs: 100 }))
      .resolves.toEqual([expect.objectContaining({ commandId: 'expired-fence', leaseOwner: 'worker-b' })])
    await expect(operations.admitOutboxStart({
      orgId: 'org-a', commandId: 'expired-fence', workerId: 'worker-a',
    })).rejects.toMatchObject({ code: 'fencing-lost', resourceType: 'operation-outbox' })
  })

  it('does not let a stale worker overwrite the current owner after lease reclaim', async () => {
    let now = 100
    const database = new MemoryPostgresDatabase()
    const operations = repository(database, () => now)
    await operations.createFixedTeam({
      teamId: 'reclaim-team', orgId: 'org-a', leaderEmployeeReleaseId: 'release-a', members: [],
      workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: 'reclaim-team',
    })
    await operations.saveTeamDefinition({
      ...teamDefinition, teamId: 'reclaim-team', departmentId: undefined,
      visibility: 'organization', allowedUserIds: [], expectedRevision: 1, idempotencyKey: 'reclaim-active',
    })
    database.seedOutbox({
      commandId: 'reclaim-command', orgId: 'org-a', teamId: 'reclaim-team', state: 'pending',
      teamDefinitionRevision: 2,
    })
    const [claimedA] = await operations.claimOutbox({ orgId: 'org-a', workerId: 'worker-a', leaseMs: 10 })
    now = 111
    const [claimedB] = await operations.claimOutbox({ orgId: 'org-a', workerId: 'worker-b', leaseMs: 10 })
    const failedByA: unknown[] = []
    const workerA = new EnterpriseOperationsWorker({
      claimOutbox: async () => claimedA === undefined ? undefined : {
        commandId: claimedA.commandId, attempt: claimedA.attemptCount,
        command: { kind: 'start-session', sessionId: claimedA.workSessionId,
          employeeReleaseId: claimedA.employeeReleaseId, teamId: claimedA.teamId },
      },
      admit: async (commandId) => { await operations.admitOutboxStart({ orgId: 'org-a', commandId, workerId: 'worker-a' }) },
      createSession: async () => { throw new Error('stale worker must not start') },
      complete: async () => { throw new Error('stale worker must not complete') },
      fail: async (failure) => { failedByA.push(failure) },
      retryable: () => true,
      nextAttemptAt: value => value + 1,
    })
    await expect(workerA.runOnce(now)).rejects.toMatchObject({ code: 'fencing-lost' })
    expect(failedByA).toEqual([])
    expect(database.outboxLease('reclaim-command')).toEqual({ owner: 'worker-b', expiresAt: 121, admittedAt: null })
    await expect(operations.admitOutboxStart({
      orgId: 'org-a', commandId: claimedB!.commandId, workerId: 'worker-b',
    })).resolves.toMatchObject({ leaseOwner: 'worker-b', startAdmittedAt: 111 })

    database.seedOutbox({
      commandId: 'expired-unclaimed', orgId: 'org-a', teamId: 'reclaim-team', state: 'processing',
      workerId: 'worker-a', leaseExpiresAt: 110, teamDefinitionRevision: 2,
    })
    await expect(operations.admitOutboxStart({
      orgId: 'org-a', commandId: 'expired-unclaimed', workerId: 'worker-a',
    })).rejects.toMatchObject({ code: 'fencing-lost' })
    const reclaimed = await operations.claimOutbox({ orgId: 'org-a', workerId: 'worker-c', leaseMs: 20 })
    expect(reclaimed).toEqual([expect.objectContaining({ commandId: 'expired-unclaimed', leaseOwner: 'worker-c' })])
  })

  it('rejects an outbox command captured from an older active definition revision', async () => {
    const database = new MemoryPostgresDatabase()
    const operations = repository(database, () => 100)
    await operations.createFixedTeam({
      teamId: 'stale-command-team', orgId: 'org-a', leaderEmployeeReleaseId: 'release-a', members: [],
      workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0, idempotencyKey: 'stale-command-team',
    })
    const activeInput = {
      ...teamDefinition, teamId: 'stale-command-team', departmentId: undefined,
      visibility: 'organization' as const, allowedUserIds: [],
    }
    await operations.saveTeamDefinition({
      ...activeInput, expectedRevision: 1, idempotencyKey: 'stale-command-active',
    })
    database.seedOutbox({
      commandId: 'stale-command', orgId: 'org-a', teamId: 'stale-command-team', state: 'processing',
      workerId: 'worker-a', leaseExpiresAt: 200, teamDefinitionRevision: 2,
    })
    await operations.saveTeamDefinition({
      ...activeInput, name: 'Changed charter', expectedRevision: 2, idempotencyKey: 'stale-command-change',
    })
    await expect(operations.admitOutboxStart({
      orgId: 'org-a', commandId: 'stale-command', workerId: 'worker-a',
    })).rejects.toMatchObject({ code: 'admission-rejected', resourceType: 'team-definition' })
  })

  it('dead-letters non-retryable failures and keeps retryable failures claimable', async () => {
    const database = new MemoryPostgresDatabase()
    const operations = repository(database, () => 100)
    database.seedOutbox({
      commandId: 'terminal-failure', orgId: 'org-a', teamId: 'team-a', state: 'processing',
      workerId: 'worker-a', leaseExpiresAt: 200, teamDefinitionRevision: 1,
    })
    await operations.failOutbox({
      orgId: 'org-a', commandId: 'terminal-failure', workerId: 'worker-a',
      error: 'stale team definition revision', retryable: false,
    })
    expect(database.outboxState('terminal-failure')).toBe('dead-letter')
    await expect(operations.claimOutbox({ orgId: 'org-a', workerId: 'worker-b', leaseMs: 100 }))
      .resolves.toEqual([])

    database.seedOutbox({
      commandId: 'retryable-failure', orgId: 'org-a', teamId: 'team-a', state: 'processing',
      workerId: 'worker-a', leaseExpiresAt: 200, teamDefinitionRevision: 1,
    })
    await operations.failOutbox({
      orgId: 'org-a', commandId: 'retryable-failure', workerId: 'worker-a',
      error: 'temporary session service outage', retryable: true,
    })
    await expect(operations.claimOutbox({ orgId: 'org-a', workerId: 'worker-b', leaseMs: 100 }))
      .resolves.toEqual([expect.objectContaining({ commandId: 'retryable-failure', state: 'processing' })])
  })

  it('migrates v9 team commands without a definition revision to dead-letter', async () => {
    const database = new MemoryPostgresDatabase(9)
    database.seedOutbox({
      commandId: 'legacy-null-revision', orgId: 'org-a', teamId: 'team-a', state: 'processing',
      workerId: 'worker-a', leaseExpiresAt: 200,
    })
    await migrateEnterpriseOperations(database)
    expect(database.schemaVersion).toBe('14')
    expect(database.outboxState('legacy-null-revision')).toBe('dead-letter')
  })

  it('serializes the globally unique team identity across organizations', async () => {
    const operations = new EnterpriseOperationsRepository(new MemoryPostgresDatabase(), {
      allowUnverifiedReferences: true,
      cursorSigningKey: Buffer.from('operations-cursor-signing-key-32b!'),
    })
    const input = {
      ...teamDefinition, teamId: 'global-team', state: 'needs-charter' as const,
      name: '', northStar: '', verificationPolicy: {}, attentionPolicy: {}, expectedRevision: 0,
    }
    const settled = await Promise.allSettled([
      operations.createTeamDefinition({ ...input, orgId: 'org-a', idempotencyKey: 'global-a' }),
      operations.createTeamDefinition({ ...input, orgId: 'org-b', idempotencyKey: 'global-b' }),
    ])
    expect(settled.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = settled.find(result => result.status === 'rejected')
    expect(rejected?.status === 'rejected' ? rejected.reason : undefined)
      .toMatchObject({ code: 'conflict', resourceType: 'team-definition' })
  })
})
