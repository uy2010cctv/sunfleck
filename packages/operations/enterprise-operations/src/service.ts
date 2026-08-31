/**
 * Host-facing enterprise operations service.
 *
 * This is deliberately driver-neutral: Host/API code depends on this contract
 * and does not need to know whether the repository is backed by PostgreSQL,
 * an integration-test double, or a future repository implementation.
 */
import { randomUUID } from 'node:crypto'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type { EnterpriseOperationsRepository } from './repository.ts'
import type {
  ApprovalKind,
  ApprovalView,
  BusinessState,
  FixedTeamView,
  EnterpriseTeamDefinition,
  OutboxCommandView,
  ScheduleFireView,
  SchedulePage,
  ScheduleTarget,
  ScheduleView,
  WorkRecordInput,
  WorkRecordPage,
  WorkRecordView,
} from './types.ts'

/** A structural repository contract, suitable for Host composition and tests. */
export interface EnterpriseOperationsDriver {
  readonly upsertWorkRecord: EnterpriseOperationsRepository['upsertWorkRecord']
  readonly getWorkRecord: EnterpriseOperationsRepository['getWorkRecord']
  readonly listWorkRecords: EnterpriseOperationsRepository['listWorkRecords']
  readonly createApprovalRequest: EnterpriseOperationsRepository['createApprovalRequest']
  readonly getApproval: EnterpriseOperationsRepository['getApproval']
  readonly listApprovals: EnterpriseOperationsRepository['listApprovals']
  readonly transitionApproval: EnterpriseOperationsRepository['transitionApproval']
  readonly createSchedule: EnterpriseOperationsRepository['createSchedule']
  readonly saveSchedule: EnterpriseOperationsRepository['saveSchedule']
  readonly getSchedule: EnterpriseOperationsRepository['getSchedule']
  readonly listSchedules: EnterpriseOperationsRepository['listSchedules']
  readonly transitionSchedule: EnterpriseOperationsRepository['transitionSchedule']
  readonly fireSchedule: EnterpriseOperationsRepository['fireSchedule']
  readonly claimOutbox: EnterpriseOperationsRepository['claimOutbox']
  readonly completeOutbox: EnterpriseOperationsRepository['completeOutbox']
  readonly failOutbox: EnterpriseOperationsRepository['failOutbox']
  readonly createFixedTeam: EnterpriseOperationsRepository['createFixedTeam']
  readonly saveFixedTeam: EnterpriseOperationsRepository['saveFixedTeam']
  readonly getFixedTeam: EnterpriseOperationsRepository['getFixedTeam']
  readonly listFixedTeams: EnterpriseOperationsRepository['listFixedTeams']
  readonly createTeamDefinition: EnterpriseOperationsRepository['createTeamDefinition']
  readonly saveTeamDefinition: EnterpriseOperationsRepository['saveTeamDefinition']
  readonly getTeamDefinition: EnterpriseOperationsRepository['getTeamDefinition']
  readonly listTeamDefinitions: EnterpriseOperationsRepository['listTeamDefinitions']
  readonly archiveTeamDefinition: EnterpriseOperationsRepository['archiveTeamDefinition']
}

type DriverInput<Name extends keyof EnterpriseOperationsDriver> = Parameters<EnterpriseOperationsDriver[Name]>[0]
type WithoutOrganization<T> = Omit<T, 'orgId'> & { readonly orgId?: string }

