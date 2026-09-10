/** Transactional enterprise operations repository. */
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type {
  ApprovalKind,
  ApprovalPage,
  ApprovalView,
  BusinessState,
  EnterpriseChannelConfiguration,
  EnterpriseChannelBindingVerificationWriteInput,
  EnterpriseChannelConfigurationPage,
  EnterpriseOperationsRepositoryOptions,
  EnterpriseTeamDefinition,
  EnterpriseTeamDefinitionRevision,
  FixedTeamView,
  FixedTeamPage,
  TeamDefinitionPage,
  TeamDefinitionReadScope,
  PostgresDatabase,
  ScheduleFireView,
  ScheduleTarget,
  ScheduleView,
  SchedulePage,
  OutboxCommandView,
  OutboxState,
  WorkRecordInput,
  WorkRecordPage,
  WorkRecordView,
  WorkStartReservation,
  WorkStartReservationInput,
} from './types.ts'
import { LEGACY_TEAM_DEFINITION_OWNER_USER_ID, migrateEnterpriseOperations } from './schema.ts'
import { assertTeamDefinitionExecutable, validateTeamDefinition } from './team-definition.ts'

/** Stable operations failure for Host adapters. */
export class EnterpriseOperationsError extends Error {
  constructor(
    readonly code: 'conflict' | 'immutable-source' | 'invalid-transition' | 'not-found'
      | 'cursor-invalid' | 'idempotency-conflict' | 'invalid-state' | 'fencing-lost' | 'admission-rejected'
      | 'forbidden',
    readonly resourceType: 'work-record' | 'approval' | 'schedule' | 'team' | 'team-definition' | 'operation-outbox'
      | 'team-run' | 'team-decision' | 'team-autonomy-grant' | 'channel' | 'work-start-reservation',
    readonly resourceId?: string,
  ) {
    super(`enterprise operations ${code}`)
    this.name = 'EnterpriseOperationsError'
  }
}
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
function canonicalEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}
function sortedFixedMembers(members: readonly { employeeReleaseId: string; role: string }[]) {
  return [...members].sort((left, right) => left.employeeReleaseId.localeCompare(right.employeeReleaseId)
    || left.role.localeCompare(right.role))
}
function teamLockKey(orgId: string, teamId: string): string {
  void orgId
  return `team:${teamId}`
}
function canonicalDefinitionInput<T extends {
  readonly visibility: EnterpriseTeamDefinition['visibility']
  readonly allowedUserIds?: readonly string[]
}>(input: T): T & { readonly allowedUserIds: readonly string[] } {
  if (input.visibility !== 'restricted') return { ...input, allowedUserIds: input.allowedUserIds ?? [] }
  return { ...input, allowedUserIds: [...new Set((input.allowedUserIds ?? []).map(userId => userId.trim()))].sort() }
}
type ChannelSaveInput = Omit<EnterpriseChannelConfiguration,
    | 'bindingStatus' | 'boundProviderIdentityId' | 'boundProviderIdentityName' | 'verifiedTenantId'
    | 'bindingVerifiedBy' | 'bindingVerifiedAt' | 'createdBy' | 'revision' | 'createdAt' | 'updatedAt'> & {
      readonly actorUserId: string
      readonly expectedRevision: number
      readonly idempotencyKey: string
    }

const CHANNEL_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/u
const CHANNEL_BINDING_EVIDENCE_MAX_LENGTH = 256

function canonicalChannelInput(input: ChannelSaveInput): ChannelSaveInput {
  const {
    tenantId: _tenantId,
    credentialRef: _credentialRef,
    defaultEmployeeReleaseId: _defaultEmployeeReleaseId,
    ...base
  } = input
  const normalized = {
    ...base,
    channelId: input.channelId.trim(),
    name: input.name.trim(),
    accountId: input.accountId.trim(),
    ...input.tenantId?.trim() ? { tenantId: input.tenantId.trim() } : {},
    ...input.credentialRef?.trim() ? { credentialRef: input.credentialRef.trim() } : {},
    ...input.defaultEmployeeReleaseId?.trim()
      ? { defaultEmployeeReleaseId: input.defaultEmployeeReleaseId.trim() }
      : {},
  }
  if (!CHANNEL_ID.test(normalized.channelId)) throw new Error('channel id must use lowercase letters, numbers, and hyphens')
  if (normalized.name === '' || normalized.accountId === '') throw new Error('channel name and account id are required')
  if (!['wecom', 'feishu', 'dingtalk', 'wechat'].includes(normalized.provider)) throw new Error('channel provider is unsupported')
  if (normalized.credentialRef !== undefined && !CREDENTIAL_REF.test(normalized.credentialRef)) {
    throw new Error('channel Credential reference must be a POSIX identifier')
  }
  if (normalized.state === 'archived') throw new Error('channel archive requires the archive operation')
  if (normalized.state === 'active' && normalized.credentialRef === undefined) {
    throw new Error('active channel requires a Credential reference')
  }
  return normalized
}

