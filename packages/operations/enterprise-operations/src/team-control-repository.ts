import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { EnterpriseOperationsError } from './repository.ts'
import { migrateEnterpriseOperations } from './schema.ts'
import type { EnterpriseTeamControlProjectionDriver } from './team-control.ts'
import type {
  EnterpriseOperationsRepositoryOptions,
  EnterpriseTeamAutonomyGrant,
  EnterpriseTeamAutonomyGrantPage,
  EnterpriseTeamDefinition,
  EnterpriseTeamRun,
  EnterpriseTeamRunFailure,
  EnterpriseTeamRunPage,
  PostgresDatabase,
  TeamDecision,
  TeamDecisionPage,
} from './types.ts'

interface TeamRunRow extends Record<string, unknown> {
  run_id: string
  org_id: string
  team_id: string
  team_definition_revision: number | string
  workspace_id: string
  root_session_id: string | null
  roster_snapshot_json: unknown
  created_by: string
  source: EnterpriseTeamRun['source']
  state: EnterpriseTeamRun['state']
  runtime_revision: number | string
  source_event_seq: number | string | null
  failure_json: unknown
  revision: number | string
  created_at: number | string
  updated_at: number | string
}
interface DecisionRow extends Record<string, unknown> {
  decision_id: string
  org_id: string
  run_id: string
  kind: TeamDecision['kind']
  question: string
  options_json: unknown
  recommendation: string | null
  context_digest: string
  assignee_user_id: string
  state: TeamDecision['state']
  answer: string | null
  runtime_revision: number | string
  source_event_seq: number | string | null
  revision: number | string
  created_at: number | string
  updated_at: number | string
}
interface GrantRow extends Record<string, unknown> {
  org_id: string
  team_id: string
  employee_release_id: string
  task_type: string
  capability_scope: string
  level: EnterpriseTeamAutonomyGrant['level']
  granted_by: string
  evidence_refs_json: unknown
  state: EnterpriseTeamAutonomyGrant['state']
  revision: number | string
  created_at: number | string
  updated_at: number | string
}
interface DefinitionRow extends Record<string, unknown> {
  org_id: string
  team_id: string
  name: string
  north_star: string
  owner_user_id: string
  department_id: string | null
  visibility: EnterpriseTeamDefinition['visibility']
  allowed_user_ids_json: unknown
  leader_release_id: string
  roster_json: unknown
  roles_json: unknown
  verification_policy_json: unknown
  attention_policy_json: unknown
  approval_policy_json: unknown
  state: EnterpriseTeamDefinition['state']
  revision: number | string
  created_at: number | string
  updated_at: number | string
}

interface Cursor { readonly version: 1; readonly scope: string; readonly createdAt: number; readonly ids: readonly string[] }

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, canonical(item)]))
}
function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex') }
function parse(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value }
function limit(value: number | undefined): number {
  const resolved = value ?? 50
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 100)
    throw new Error('enterprise team-control list limit must be an integer from 1 to 100')
  return resolved
}
function signingKey(value: Buffer | string | undefined): Buffer | undefined {
  if (value === undefined) return undefined
  const key = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8')
  if (key.length < 32) throw new Error('enterprise team-control cursor signing key must be at least 32 bytes')
  return key
}
function decode(value: string | undefined, scope: string, key: Buffer | undefined): Cursor | undefined {
  if (value === undefined) return undefined
  if (key === undefined) throw new EnterpriseOperationsError('cursor-invalid', 'team-run')
  try {
    const [payload, signature, extra] = value.split('.')
    if (payload === undefined || signature === undefined || extra !== undefined) throw new Error('invalid cursor')
    const supplied = Buffer.from(signature, 'base64url')
    const expected = createHmac('sha256', key).update(payload).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('invalid cursor')
    const cursor = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Cursor
    if (cursor.version !== 1 || cursor.scope !== scope || !Number.isSafeInteger(cursor.createdAt)
      || !Array.isArray(cursor.ids) || cursor.ids.some(id => typeof id !== 'string' || id === '')) throw new Error('invalid cursor')
    return cursor
  } catch {
    throw new EnterpriseOperationsError('cursor-invalid', 'team-run')
  }
}
function encode(scope: string, createdAt: number, ids: readonly string[], key: Buffer | undefined): string {
  if (key === undefined) throw new Error('enterprise team-control cursor signing key is required')
  const payload = Buffer.from(JSON.stringify({ version: 1, scope, createdAt, ids } satisfies Cursor)).toString('base64url')
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}
function terminalRun(state: EnterpriseTeamRun['state']): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled'
}