export type EnterpriseWorkRecordInput = WithoutOrganization<DriverInput<'upsertWorkRecord'>>
export interface EnterpriseWorkRecordLookup {
  readonly orgId?: string
  readonly sessionId: string
  readonly employeeReleaseId: string
}
export type EnterpriseWorkRecordListInput = WithoutOrganization<DriverInput<'listWorkRecords'>>
export type EnterpriseApprovalCreateInput = WithoutOrganization<DriverInput<'createApprovalRequest'>>
export interface EnterpriseApprovalLookup { readonly orgId?: string; readonly approvalId: string }
export type EnterpriseApprovalListInput = WithoutOrganization<DriverInput<'listApprovals'>>
export type EnterpriseApprovalTransitionInput = WithoutOrganization<DriverInput<'transitionApproval'>>
export type EnterpriseScheduleCreateInput = WithoutOrganization<DriverInput<'createSchedule'>>
export type EnterpriseScheduleSaveInput = WithoutOrganization<DriverInput<'saveSchedule'>>
export interface EnterpriseScheduleListInput {
  readonly orgId?: string
  readonly state?: ScheduleView['state']
  readonly limit?: number
  readonly cursor?: string
}
export interface EnterpriseScheduleLegacyListInput {
  readonly orgId?: string
  readonly state?: never
  readonly limit?: never
  readonly cursor?: never
}
export interface EnterpriseScheduleLookup {
  readonly orgId?: string
  readonly scheduleId: string
}
export type EnterpriseScheduleTransitionInput = WithoutOrganization<DriverInput<'transitionSchedule'>>
export type EnterpriseScheduleFireInput = WithoutOrganization<DriverInput<'fireSchedule'>>
export type EnterpriseOutboxClaimInput = WithoutOrganization<DriverInput<'claimOutbox'>>
export type EnterpriseOutboxCompleteInput = WithoutOrganization<DriverInput<'completeOutbox'>>
export type EnterpriseOutboxFailureInput = WithoutOrganization<DriverInput<'failOutbox'>>
export type EnterpriseFixedTeamCreateInput = WithoutOrganization<DriverInput<'createFixedTeam'>>
export type EnterpriseFixedTeamSaveInput = WithoutOrganization<DriverInput<'saveFixedTeam'>>
export interface EnterpriseFixedTeamLookup { readonly orgId?: string; readonly teamId: string }
export type EnterpriseFixedTeamListInput = WithoutOrganization<DriverInput<'listFixedTeams'>>
/** Host input for explicit team-definition creation. */
export type EnterpriseTeamDefinitionCreateInput = WithoutOrganization<DriverInput<'createTeamDefinition'>>
/** Host input for revision-fenced team-definition save. */
export type EnterpriseTeamDefinitionSaveInput = WithoutOrganization<DriverInput<'saveTeamDefinition'>>
/** Host-scoped team-definition identity. */
export interface EnterpriseTeamDefinitionLookup { readonly orgId?: string; readonly teamId: string }
/** Host input for a signed team-definition page. */
export type EnterpriseTeamDefinitionListInput = Omit<DriverInput<'listTeamDefinitions'>, 'orgId' | 'readScope'> & {
  readonly orgId?: string
}
/** Host input for terminal team-definition archival. */
export type EnterpriseTeamDefinitionArchiveInput = WithoutOrganization<DriverInput<'archiveTeamDefinition'>>

export type EnterpriseOperationsEndpoint =
  | 'enterpriseOperation.workRecords.upsert'
  | 'enterpriseOperation.workRecords.get'
  | 'enterpriseOperation.workRecords.list'
  | 'enterpriseOperation.approvals.create'
  | 'enterpriseOperation.approvals.get'
  | 'enterpriseOperation.approvals.list'
  | 'enterpriseOperation.approvals.transition'
  | 'enterpriseOperation.schedules.create'
  | 'enterpriseOperation.schedules.save'
  | 'enterpriseOperation.schedules.get'
  | 'enterpriseOperation.schedules.list'
  | 'enterpriseOperation.schedules.transition'
  | 'enterpriseOperation.schedules.fire'
  | 'enterpriseOperation.outbox.claim'
  | 'enterpriseOperation.outbox.complete'
  | 'enterpriseOperation.outbox.fail'
  | 'enterpriseOperation.teams.create'
  | 'enterpriseOperation.teams.save'
  | 'enterpriseOperation.teams.get'
  | 'enterpriseOperation.teams.list'
  | 'enterpriseOperation.teamDefinitions.create'
  | 'enterpriseOperation.teamDefinitions.save'
  | 'enterpriseOperation.teamDefinitions.get'
  | 'enterpriseOperation.teamDefinitions.list'
  | 'enterpriseOperation.teamDefinitions.archive'

