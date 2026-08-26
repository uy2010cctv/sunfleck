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
  OutboxCommandView,
  ScheduleFireView,
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
  readonly transitionApproval: EnterpriseOperationsRepository['transitionApproval']
  readonly createSchedule: EnterpriseOperationsRepository['createSchedule']
  readonly getSchedule: EnterpriseOperationsRepository['getSchedule']
  readonly listSchedules: EnterpriseOperationsRepository['listSchedules']
  readonly transitionSchedule: EnterpriseOperationsRepository['transitionSchedule']
  readonly fireSchedule: EnterpriseOperationsRepository['fireSchedule']
  readonly claimOutbox: EnterpriseOperationsRepository['claimOutbox']
  readonly completeOutbox: EnterpriseOperationsRepository['completeOutbox']
  readonly failOutbox: EnterpriseOperationsRepository['failOutbox']
  readonly createFixedTeam: EnterpriseOperationsRepository['createFixedTeam']
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
export type EnterpriseApprovalTransitionInput = WithoutOrganization<DriverInput<'transitionApproval'>>
export type EnterpriseScheduleCreateInput = WithoutOrganization<DriverInput<'createSchedule'>>
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

export type EnterpriseOperationsEndpoint =
  | 'enterpriseOperation.workRecords.upsert'
  | 'enterpriseOperation.workRecords.get'
  | 'enterpriseOperation.workRecords.list'
  | 'enterpriseOperation.approvals.create'
  | 'enterpriseOperation.approvals.transition'
  | 'enterpriseOperation.schedules.create'
  | 'enterpriseOperation.schedules.get'
  | 'enterpriseOperation.schedules.list'
  | 'enterpriseOperation.schedules.transition'
  | 'enterpriseOperation.schedules.fire'
  | 'enterpriseOperation.outbox.claim'
  | 'enterpriseOperation.outbox.complete'
  | 'enterpriseOperation.outbox.fail'
  | 'enterpriseOperation.teams.create'

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
    const scoped = this.scope(principal, input)
    const identityMismatch = input.orgId !== undefined && input.orgId !== principal.orgId
    const decision = identityMismatch
      ? { allowed: false, reason: 'organization-mismatch' }
      : normalizeDecision(await this.options.authorize(principal, endpoint, input))
    const descriptor = resource(endpoint, input)
    await this.options.audit({
      principal,
      endpoint,
      decision,
      ...descriptor,
      correlationId: this.correlationId(),
    })
    if (!decision.allowed) {
      throw new EnterpriseOperationsAuthorizationError(
        decision.reason === 'organization-mismatch' ? 'organization-mismatch' : 'insufficient-role', endpoint,
      )
    }
    return scoped
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

  async transitionApproval(principal: EnterprisePrincipal, input: EnterpriseApprovalTransitionInput): Promise<ApprovalView> {
    return this.driver.transitionApproval(await this.authorize(principal, 'enterpriseOperation.approvals.transition', input))
  }

  async createSchedule(principal: EnterprisePrincipal, input: EnterpriseScheduleCreateInput): Promise<ScheduleView> {
    return this.driver.createSchedule(await this.authorize(principal, 'enterpriseOperation.schedules.create', input))
  }

  async getSchedule(principal: EnterprisePrincipal, input: EnterpriseScheduleLookup): Promise<ScheduleView | undefined> {
    const scoped = await this.authorize(principal, 'enterpriseOperation.schedules.get', input)
    return this.driver.getSchedule(scoped.orgId, scoped.scheduleId)
  }

  async listSchedules(principal: EnterprisePrincipal, input: { readonly orgId?: string } = {}): Promise<readonly ScheduleView[]> {
    const scoped = await this.authorize(principal, 'enterpriseOperation.schedules.list', input)
    return this.driver.listSchedules(scoped.orgId)
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

}

// Keep these imports visible in generated declaration files for consumers that
// use the service contract without importing the repository implementation.
export type { ApprovalKind, BusinessState, ScheduleTarget, WorkRecordInput }