/** PostgreSQL query projections for enterprise TeamRun, TeamDecision, and autonomy grants. */
export class EnterpriseTeamControlRepository implements EnterpriseTeamControlProjectionDriver {
  private initialized: Promise<void> | undefined
  private readonly cursorSigningKey: Buffer | undefined
  constructor(private readonly database: PostgresDatabase, private readonly options: EnterpriseOperationsRepositoryOptions = {}) {
    this.cursorSigningKey = signingKey(options.cursorSigningKey)
  }
  private initialize(): Promise<void> { return this.initialized ??= migrateEnterpriseOperations(this.database) }
  private now(): number { return this.options.now?.() ?? Date.now() }
  private async lock(database: PostgresDatabase, key: string): Promise<void> {
    await database.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key])
  }

  /** @returns a definition only when the authenticated read scope can see it. */
  async getTeamDefinition(
    orgId: string,
    teamId: string,
    scope: { userId: string; isAdministrator: boolean },
  ): Promise<EnterpriseTeamDefinition | undefined> {
    await this.initialize()
    const result = await this.database.query<DefinitionRow>(
      'SELECT * FROM dsh_enterprise_team_definitions WHERE org_id=$1 AND team_id=$2', [orgId, teamId],
    )
    const row = result.rows[0]
    if (row === undefined) return undefined
    const allowed = row.allowed_user_ids_json === null
      ? []
      : parse(row.allowed_user_ids_json) as readonly string[]
    if (!scope.isAdministrator && row.owner_user_id !== scope.userId && row.visibility !== 'organization'
      && !(row.visibility === 'restricted' && allowed.includes(scope.userId))) return undefined
    return {
      orgId: row.org_id, teamId: row.team_id, name: row.name, northStar: row.north_star, ownerUserId: row.owner_user_id,
      ...(row.department_id === null ? {} : { departmentId: row.department_id }), visibility: row.visibility,
      ...(row.allowed_user_ids_json === null ? {} : { allowedUserIds: allowed }), leaderEmployeeReleaseId: row.leader_release_id,
      roster: parse(row.roster_json) as EnterpriseTeamDefinition['roster'],
      roles: parse(row.roles_json) as EnterpriseTeamDefinition['roles'],
      verificationPolicy: parse(row.verification_policy_json) as EnterpriseTeamDefinition['verificationPolicy'],
      attentionPolicy: parse(row.attention_policy_json) as EnterpriseTeamDefinition['attentionPolicy'],
      approvalPolicy: parse(row.approval_policy_json) as EnterpriseTeamDefinition['approvalPolicy'], state: row.state,
      revision: Number(row.revision), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    }
  }

  /** @returns the TeamRun stored for one start idempotency key. */
  async getTeamRunByStartKey(
    orgId: string,
    idempotencyKey: string,
    idempotencyFingerprint?: string,
  ): Promise<EnterpriseTeamRun | undefined> {
    await this.initialize()
    const result = await this.database.query<{ result_json: unknown }>(
      "SELECT result_json FROM dsh_enterprise_operations_idempotency WHERE org_id=$1 AND operation='teamRun.start' AND key=$2",
      [orgId, idempotencyKey],
    )
    const envelope = result.rows[0] === undefined
      ? undefined
      : parse(result.rows[0].result_json) as { requestDigest?: string; result?: { runId?: string } }
    if (idempotencyFingerprint !== undefined && envelope?.requestDigest !== undefined
      && envelope.requestDigest !== idempotencyFingerprint)
      throw new EnterpriseOperationsError('idempotency-conflict', 'team-run', envelope.result?.runId)
    return typeof envelope?.result?.runId === 'string' ? this.getTeamRun(orgId, envelope.result.runId) : undefined
  }

  /** @returns the existing or newly inserted starting projection and whether this call inserted it. */
  async createTeamRunStarting(
    input: Omit<EnterpriseTeamRun, 'revision' | 'createdAt' | 'updatedAt'> & {
      readonly idempotencyKey: string
      readonly idempotencyFingerprint?: string
    },
  ): Promise<{ readonly run: EnterpriseTeamRun; readonly created: boolean }> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `teamRun.start:${input.orgId}:${input.idempotencyKey}`)
      const existing = await database.query<{ result_json: unknown }>(
        "SELECT result_json FROM dsh_enterprise_operations_idempotency WHERE org_id=$1 AND operation='teamRun.start' AND key=$2",
        [input.orgId, input.idempotencyKey],
      )
      if (existing.rows[0] !== undefined) {
        const envelope = parse(existing.rows[0].result_json) as { requestDigest: string; result: { runId: string } }
        if (envelope.requestDigest !== (input.idempotencyFingerprint ?? digest(input)))
          throw new EnterpriseOperationsError('idempotency-conflict', 'team-run', envelope.result.runId)
        const current = await database.query<TeamRunRow>(
          'SELECT * FROM dsh_enterprise_team_runs WHERE org_id=$1 AND run_id=$2',
          [input.orgId, envelope.result.runId],
        )
        if (current.rows[0] === undefined) throw new EnterpriseOperationsError('not-found', 'team-run', envelope.result.runId)
        return { run: this.run(current.rows[0]), created: false }
      }
      const now = this.now()
      const inserted = await database.query<TeamRunRow>(
        `INSERT INTO dsh_enterprise_team_runs(run_id,org_id,team_id,team_definition_revision,workspace_id,root_session_id,
          roster_snapshot_json,created_by,source,state,runtime_revision,source_event_seq,failure_json,revision,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,NULL,$6::jsonb,$7,$8,'starting',0,NULL,NULL,1,$9,$9) RETURNING *`,
        [input.runId, input.orgId, input.teamId, input.teamDefinitionRevision, input.workspaceId,
          JSON.stringify(canonical(input.rosterSnapshot)), input.createdBy, input.source, now],
      )
      const row = inserted.rows[0]
      if (row === undefined) throw new Error('TeamRun insert returned no row')
      await database.query(
        `INSERT INTO dsh_enterprise_operations_idempotency(org_id,operation,key,result_json)
         VALUES($1,'teamRun.start',$2,$3::jsonb)`,
        [input.orgId, input.idempotencyKey, JSON.stringify({
          requestDigest: input.idempotencyFingerprint ?? digest(input), result: { runId: input.runId },
        })],
      )
      return { run: this.run(row), created: true }
    })
  }

  /** @returns one organization-scoped TeamRun projection. */
  async getTeamRun(orgId: string, runId: string): Promise<EnterpriseTeamRun | undefined> {
    await this.initialize()
    const result = await this.database.query<TeamRunRow>(
      'SELECT * FROM dsh_enterprise_team_runs WHERE org_id=$1 AND run_id=$2', [orgId, runId],
    )
    return result.rows[0] === undefined ? undefined : this.run(result.rows[0])
  }

  /** @returns a signed stable TeamRun page. */
  async listTeamRuns(input: {
    orgId: string
    teamId?: string
    state?: EnterpriseTeamRun['state']
    limit?: number
    cursor?: string
  }): Promise<EnterpriseTeamRunPage> {
    const size = limit(input.limit); await this.initialize()
    const scope = digest({ kind: 'team-run', orgId: input.orgId, teamId: input.teamId, state: input.state })
    const cursor = decode(input.cursor, scope, this.cursorSigningKey)
    const values: unknown[] = [input.orgId]
    const where = ['org_id=$1']
    if (input.teamId !== undefined) { values.push(input.teamId); where.push(`team_id=$${values.length}`) }
    if (input.state !== undefined) { values.push(input.state); where.push(`state=$${values.length}`) }
    if (cursor !== undefined) {
      values.push(cursor.createdAt, cursor.ids[0])
      where.push(`(created_at,run_id)<($${values.length - 1},$${values.length})`)
    }
    values.push(size + 1)
    const result = await this.database.query<TeamRunRow>(
      `SELECT * FROM dsh_enterprise_team_runs WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC,run_id DESC LIMIT $${values.length}`,
      values,
    )
    const rows = result.rows.slice(0, size); const last = rows.at(-1)
    return {
      items: rows.map(row => this.run(row)),
      ...(result.rows.length <= size || last === undefined ? {} : {
        nextCursor: encode(scope, Number(last.created_at), [last.run_id], this.cursorSigningKey),
      }),
    }
  }

  /** @returns a revision-fenced runtime projection update. */
  async projectTeamRun(input: {
    orgId: string
    runId: string
    expectedRevision: number
    state: EnterpriseTeamRun['state']
    rootSessionId?: string
    runtimeRevision: number
    sourceEventSeq?: number
    failure?: EnterpriseTeamRunFailure
  }): Promise<EnterpriseTeamRun> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      const current = await database.query<TeamRunRow>(
        'SELECT * FROM dsh_enterprise_team_runs WHERE org_id=$1 AND run_id=$2 FOR UPDATE',
        [input.orgId, input.runId],
      )
      const row = current.rows[0]
      if (row === undefined) throw new EnterpriseOperationsError('not-found', 'team-run', input.runId)
      const before = this.run(row)
      if (before.revision !== input.expectedRevision) throw new EnterpriseOperationsError('conflict', 'team-run', input.runId)
      if (input.runtimeRevision < before.runtimeRevision) throw new EnterpriseOperationsError('fencing-lost', 'team-run', input.runId)
      if (terminalRun(before.state) && input.state !== before.state)
        throw new EnterpriseOperationsError('invalid-transition', 'team-run', input.runId)
      const result = await database.query<TeamRunRow>(
        `UPDATE dsh_enterprise_team_runs SET state=$1,root_session_id=COALESCE($2,root_session_id),runtime_revision=$3,
          source_event_seq=COALESCE($4,source_event_seq),failure_json=$5::jsonb,revision=revision+1,updated_at=$6
         WHERE org_id=$7 AND run_id=$8 AND revision=$9 RETURNING *`,
        [input.state, input.rootSessionId ?? null, input.runtimeRevision, input.sourceEventSeq ?? null,
          input.failure === undefined ? null : JSON.stringify(canonical(input.failure)),
          this.now(), input.orgId, input.runId, input.expectedRevision,
        ],
      )
      if (result.rows[0] === undefined) throw new EnterpriseOperationsError('conflict', 'team-run', input.runId)
      return this.run(result.rows[0])
    })
  }

  /** @returns a runtime-ingested decision projection. */
  async projectDecision(input: TeamDecision): Promise<TeamDecision> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      const current = await database.query<DecisionRow>(
        'SELECT * FROM dsh_enterprise_team_decisions WHERE org_id=$1 AND decision_id=$2 FOR UPDATE',
        [input.orgId, input.decisionId],
      )
      const row = current.rows[0]
      if (row === undefined) {
        const inserted = await database.query<DecisionRow>(
          `INSERT INTO dsh_enterprise_team_decisions(decision_id,org_id,run_id,kind,question,options_json,recommendation,
            context_digest,assignee_user_id,state,answer,runtime_revision,source_event_seq,revision,created_at,updated_at)
           SELECT $1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,1,$14,$14
           WHERE EXISTS(SELECT 1 FROM dsh_enterprise_team_runs WHERE org_id=$2 AND run_id=$3) RETURNING *`,
          [input.decisionId, input.orgId, input.runId, input.kind, input.question, JSON.stringify(input.options),
            input.recommendation ?? null, input.contextDigest, input.assigneeUserId, input.state, input.answer ?? null,
            input.runtimeRevision, input.sourceEventSeq ?? null, input.createdAt],
        )
        if (inserted.rows[0] === undefined) throw new EnterpriseOperationsError('not-found', 'team-run', input.runId)
        return this.decision(inserted.rows[0])
      }
      const before = this.decision(row)
      if (input.runtimeRevision < before.runtimeRevision) return before
      if (before.state !== 'open' && input.state !== before.state)
        throw new EnterpriseOperationsError('invalid-transition', 'team-decision', input.decisionId)
      if (input.runtimeRevision === before.runtimeRevision) return before
      const updated = await database.query<DecisionRow>(
        `UPDATE dsh_enterprise_team_decisions SET state=$1,answer=$2,runtime_revision=$3,source_event_seq=$4,
          revision=revision+1,updated_at=$5 WHERE org_id=$6 AND decision_id=$7 RETURNING *`,
        [input.state, input.answer ?? null, input.runtimeRevision, input.sourceEventSeq ?? null,
          input.updatedAt, input.orgId, input.decisionId],
      )
      if (updated.rows[0] === undefined) throw new EnterpriseOperationsError('conflict', 'team-decision', input.decisionId)
      return this.decision(updated.rows[0])
    })
  }

  /** @returns one organization-scoped decision projection. */
  async getDecision(orgId: string, decisionId: string): Promise<TeamDecision | undefined> {
    await this.initialize()
    const result = await this.database.query<DecisionRow>(
      'SELECT * FROM dsh_enterprise_team_decisions WHERE org_id=$1 AND decision_id=$2', [orgId, decisionId],
    )
    return result.rows[0] === undefined ? undefined : this.decision(result.rows[0])
  }

  /** @returns a signed stable TeamDecision page. */
  async listDecisions(input: {
    orgId: string
    runId?: string
    state?: TeamDecision['state']
    assigneeUserId?: string
    limit?: number
    cursor?: string
  }): Promise<TeamDecisionPage> {
    const size = limit(input.limit); await this.initialize()
    const scope = digest({
      kind: 'decision', orgId: input.orgId, runId: input.runId,
      state: input.state, assigneeUserId: input.assigneeUserId,
    })
    const cursor = decode(input.cursor, scope, this.cursorSigningKey)
    const values: unknown[] = [input.orgId]; const where = ['org_id=$1']
    for (const [column, value] of [['run_id', input.runId], ['state', input.state], ['assignee_user_id', input.assigneeUserId]] as const)
      if (value !== undefined) { values.push(value); where.push(`${column}=$${values.length}`) }
    if (cursor !== undefined) {
      values.push(cursor.createdAt, cursor.ids[0])
      where.push(`(created_at,decision_id)<($${values.length - 1},$${values.length})`)
    }
    values.push(size + 1)
    const result = await this.database.query<DecisionRow>(
      `SELECT * FROM dsh_enterprise_team_decisions WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC,decision_id DESC LIMIT $${values.length}`,
      values,
    )
    const rows = result.rows.slice(0, size); const last = rows.at(-1)
    return {
      items: rows.map(row => this.decision(row)),
      ...(result.rows.length <= size || last === undefined ? {} : {
        nextCursor: encode(scope, Number(last.created_at), [last.decision_id], this.cursorSigningKey),
      }),
    }
  }

  /** @returns a CAS-answered decision after the driver appended the authoritative event. */
  async answerDecision(input: {
    orgId: string
    decisionId: string
    expectedRevision: number
    answer: string
    runtimeRevision: number
    sourceEventSeq?: number
    idempotencyKey: string
  }): Promise<TeamDecision> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `teamDecision.respond:${input.orgId}:${input.idempotencyKey}`)
      const remembered = await database.query<{ result_json: unknown }>(
        "SELECT result_json FROM dsh_enterprise_operations_idempotency WHERE org_id=$1 AND operation='teamDecision.respond' AND key=$2",
        [input.orgId, input.idempotencyKey],
      )
      if (remembered.rows[0] !== undefined) {
        const envelope = parse(remembered.rows[0].result_json) as { requestDigest: string; result: TeamDecision }
        if (envelope.requestDigest !== digest(input))
          throw new EnterpriseOperationsError('idempotency-conflict', 'team-decision', input.decisionId)
        return envelope.result
      }
      const result = await database.query<DecisionRow>(
        `UPDATE dsh_enterprise_team_decisions SET state='answered',answer=$1,runtime_revision=$2,
          source_event_seq=COALESCE($3,source_event_seq),revision=revision+1,updated_at=$4
         WHERE org_id=$5 AND decision_id=$6 AND state='open' AND revision=$7 AND runtime_revision<=$2 RETURNING *`,
        [input.answer, input.runtimeRevision, input.sourceEventSeq ?? null, this.now(),
          input.orgId, input.decisionId, input.expectedRevision],
      )
      if (result.rows[0] === undefined) throw new EnterpriseOperationsError('conflict', 'team-decision', input.decisionId)
      const decision = this.decision(result.rows[0])
      await database.query(
        `INSERT INTO dsh_enterprise_operations_idempotency(org_id,operation,key,result_json)
         VALUES($1,'teamDecision.respond',$2,$3::jsonb)`,
        [input.orgId, input.idempotencyKey, JSON.stringify({ requestDigest: digest(input), result: decision })])
      return decision
    })
  }

  /** @returns a signed stable autonomy-grant page. */
  async listAutonomyGrants(input: {
    orgId: string
    teamId?: string
    employeeReleaseId?: string
    state?: EnterpriseTeamAutonomyGrant['state']
    limit?: number
    cursor?: string
  }): Promise<EnterpriseTeamAutonomyGrantPage> {
    const size = limit(input.limit); await this.initialize()
    const scope = digest({
      kind: 'autonomy', orgId: input.orgId, teamId: input.teamId,
      employeeReleaseId: input.employeeReleaseId, state: input.state,
    })
    const cursor = decode(input.cursor, scope, this.cursorSigningKey)
    const values: unknown[] = [input.orgId]; const where = ['org_id=$1']
    const filters = [
      ['team_id', input.teamId], ['employee_release_id', input.employeeReleaseId], ['state', input.state],
    ] as const
    for (const [column, value] of filters)
      if (value !== undefined) { values.push(value); where.push(`${column}=$${values.length}`) }
    if (cursor !== undefined) {
      values.push(cursor.createdAt, ...cursor.ids)
      where.push(`(created_at,team_id,employee_release_id,task_type,capability_scope)<(
        $${values.length - 5},$${values.length - 4},$${values.length - 3},
        $${values.length - 2},$${values.length - 1})`)
    }
    values.push(size + 1)
    const result = await this.database.query<GrantRow>(
      `SELECT * FROM dsh_enterprise_team_autonomy_grants WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC,team_id DESC,employee_release_id DESC,task_type DESC,capability_scope DESC
       LIMIT $${values.length}`,
      values,
    )
    const rows = result.rows.slice(0, size); const last = rows.at(-1)
    return {
      items: rows.map(row => this.grant(row)),
      ...(result.rows.length <= size || last === undefined ? {} : {
        nextCursor: encode(scope, Number(last.created_at), [
          last.team_id, last.employee_release_id, last.task_type, last.capability_scope,
        ], this.cursorSigningKey),
      }),
    }
  }

  /** @returns an explicitly saved active grant; revoked grants cannot be revived. */
  async saveAutonomyGrant(
    input: Omit<EnterpriseTeamAutonomyGrant, 'revision' | 'createdAt' | 'updatedAt' | 'state'> & {
      expectedRevision: number
      idempotencyKey: string
    },
  ): Promise<EnterpriseTeamAutonomyGrant> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `teamAutonomy.save:${input.orgId}:${input.idempotencyKey}`)
      const remembered = await database.query<{ result_json: unknown }>(
        "SELECT result_json FROM dsh_enterprise_operations_idempotency WHERE org_id=$1 AND operation='teamAutonomy.save' AND key=$2",
        [input.orgId, input.idempotencyKey],
      )
      if (remembered.rows[0] !== undefined) {
        const envelope = parse(remembered.rows[0].result_json) as {
          requestDigest: string
          result: EnterpriseTeamAutonomyGrant
        }
        if (envelope.requestDigest !== digest(input)) throw new EnterpriseOperationsError('idempotency-conflict', 'team-autonomy-grant')
        return envelope.result
      }
      const existing = await database.query<GrantRow>(
        `SELECT * FROM dsh_enterprise_team_autonomy_grants WHERE org_id=$1 AND team_id=$2 AND employee_release_id=$3
          AND task_type=$4 AND capability_scope=$5 FOR UPDATE`,
        [input.orgId, input.teamId, input.employeeReleaseId, input.taskType, input.capabilityScope],
      )
      const before = existing.rows[0] === undefined ? undefined : this.grant(existing.rows[0])
      if (before?.state === 'revoked') throw new EnterpriseOperationsError('invalid-transition', 'team-autonomy-grant')
      if ((before?.revision ?? 0) !== input.expectedRevision) throw new EnterpriseOperationsError('conflict', 'team-autonomy-grant')
      const now = this.now()
      const result = before === undefined
        ? await database.query<GrantRow>(
          `INSERT INTO dsh_enterprise_team_autonomy_grants(org_id,team_id,employee_release_id,task_type,capability_scope,
            level,granted_by,evidence_refs_json,state,revision,created_at,updated_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'active',1,$9,$9) RETURNING *`,
          [input.orgId, input.teamId, input.employeeReleaseId, input.taskType, input.capabilityScope,
            input.level, input.grantedBy, JSON.stringify(input.evidenceRefs), now])
        : await database.query<GrantRow>(
          `UPDATE dsh_enterprise_team_autonomy_grants SET level=$1,granted_by=$2,evidence_refs_json=$3::jsonb,
            revision=revision+1,updated_at=$4 WHERE org_id=$5 AND team_id=$6 AND employee_release_id=$7
            AND task_type=$8 AND capability_scope=$9 AND revision=$10 AND state='active' RETURNING *`,
          [input.level, input.grantedBy, JSON.stringify(input.evidenceRefs), now, input.orgId, input.teamId,
            input.employeeReleaseId, input.taskType, input.capabilityScope, input.expectedRevision])
      if (result.rows[0] === undefined) throw new EnterpriseOperationsError('conflict', 'team-autonomy-grant')
      const grant = this.grant(result.rows[0])
      await database.query(
        `INSERT INTO dsh_enterprise_operations_idempotency(org_id,operation,key,result_json)
         VALUES($1,'teamAutonomy.save',$2,$3::jsonb)`,
        [input.orgId, input.idempotencyKey, JSON.stringify({ requestDigest: digest(input), result: grant })],
      )
      return grant
    })
  }

  /** @returns a terminal revoked grant. */
  async revokeAutonomyGrant(input: {
    orgId: string
    teamId: string
    employeeReleaseId: string
    taskType: string
    capabilityScope: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<EnterpriseTeamAutonomyGrant> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `teamAutonomy.revoke:${input.orgId}:${input.idempotencyKey}`)
      const remembered = await database.query<{ result_json: unknown }>(
        "SELECT result_json FROM dsh_enterprise_operations_idempotency WHERE org_id=$1 AND operation='teamAutonomy.revoke' AND key=$2",
        [input.orgId, input.idempotencyKey],
      )
      if (remembered.rows[0] !== undefined) {
        const envelope = parse(remembered.rows[0].result_json) as {
          requestDigest: string
          result: EnterpriseTeamAutonomyGrant
        }
        if (envelope.requestDigest !== digest(input)) throw new EnterpriseOperationsError('idempotency-conflict', 'team-autonomy-grant')
        return envelope.result
      }
      const result = await database.query<GrantRow>(
        `UPDATE dsh_enterprise_team_autonomy_grants SET state='revoked',revision=revision+1,updated_at=$1
         WHERE org_id=$2 AND team_id=$3 AND employee_release_id=$4 AND task_type=$5 AND capability_scope=$6
          AND revision=$7 AND state='active' RETURNING *`,
        [this.now(), input.orgId, input.teamId, input.employeeReleaseId, input.taskType, input.capabilityScope, input.expectedRevision],
      )
      if (result.rows[0] === undefined) throw new EnterpriseOperationsError('conflict', 'team-autonomy-grant')
      const grant = this.grant(result.rows[0])
      await database.query(
        `INSERT INTO dsh_enterprise_operations_idempotency(org_id,operation,key,result_json)
         VALUES($1,'teamAutonomy.revoke',$2,$3::jsonb)`,
        [input.orgId, input.idempotencyKey, JSON.stringify({ requestDigest: digest(input), result: grant })],
      )
      return grant
    })
  }

  private run(row: TeamRunRow): EnterpriseTeamRun {
    return { runId: row.run_id, orgId: row.org_id, teamId: row.team_id,
      teamDefinitionRevision: Number(row.team_definition_revision), workspaceId: row.workspace_id,
      ...(row.root_session_id === null ? {} : { rootSessionId: row.root_session_id }),
      rosterSnapshot: parse(row.roster_snapshot_json) as EnterpriseTeamRun['rosterSnapshot'],
      createdBy: row.created_by, source: row.source, state: row.state,
      runtimeRevision: Number(row.runtime_revision),
      ...(row.source_event_seq === null ? {} : { sourceEventSeq: Number(row.source_event_seq) }),
      ...(row.failure_json === null ? {} : {
        failure: parse(row.failure_json) as EnterpriseTeamRunFailure,
      }),
      revision: Number(row.revision),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }
  }
  private decision(row: DecisionRow): TeamDecision {
    return { decisionId: row.decision_id, orgId: row.org_id, runId: row.run_id, kind: row.kind,
      question: row.question, options: parse(row.options_json) as readonly string[],
      ...(row.recommendation === null ? {} : { recommendation: row.recommendation }),
      contextDigest: row.context_digest, assigneeUserId: row.assignee_user_id, state: row.state,
      ...(row.answer === null ? {} : { answer: row.answer }), runtimeRevision: Number(row.runtime_revision),
      ...(row.source_event_seq === null ? {} : { sourceEventSeq: Number(row.source_event_seq) }), revision: Number(row.revision),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }
  }
  private grant(row: GrantRow): EnterpriseTeamAutonomyGrant {
    return { orgId: row.org_id, teamId: row.team_id, employeeReleaseId: row.employee_release_id,
      taskType: row.task_type, capabilityScope: row.capability_scope, level: row.level, grantedBy: row.granted_by,
      evidenceRefs: parse(row.evidence_refs_json) as readonly string[],
      state: row.state, revision: Number(row.revision),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }
  }
}