export interface EnterpriseOperationsAuthorizationDecision {
  readonly allowed: boolean
  readonly reason?: string
}

export interface EnterpriseOperationsAuditEvent {
  readonly principal: EnterprisePrincipal
  readonly endpoint: EnterpriseOperationsEndpoint
  readonly decision: EnterpriseOperationsAuthorizationDecision
  readonly resourceType: string
  readonly resourceId?: string
  readonly correlationId: string
}

export type EnterpriseOperationsAuthorize = (
  principal: EnterprisePrincipal,
  endpoint: EnterpriseOperationsEndpoint,
  input: unknown,
) => EnterpriseOperationsAuthorizationDecision | boolean | Promise<EnterpriseOperationsAuthorizationDecision | boolean>

export type EnterpriseOperationsAudit = (event: EnterpriseOperationsAuditEvent) => void | Promise<void>

export interface EnterpriseOperationsServiceOptions {
  readonly authorize: EnterpriseOperationsAuthorize
  readonly audit: EnterpriseOperationsAudit
  readonly correlationId?: () => string
}

export class EnterpriseOperationsAuthorizationError extends Error {
  constructor(
    readonly code: 'organization-mismatch' | 'insufficient-role',
    readonly endpoint: EnterpriseOperationsEndpoint,
  ) {
    super(`enterprise operation ${endpoint} denied: ${code}`)
    this.name = 'EnterpriseOperationsAuthorizationError'
  }
}

function normalizeDecision(decision: EnterpriseOperationsAuthorizationDecision | boolean): EnterpriseOperationsAuthorizationDecision {
  return typeof decision === 'boolean' ? { allowed: decision, ...(decision ? {} : { reason: 'insufficient-role' }) } : decision
}

function resource(endpoint: EnterpriseOperationsEndpoint, input: unknown): { resourceType: string; resourceId?: string } {
  const payload = typeof input === 'object' && input !== null ? input as Record<string, unknown> : {}
  if (endpoint.startsWith('enterpriseOperation.workRecords.')) {
    const id = typeof payload.sessionId === 'string' ? payload.sessionId : undefined
    return { resourceType: 'work-record', ...(id === undefined ? {} : { resourceId: id }) }
  }
  if (endpoint.startsWith('enterpriseOperation.approvals.')) {
    const id = typeof payload.approvalId === 'string' ? payload.approvalId : undefined
    return { resourceType: 'approval', ...(id === undefined ? {} : { resourceId: id }) }
  }
  if (endpoint.startsWith('enterpriseOperation.schedules.')) {
    const id = typeof payload.scheduleId === 'string' ? payload.scheduleId : undefined
    return { resourceType: 'schedule', ...(id === undefined ? {} : { resourceId: id }) }
  }
  if (endpoint.startsWith('enterpriseOperation.outbox.')) {
    const id = typeof payload.commandId === 'string' ? payload.commandId : undefined
    return { resourceType: 'operation-outbox', ...(id === undefined ? {} : { resourceId: id }) }
  }
  if (endpoint.startsWith('enterpriseOperation.teamDefinitions.')) {
    const id = typeof payload.teamId === 'string' ? payload.teamId : undefined
    return { resourceType: 'team-definition', ...(id === undefined ? {} : { resourceId: id }) }
  }
  const id = typeof payload.teamId === 'string' ? payload.teamId : undefined
  return { resourceType: 'fixed-team', ...(id === undefined ? {} : { resourceId: id }) }
}

/**
 * Typed Host facade. Every method requires a principal and performs a
 * mandatory authorization + audit decision before reaching the driver.
 */
export class EnterpriseOperationsService {
  private readonly correlationId: () => string

  constructor(
    private readonly driver: EnterpriseOperationsDriver,
    private readonly options: EnterpriseOperationsServiceOptions,
  ) {
    this.correlationId = options.correlationId ?? randomUUID
  }