function canonicalChannelBindingInput(
  input: EnterpriseChannelBindingVerificationWriteInput,
): EnterpriseChannelBindingVerificationWriteInput {
  const {
    providerIdentityName: _providerIdentityName,
    verifiedTenantId: _verifiedTenantId,
    ...base
  } = input
  const normalized = {
    ...base,
    channelId: input.channelId.trim(),
    providerIdentityId: input.providerIdentityId.trim(),
    ...input.providerIdentityName?.trim() ? { providerIdentityName: input.providerIdentityName.trim() } : {},
    ...input.verifiedTenantId?.trim() ? { verifiedTenantId: input.verifiedTenantId.trim() } : {},
  }
  if (!CHANNEL_ID.test(normalized.channelId)) throw new Error('channel id must use lowercase letters, numbers, and hyphens')
  if (normalized.providerIdentityId === '') throw new Error('channel provider identity id is required')
  if (normalized.actorUserId.trim() === '') throw new Error('channel binding actor user id is required')
  for (const value of [normalized.providerIdentityId, normalized.providerIdentityName, normalized.verifiedTenantId]) {
    if (value !== undefined && value.length > CHANNEL_BINDING_EVIDENCE_MAX_LENGTH) {
      throw new Error('channel binding evidence must not exceed 256 characters')
    }
  }
  return normalized
}
interface OperationsCursor {
  readonly version: 2
  readonly scope: string
  readonly createdAt: number
  readonly ids: readonly string[]
}
const DEFAULT_LIST_LIMIT = 50
function listLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_LIST_LIMIT
  if (!Number.isInteger(value) || value < 1 || value > 100) throw new Error('operations list limit must be an integer from 1 to 100')
  return value
}
function canonicalBase64url(segment: string): Buffer {
  const decoded = Buffer.from(segment, 'base64url')
  if (segment.length === 0 || decoded.toString('base64url') !== segment)
    throw new Error('operations list cursor segment is not canonical base64url')
  return decoded
}
function cursorKey(value: Buffer | string | undefined): Buffer | undefined {
  if (value === undefined) return undefined
  const key = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8')
  if (key.length < 32) throw new Error('operations cursor signing key must be at least 32 bytes')
  return key
}
function cursorScope(kind: string, input: Record<string, unknown>): string {
  return requestDigest({ kind, ...input })
}
function decodeCursor(value: string | undefined, scope: string, key: Buffer | undefined): OperationsCursor | undefined {
  if (value === undefined) return undefined
  if (key === undefined) throw new EnterpriseOperationsError('cursor-invalid', 'work-record')
  try {
    const segments = value.split('.')
    if (segments.length !== 2 || segments[0] === undefined || segments[1] === undefined) throw new Error('signature')
    const supplied = canonicalBase64url(segments[1])
    const expected = createHmac('sha256', key).update(segments[0]).digest()
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('signature')
    const parsed: unknown = JSON.parse(canonicalBase64url(segments[0]).toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('invalid')
    const cursor = parsed as Record<string, unknown>
    if (cursor.version !== 2 || cursor.scope !== scope || !Number.isSafeInteger(cursor.createdAt)
      || !Array.isArray(cursor.ids) || cursor.ids.length === 0 || cursor.ids.some(id => typeof id !== 'string' || id.length === 0))
      throw new Error('invalid')
    return cursor as unknown as OperationsCursor
  } catch (error) {
    if (error instanceof EnterpriseOperationsError) throw error
    throw new EnterpriseOperationsError('cursor-invalid', 'work-record')
  }
}
function encodeCursor(scope: string, createdAt: number, ids: readonly string[], key: Buffer | undefined): string {
  if (key === undefined) throw new Error('operations cursor signing key is required to generate a cursor')
  const payload = Buffer.from(JSON.stringify({ version: 2, scope, createdAt, ids } satisfies OperationsCursor)).toString('base64url')
  return `${payload}.${createHmac('sha256', key).update(payload).digest('base64url')}`
}
function assertSourceImmutable(before: WorkRecordView, after: WorkRecordInput): void {
  if (
    JSON.stringify(canonical(before.sourceReferences)) !== JSON.stringify(canonical(after.sourceReferences)) ||
    before.sessionId !== after.sessionId ||
    before.employeeReleaseId !== after.employeeReleaseId ||
    before.source !== after.source
  )
    throw new EnterpriseOperationsError('immutable-source', 'work-record')
}
function assertBusinessTransition(before: BusinessState, after: BusinessState): void {
  if (before === after) return
  const allowed: Record<BusinessState, readonly BusinessState[]> = {
    active: ['waiting-approval', 'completed', 'failed'],
    'waiting-approval': ['active', 'completed', 'failed'],
    completed: [],
    failed: ['active'],
  }
  if (!allowed[before].includes(after)) throw new EnterpriseOperationsError('invalid-transition', 'work-record')
}
/** Provides `ApprovalRevisionConflictError` capabilities. */
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
interface WorkStartReservationRow extends Record<string, unknown> {
  org_id: string
  user_id: string
  idempotency_key: string
  request_fingerprint: string
  session_id: string
  workspace_id: string
  employee_release_id: string
  preset_id: string
  deadline: string | null
  deadline_digest: string | null
  state: WorkStartReservation['state']
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
interface TeamDefinitionRow extends Record<string, unknown> {
  org_id: string
  team_id: string
  name: string
  north_star: string
  owner_user_id: string
  department_id: string | null
  visibility: EnterpriseTeamDefinition['visibility']
  allowed_user_ids_json: unknown | null
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
interface TeamDefinitionRevisionRow extends TeamDefinitionRow {
  state: 'needs-charter' | 'draft' | 'active' | 'archived'
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
  start_admitted_at: number | string | null
  team_definition_revision: number | string | null
  created_at: number | string
}

interface ChannelConfigurationRow extends Record<string, unknown> {
  org_id: string
  channel_id: string
  name: string
  provider: EnterpriseChannelConfiguration['provider']
  tenant_id: string | null
  account_id: string
  credential_ref: string | null
  default_employee_release_id: string | null
  inbound_enabled: boolean
  state: EnterpriseChannelConfiguration['state']
  binding_status: EnterpriseChannelConfiguration['bindingStatus']
  bound_provider_identity_id: string | null
  bound_provider_identity_name: string | null
  verified_tenant_id: string | null
  binding_verified_by: string | null
  binding_verified_at: number | string | null
  created_by: string
  revision: number | string
  created_at: number | string
  updated_at: number | string
}

/** Provides `EnterpriseOperationsRepository` capabilities. */
export class EnterpriseOperationsRepository {
  private initialized: Promise<void> | undefined
  private readonly cursorSigningKey: Buffer | undefined
  constructor(
    private readonly database: PostgresDatabase,
    private readonly options: EnterpriseOperationsRepositoryOptions = {},
  ) { this.cursorSigningKey = cursorKey(options.cursorSigningKey) }
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
  private async requireSession(database: PostgresDatabase, orgId: string, sessionId: string): Promise<void> {
    if (this.options.resolveSession === undefined && this.options.allowUnverifiedReferences !== true)
      throw new Error('native session resolver is required')
    if (this.options.resolveSession !== undefined && !(await this.options.resolveSession(database, orgId, sessionId)))
      throw new Error(`native session ${sessionId} was not found in organization ${orgId}`)
  }
  private async requireRelease(database: PostgresDatabase, orgId: string, releaseId: string): Promise<void> {
    if (this.options.resolveRelease === undefined && this.options.allowUnverifiedReferences !== true)
      throw new Error('native employee release resolver is required')
    if (this.options.resolveRelease !== undefined && !(await this.options.resolveRelease(database, orgId, releaseId)))
      throw new Error(`native employee release ${releaseId} was not found in organization ${orgId}`)
  }
  private async requireUser(database: PostgresDatabase, orgId: string, userId: string): Promise<void> {
    if (this.options.resolveUser === undefined && this.options.allowUnverifiedReferences !== true)
      throw new Error('native enterprise user resolver is required')
    if (this.options.resolveUser !== undefined && !(await this.options.resolveUser(database, orgId, userId)))
      throw new Error(`native enterprise user ${userId} was not found in organization ${orgId}`)
  }
  private async requireDepartment(database: PostgresDatabase, orgId: string, departmentId: string): Promise<void> {
    if (this.options.resolveDepartment === undefined && this.options.allowUnverifiedReferences !== true)
      throw new Error('native enterprise department resolver is required')
    if (this.options.resolveDepartment !== undefined && !(await this.options.resolveDepartment(database, orgId, departmentId)))
      throw new Error(`native enterprise department ${departmentId} was not found in organization ${orgId}`)
  }
  private async teamTarget(
    database: PostgresDatabase,
    orgId: string,
    teamId: string,
  ): Promise<{ fixed: TeamRow; definition: EnterpriseTeamDefinition }> {
    await this.lock(database, teamLockKey(orgId, teamId))
    const result = await database.query<TeamRow>('SELECT * FROM dsh_enterprise_fixed_teams WHERE team_id = $1 AND org_id = $2', [
      teamId,
      orgId,
    ])
    const team = result.rows[0]
    if (team === undefined || team.org_id !== orgId) throw new Error(`fixed team ${teamId} was not found in organization ${orgId}`)
    const definitions = await database.query<TeamDefinitionRow>(
      'SELECT * FROM dsh_enterprise_team_definitions WHERE org_id=$1 AND team_id=$2', [orgId, teamId],
    )
    if (definitions.rows[0] === undefined)
      throw new EnterpriseOperationsError('invalid-state', 'team-definition', teamId)
    const definition = this.teamDefinition(definitions.rows[0])
    assertTeamDefinitionExecutable(definition)
    return { fixed: team, definition }
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
    if (typeof envelope.requestDigest !== 'string' || envelope.requestDigest.length === 0)
      throw new EnterpriseOperationsError('idempotency-conflict', 'work-record')
    if (envelope.requestDigest !== requestDigest(request))
      throw new EnterpriseOperationsError('idempotency-conflict', 'work-record')
    return envelope.result as T
  }
  private async lockIdempotency(database: PostgresDatabase, orgId: string, operation: string, key: string): Promise<void> {
    await this.lock(database, `idempotency:${orgId}:${operation}:${key}`)
  }
  private async assertNoLiveTeamAdmission(
    database: PostgresDatabase,
    orgId: string,
    teamId: string,
  ): Promise<void> {
    const result = await database.query(
      `SELECT 1 FROM dsh_enterprise_operation_outbox WHERE org_id=$1 AND team_id=$2
        AND state='processing' AND start_admitted_at IS NOT NULL AND lease_expires_at >= $3 LIMIT 1`,
      [orgId, teamId, this.now()],
    )
    if (result.rows[0] !== undefined)
      throw new EnterpriseOperationsError('conflict', 'team-definition', teamId)
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
  /** Executes `EnterpriseOperationsRepository.reserveWorkStart` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async reserveWorkStart(input: WorkStartReservationInput): Promise<WorkStartReservation> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `work-start:${input.orgId}:${input.userId}:${input.idempotencyKey}`)
      const prior = await database.query<WorkStartReservationRow>(
        'SELECT * FROM dsh_enterprise_work_start_reservations WHERE org_id=$1 AND user_id=$2 AND idempotency_key=$3 FOR UPDATE',
        [input.orgId, input.userId, input.idempotencyKey],
      )
      if (prior.rows[0] !== undefined) {
        const reservation = this.workStartReservation(prior.rows[0])
        if (reservation.requestFingerprint !== input.requestFingerprint)
          throw new EnterpriseOperationsError('idempotency-conflict', 'work-start-reservation', input.idempotencyKey)
        return reservation
      }
      const now = this.now()
      const inserted = await database.query<WorkStartReservationRow>(
        `INSERT INTO dsh_enterprise_work_start_reservations(
          org_id,user_id,idempotency_key,request_fingerprint,session_id,workspace_id,employee_release_id,preset_id,
          deadline,deadline_digest,state,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'starting',$11,$11) RETURNING *`,
        [input.orgId, input.userId, input.idempotencyKey, input.requestFingerprint, input.sessionId, input.workspaceId,
          input.employeeReleaseId, input.presetId, input.deadline ?? null, input.deadlineDigest ?? null, now],
      )
      return this.workStartReservation(required(inserted.rows[0], 'work start reservation'))
    })
  }
  /** Executes `EnterpriseOperationsRepository.getWorkStart` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async getWorkStart(input: Pick<WorkStartReservationInput, 'orgId' | 'userId' | 'idempotencyKey'>): Promise<WorkStartReservation | undefined> {
    await this.initialize()
    const result = await this.database.query<WorkStartReservationRow>(
      'SELECT * FROM dsh_enterprise_work_start_reservations WHERE org_id=$1 AND user_id=$2 AND idempotency_key=$3',
      [input.orgId, input.userId, input.idempotencyKey],
    )
    return result.rows[0] === undefined ? undefined : this.workStartReservation(result.rows[0])
  }
  /** Executes `EnterpriseOperationsRepository.completeWorkStart` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async completeWorkStart(input: Pick<WorkStartReservationInput, 'orgId' | 'userId' | 'idempotencyKey'>): Promise<WorkStartReservation> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `work-start:${input.orgId}:${input.userId}:${input.idempotencyKey}`)
      const updated = await database.query<WorkStartReservationRow>(
        `UPDATE dsh_enterprise_work_start_reservations SET state='completed',updated_at=$4
         WHERE org_id=$1 AND user_id=$2 AND idempotency_key=$3 RETURNING *`,
        [input.orgId, input.userId, input.idempotencyKey, this.now()],
      )
      if (updated.rows[0] === undefined) throw new EnterpriseOperationsError('not-found', 'work-start-reservation', input.idempotencyKey)
      return this.workStartReservation(updated.rows[0])
    })
  }
  /** Executes `EnterpriseOperationsRepository.upsertWorkRecord` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
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
        throw new EnterpriseOperationsError('not-found', 'work-record', input.sessionId)
      await Promise.all([
        this.requireSession(database, input.orgId, input.sessionId),
        this.requireRelease(database, input.orgId, input.employeeReleaseId),
      ])
      const result = await database.query<WorkRow>(
        'SELECT * FROM dsh_enterprise_work_records WHERE org_id = $1 AND session_id = $2 AND employee_release_id = $3 FOR UPDATE',
        [input.orgId, input.sessionId, input.employeeReleaseId],
      )
      const current = result.rows[0]
      const entersActive = input.businessState === 'active' && current?.business_state !== 'active'
      if (input.teamId !== undefined && (current?.team_id !== input.teamId || entersActive)) {
        const target = await this.teamTarget(database, input.orgId, input.teamId)
        const eligible = target.definition.roster.some(member => member.actor.kind === 'agent'
          && member.actor.employeeReleaseId === input.employeeReleaseId)
        if (!eligible) throw new EnterpriseOperationsError('invalid-state', 'team-definition', input.teamId)
      }
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
  private workStartReservation(row: WorkStartReservationRow): WorkStartReservation {
    return {
      orgId: row.org_id, userId: row.user_id, idempotencyKey: row.idempotency_key,
      requestFingerprint: row.request_fingerprint, sessionId: row.session_id, workspaceId: row.workspace_id,
      employeeReleaseId: row.employee_release_id, presetId: row.preset_id,
      ...(row.deadline === null ? {} : { deadline: row.deadline }),
      ...(row.deadline_digest === null ? {} : { deadlineDigest: row.deadline_digest }),
      state: row.state, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    }
  }
  /** Executes `EnterpriseOperationsRepository.getWorkRecord` for this instance.
   * @param employeeReleaseId - Input value used by this API.
   * @param orgId - Input value used by this API.
   * @param sessionId - Input value used by this API.
   * @returns Result produced by this API.
   */
  async getWorkRecord(orgId: string, sessionId: string, employeeReleaseId: string): Promise<WorkRecordView | undefined> {
    await this.initialize()
    const result = await this.database.query<WorkRow>(
      'SELECT * FROM dsh_enterprise_work_records WHERE org_id = $1 AND session_id = $2 AND employee_release_id = $3',
      [orgId, sessionId, employeeReleaseId],
    )
    const row = result.rows[0]
    return row === undefined || row.org_id !== orgId ? undefined : this.work(row)
  }
  /** Executes `EnterpriseOperationsRepository.listWorkRecords` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async listWorkRecords(input: {
    orgId: string
    businessState?: BusinessState
    source?: WorkRecordInput['source']
    teamId?: string
    limit?: number
    cursor?: string
  }): Promise<WorkRecordPage> {
    await this.initialize()
    const limit = listLimit(input.limit)
    const scope = cursorScope('work', { orgId: input.orgId, businessState: input.businessState, source: input.source, teamId: input.teamId })
    const cursor = decodeCursor(input.cursor, scope, this.cursorSigningKey)
    const values: unknown[] = [input.orgId]
    const clauses = ['org_id = $1']
    for (const [column, value] of [['business_state', input.businessState], ['source', input.source], ['team_id', input.teamId]] as const) {
      if (value !== undefined) { values.push(value); clauses.push(`${column} = $${String(values.length)}`) }
    }
    if (cursor !== undefined) {
      if (cursor.ids.length !== 2) throw new EnterpriseOperationsError('cursor-invalid', 'work-record')
      values.push(cursor.createdAt, cursor.ids[0], cursor.ids[1])
      clauses.push(`(created_at, session_id, employee_release_id) < ($${String(values.length - 2)}, $${String(values.length - 1)}, $${String(values.length)})`)
    }
    values.push(limit + 1)
    const result = await this.database.query<WorkRow>(
      `SELECT * FROM dsh_enterprise_work_records WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, session_id DESC, employee_release_id DESC LIMIT $${String(values.length)}`,
      values,
    )
    const page = result.rows.slice(0, limit)
    const last = page.at(-1)
    return {
      items: page.map(row => this.work(row)),
      ...(result.rows.length <= limit || last === undefined ? {} : {
        nextCursor: encodeCursor(scope, Number(last.created_at), [last.session_id, last.employee_release_id], this.cursorSigningKey),
      }),
    }
  }
  /** Executes `EnterpriseOperationsRepository.createApprovalRequest` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
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
  /** Executes `EnterpriseOperationsRepository.getApproval` for this instance.
   * @param approvalId - Input value used by this API.
   * @param orgId - Input value used by this API.
   * @returns Result produced by this API.
   */
  async getApproval(orgId: string, approvalId: string): Promise<ApprovalView | undefined> {
    await this.initialize()
    const result = await this.database.query<ApprovalRow>(
      'SELECT * FROM dsh_enterprise_approval_requests WHERE approval_id = $1 AND org_id = $2', [approvalId, orgId],
    )
    const row = result.rows[0]
    return row === undefined || row.org_id !== orgId ? undefined : this.approval(row)
  }
  /** Executes `EnterpriseOperationsRepository.listApprovals` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async listApprovals(input: {
    orgId: string
    kind?: ApprovalKind
    state?: ApprovalView['state']
    requestedBy?: string
    limit?: number
    cursor?: string
  }): Promise<ApprovalPage> {
    await this.initialize()
    const limit = listLimit(input.limit)
    const scope = cursorScope('approval', { orgId: input.orgId, kind: input.kind, state: input.state, requestedBy: input.requestedBy })
    const cursor = decodeCursor(input.cursor, scope, this.cursorSigningKey)
    const values: unknown[] = [input.orgId]
    const clauses = ['org_id = $1']
    for (const [column, value] of [['kind', input.kind], ['state', input.state], ['requested_by', input.requestedBy]] as const) {
      if (value !== undefined) { values.push(value); clauses.push(`${column} = $${String(values.length)}`) }
    }
    if (cursor !== undefined) {
      if (cursor.ids.length !== 1) throw new EnterpriseOperationsError('cursor-invalid', 'approval')
      values.push(cursor.createdAt, cursor.ids[0])
      clauses.push(`(created_at, approval_id) < ($${String(values.length - 1)}, $${String(values.length)})`)
    }
    values.push(limit + 1)
    const result = await this.database.query<ApprovalRow>(
      `SELECT * FROM dsh_enterprise_approval_requests WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, approval_id DESC LIMIT $${String(values.length)}`,
      values,
    )
    const page = result.rows.slice(0, limit)
    const last = page.at(-1)
    return { items: page.map(row => this.approval(row)), ...(result.rows.length <= limit || last === undefined ? {} : {
      nextCursor: encodeCursor(scope, Number(last.created_at), [last.approval_id], this.cursorSigningKey),
    }) }
  }
  /** Executes `EnterpriseOperationsRepository.transitionApproval` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async transitionApproval(input: {
    approvalId: string
    orgId: string
    expectedRevision: number
    idempotencyKey: string
    state: 'approved' | 'rejected' | 'cancelled'
    reviewerUserId?: string
    actorUserId?: string
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
      if (current === undefined || current.org_id !== input.orgId) {
        throw new EnterpriseOperationsError('not-found', 'approval', input.approvalId)
      }
      if (Number(current.revision) !== input.expectedRevision)
        throw new ApprovalRevisionConflictError(input.approvalId, input.expectedRevision, Number(current.revision))
      if (current.state !== 'pending') throw new EnterpriseOperationsError('invalid-state', 'approval', input.approvalId)
      const actor = input.state === 'cancelled' ? input.actorUserId : input.reviewerUserId
      if (actor === undefined || actor.length === 0) throw new Error('approval transition actor is required')
      const updated = await database.query<ApprovalRow>(
        'UPDATE dsh_enterprise_approval_requests SET state=$1, reviewer_user_id=$2, reason=$3, updated_at=$4, ' +
          'revision=revision+1 WHERE approval_id=$5 AND org_id=$6 AND revision=$7 RETURNING *',
        [input.state, actor, input.reason ?? null, this.now(), input.approvalId, input.orgId, input.expectedRevision],
      )
      if (updated.rows[0] === undefined)
        throw new ApprovalRevisionConflictError(input.approvalId, input.expectedRevision, Number(current.revision))
      const view = this.approval(updated.rows[0])
      await this.remember(database, input.orgId, 'approval-transition', input.idempotencyKey, input, view)
      return view
    })
  }
  /** Executes `EnterpriseOperationsRepository.createSchedule` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
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
      if (input.target.kind === 'employee') await this.requireRelease(database, input.orgId, input.target.employeeReleaseId)
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
  /** Executes `EnterpriseOperationsRepository.saveSchedule` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async saveSchedule(input: {
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
    if (input.expectedRevision === 0) return this.createSchedule(input)
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `schedule:${input.scheduleId}`)
      await this.lockIdempotency(database, input.orgId, 'schedule-save', input.idempotencyKey)
      const prior = await this.idempotent<ScheduleView>(database, input.orgId, 'schedule-save', input.idempotencyKey, input)
      if (prior !== undefined) return prior
      const current = await database.query<ScheduleRow>(
        'SELECT * FROM dsh_enterprise_schedules WHERE schedule_id = $1 AND org_id = $2 FOR UPDATE', [input.scheduleId, input.orgId],
      )
      const row = current.rows[0]
      if (row === undefined || row.org_id !== input.orgId) throw new EnterpriseOperationsError('not-found', 'schedule', input.scheduleId)
      if (row.state === 'archived') throw new EnterpriseOperationsError('invalid-state', 'schedule', input.scheduleId)
      if (Number(row.revision) !== input.expectedRevision) throw new Error(`schedule ${input.scheduleId} revision conflict`)
      if (input.target.kind === 'employee') await this.requireRelease(database, input.orgId, input.target.employeeReleaseId)
      else await this.teamTarget(database, input.orgId, input.target.teamId)
      const updated = await database.query<ScheduleRow>(
        'UPDATE dsh_enterprise_schedules SET target_json=$1::jsonb,timezone=$2,rule=$3,input_json=$4::jsonb,next_run_at=$5,' +
          'updated_at=$6,revision=revision+1 WHERE schedule_id=$7 AND org_id=$8 AND revision=$9 RETURNING *',
        [JSON.stringify(input.target), input.timezone, input.rule, JSON.stringify(input.input), input.nextRunAt,
          this.now(), input.scheduleId, input.orgId, input.expectedRevision],
      )
      if (updated.rows[0] === undefined) throw new Error(`schedule ${input.scheduleId} revision conflict`)
      const view = this.schedule(updated.rows[0])
      await this.remember(database, input.orgId, 'schedule-save', input.idempotencyKey, input, view)
      return view
    })
  }
  /** Executes `EnterpriseOperationsRepository.updateSchedule` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async updateSchedule(input: Parameters<EnterpriseOperationsRepository['saveSchedule']>[0]): Promise<ScheduleView> {
    return this.saveSchedule(input)
  }
  /** Executes `EnterpriseOperationsRepository.getSchedule` for this instance.
   * @param orgId - Input value used by this API.
   * @param scheduleId - Input value used by this API.
   * @returns Result produced by this API.
  */
  async getSchedule(orgId: string, scheduleId: string): Promise<ScheduleView | undefined> {
    await this.initialize()
    const result = await this.database.query<ScheduleRow>('SELECT * FROM dsh_enterprise_schedules WHERE schedule_id = $1 AND org_id = $2', [
      scheduleId,
      orgId,
    ])
    const row = result.rows[0]
    return row === undefined || row.org_id !== orgId ? undefined : this.schedule(row)
  }
  /** Executes `EnterpriseOperationsRepository.listSchedules` for this instance.
   * @param orgId - Input value used by this API.
   * @returns Result produced by this API.
  */
  async listSchedules(orgId: string): Promise<readonly ScheduleView[]>
  /** Executes `EnterpriseOperationsRepository.listSchedules` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
  async listSchedules(input: { orgId: string; state?: ScheduleView['state']; limit?: number; cursor?: string }): Promise<SchedulePage>
  async listSchedules(input: string | { orgId: string; state?: ScheduleView['state']; limit?: number; cursor?: string }): Promise<readonly ScheduleView[] | SchedulePage> {
    await this.initialize()
    if (typeof input === 'string') {
      const result = await this.database.query<ScheduleRow>(
        'SELECT * FROM dsh_enterprise_schedules WHERE org_id = $1 ORDER BY created_at DESC, schedule_id DESC', [input],
      )
      return result.rows.map(row => this.schedule(row))
    }
    const query = input
    const limit = listLimit(query.limit)
    const scope = cursorScope('schedule', { orgId: query.orgId, state: query.state })
    const cursor = decodeCursor(query.cursor, scope, this.cursorSigningKey)
    const values: unknown[] = [query.orgId]
    const clauses = ['org_id = $1']
    if (query.state !== undefined) { values.push(query.state); clauses.push(`state = $${String(values.length)}`) }
    if (cursor !== undefined) {
      if (cursor.ids.length !== 1) throw new EnterpriseOperationsError('cursor-invalid', 'schedule')
      values.push(cursor.createdAt, cursor.ids[0])
      clauses.push(`(created_at, schedule_id) < ($${String(values.length - 1)}, $${String(values.length)})`)
    }
    values.push(limit + 1)
    const result = await this.database.query<ScheduleRow>(
      `SELECT * FROM dsh_enterprise_schedules WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, schedule_id DESC LIMIT $${String(values.length)}`,
      values,
    )
    const page = result.rows.slice(0, limit)
    const last = page.at(-1)
    return { items: page.map(row => this.schedule(row)), ...(result.rows.length <= limit || last === undefined ? {} : {
      nextCursor: encodeCursor(scope, Number(last.created_at), [last.schedule_id], this.cursorSigningKey),
    }) }
  }
  /** Executes `EnterpriseOperationsRepository.transitionSchedule` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
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
      if (row === undefined) throw new EnterpriseOperationsError('not-found', 'schedule', input.scheduleId)
      if (Number(row.revision) !== input.expectedRevision) throw new Error(`schedule ${input.scheduleId} revision conflict`)
      if (row.state === 'archived' && input.state !== 'archived') {
        throw new EnterpriseOperationsError('invalid-state', 'schedule', input.scheduleId)
      }
      const updated = await database.query<ScheduleRow>(
        'UPDATE dsh_enterprise_schedules SET state = $1, updated_at = $2, revision = revision + 1 WHERE schedule_id = $3 AND org_id = $4 AND revision = $5 RETURNING *',
        [input.state, this.now(), input.scheduleId, input.orgId, input.expectedRevision],
      )
      const view = this.schedule(required(updated.rows[0], 'schedule'))
      await this.remember(database, input.orgId, 'schedule-transition', input.idempotencyKey, input, view)
      return view
    })
  }
  /** Executes `EnterpriseOperationsRepository.fireSchedule` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
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
      const employeeReleaseId = target.kind === 'employee'
        ? target.employeeReleaseId
        : required(team, 'fixed team').definition.leaderEmployeeReleaseId
      const teamId = target.kind === 'team' ? target.teamId : undefined
      await this.requireRelease(database, input.orgId, employeeReleaseId)
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
          "employee_release_id,team_id,team_definition_revision,payload_json,state,attempt_count,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'pending',0,$10) RETURNING *",
        [
          randomUUID(),
          input.orgId,
          input.scheduleId,
          input.occurrenceKey,
          input.sessionId,
          employeeReleaseId,
          teamId ?? null,
          team?.definition.revision ?? null,
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
  /** Claim pending or expired outbox commands using a worker lease (fencing token).
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
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
          "UPDATE dsh_enterprise_operation_outbox SET state = 'processing', lease_owner = $1, lease_expires_at = $2, attempt_count = attempt_count + 1, last_error = NULL, start_admitted_at = NULL WHERE command_id = $3 RETURNING *",
          [input.workerId, now + input.leaseMs, row.command_id],
        )
        if (result.rows[0] !== undefined) claimed.push(this.outbox(result.rows[0]))
      }
      return claimed
    })
  }
  /** Executes `EnterpriseOperationsRepository.admitOutboxStart` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
  async admitOutboxStart(input: { orgId: string; commandId: string; workerId: string }): Promise<OutboxCommandView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      const current = await database.query<OutboxRow>(
        'SELECT * FROM dsh_enterprise_operation_outbox WHERE command_id=$1 AND org_id=$2 FOR UPDATE',
        [input.commandId, input.orgId],
      )
      const row = current.rows[0]
      const now = this.now()
      if (row === undefined || row.state !== 'processing' || row.lease_owner !== input.workerId
        || row.lease_expires_at === null || Number(row.lease_expires_at) < now)
        throw new EnterpriseOperationsError('fencing-lost', 'operation-outbox', input.commandId)
      if (row.team_id !== null) {
        const target = await this.teamTarget(database, input.orgId, row.team_id)
        if (row.team_definition_revision === null
          || Number(row.team_definition_revision) !== target.definition.revision
          || row.employee_release_id !== target.definition.leaderEmployeeReleaseId)
          throw new EnterpriseOperationsError('admission-rejected', 'team-definition', row.team_id)
      }
      const admitted = await database.query<OutboxRow>(
        `UPDATE dsh_enterprise_operation_outbox SET start_admitted_at=$1
          WHERE command_id=$2 AND org_id=$3 AND state='processing' AND lease_owner=$4 AND lease_expires_at >= $1 RETURNING *`,
        [now, input.commandId, input.orgId, input.workerId],
      )
      if (admitted.rows[0] === undefined)
        throw new EnterpriseOperationsError('fencing-lost', 'operation-outbox', input.commandId)
      return this.outbox(admitted.rows[0])
    })
  }
  /** Executes `EnterpriseOperationsRepository.completeOutbox` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
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
  /** Executes `EnterpriseOperationsRepository.failOutbox` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
  async failOutbox(input: {
    orgId: string
    commandId: string
    workerId: string
    error: string
    retryable: boolean
  }): Promise<OutboxCommandView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      const state: OutboxState = input.retryable ? 'pending' : 'dead-letter'
      const result = await database.query<OutboxRow>(
        "UPDATE dsh_enterprise_operation_outbox SET state = $1, lease_owner = NULL, lease_expires_at = NULL, start_admitted_at = NULL, last_error = $2 WHERE command_id = $3 AND org_id = $4 AND state = 'processing' AND lease_owner = $5 RETURNING *",
        [state, input.error.slice(0, 2000), input.commandId, input.orgId, input.workerId],
      )
      return this.outbox(required(result.rows[0], 'outbox command'))
    })
  }
  /** Executes `EnterpriseOperationsRepository.createFixedTeam` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
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
      await this.lock(database, teamLockKey(input.orgId, input.teamId))
      await this.lockIdempotency(database, input.orgId, 'team-create', input.idempotencyKey)
      const prior = await this.idempotent<FixedTeamView>(database, input.orgId, 'team-create', input.idempotencyKey, input)
      if (prior !== undefined) return prior
      if (input.expectedRevision !== 0) throw new Error(`fixed team ${input.teamId} revision conflict`)
      const existingFixed = await database.query<TeamRow>(
        'SELECT * FROM dsh_enterprise_fixed_teams WHERE team_id = $1 FOR UPDATE', [input.teamId],
      )
      if (existingFixed.rows[0] !== undefined)
        throw new EnterpriseOperationsError('conflict', 'team', input.teamId)
      await Promise.all([
        this.requireRelease(database, input.orgId, input.leaderEmployeeReleaseId),
        ...input.members.map(member => this.requireRelease(database, input.orgId, member.employeeReleaseId)),
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
      await this.ensureFixedTeamDefinition(database, input, now)
      const view = this.team(required(result.rows[0], 'fixed team'), input.members)
      await this.remember(database, input.orgId, 'team-create', input.idempotencyKey, input, view)
      return view
    })
  }
  /** Executes `EnterpriseOperationsRepository.saveFixedTeam` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
  async saveFixedTeam(input: {
    teamId: string
    orgId: string
    leaderEmployeeReleaseId: string
    members: readonly { employeeReleaseId: string; role: string }[]
    workflowTemplate: Readonly<Record<string, unknown>>
    approvalPolicy: Readonly<Record<string, unknown>>
    expectedRevision: number
    idempotencyKey: string
  }): Promise<FixedTeamView> {
    if (input.expectedRevision === 0) return this.createFixedTeam(input)
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, teamLockKey(input.orgId, input.teamId))
      await this.lockIdempotency(database, input.orgId, 'team-save', input.idempotencyKey)
      const prior = await this.idempotent<FixedTeamView>(database, input.orgId, 'team-save', input.idempotencyKey, input)
      if (prior !== undefined) return prior
      const current = await database.query<TeamRow>(
        'SELECT * FROM dsh_enterprise_fixed_teams WHERE team_id = $1 AND org_id = $2 FOR UPDATE', [input.teamId, input.orgId],
      )
      const row = current.rows[0]
      if (row === undefined || row.org_id !== input.orgId) throw new EnterpriseOperationsError('not-found', 'team', input.teamId)
      if (Number(row.revision) !== input.expectedRevision) throw new Error(`fixed team ${input.teamId} revision conflict`)
      const definitions = await database.query<TeamDefinitionRow>(
        'SELECT * FROM dsh_enterprise_team_definitions WHERE org_id=$1 AND team_id=$2 FOR UPDATE',
        [input.orgId, input.teamId],
      )
      const definition = definitions.rows[0]
      if (definition === undefined)
        throw new EnterpriseOperationsError('invalid-state', 'team-definition', input.teamId)
      const currentMembers = await database.query<{ employee_release_id: string; role: string }>(
        'SELECT employee_release_id, role FROM dsh_enterprise_fixed_team_members WHERE team_id = $1 ORDER BY employee_release_id',
        [input.teamId],
      )
      const before = this.team(row, currentMembers.rows.map(member => ({
        employeeReleaseId: member.employee_release_id, role: member.role,
      })))
      if (definition.state !== 'needs-charter') {
        const fixedExecutionMatches = input.leaderEmployeeReleaseId === before.leaderEmployeeReleaseId
          && canonicalEqual(sortedFixedMembers(input.members), sortedFixedMembers(before.members))
          && canonicalEqual(input.approvalPolicy, before.approvalPolicy)
        if (!fixedExecutionMatches
          || (definition.state === 'archived' && !canonicalEqual(input.workflowTemplate, before.workflowTemplate)))
          throw new EnterpriseOperationsError('invalid-state', 'team-definition', input.teamId)
        if (canonicalEqual(input.workflowTemplate, before.workflowTemplate)) {
          await this.remember(database, input.orgId, 'team-save', input.idempotencyKey, input, before)
          return before
        }
        const workflowOnly = await database.query<TeamRow>(
          'UPDATE dsh_enterprise_fixed_teams SET workflow_template_json=$1::jsonb,updated_at=$2,revision=revision+1 ' +
            'WHERE team_id=$3 AND org_id=$4 AND revision=$5 RETURNING *',
          [JSON.stringify(input.workflowTemplate), this.now(), input.teamId, input.orgId, input.expectedRevision],
        )
        const view = this.team(required(workflowOnly.rows[0], 'fixed team'), before.members)
        await this.remember(database, input.orgId, 'team-save', input.idempotencyKey, input, view)
        return view
      }
      await Promise.all([
        this.requireRelease(database, input.orgId, input.leaderEmployeeReleaseId),
        ...input.members.map(member => this.requireRelease(database, input.orgId, member.employeeReleaseId)),
      ])
      const updated = await database.query<TeamRow>(
        'UPDATE dsh_enterprise_fixed_teams SET leader_release_id=$1,workflow_template_json=$2::jsonb,' +
          'approval_policy_json=$3::jsonb,updated_at=$4,revision=revision+1 WHERE team_id=$5 AND org_id=$6 AND revision=$7 RETURNING *',
        [input.leaderEmployeeReleaseId, JSON.stringify(input.workflowTemplate), JSON.stringify(input.approvalPolicy),
          this.now(), input.teamId, input.orgId, input.expectedRevision],
      )
      if (updated.rows[0] === undefined) throw new Error(`fixed team ${input.teamId} revision conflict`)
      await database.query('DELETE FROM dsh_enterprise_fixed_team_members WHERE team_id = $1', [input.teamId])
      for (const member of input.members) await database.query(
        'INSERT INTO dsh_enterprise_fixed_team_members(team_id,employee_release_id,role) VALUES ($1,$2,$3)',
        [input.teamId, member.employeeReleaseId, member.role],
      )
      const roles = [...new Set(input.members.map(member => member.role))].sort()
        .map(role => ({ roleId: role, name: role, responsibility: '' }))
      const synced = await database.query<TeamDefinitionRow>(
        `UPDATE dsh_enterprise_team_definitions SET leader_release_id=$1,roster_json=$2::jsonb,
          roles_json=$3::jsonb,approval_policy_json=$4::jsonb,updated_at=$5,revision=revision+1
          WHERE org_id=$6 AND team_id=$7 AND state='needs-charter' RETURNING *`,
        [input.leaderEmployeeReleaseId, JSON.stringify(input.members.map(member => ({
          actor: { kind: 'agent', employeeReleaseId: member.employeeReleaseId }, roleId: member.role,
        }))), JSON.stringify(roles), JSON.stringify(input.approvalPolicy), this.now(), input.orgId, input.teamId],
      )
      if (synced.rows[0] === undefined)
        throw new EnterpriseOperationsError('invalid-state', 'team-definition', input.teamId)
      const syncedDefinition = this.teamDefinition(synced.rows[0])
      const superseded = await database.query<TeamDefinitionRevisionRow>(`UPDATE dsh_enterprise_team_definition_revisions
        SET state='archived',updated_at=$1 WHERE org_id=$2 AND team_id=$3 AND revision=$4 AND state='needs-charter' RETURNING *`,
      [syncedDefinition.updatedAt, input.orgId, input.teamId, Number(definition.revision)])
      if (superseded.rows[0] === undefined)
        throw new EnterpriseOperationsError('conflict', 'team-definition', input.teamId)
      await database.query<TeamDefinitionRevisionRow>(`INSERT INTO dsh_enterprise_team_definition_revisions(
        org_id,team_id,revision,name,north_star,owner_user_id,department_id,visibility,allowed_user_ids_json,
        leader_release_id,roster_json,roles_json,verification_policy_json,attention_policy_json,approval_policy_json,
        state,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,'needs-charter',$16,$16)`,
      [syncedDefinition.orgId, syncedDefinition.teamId, syncedDefinition.revision, syncedDefinition.name,
        syncedDefinition.northStar, syncedDefinition.ownerUserId, syncedDefinition.departmentId ?? null,
        syncedDefinition.visibility, syncedDefinition.allowedUserIds === undefined ? null : JSON.stringify(syncedDefinition.allowedUserIds),
        syncedDefinition.leaderEmployeeReleaseId, JSON.stringify(syncedDefinition.roster), JSON.stringify(syncedDefinition.roles),
        JSON.stringify(syncedDefinition.verificationPolicy), JSON.stringify(syncedDefinition.attentionPolicy),
        JSON.stringify(syncedDefinition.approvalPolicy), syncedDefinition.updatedAt])
      const view = this.team(updated.rows[0], input.members)
      await this.remember(database, input.orgId, 'team-save', input.idempotencyKey, input, view)
      return view
    })
  }
  /** Executes `EnterpriseOperationsRepository.updateFixedTeam` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
  async updateFixedTeam(input: Parameters<EnterpriseOperationsRepository['saveFixedTeam']>[0]): Promise<FixedTeamView> {
    return this.saveFixedTeam(input)
  }
  /** Executes `EnterpriseOperationsRepository.getFixedTeam` for this instance.
   * @param orgId - Input value used by this API.
   * @param teamId - Input value used by this API.
   * @returns Result produced by this API.
  */
  async getFixedTeam(orgId: string, teamId: string): Promise<FixedTeamView | undefined> {
    await this.initialize()
    const result = await this.database.query<TeamRow>(
      'SELECT * FROM dsh_enterprise_fixed_teams WHERE team_id = $1 AND org_id = $2', [teamId, orgId],
    )
    const row = result.rows[0]
    if (row === undefined || row.org_id !== orgId) return undefined
    const members = await this.database.query<{ employee_release_id: string; role: string }>(
      'SELECT employee_release_id, role FROM dsh_enterprise_fixed_team_members WHERE team_id = $1 ORDER BY employee_release_id', [teamId],
    )
    return this.team(row, members.rows.map(member => ({ employeeReleaseId: member.employee_release_id, role: member.role })))
  }
  /** Executes `EnterpriseOperationsRepository.listFixedTeams` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
  async listFixedTeams(input: { orgId: string; limit?: number; cursor?: string }): Promise<FixedTeamPage> {
    await this.initialize()
    const limit = listLimit(input.limit)
    const scope = cursorScope('team', { orgId: input.orgId })
    const cursor = decodeCursor(input.cursor, scope, this.cursorSigningKey)
    const values: unknown[] = [input.orgId]
    const clauses = ['org_id = $1']
    if (cursor !== undefined) {
      if (cursor.ids.length !== 1) throw new EnterpriseOperationsError('cursor-invalid', 'team')
      values.push(cursor.createdAt, cursor.ids[0])
      clauses.push(`(created_at, team_id) < ($${String(values.length - 1)}, $${String(values.length)})`)
    }
    values.push(limit + 1)
    const result = await this.database.query<TeamRow>(
      `SELECT * FROM dsh_enterprise_fixed_teams WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, team_id DESC LIMIT $${String(values.length)}`,
      values,
    )
    const page = result.rows.slice(0, limit)
    const items = await Promise.all(page.map(async (row) => {
      const members = await this.database.query<{ employee_release_id: string; role: string }>(
        'SELECT employee_release_id, role FROM dsh_enterprise_fixed_team_members WHERE team_id = $1 ORDER BY employee_release_id', [row.team_id],
      )
      return this.team(row, members.rows.map(member => ({ employeeReleaseId: member.employee_release_id, role: member.role })))
    }))
    const last = page.at(-1)
    return { items, ...(result.rows.length <= limit || last === undefined ? {} : {
      nextCursor: encodeCursor(scope, Number(last.created_at), [last.team_id], this.cursorSigningKey),
    }) }
  }
  /** Executes `EnterpriseOperationsRepository.createTeamDefinition` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
  async createTeamDefinition(input: Omit<EnterpriseTeamDefinition, 'revision' | 'createdAt' | 'updatedAt'> & {
    expectedRevision: number
    idempotencyKey: string
  }): Promise<EnterpriseTeamDefinition> {
    if (input.expectedRevision !== 0) throw new EnterpriseOperationsError('conflict', 'team-definition', input.teamId)
    if (input.state === 'archived') throw new EnterpriseOperationsError('invalid-transition', 'team-definition', input.teamId)
    return this.saveTeamDefinitionDraft({
      ...input,
      state: input.state === 'needs-charter' ? 'needs-charter' : 'draft',
    })
  }
  /** Executes `EnterpriseOperationsRepository.saveTeamDefinition` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
  async saveTeamDefinition(input: Omit<EnterpriseTeamDefinition, 'revision' | 'createdAt' | 'updatedAt'> & {
    expectedRevision: number
    idempotencyKey: string
  }): Promise<EnterpriseTeamDefinition> {
    if (input.state === 'archived') throw new EnterpriseOperationsError('invalid-transition', 'team-definition', input.teamId)
    return this.saveTeamDefinitionDraft({
      ...input,
      state: input.state === 'needs-charter' ? 'needs-charter' : 'draft',
    })
  }
  /**
   * Save the sole draft revision. The active projection is intentionally untouched,
   * so TeamRuns already admitted from it retain their exact charter snapshot.

   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
  async saveTeamDefinitionDraft(input: Omit<EnterpriseTeamDefinition, 'revision' | 'createdAt' | 'updatedAt' | 'state'> & {
    expectedRevision: number
    idempotencyKey: string
    state?: 'needs-charter' | 'draft'
  }): Promise<EnterpriseTeamDefinitionRevision> {
    input = canonicalDefinitionInput(input)
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, teamLockKey(input.orgId, input.teamId))
      await this.lockIdempotency(database, input.orgId, 'team-definition-draft', input.idempotencyKey)
      const prior = await this.idempotent<EnterpriseTeamDefinitionRevision>(database, input.orgId, 'team-definition-draft', input.idempotencyKey, input)
      if (prior !== undefined) return prior
      const projection = await database.query<{ state: TeamDefinitionRow['state'] }>(
        'SELECT state FROM dsh_enterprise_team_definitions WHERE org_id=$1 AND team_id=$2 FOR UPDATE',
        [input.orgId, input.teamId],
      )
      if (projection.rows[0]?.state === 'archived')
        throw new EnterpriseOperationsError('conflict', 'team-definition', input.teamId)
      const draftResult = await database.query<TeamDefinitionRevisionRow>(
        'SELECT * FROM dsh_enterprise_team_definition_revisions WHERE org_id=$1 AND team_id=$2 AND state IN (\'draft\',\'needs-charter\') FOR UPDATE',
        [input.orgId, input.teamId],
      )
      const activeResult = await database.query<TeamDefinitionRevisionRow>(
        'SELECT * FROM dsh_enterprise_team_definition_revisions WHERE org_id=$1 AND team_id=$2 AND state=\'active\' FOR UPDATE',
        [input.orgId, input.teamId],
      )
      const draft = draftResult.rows[0]
      const active = activeResult.rows[0]
      if (draft !== undefined && Number(draft.revision) !== input.expectedRevision)
        throw new EnterpriseOperationsError('conflict', 'team-definition', input.teamId)
      if (draft === undefined && active !== undefined && Number(active.revision) !== input.expectedRevision)
        throw new EnterpriseOperationsError('conflict', 'team-definition', input.teamId)
      if (draft === undefined && active === undefined && input.expectedRevision !== 0)
        throw new EnterpriseOperationsError('not-found', 'team-definition', input.teamId)
      const now = this.now()
      const revision = Math.max(Number(draft?.revision ?? 0), Number(active?.revision ?? 0)) + 1
      const candidate: EnterpriseTeamDefinition = {
        ...input, state: input.state ?? 'draft', revision, createdAt: now, updatedAt: now,
      }
      validateTeamDefinition(candidate)
      await this.requireTeamDefinitionReleases(database, input.orgId, candidate)
      const values = [candidate.orgId, candidate.teamId, candidate.revision, candidate.name, candidate.northStar,
        candidate.ownerUserId, candidate.departmentId ?? null, candidate.visibility,
        candidate.allowedUserIds === undefined ? null : JSON.stringify(candidate.allowedUserIds), candidate.leaderEmployeeReleaseId,
        JSON.stringify(candidate.roster), JSON.stringify(candidate.roles), JSON.stringify(candidate.verificationPolicy),
        JSON.stringify(candidate.attentionPolicy), JSON.stringify(candidate.approvalPolicy), candidate.state, now] as const
      if (draft !== undefined) {
        const superseded = await database.query<TeamDefinitionRevisionRow>(`UPDATE dsh_enterprise_team_definition_revisions
          SET state='archived',updated_at=$1 WHERE org_id=$2 AND team_id=$3 AND revision=$4
            AND state IN ('draft','needs-charter') RETURNING *`, [now, input.orgId, input.teamId, input.expectedRevision])
        if (superseded.rows[0] === undefined) throw new EnterpriseOperationsError('conflict', 'team-definition', input.teamId)
      }
      const saved = await database.query<TeamDefinitionRevisionRow>(`INSERT INTO dsh_enterprise_team_definition_revisions(
          org_id,team_id,revision,name,north_star,owner_user_id,department_id,visibility,allowed_user_ids_json,leader_release_id,
          roster_json,roles_json,verification_policy_json,attention_policy_json,approval_policy_json,state,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$17) RETURNING *`, values)
      const view = this.teamDefinitionRevision(required(saved.rows[0], 'team definition draft'))
      await this.remember(database, input.orgId, 'team-definition-draft', input.idempotencyKey, input, view)
      return view
    })
  }

  /** Validate and atomically promote the draft before refreshing the compatibility projection.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
  async publishTeamDefinitionDraft(input: {
    orgId: string
    teamId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<EnterpriseTeamDefinition> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, teamLockKey(input.orgId, input.teamId))
      await this.lockIdempotency(database, input.orgId, 'team-definition-publish', input.idempotencyKey)
      const prior = await this.idempotent<EnterpriseTeamDefinition>(database, input.orgId, 'team-definition-publish', input.idempotencyKey, input)
      if (prior !== undefined) return prior
      const selected = await database.query<TeamDefinitionRevisionRow>(
        `SELECT * FROM dsh_enterprise_team_definition_revisions WHERE org_id=$1 AND team_id=$2
          AND revision=$3 AND state IN ('draft','needs-charter') FOR UPDATE`, [input.orgId, input.teamId, input.expectedRevision],
      )
      if (selected.rows[0] === undefined) throw new EnterpriseOperationsError('conflict', 'team-definition', input.teamId)
      const candidate: EnterpriseTeamDefinition = { ...this.teamDefinition(selected.rows[0]), state: 'active' }
      validateTeamDefinition(candidate)
      await this.requireTeamDefinitionReleases(database, input.orgId, candidate)
      await this.requireTeamDefinitionIdentities(database, input.orgId, candidate)
      const now = this.now()
      await database.query(`UPDATE dsh_enterprise_team_definition_revisions SET state='archived',updated_at=$1
        WHERE org_id=$2 AND team_id=$3 AND state='active'`, [now, input.orgId, input.teamId])
      await database.query(`UPDATE dsh_enterprise_team_definition_revisions SET state='active',updated_at=$1
        WHERE org_id=$2 AND team_id=$3 AND revision=$4 AND state IN ('draft','needs-charter')`, [now, input.orgId, input.teamId, input.expectedRevision])
      let updated = await database.query<TeamDefinitionRow>(`UPDATE dsh_enterprise_team_definitions SET
        name=$1,north_star=$2,owner_user_id=$3,department_id=$4,visibility=$5,allowed_user_ids_json=$6::jsonb,
        leader_release_id=$7,roster_json=$8::jsonb,roles_json=$9::jsonb,verification_policy_json=$10::jsonb,
        attention_policy_json=$11::jsonb,approval_policy_json=$12::jsonb,state='active',revision=$13,updated_at=$14
        WHERE org_id=$15 AND team_id=$16 RETURNING *`, [candidate.name, candidate.northStar, candidate.ownerUserId,
        candidate.departmentId ?? null, candidate.visibility,
        candidate.allowedUserIds === undefined ? null : JSON.stringify(candidate.allowedUserIds),
        candidate.leaderEmployeeReleaseId, JSON.stringify(candidate.roster), JSON.stringify(candidate.roles),
        JSON.stringify(candidate.verificationPolicy), JSON.stringify(candidate.attentionPolicy), JSON.stringify(candidate.approvalPolicy),
        candidate.revision, now, input.orgId, input.teamId])
      if (updated.rows[0] === undefined) updated = await database.query<TeamDefinitionRow>(
        `INSERT INTO dsh_enterprise_team_definitions(
          org_id,team_id,name,north_star,owner_user_id,department_id,visibility,allowed_user_ids_json,leader_release_id,
          roster_json,roles_json,verification_policy_json,attention_policy_json,approval_policy_json,state,revision,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,'active',$15,$16,$16) RETURNING *`,
        [candidate.orgId, candidate.teamId, candidate.name, candidate.northStar, candidate.ownerUserId,
          candidate.departmentId ?? null, candidate.visibility,
          candidate.allowedUserIds === undefined ? null : JSON.stringify(candidate.allowedUserIds),
          candidate.leaderEmployeeReleaseId, JSON.stringify(candidate.roster), JSON.stringify(candidate.roles),
          JSON.stringify(candidate.verificationPolicy), JSON.stringify(candidate.attentionPolicy), JSON.stringify(candidate.approvalPolicy),
          candidate.revision, now],
      )
      const view = this.teamDefinition(required(updated.rows[0], 'published team definition'))
      await this.projectActiveDefinitionToFixedTeam(database, view)
      await this.remember(database, input.orgId, 'team-definition-publish', input.idempotencyKey, input, view)
      return view
    })
  }

  /** Discard a draft by archiving its immutable revision; the active revision remains executable.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
  async discardTeamDefinitionDraft(input: {
    orgId: string
    teamId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<EnterpriseTeamDefinitionRevision> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, teamLockKey(input.orgId, input.teamId))
      await this.lockIdempotency(database, input.orgId, 'team-definition-discard-draft', input.idempotencyKey)
      const prior = await this.idempotent<EnterpriseTeamDefinitionRevision>(database, input.orgId, 'team-definition-discard-draft', input.idempotencyKey, input)
      if (prior !== undefined) return prior
      const result = await database.query<TeamDefinitionRevisionRow>(`UPDATE dsh_enterprise_team_definition_revisions
        SET state='archived',updated_at=$1 WHERE org_id=$2 AND team_id=$3 AND revision=$4
          AND state IN ('draft','needs-charter') RETURNING *`, [this.now(), input.orgId, input.teamId, input.expectedRevision])
      if (result.rows[0] === undefined) throw new EnterpriseOperationsError('conflict', 'team-definition', input.teamId)
      const view = this.teamDefinitionRevision(result.rows[0])
      await this.remember(database, input.orgId, 'team-definition-discard-draft', input.idempotencyKey, input, view)
      return view
    })
  }

  /** Executes `EnterpriseOperationsRepository.archiveTeamDefinition` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
  async archiveTeamDefinition(input: {
    orgId: string
    teamId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<EnterpriseTeamDefinition> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, teamLockKey(input.orgId, input.teamId))
      await this.lockIdempotency(database, input.orgId, 'team-definition-archive', input.idempotencyKey)
      const prior = await this.idempotent<EnterpriseTeamDefinition>(
        database, input.orgId, 'team-definition-archive', input.idempotencyKey, input,
      )
      if (prior !== undefined) return prior
      await this.assertNoLiveTeamAdmission(database, input.orgId, input.teamId)
      const now = this.now()
      await database.query<TeamDefinitionRevisionRow>(`UPDATE dsh_enterprise_team_definition_revisions
        SET state='archived',updated_at=$1 WHERE org_id=$2 AND team_id=$3 AND state IN ('active','draft','needs-charter')`,
      [now, input.orgId, input.teamId])
      const updated = await database.query<TeamDefinitionRow>(
        `UPDATE dsh_enterprise_team_definitions SET state='archived',updated_at=$1,revision=revision+1
          WHERE org_id=$2 AND team_id=$3 AND revision=$4 AND state<>'archived' RETURNING *`,
        [now, input.orgId, input.teamId, input.expectedRevision],
      )
      if (updated.rows[0] === undefined) {
        const current = await database.query<TeamDefinitionRow>(
          'SELECT * FROM dsh_enterprise_team_definitions WHERE org_id=$1 AND team_id=$2', [input.orgId, input.teamId],
        )
        if (current.rows[0] === undefined)
          throw new EnterpriseOperationsError('not-found', 'team-definition', input.teamId)
        throw new EnterpriseOperationsError('conflict', 'team-definition', input.teamId)
      }
      const view = this.teamDefinition(updated.rows[0])
      await this.remember(database, input.orgId, 'team-definition-archive', input.idempotencyKey, input, view)
      return view
    })
  }
  /** Executes `EnterpriseOperationsRepository.getTeamDefinition` for this instance.
   * @param orgId - Input value used by this API.
   * @param readScope - Input value used by this API.
   * @param teamId - Input value used by this API.
   * @returns Result produced by this API.
  */
  async getTeamDefinition(
    orgId: string,
    teamId: string,
    readScope: TeamDefinitionReadScope,
  ): Promise<EnterpriseTeamDefinition | undefined> {
    await this.initialize()
    const result = await this.database.query<TeamDefinitionRow>(
      `SELECT * FROM dsh_enterprise_team_definitions WHERE org_id=$1 AND team_id=$2 AND
        ($3::boolean OR visibility='organization' OR owner_user_id=$4 OR
          (visibility='restricted' AND allowed_user_ids_json ? $4))`,
      [orgId, teamId, readScope.isAdministrator, readScope.userId],
    )
    return result.rows[0] === undefined ? undefined : this.teamDefinition(result.rows[0])
  }
  /** Return only the team's current draft to its owner or an administrator.
   * @param orgId - Input value used by this API.
   * @param readScope - Input value used by this API.
   * @param teamId - Input value used by this API.
   * @returns Result produced by this API.
  */
  async getTeamDefinitionDraft(
    orgId: string,
    teamId: string,
    readScope: TeamDefinitionReadScope,
  ): Promise<EnterpriseTeamDefinitionRevision | undefined> {
    await this.initialize()
    const result = await this.database.query<TeamDefinitionRevisionRow>(
      `SELECT * FROM dsh_enterprise_team_definition_revisions WHERE org_id=$1 AND team_id=$2
        AND state IN ('draft','needs-charter') AND ($3::boolean OR owner_user_id=$4)
        ORDER BY revision DESC LIMIT 1`,
      [orgId, teamId, readScope.isAdministrator, readScope.userId],
    )
    return result.rows[0] === undefined ? undefined : this.teamDefinitionRevision(result.rows[0])
  }
  /** Executes `EnterpriseOperationsRepository.listTeamDefinitions` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
  */
  async listTeamDefinitions(input: {
    orgId: string
    readScope: TeamDefinitionReadScope
    limit?: number
    cursor?: string
  }): Promise<TeamDefinitionPage> {
    await this.initialize()
    const limit = listLimit(input.limit)
    const scope = cursorScope('team-definition', { orgId: input.orgId, ...input.readScope })
    const cursor = decodeCursor(input.cursor, scope, this.cursorSigningKey)
    const values: unknown[] = [input.orgId, input.readScope.isAdministrator, input.readScope.userId]
    const clauses = ['org_id=$1', "($2::boolean OR visibility='organization' OR owner_user_id=$3 OR (visibility='restricted' AND allowed_user_ids_json ? $3))"]
    if (cursor !== undefined) {
      if (cursor.ids.length !== 1) throw new EnterpriseOperationsError('cursor-invalid', 'team-definition')
      values.push(cursor.createdAt, cursor.ids[0])
      clauses.push(`(created_at,team_id)<($${String(values.length - 1)},$${String(values.length)})`)
    }
    values.push(limit + 1)
    const result = await this.database.query<TeamDefinitionRow>(
      `SELECT * FROM dsh_enterprise_team_definitions WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC,team_id DESC LIMIT $${String(values.length)}`,
      values,
    )
    const drafts = cursor === undefined
      ? await this.database.query<TeamDefinitionRevisionRow>(
        `SELECT * FROM dsh_enterprise_team_definition_revisions WHERE org_id=$1
          AND state IN ('draft','needs-charter') AND ($2::boolean OR owner_user_id=$3)
          ORDER BY created_at DESC,team_id DESC,revision DESC LIMIT $4`,
        [input.orgId, input.readScope.isAdministrator, input.readScope.userId, limit],
      )
      : { rows: [] as TeamDefinitionRevisionRow[] }
    const candidates = [
      ...result.rows.map(row => this.teamDefinition(row)),
      ...drafts.rows.map(row => this.teamDefinitionRevision(row)),
    ].sort((left, right) => right.createdAt - left.createdAt || right.revision - left.revision
      || right.teamId.localeCompare(left.teamId))
    const page = candidates.slice(0, limit)
    const last = page.at(-1)
    return {
      items: page,
      ...(drafts.rows.length > 0 || result.rows.length <= limit || last === undefined ? {} : {
        nextCursor: encodeCursor(scope, last.createdAt, [last.teamId], this.cursorSigningKey),
      }),
    }
  }
  /**
   * Create or CAS-save one organization-scoped channel configuration.
   * @param rawInput - configuration, authenticated actor, revision, and idempotency guard.
   * @returns the committed channel configuration.
   */
  async saveChannelConfiguration(rawInput: ChannelSaveInput): Promise<EnterpriseChannelConfiguration> {
    const input = canonicalChannelInput(rawInput)
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `channel:${input.orgId}:${input.channelId}`)
      const operation = input.expectedRevision === 0 ? 'channel-create' : 'channel-save'
      await this.lockIdempotency(database, input.orgId, operation, input.idempotencyKey)
      const prior = await this.idempotent<EnterpriseChannelConfiguration>(
        database, input.orgId, operation, input.idempotencyKey, input,
      )
      if (prior !== undefined) return prior
      await this.requireUser(database, input.orgId, input.actorUserId)
      if (input.defaultEmployeeReleaseId !== undefined) {
        await this.requireRelease(database, input.orgId, input.defaultEmployeeReleaseId)
      }
      const now = this.now()
      let row: ChannelConfigurationRow | undefined
      if (input.expectedRevision === 0) {
        const existing = await database.query<ChannelConfigurationRow>(
          'SELECT * FROM dsh_enterprise_channel_configurations WHERE org_id=$1 AND channel_id=$2 FOR UPDATE',
          [input.orgId, input.channelId],
        )
        if (existing.rows[0] !== undefined) throw new EnterpriseOperationsError('conflict', 'channel', input.channelId)
        const inserted = await database.query<ChannelConfigurationRow>(
          `INSERT INTO dsh_enterprise_channel_configurations(
            org_id,channel_id,name,provider,tenant_id,account_id,credential_ref,default_employee_release_id,
            inbound_enabled,state,created_by,revision,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$12) RETURNING *`,
          [input.orgId, input.channelId, input.name, input.provider, input.tenantId ?? null,
            input.accountId, input.credentialRef ?? null, input.defaultEmployeeReleaseId ?? null,
            input.inboundEnabled, input.state, input.actorUserId, now],
        )
        row = inserted.rows[0]
      } else {
        const current = await database.query<ChannelConfigurationRow>(
          'SELECT * FROM dsh_enterprise_channel_configurations WHERE org_id=$1 AND channel_id=$2 FOR UPDATE',
          [input.orgId, input.channelId],
        )
        const existing = current.rows[0]
        if (existing === undefined) throw new EnterpriseOperationsError('not-found', 'channel', input.channelId)
        if (existing.state === 'archived') throw new EnterpriseOperationsError('invalid-state', 'channel', input.channelId)
        if (Number(existing.revision) !== input.expectedRevision) {
          throw new EnterpriseOperationsError('conflict', 'channel', input.channelId)
        }
        const updated = await database.query<ChannelConfigurationRow>(
          `UPDATE dsh_enterprise_channel_configurations SET
            name=$1,provider=$2,tenant_id=$3,account_id=$4,credential_ref=$5,default_employee_release_id=$6,
            inbound_enabled=$7,state=$8,
            binding_status=CASE WHEN $9 THEN 'unbound' ELSE binding_status END,
            bound_provider_identity_id=CASE WHEN $9 THEN NULL ELSE bound_provider_identity_id END,
            bound_provider_identity_name=CASE WHEN $9 THEN NULL ELSE bound_provider_identity_name END,
            verified_tenant_id=CASE WHEN $9 THEN NULL ELSE verified_tenant_id END,
            binding_verified_by=CASE WHEN $9 THEN NULL ELSE binding_verified_by END,
            binding_verified_at=CASE WHEN $9 THEN NULL ELSE binding_verified_at END,
            updated_at=$10,revision=revision+1
          WHERE org_id=$11 AND channel_id=$12 AND revision=$13 RETURNING *`,
          [input.name, input.provider, input.tenantId ?? null, input.accountId, input.credentialRef ?? null,
            input.defaultEmployeeReleaseId ?? null, input.inboundEnabled, input.state,
            existing.provider !== input.provider
              || (existing.tenant_id ?? undefined) !== input.tenantId
              || existing.account_id !== input.accountId
              || (existing.credential_ref ?? undefined) !== input.credentialRef,
            now, input.orgId, input.channelId, input.expectedRevision],
        )
        row = updated.rows[0]
      }
      if (row === undefined) throw new EnterpriseOperationsError('conflict', 'channel', input.channelId)
      const view = this.channelConfiguration(row)
      await this.remember(database, input.orgId, operation, input.idempotencyKey, input, view)
      return view
    })
  }

  /**
   * Replace the verified provider identity evidence for one active channel revision.
   * @param rawInput - organization, channel, actor, revision, idempotency guard, and secret-free provider evidence.
   * @returns the committed channel configuration.
   */
  async verifyChannelBinding(
    rawInput: EnterpriseChannelBindingVerificationWriteInput,
  ): Promise<EnterpriseChannelConfiguration> {
    const input = canonicalChannelBindingInput(rawInput)
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `channel:${input.orgId}:${input.channelId}`)
      await this.lockIdempotency(database, input.orgId, 'channel-binding-verify', input.idempotencyKey)
      const prior = await this.idempotent<EnterpriseChannelConfiguration>(
        database, input.orgId, 'channel-binding-verify', input.idempotencyKey, input,
      )
      if (prior !== undefined) return prior
      await this.requireUser(database, input.orgId, input.actorUserId)
      const current = await database.query<ChannelConfigurationRow>(
        'SELECT * FROM dsh_enterprise_channel_configurations WHERE org_id=$1 AND channel_id=$2 FOR UPDATE',
        [input.orgId, input.channelId],
      )
      const existing = current.rows[0]
      if (existing === undefined) throw new EnterpriseOperationsError('not-found', 'channel', input.channelId)
      if (existing.state === 'archived') throw new EnterpriseOperationsError('invalid-state', 'channel', input.channelId)
      if (Number(existing.revision) !== input.expectedRevision) {
        throw new EnterpriseOperationsError('conflict', 'channel', input.channelId)
      }
      const now = this.now()
      const updated = await database.query<ChannelConfigurationRow>(
        `UPDATE dsh_enterprise_channel_configurations SET binding_status='verified',
          bound_provider_identity_id=$1,bound_provider_identity_name=$2,verified_tenant_id=$3,
          binding_verified_by=$4,binding_verified_at=$5,updated_at=$5,revision=revision+1
        WHERE org_id=$6 AND channel_id=$7 AND revision=$8 AND state<>'archived' RETURNING *`,
        [input.providerIdentityId, input.providerIdentityName ?? null, input.verifiedTenantId ?? null,
          input.actorUserId, now, input.orgId, input.channelId, input.expectedRevision],
      )
      const row = updated.rows[0]
      if (row === undefined) throw new EnterpriseOperationsError('conflict', 'channel', input.channelId)
      const view = this.channelConfiguration(row)
      await this.remember(database, input.orgId, 'channel-binding-verify', input.idempotencyKey, input, view)
      return view
    })
  }

  /**
   * Read one channel configuration without crossing its organization boundary.
   * @param orgId - authenticated organization identity.
   * @param channelId - stable channel identity.
   * @returns the configuration when it belongs to the organization.
   */
  async getChannelConfiguration(orgId: string, channelId: string): Promise<EnterpriseChannelConfiguration | undefined> {
    await this.initialize()
    const result = await this.database.query<ChannelConfigurationRow>(
      'SELECT * FROM dsh_enterprise_channel_configurations WHERE org_id=$1 AND channel_id=$2',
      [orgId, channelId],
    )
    return result.rows[0] === undefined ? undefined : this.channelConfiguration(result.rows[0])
  }

  /**
   * List every channel configuration visible to the authenticated organization administrator.
   * @param orgId - authenticated organization identity.
   * @returns organization-scoped channel configurations.
   */
  async listChannelConfigurations(orgId: string): Promise<EnterpriseChannelConfigurationPage> {
    await this.initialize()
    const result = await this.database.query<ChannelConfigurationRow>(
      'SELECT * FROM dsh_enterprise_channel_configurations WHERE org_id=$1 ORDER BY created_at DESC,channel_id DESC',
      [orgId],
    )
    return { items: result.rows.map(row => this.channelConfiguration(row)) }
  }

  /**
   * Archive one channel configuration; archive is terminal.
   * @param input - organization, channel, actor, revision, and idempotency guard.
   * @returns the archived channel configuration.
   */
  async archiveChannelConfiguration(input: {
    readonly orgId: string
    readonly channelId: string
    readonly actorUserId: string
    readonly expectedRevision: number
    readonly idempotencyKey: string
  }): Promise<EnterpriseChannelConfiguration> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `channel:${input.orgId}:${input.channelId}`)
      await this.lockIdempotency(database, input.orgId, 'channel-archive', input.idempotencyKey)
      const prior = await this.idempotent<EnterpriseChannelConfiguration>(
        database, input.orgId, 'channel-archive', input.idempotencyKey, input,
      )
      if (prior !== undefined) return prior
      await this.requireUser(database, input.orgId, input.actorUserId)
      const updated = await database.query<ChannelConfigurationRow>(
        `UPDATE dsh_enterprise_channel_configurations SET state='archived',updated_at=$1,revision=revision+1
          WHERE org_id=$2 AND channel_id=$3 AND revision=$4 AND state<>'archived' RETURNING *`,
        [this.now(), input.orgId, input.channelId, input.expectedRevision],
      )
      if (updated.rows[0] === undefined) {
        const current = await database.query<ChannelConfigurationRow>(
          'SELECT * FROM dsh_enterprise_channel_configurations WHERE org_id=$1 AND channel_id=$2',
          [input.orgId, input.channelId],
        )
        if (current.rows[0] === undefined) throw new EnterpriseOperationsError('not-found', 'channel', input.channelId)
        throw new EnterpriseOperationsError('conflict', 'channel', input.channelId)
      }
      const view = this.channelConfiguration(updated.rows[0])
      await this.remember(database, input.orgId, 'channel-archive', input.idempotencyKey, input, view)
      return view
    })
  }

  private channelConfiguration(row: ChannelConfigurationRow): EnterpriseChannelConfiguration {
    return {
      orgId: row.org_id,
      channelId: row.channel_id,
      name: row.name,
      provider: row.provider,
      ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
      accountId: row.account_id,
      ...(row.credential_ref === null ? {} : { credentialRef: row.credential_ref }),
      ...(row.default_employee_release_id === null ? {} : { defaultEmployeeReleaseId: row.default_employee_release_id }),
      inboundEnabled: row.inbound_enabled,
      state: row.state,
      bindingStatus: row.binding_status,
      ...(row.bound_provider_identity_id === null ? {} : { boundProviderIdentityId: row.bound_provider_identity_id }),
      ...(row.bound_provider_identity_name === null ? {} : { boundProviderIdentityName: row.bound_provider_identity_name }),
      ...(row.verified_tenant_id === null ? {} : { verifiedTenantId: row.verified_tenant_id }),
      ...(row.binding_verified_by === null ? {} : { bindingVerifiedBy: row.binding_verified_by }),
      ...(row.binding_verified_at === null ? {} : { bindingVerifiedAt: Number(row.binding_verified_at) }),
      createdBy: row.created_by,
      revision: Number(row.revision),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
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
      ...(row.start_admitted_at === null ? {} : { startAdmittedAt: Number(row.start_admitted_at) }),
      ...(row.team_definition_revision === null ? {} : { teamDefinitionRevision: Number(row.team_definition_revision) }),
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
  private teamDefinitionValues(definition: EnterpriseTeamDefinition): readonly unknown[] {
    return [definition.orgId, definition.teamId, definition.name, definition.northStar, definition.ownerUserId,
      definition.departmentId ?? null, definition.visibility,
      definition.allowedUserIds === undefined ? null : JSON.stringify(definition.allowedUserIds),
      definition.leaderEmployeeReleaseId, JSON.stringify(definition.roster), JSON.stringify(definition.roles),
      JSON.stringify(definition.verificationPolicy), JSON.stringify(definition.attentionPolicy),
      JSON.stringify(definition.approvalPolicy), definition.state, definition.createdAt]
  }
  private teamDefinition(row: TeamDefinitionRow): EnterpriseTeamDefinition {
    const definition: EnterpriseTeamDefinition = {
      orgId: row.org_id, teamId: row.team_id, name: row.name, northStar: row.north_star,
      ownerUserId: row.owner_user_id, ...(row.department_id === null ? {} : { departmentId: row.department_id }),
      visibility: row.visibility,
      ...(row.allowed_user_ids_json === null ? {} : { allowedUserIds: parse(row.allowed_user_ids_json) as readonly string[] }),
      leaderEmployeeReleaseId: row.leader_release_id,
      roster: parse(row.roster_json) as EnterpriseTeamDefinition['roster'],
      roles: parse(row.roles_json) as EnterpriseTeamDefinition['roles'],
      verificationPolicy: record(row.verification_policy_json), attentionPolicy: record(row.attention_policy_json),
      approvalPolicy: record(row.approval_policy_json), state: row.state, revision: Number(row.revision),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    }
    validateTeamDefinition(definition)
    return definition
  }
  private teamDefinitionRevision(row: TeamDefinitionRevisionRow): EnterpriseTeamDefinitionRevision {
    return { ...this.teamDefinition(row), revisionState: row.state }
  }
  private async requireTeamDefinitionReleases(
    database: PostgresDatabase,
    orgId: string,
    definition: EnterpriseTeamDefinition,
  ): Promise<void> {
    const releases = new Set([definition.leaderEmployeeReleaseId])
    for (const member of definition.roster)
      if (member.actor.kind === 'agent') releases.add(member.actor.employeeReleaseId)
    await Promise.all([...releases].map(releaseId => this.requireRelease(database, orgId, releaseId)))
  }
  private async requireTeamDefinitionIdentities(
    database: PostgresDatabase,
    orgId: string,
    definition: EnterpriseTeamDefinition,
  ): Promise<void> {
    if (definition.state !== 'active') return
    const users = new Set([definition.ownerUserId, ...(definition.allowedUserIds ?? [])])
    for (const member of definition.roster)
      if (member.actor.kind === 'human') users.add(member.actor.userId)
    await Promise.all([...users].map(userId => this.requireUser(database, orgId, userId)))
    if (definition.departmentId !== undefined)
      await this.requireDepartment(database, orgId, definition.departmentId)
  }
  private async projectActiveDefinitionToFixedTeam(
    database: PostgresDatabase,
    definition: EnterpriseTeamDefinition,
  ): Promise<void> {
    const members = definition.roster.flatMap(member => member.actor.kind === 'agent'
      && member.actor.employeeReleaseId !== definition.leaderEmployeeReleaseId
      ? [{ employeeReleaseId: member.actor.employeeReleaseId, role: member.roleId }] : [])
    const current = await database.query<TeamRow>(
      'SELECT * FROM dsh_enterprise_fixed_teams WHERE team_id=$1 FOR UPDATE', [definition.teamId],
    )
    const row = current.rows[0]
    if (row === undefined) {
      await database.query<TeamRow>(
        `INSERT INTO dsh_enterprise_fixed_teams(team_id,org_id,leader_release_id,workflow_template_json,
          approval_policy_json,revision,created_at,updated_at) VALUES ($1,$2,$3,'{}'::jsonb,$4::jsonb,1,$5,$5) RETURNING *`,
        [definition.teamId, definition.orgId, definition.leaderEmployeeReleaseId,
          JSON.stringify(definition.approvalPolicy), definition.updatedAt],
      )
    } else {
      const currentMembers = await database.query<{ employee_release_id: string; role: string }>(
        'SELECT employee_release_id, role FROM dsh_enterprise_fixed_team_members WHERE team_id = $1 ORDER BY employee_release_id',
        [definition.teamId],
      )
      const existingMembers = currentMembers.rows.map(member => ({
        employeeReleaseId: member.employee_release_id, role: member.role,
      }))
      if (row.org_id !== definition.orgId)
        throw new EnterpriseOperationsError('conflict', 'team-definition', definition.teamId)
      if (row.leader_release_id === definition.leaderEmployeeReleaseId
        && canonicalEqual(sortedFixedMembers(existingMembers), sortedFixedMembers(members))
        && canonicalEqual(record(row.approval_policy_json), definition.approvalPolicy)) return
      await database.query<TeamRow>(
        `UPDATE dsh_enterprise_fixed_teams SET leader_release_id=$1,approval_policy_json=$2::jsonb,
          updated_at=$3,revision=revision+1 WHERE team_id=$4 AND org_id=$5 RETURNING *`,
        [definition.leaderEmployeeReleaseId, JSON.stringify(definition.approvalPolicy),
          definition.updatedAt, definition.teamId, definition.orgId],
      )
      await database.query('DELETE FROM dsh_enterprise_fixed_team_members WHERE team_id = $1', [definition.teamId])
    }
    for (const member of members) await database.query(
      'INSERT INTO dsh_enterprise_fixed_team_members(team_id,employee_release_id,role) VALUES ($1,$2,$3)',
      [definition.teamId, member.employeeReleaseId, member.role],
    )
  }
  private async ensureFixedTeamDefinition(
    database: PostgresDatabase,
    input: {
      teamId: string
      orgId: string
      leaderEmployeeReleaseId: string
      members: readonly { employeeReleaseId: string; role: string }[]
      approvalPolicy: Readonly<Record<string, unknown>>
    },
    now: number,
  ): Promise<void> {
    const existing = await database.query<TeamDefinitionRow>(
      'SELECT * FROM dsh_enterprise_team_definitions WHERE team_id=$1 FOR UPDATE',
      [input.teamId],
    )
    if (existing.rows[0] !== undefined)
      throw new EnterpriseOperationsError('conflict', 'team-definition', input.teamId)
    const roles = [...new Set(input.members.map(member => member.role))].sort()
      .map(role => ({ roleId: role, name: role, responsibility: '' }))
    const definition: EnterpriseTeamDefinition = {
      teamId: input.teamId, orgId: input.orgId, name: '', northStar: '',
      ownerUserId: LEGACY_TEAM_DEFINITION_OWNER_USER_ID, visibility: 'organization',
      leaderEmployeeReleaseId: input.leaderEmployeeReleaseId,
      roster: input.members.map(member => ({
        actor: { kind: 'agent', employeeReleaseId: member.employeeReleaseId }, roleId: member.role,
      })),
      roles, verificationPolicy: {}, attentionPolicy: {}, approvalPolicy: input.approvalPolicy,
      state: 'needs-charter', revision: 1, createdAt: now, updatedAt: now,
    }
    await database.query(
      `INSERT INTO dsh_enterprise_team_definitions(
        org_id,team_id,name,north_star,owner_user_id,department_id,visibility,allowed_user_ids_json,
        leader_release_id,roster_json,roles_json,verification_policy_json,attention_policy_json,
        approval_policy_json,state,revision,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,1,$16,$16)
      `,
      this.teamDefinitionValues(definition),
    )
    await database.query(
      `INSERT INTO dsh_enterprise_team_definition_revisions(
        org_id,team_id,revision,name,north_star,owner_user_id,department_id,visibility,allowed_user_ids_json,
        leader_release_id,roster_json,roles_json,verification_policy_json,attention_policy_json,approval_policy_json,
        state,created_at,updated_at)
       VALUES($1,$2,1,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,'needs-charter',$15,$15)`,
      [definition.orgId, definition.teamId, definition.name, definition.northStar, definition.ownerUserId,
        definition.departmentId ?? null, definition.visibility,
        definition.allowedUserIds === undefined ? null : JSON.stringify(definition.allowedUserIds),
        definition.leaderEmployeeReleaseId, JSON.stringify(definition.roster), JSON.stringify(definition.roles),
        JSON.stringify(definition.verificationPolicy), JSON.stringify(definition.attentionPolicy),
        JSON.stringify(definition.approvalPolicy), now],
    )
  }
}