  private scope<T extends { readonly orgId?: string }>(principal: EnterprisePrincipal, input: T): Omit<T, 'orgId'> & { orgId: string } {
    const { orgId: _ignored, ...rest } = input
    return { ...rest, orgId: principal.orgId }
  }

  private async authorize<T extends { readonly orgId?: string }>(
    principal: EnterprisePrincipal,
    endpoint: EnterpriseOperationsEndpoint,
    input: T,
  ): Promise<Omit<T, 'orgId'> & { orgId: string }> {
    const { scoped, decision } = await this.authorizeDecision(principal, endpoint, input)
    await this.auditDecision(principal, endpoint, input, decision)
    this.assertAllowed(decision, endpoint)
    return scoped
  }

  private async authorizeDecision<T extends { readonly orgId?: string }>(
    principal: EnterprisePrincipal,
    endpoint: EnterpriseOperationsEndpoint,
    input: T,
  ): Promise<{
    scoped: Omit<T, 'orgId'> & { orgId: string }
    decision: EnterpriseOperationsAuthorizationDecision
  }> {
    const scoped = this.scope(principal, input)
    const identityMismatch = input.orgId !== undefined && input.orgId !== principal.orgId
    const decision = identityMismatch
      ? { allowed: false, reason: 'organization-mismatch' }
      : normalizeDecision(await this.options.authorize(principal, endpoint, input))
    return { scoped, decision }
  }

  private async auditDecision(
    principal: EnterprisePrincipal,
    endpoint: EnterpriseOperationsEndpoint,
    input: unknown,
    decision: EnterpriseOperationsAuthorizationDecision,
  ): Promise<void> {
    const descriptor = resource(endpoint, input)
    await this.options.audit({
      principal,
      endpoint,
      decision,
      ...descriptor,
      correlationId: this.correlationId(),
    })
  }

  private assertAllowed(
    decision: EnterpriseOperationsAuthorizationDecision,
    endpoint: EnterpriseOperationsEndpoint,
  ): void {
    if (!decision.allowed) {
      throw new EnterpriseOperationsAuthorizationError(
        decision.reason === 'organization-mismatch' ? 'organization-mismatch' : 'insufficient-role', endpoint,
      )
    }
  }

  async upsertWorkRecord(principal: EnterprisePrincipal, input: EnterpriseWorkRecordInput): Promise<WorkRecordView> {
    return this.driver.upsertWorkRecord(await this.authorize(principal, 'enterpriseOperation.workRecords.upsert', input))
  }

  async getWorkRecord(principal: EnterprisePrincipal, input: EnterpriseWorkRecordLookup): Promise<WorkRecordView | undefined> {
    const scoped = await this.authorize(principal, 'enterpriseOperation.workRecords.get', input)
    return this.driver.getWorkRecord(scoped.orgId, scoped.sessionId, scoped.employeeReleaseId)
  }

  async listWorkRecords(principal: EnterprisePrincipal, input: EnterpriseWorkRecordListInput = {}): Promise<WorkRecordPage> {
    return this.driver.listWorkRecords(await this.authorize(principal, 'enterpriseOperation.workRecords.list', input))
  }

  async createApprovalRequest(principal: EnterprisePrincipal, input: EnterpriseApprovalCreateInput): Promise<ApprovalView> {
    return this.driver.createApprovalRequest(await this.authorize(principal, 'enterpriseOperation.approvals.create', input))
  }
  async getApproval(principal: EnterprisePrincipal, input: EnterpriseApprovalLookup): Promise<ApprovalView | undefined> {
    const scoped = await this.authorize(principal, 'enterpriseOperation.approvals.get', input)
    return this.driver.getApproval(scoped.orgId, scoped.approvalId)
  }
  async listApprovals(principal: EnterprisePrincipal, input: EnterpriseApprovalListInput = {}): ReturnType<EnterpriseOperationsDriver['listApprovals']> {
    return this.driver.listApprovals(await this.authorize(principal, 'enterpriseOperation.approvals.list', input))
  }

  async transitionApproval(principal: EnterprisePrincipal, input: EnterpriseApprovalTransitionInput): Promise<ApprovalView> {
    if (input.state === 'cancelled') {
      const endpoint = 'enterpriseOperation.approvals.transition' as const
      const { scoped, decision } = await this.authorizeDecision(principal, endpoint, input)
      if (!decision.allowed) {
        await this.auditDecision(principal, endpoint, input, decision)
        this.assertAllowed(decision, endpoint)
      }
      const approval = await this.driver.getApproval(scoped.orgId, scoped.approvalId)
      if (approval === undefined || (approval.requestedBy !== principal.userId && !principal.roles.includes('administrator'))) {
        const ownershipDecision = { allowed: false, reason: 'insufficient-role' } as const
        await this.auditDecision(principal, endpoint, input, ownershipDecision)
        this.assertAllowed(ownershipDecision, endpoint)
      }
      await this.auditDecision(principal, endpoint, input, decision)
      return this.driver.transitionApproval({ ...scoped, actorUserId: principal.userId })
    }
    return this.driver.transitionApproval(await this.authorize(principal, 'enterpriseOperation.approvals.transition', input))
  }

  async createSchedule(principal: EnterprisePrincipal, input: EnterpriseScheduleCreateInput): Promise<ScheduleView> {
    return this.driver.createSchedule(await this.authorize(principal, 'enterpriseOperation.schedules.create', input))
  }
  async saveSchedule(principal: EnterprisePrincipal, input: EnterpriseScheduleSaveInput): Promise<ScheduleView> {
    return this.driver.saveSchedule(await this.authorize(principal, 'enterpriseOperation.schedules.save', input))
  }

  async getSchedule(principal: EnterprisePrincipal, input: EnterpriseScheduleLookup): Promise<ScheduleView | undefined> {
    const scoped = await this.authorize(principal, 'enterpriseOperation.schedules.get', input)
    return this.driver.getSchedule(scoped.orgId, scoped.scheduleId)
  }

  async listSchedules(principal: EnterprisePrincipal, input?: EnterpriseScheduleLegacyListInput): Promise<readonly ScheduleView[]>
  async listSchedules(principal: EnterprisePrincipal, input: EnterpriseScheduleListInput): Promise<SchedulePage>
  async listSchedules(
    principal: EnterprisePrincipal,
    input: EnterpriseScheduleListInput = {},
  ): Promise<readonly ScheduleView[] | SchedulePage> {
    const scoped = await this.authorize(principal, 'enterpriseOperation.schedules.list', input)
    if (scoped.state === undefined && scoped.limit === undefined && scoped.cursor === undefined)
      return this.driver.listSchedules(scoped.orgId)
    return this.driver.listSchedules(scoped)
  }

  async transitionSchedule(principal: EnterprisePrincipal, input: EnterpriseScheduleTransitionInput): Promise<ScheduleView> {
    return this.driver.transitionSchedule(await this.authorize(principal, 'enterpriseOperation.schedules.transition', input))
  }

  async fireSchedule(principal: EnterprisePrincipal, input: EnterpriseScheduleFireInput): Promise<ScheduleFireView> {
    return this.driver.fireSchedule(await this.authorize(principal, 'enterpriseOperation.schedules.fire', input))
  }

  async claimOutbox(principal: EnterprisePrincipal, input: EnterpriseOutboxClaimInput): Promise<readonly OutboxCommandView[]> {
    return this.driver.claimOutbox(await this.authorize(principal, 'enterpriseOperation.outbox.claim', input))
  }

  async completeOutbox(principal: EnterprisePrincipal, input: EnterpriseOutboxCompleteInput): Promise<OutboxCommandView> {
    return this.driver.completeOutbox(await this.authorize(principal, 'enterpriseOperation.outbox.complete', input))
  }

  async failOutbox(principal: EnterprisePrincipal, input: EnterpriseOutboxFailureInput): Promise<OutboxCommandView> {
    return this.driver.failOutbox(await this.authorize(principal, 'enterpriseOperation.outbox.fail', input))
  }

  async createFixedTeam(principal: EnterprisePrincipal, input: EnterpriseFixedTeamCreateInput): Promise<FixedTeamView> {
    return this.driver.createFixedTeam(await this.authorize(principal, 'enterpriseOperation.teams.create', input))
  }
  async saveFixedTeam(principal: EnterprisePrincipal, input: EnterpriseFixedTeamSaveInput): Promise<FixedTeamView> {
    return this.driver.saveFixedTeam(await this.authorize(principal, 'enterpriseOperation.teams.save', input))
  }
  async getFixedTeam(principal: EnterprisePrincipal, input: EnterpriseFixedTeamLookup): Promise<FixedTeamView | undefined> {
    const scoped = await this.authorize(principal, 'enterpriseOperation.teams.get', input)
    return this.driver.getFixedTeam(scoped.orgId, scoped.teamId)
  }
  async listFixedTeams(principal: EnterprisePrincipal, input: EnterpriseFixedTeamListInput = {}): ReturnType<EnterpriseOperationsDriver['listFixedTeams']> {
    return this.driver.listFixedTeams(await this.authorize(principal, 'enterpriseOperation.teams.list', input))
  }

  /**
   * @param principal - authenticated actor.
   * @param input - definition and write guards.
   * @returns created definition.
   */
  async createTeamDefinition(
    principal: EnterprisePrincipal,
    input: EnterpriseTeamDefinitionCreateInput,
  ): Promise<EnterpriseTeamDefinition> {
    return this.driver.createTeamDefinition(
      await this.authorize(principal, 'enterpriseOperation.teamDefinitions.create', input),
    )
  }
  /**
   * @param principal - authenticated actor.
   * @param input - definition and write guards.
   * @returns saved definition.
   */
  async saveTeamDefinition(
    principal: EnterprisePrincipal,
    input: EnterpriseTeamDefinitionSaveInput,
  ): Promise<EnterpriseTeamDefinition> {
    return this.driver.saveTeamDefinition(
      await this.authorize(principal, 'enterpriseOperation.teamDefinitions.save', input),
    )
  }
  /**
   * @param principal - authenticated viewer.
   * @param input - team identity.
   * @returns visible definition when present.
   */
  async getTeamDefinition(
    principal: EnterprisePrincipal,
    input: EnterpriseTeamDefinitionLookup,
  ): Promise<EnterpriseTeamDefinition | undefined> {
    const scoped = await this.authorize(principal, 'enterpriseOperation.teamDefinitions.get', input)
    return this.driver.getTeamDefinition(scoped.orgId, scoped.teamId, {
      userId: principal.userId, isAdministrator: principal.roles.includes('administrator'),
    })
  }
  /**
   * @param principal - authenticated viewer.
   * @param input - page options.
   * @returns visible definition page.
   */
  async listTeamDefinitions(
    principal: EnterprisePrincipal,
    input: EnterpriseTeamDefinitionListInput = {},
  ): ReturnType<EnterpriseOperationsDriver['listTeamDefinitions']> {
    const scoped = await this.authorize(principal, 'enterpriseOperation.teamDefinitions.list', input)
    return this.driver.listTeamDefinitions({
      ...scoped,
      readScope: { userId: principal.userId, isAdministrator: principal.roles.includes('administrator') },
    })
  }
  /**
   * @param principal - authenticated actor.
   * @param input - identity and write guards.
   * @returns archived definition.
   */
  async archiveTeamDefinition(
    principal: EnterprisePrincipal,
    input: EnterpriseTeamDefinitionArchiveInput,
  ): Promise<EnterpriseTeamDefinition> {
    return this.driver.archiveTeamDefinition(
      await this.authorize(principal, 'enterpriseOperation.teamDefinitions.archive', input),
    )
  }

}

// Keep these imports visible in generated declaration files for consumers that
// use the service contract without importing the repository implementation.
export type { ApprovalKind, BusinessState, ScheduleTarget, WorkRecordInput }
