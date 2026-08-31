import { createHash, randomUUID } from 'node:crypto'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import { EnterpriseOperationsError } from './repository.ts'
import type {
  EnterpriseTeamAutonomyGrant,
  EnterpriseTeamAutonomyGrantPage,
  EnterpriseTeamDefinition,
  EnterpriseTeamRun,
  EnterpriseTeamRunFailure,
  EnterpriseTeamRunPage,
  TeamDefinitionReadScope,
  TeamDecision,
  TeamDecisionPage,
} from './types.ts'

/** Runtime outcome appended to the authoritative root Session event log. */
export interface EnterpriseTeamRuntimeMutation {
  readonly runtimeRevision: number
  readonly sourceEventSeq?: number
}

/** Start outcome appended by the runtime driver. */
export interface EnterpriseTeamRuntimeStart extends EnterpriseTeamRuntimeMutation { readonly rootSessionId: string }

/** Reconciled state derived from the root Session event log. */
export interface EnterpriseTeamRuntimeReconciliation extends EnterpriseTeamRuntimeMutation {
  readonly state: EnterpriseTeamRun['state']
  readonly rootSessionId?: string
  readonly failure?: EnterpriseTeamRunFailure
}

/** Durable start reservation with the immutable definition used by the runtime driver. */
export interface EnterpriseTeamRunStartReservation {
  readonly run: EnterpriseTeamRun
  readonly definitionSnapshot: EnterpriseTeamDefinition
  readonly created: boolean
}

/** Durable decision-response reservation acquired before calling the runtime driver. */
export interface EnterpriseTeamDecisionResponseReservation {
  readonly decision: TeamDecision
  readonly operationId: string
  readonly completed: boolean
}

/**
 * Swappable Team runtime provider. Every operationId is stable across retries;
 * implementations append authoritative events to the root Session log.
 */
export interface EnterpriseTeamRuntimeDriver {
  /** @param input - immutable definition snapshot and stable operation identity. @returns authoritative start event position. */
  startRun(input: {
    readonly operationId: string
    readonly runId: string
    readonly orgId: string
    readonly definition: EnterpriseTeamDefinition
    readonly workspaceId: string
    readonly prompt: string
    readonly actor: EnterprisePrincipal
  }): Promise<EnterpriseTeamRuntimeStart>
  /** @param input - run and stable operation identity. @returns authoritative cancellation event position. */
  cancelRun(input: {
    readonly operationId: string
    readonly run: EnterpriseTeamRun
    readonly actor: EnterprisePrincipal
  }): Promise<EnterpriseTeamRuntimeMutation>
  /** @param input - decision answer and stable operation identity. @returns authoritative answer event position. */
  respondDecision(input: {
    readonly operationId: string
    readonly decision: TeamDecision
    readonly answer: string
    readonly actor: EnterprisePrincipal
  }): Promise<EnterpriseTeamRuntimeMutation>
  /** @param input - starting run and original start operation identity. @returns state derived from its root Session log. */
  reconcileRun(input: {
    readonly operationId: string
    readonly run: EnterpriseTeamRun
  }): Promise<EnterpriseTeamRuntimeReconciliation>
}

/** Runtime failure classification used to distinguish rejection from unknown commit outcome. */
export class EnterpriseTeamRuntimeError extends Error {
  constructor(readonly outcome: 'deterministic' | 'unknown', readonly code: string, message = code) {
    super(message)
    this.name = 'EnterpriseTeamRuntimeError'
  }
}

/** PostgreSQL-backed query projection methods consumed by the control service. */
export interface EnterpriseTeamControlProjectionDriver {
  getTeamDefinition(
    orgId: string,
    teamId: string,
    scope: { userId: string; isAdministrator: boolean },
  ): Promise<EnterpriseTeamDefinition | undefined>
  createTeamRunStarting(
    input: {
      readonly orgId: string
      readonly teamId: string
      readonly expectedTeamRevision: number
      readonly workspaceId: string
      readonly createdBy: string
      readonly source: EnterpriseTeamRun['source']
      readonly idempotencyKey: string
      readonly idempotencyFingerprint: string
    },
    allocateRunId: () => string,
  ): Promise<EnterpriseTeamRunStartReservation>
  getTeamRunByStartKey(
    orgId: string,
    idempotencyKey: string,
    idempotencyFingerprint?: string,
  ): Promise<EnterpriseTeamRunStartReservation | undefined>
  projectTeamRun(input: {
    readonly orgId: string
    readonly runId: string
    readonly expectedRevision: number
    readonly state: EnterpriseTeamRun['state']
    readonly rootSessionId?: string
    readonly runtimeRevision: number
    readonly sourceEventSeq?: number
    readonly failure?: EnterpriseTeamRunFailure
  }): Promise<EnterpriseTeamRun>
  getTeamRun(orgId: string, runId: string, readScope?: TeamDefinitionReadScope): Promise<EnterpriseTeamRun | undefined>
  listTeamRuns(input: {
    readonly orgId: string
    readonly readScope: TeamDefinitionReadScope
    readonly teamId?: string
    readonly state?: EnterpriseTeamRun['state']
    readonly limit?: number
    readonly cursor?: string
  }): Promise<EnterpriseTeamRunPage>
  projectDecision(input: TeamDecision): Promise<TeamDecision>
  getDecision(orgId: string, decisionId: string, readScope?: TeamDefinitionReadScope): Promise<TeamDecision | undefined>
  getDecisionResponseByKey(
    orgId: string,
    idempotencyKey: string,
    idempotencyFingerprint: string,
  ): Promise<TeamDecision | undefined>
  reserveDecisionResponse(input: {
    readonly orgId: string
    readonly decisionId: string
    readonly expectedRevision: number
    readonly idempotencyKey: string
    readonly idempotencyFingerprint: string
  }): Promise<EnterpriseTeamDecisionResponseReservation>
  listDecisions(input: {
    readonly orgId: string
    readonly readScope: TeamDefinitionReadScope
    readonly runId?: string
    readonly state?: TeamDecision['state']
    readonly assigneeUserId?: string
    readonly limit?: number
    readonly cursor?: string
  }): Promise<TeamDecisionPage>
  answerDecision(input: {
    readonly orgId: string
    readonly decisionId: string
    readonly expectedRevision: number
    readonly answer: string
    readonly runtimeRevision: number
    readonly sourceEventSeq?: number
    readonly idempotencyKey: string
    readonly idempotencyFingerprint: string
    readonly operationId: string
  }): Promise<TeamDecision>
  listAutonomyGrants(input: {
    readonly orgId: string
    readonly readScope: TeamDefinitionReadScope
    readonly teamId?: string
    readonly employeeReleaseId?: string
    readonly state?: EnterpriseTeamAutonomyGrant['state']
    readonly limit?: number
    readonly cursor?: string
  }): Promise<EnterpriseTeamAutonomyGrantPage>
  saveAutonomyGrant(
    input: Omit<EnterpriseTeamAutonomyGrant, 'revision' | 'createdAt' | 'updatedAt' | 'state'> & {
      readonly expectedRevision: number
      readonly idempotencyKey: string
    },
  ): Promise<EnterpriseTeamAutonomyGrant>
  revokeAutonomyGrant(input: {
    readonly orgId: string
    readonly teamId: string
    readonly employeeReleaseId: string
    readonly taskType: string
    readonly capabilityScope: string
    readonly expectedRevision: number
    readonly idempotencyKey: string
  }): Promise<EnterpriseTeamAutonomyGrant>
}

export type EnterpriseTeamControlEndpoint =
  | 'enterpriseTeamRun.list' | 'enterpriseTeamRun.get' | 'enterpriseTeamRun.start' | 'enterpriseTeamRun.cancel'
  | 'enterpriseTeamDecision.list' | 'enterpriseTeamDecision.respond'
  | 'enterpriseTeamAutonomy.list' | 'enterpriseTeamAutonomy.save' | 'enterpriseTeamAutonomy.revoke'

/** Control-service authorization decision. */
export interface EnterpriseTeamControlAuthorizationDecision { readonly allowed: boolean; readonly reason?: string }
/** Control-plane audit record correlated by run id when one exists. */
export interface EnterpriseTeamControlAuditEvent {
  readonly principal: EnterprisePrincipal
  readonly endpoint: EnterpriseTeamControlEndpoint
  readonly decision: EnterpriseTeamControlAuthorizationDecision
  readonly resource: {
    readonly type: 'team-definition' | 'team-run' | 'team-decision' | 'team-autonomy-grant'
    readonly id: string
  }
  readonly correlationId: string
  readonly details: Readonly<Record<string, unknown>>
}
/** Team control-service callbacks supplied by the authenticated Host. */
export interface EnterpriseTeamControlServiceOptions {
  readonly authorize: (
    principal: EnterprisePrincipal,
    endpoint: EnterpriseTeamControlEndpoint,
    input: unknown,
  ) => boolean | EnterpriseTeamControlAuthorizationDecision | Promise<boolean | EnterpriseTeamControlAuthorizationDecision>
  readonly authorizeWorkspace: (principal: EnterprisePrincipal, workspaceId: string) => boolean | Promise<boolean>
  readonly audit: (event: EnterpriseTeamControlAuditEvent) => void | Promise<void>
  readonly runId?: () => string
}

export interface EnterpriseTeamRunStartInput {
  readonly teamId: string
  readonly expectedTeamRevision: number
  readonly workspaceId: string
  readonly prompt: string
  readonly source: EnterpriseTeamRun['source']
  readonly idempotencyKey: string
}
export interface EnterpriseTeamRunCancelInput {
  readonly runId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface EnterpriseTeamRunListInput {
  readonly teamId?: string
  readonly state?: EnterpriseTeamRun['state']
  readonly limit?: number
  readonly cursor?: string
}
export interface EnterpriseTeamDecisionRespondInput {
  readonly decisionId: string
  readonly answer: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface EnterpriseTeamDecisionListInput {
  readonly runId?: string
  readonly state?: TeamDecision['state']
  readonly assigneeUserId?: string
  readonly limit?: number
  readonly cursor?: string
}
export interface EnterpriseTeamAutonomySaveInput {
  readonly teamId: string
  readonly employeeReleaseId: string
  readonly taskType: string
  readonly capabilityScope: string
  readonly level: EnterpriseTeamAutonomyGrant['level']
  readonly evidenceRefs: readonly string[]
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface EnterpriseTeamAutonomyRevokeInput {
  readonly teamId: string
  readonly employeeReleaseId: string
  readonly taskType: string
  readonly capabilityScope: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface EnterpriseTeamAutonomyListInput {
  readonly teamId?: string
  readonly employeeReleaseId?: string
  readonly state?: EnterpriseTeamAutonomyGrant['state']
  readonly limit?: number
  readonly cursor?: string
}

const TERMINAL_RUN_STATES = new Set<EnterpriseTeamRun['state']>(['completed', 'failed', 'cancelled'])

function teamRunAuditOutcome(state: EnterpriseTeamRun['state']): string {
  switch (state) {
    case 'starting':
    case 'waiting-human':
    case 'verifying': return 'runtime-pending'
    case 'failed': return 'runtime-failed'
    case 'active':
    case 'completed':
    case 'cancelled': return state
  }
}

function authorization(value: boolean | EnterpriseTeamControlAuthorizationDecision): EnterpriseTeamControlAuthorizationDecision {
  return typeof value === 'boolean' ? { allowed: value } : value
}

/** Enterprise control plane coordinating projections with one idempotent runtime driver. */
export class EnterpriseTeamControlService {
  private readonly runId: () => string
  constructor(
    private readonly projections: EnterpriseTeamControlProjectionDriver,
    private readonly runtime: EnterpriseTeamRuntimeDriver,
    private readonly options: EnterpriseTeamControlServiceOptions,
  ) { this.runId = options.runId ?? randomUUID }

  private scope(principal: EnterprisePrincipal) {
    return { userId: principal.userId, isAdministrator: principal.roles.includes('administrator') }
  }

  private async decision(principal: EnterprisePrincipal, endpoint: EnterpriseTeamControlEndpoint, input: unknown) {
    return authorization(await this.options.authorize(principal, endpoint, input))
  }

  private async audit(
    principal: EnterprisePrincipal,
    endpoint: EnterpriseTeamControlEndpoint,
    resource: EnterpriseTeamControlAuditEvent['resource'],
    decision: EnterpriseTeamControlAuthorizationDecision,
    correlationId = resource.id,
    details: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    await this.options.audit({ principal, endpoint, resource, decision, correlationId, details })
  }

  private deny(endpoint: EnterpriseTeamControlEndpoint): never {
    throw new EnterpriseOperationsError('forbidden', endpoint.startsWith('enterpriseTeamDecision') ? 'team-decision'
      : endpoint.startsWith('enterpriseTeamAutonomy') ? 'team-autonomy-grant' : 'team-run')
  }

  private async requireAuthorized(principal: EnterprisePrincipal, endpoint: EnterpriseTeamControlEndpoint,
    input: unknown, resourceType: EnterpriseTeamControlAuditEvent['resource']['type'], resourceId: string,
    correlationId = resourceId): Promise<void> {
    const result = await this.decision(principal, endpoint, input)
    await this.audit(principal, endpoint, { type: resourceType, id: resourceId }, result, correlationId)
    if (!result.allowed) this.deny(endpoint)
  }

  /** @param principal - authenticated Host actor. @param input - browser-safe start fields. @returns runtime-backed run projection. */
  async startRun(principal: EnterprisePrincipal, input: EnterpriseTeamRunStartInput): Promise<EnterpriseTeamRun> {
    const correlationId = `team-run:start:${input.idempotencyKey}`
    const definitionDetails = {
      teamId: input.teamId,
      teamDefinitionRevision: input.expectedTeamRevision,
    }
    const deniedDefinition = async (reason: string): Promise<void> => this.audit(
      principal, 'enterpriseTeamRun.start', { type: 'team-definition', id: input.teamId },
      { allowed: false, reason }, correlationId, { ...definitionDetails, outcomeReason: reason },
    )
    const authorizationDecision = await this.decision(principal, 'enterpriseTeamRun.start', input)
    if (!authorizationDecision.allowed) {
      await deniedDefinition(authorizationDecision.reason ?? 'insufficient-role')
      this.deny('enterpriseTeamRun.start')
    }
    const idempotencyFingerprint = createHash('sha256').update(JSON.stringify({
      teamId: input.teamId, expectedTeamRevision: input.expectedTeamRevision, workspaceId: input.workspaceId,
      prompt: input.prompt, source: input.source,
    })).digest('hex')
    let reservation: EnterpriseTeamRunStartReservation | undefined
    try {
      reservation = await this.projections.getTeamRunByStartKey(
        principal.orgId, input.idempotencyKey, idempotencyFingerprint,
      )
    } catch (error) {
      if (error instanceof EnterpriseOperationsError && error.code === 'idempotency-conflict')
        await deniedDefinition('idempotency-conflict')
      throw error
    }
    if (reservation !== undefined) {
      if (reservation.run.createdBy !== principal.userId
        || await this.projections.getTeamDefinition(
          principal.orgId, reservation.run.teamId, this.scope(principal),
        ) === undefined) {
        await deniedDefinition('definition-hidden')
        throw new EnterpriseOperationsError('not-found', 'team-run', reservation.run.runId)
      }
    }
    if (reservation === undefined) {
      const definition = await this.projections.getTeamDefinition(principal.orgId, input.teamId, this.scope(principal))
      if (definition === undefined) {
        await deniedDefinition('definition-hidden')
        throw new EnterpriseOperationsError('not-found', 'team-definition', input.teamId)
      }
      if (definition.revision !== input.expectedTeamRevision) {
        await deniedDefinition('definition-stale')
        throw new EnterpriseOperationsError('conflict', 'team-definition', input.teamId)
      }
      if (definition.state !== 'active') {
        await deniedDefinition('definition-inactive')
        throw new EnterpriseOperationsError('invalid-state', 'team-definition', input.teamId)
      }
      if (!(await this.options.authorizeWorkspace(principal, input.workspaceId))) {
        await deniedDefinition('workspace-forbidden')
        throw new EnterpriseOperationsError('forbidden', 'team-run', input.teamId)
      }
      try {
        reservation = await this.projections.createTeamRunStarting({
          orgId: principal.orgId, teamId: definition.teamId, expectedTeamRevision: definition.revision,
          workspaceId: input.workspaceId, createdBy: principal.userId, source: input.source,
          idempotencyKey: input.idempotencyKey, idempotencyFingerprint,
        }, this.runId)
      } catch (error) {
        if (error instanceof EnterpriseOperationsError) {
          const reason = error.code === 'conflict' ? 'definition-stale'
            : error.code === 'invalid-state' ? 'definition-inactive'
              : error.code === 'not-found' ? 'definition-hidden' : error.code
          await deniedDefinition(reason)
        }
        throw error
      }
    }
    const reserved = reservation
    if (reserved.run.createdBy !== principal.userId) {
      await deniedDefinition('definition-hidden')
      throw new EnterpriseOperationsError('not-found', 'team-run', reserved.run.runId)
    }
    const runAudit = async (outcome: string, outcomeReason?: string): Promise<void> => this.audit(
      principal, 'enterpriseTeamRun.start', { type: 'team-run', id: reserved.run.runId },
      authorizationDecision, reserved.run.runId, {
        teamId: reserved.run.teamId,
        teamDefinitionRevision: reserved.run.teamDefinitionRevision,
        outcome,
        ...(outcomeReason === undefined ? {} : { outcomeReason }),
      },
    )
    if (reserved.run.state !== 'starting') {
      await runAudit(teamRunAuditOutcome(reserved.run.state))
      return reserved.run
    }
    if (!reserved.created) {
      let reconciled: EnterpriseTeamRuntimeReconciliation
      try {
        reconciled = await this.runtime.reconcileRun({
          operationId: `team-run:start:${reserved.run.runId}`, run: reserved.run,
        })
      } catch (error) {
        if (error instanceof EnterpriseTeamRuntimeError && error.outcome === 'deterministic') {
          const failed = await this.projections.projectTeamRun({
            orgId: reserved.run.orgId, runId: reserved.run.runId, expectedRevision: reserved.run.revision,
            state: 'failed', runtimeRevision: reserved.run.runtimeRevision + 1,
            failure: { code: error.code, message: error.message },
          })
          await runAudit('runtime-failed', error.code)
          return failed
        }
        const reason = error instanceof EnterpriseTeamRuntimeError ? error.code : 'runtime-throw'
        await runAudit('runtime-unknown', reason)
        return reserved.run
      }
      if (reconciled.state !== 'starting') {
        const projected = await this.projections.projectTeamRun({
          orgId: reserved.run.orgId, runId: reserved.run.runId, expectedRevision: reserved.run.revision,
          state: reconciled.state, runtimeRevision: reconciled.runtimeRevision,
          ...(reconciled.rootSessionId === undefined ? {} : { rootSessionId: reconciled.rootSessionId }),
          ...(reconciled.sourceEventSeq === undefined ? {} : { sourceEventSeq: reconciled.sourceEventSeq }),
          ...(reconciled.failure === undefined ? {} : { failure: reconciled.failure }),
        })
        await runAudit(teamRunAuditOutcome(projected.state))
        return projected
      }
    }
    try {
      const result = await this.runtime.startRun({
        operationId: `team-run:start:${reserved.run.runId}`, runId: reserved.run.runId,
        orgId: principal.orgId, definition: reserved.definitionSnapshot,
        workspaceId: reserved.run.workspaceId, prompt: input.prompt, actor: principal,
      })
      const active = await this.projections.projectTeamRun({ orgId: principal.orgId, runId: reserved.run.runId,
        expectedRevision: reserved.run.revision, state: 'active', rootSessionId: result.rootSessionId,
        runtimeRevision: result.runtimeRevision,
        ...(result.sourceEventSeq === undefined ? {} : { sourceEventSeq: result.sourceEventSeq }),
      })
      await runAudit('active')
      return active
    } catch (error) {
      if (error instanceof EnterpriseTeamRuntimeError && error.outcome === 'deterministic') {
        const failed = await this.projections.projectTeamRun({ orgId: principal.orgId, runId: reserved.run.runId,
          expectedRevision: reserved.run.revision, state: 'failed', runtimeRevision: reserved.run.runtimeRevision + 1,
          failure: { code: error.code, message: error.message } })
        await runAudit('runtime-failed', error.code)
        return failed
      }
      if (error instanceof EnterpriseTeamRuntimeError && error.outcome === 'unknown') {
        await runAudit('runtime-unknown', error.code)
        return reserved.run
      }
      await runAudit('runtime-failed', 'runtime-failure')
      throw error
    }
  }

  /**
   * Reconcile one non-terminal run through the authoritative runtime driver.
   * @param principal - authenticated Host actor.
   * @param input - Host-only reconciliation address.
   * @returns event-log-derived projection.
   */
  async reconcileRun(
    principal: EnterprisePrincipal,
    input: { readonly runId: string },
  ): Promise<EnterpriseTeamRun> {
    const correlationId = `team-run:reconcile:${input.runId}`
    const auditReconcile = async (
      decision: EnterpriseTeamControlAuthorizationDecision,
      outcome?: string,
      outcomeReason?: string,
    ): Promise<void> => this.audit(
      principal, 'enterpriseTeamRun.get', { type: 'team-run', id: input.runId }, decision, correlationId, {
        ...(outcome === undefined ? {} : { outcome }),
        ...(outcomeReason === undefined ? {} : { outcomeReason }),
      },
    )
    const run = await this.projections.getTeamRun(principal.orgId, input.runId, this.scope(principal))
    if (run === undefined) {
      await auditReconcile({ allowed: false, reason: 'not-found' })
      throw new EnterpriseOperationsError('not-found', 'team-run', input.runId)
    }
    const authorizationDecision = await this.decision(principal, 'enterpriseTeamRun.get', input)
    if (!authorizationDecision.allowed) {
      await auditReconcile({ allowed: false, reason: authorizationDecision.reason ?? 'insufficient-role' })
      this.deny('enterpriseTeamRun.get')
    }
    if (TERMINAL_RUN_STATES.has(run.state)) {
      await auditReconcile(authorizationDecision, teamRunAuditOutcome(run.state))
      return run
    }
    const operationId = run.state === 'starting'
      ? `team-run:start:${run.runId}`
      : `team-run:reconcile:${run.runId}`
    try {
      const result = await this.runtime.reconcileRun({ operationId, run })
      const projected = await this.projections.projectTeamRun({
        orgId: run.orgId, runId: run.runId, expectedRevision: run.revision,
        state: result.state, runtimeRevision: result.runtimeRevision,
        ...(result.rootSessionId === undefined ? {} : { rootSessionId: result.rootSessionId }),
        ...(result.sourceEventSeq === undefined ? {} : { sourceEventSeq: result.sourceEventSeq }),
        ...(result.failure === undefined ? {} : { failure: result.failure }),
      })
      await auditReconcile(authorizationDecision, teamRunAuditOutcome(projected.state))
      return projected
    } catch (error) {
      if (error instanceof EnterpriseOperationsError) {
        await auditReconcile({ allowed: false, reason: error.code })
        throw error
      }
      if (error instanceof EnterpriseTeamRuntimeError && error.outcome === 'deterministic') {
        const failed = await this.projections.projectTeamRun({
          orgId: run.orgId, runId: run.runId, expectedRevision: run.revision,
          state: 'failed', runtimeRevision: run.runtimeRevision + 1,
          failure: { code: error.code, message: error.message },
        })
        await auditReconcile(authorizationDecision, 'runtime-failed', error.code)
        return failed
      }
      const reason = error instanceof EnterpriseTeamRuntimeError ? error.code : 'runtime-throw'
      await auditReconcile(authorizationDecision, 'runtime-unknown', reason)
      return run
    }
  }

  /** @param principal - authenticated Host actor. @param input - run CAS and idempotency fields. @returns cancelled projection. */
  async cancelRun(principal: EnterprisePrincipal, input: EnterpriseTeamRunCancelInput): Promise<EnterpriseTeamRun> {
    const correlationId = `team-run:cancel:${input.runId}:${input.idempotencyKey}`
    const auditCancel = async (
      decision: EnterpriseTeamControlAuthorizationDecision,
      outcome?: string,
    ): Promise<void> => this.audit(
      principal, 'enterpriseTeamRun.cancel', { type: 'team-run', id: input.runId },
      decision, correlationId, { ...(outcome === undefined ? {} : { outcome }) },
    )
    const run = await this.projections.getTeamRun(principal.orgId, input.runId, this.scope(principal))
    if (run === undefined) {
      await auditCancel({ allowed: false, reason: 'not-found' })
      throw new EnterpriseOperationsError('not-found', 'team-run', input.runId)
    }
    const authorizationDecision = await this.decision(principal, 'enterpriseTeamRun.cancel', input)
    if (!authorizationDecision.allowed) {
      await auditCancel({ allowed: false, reason: authorizationDecision.reason ?? 'insufficient-role' })
      this.deny('enterpriseTeamRun.cancel')
    }
    if (run.state === 'cancelled' && input.expectedRevision === run.revision - 1) {
      await auditCancel(authorizationDecision, 'cancelled')
      return run
    }
    if (run.revision !== input.expectedRevision) {
      await auditCancel({ allowed: false, reason: 'conflict' })
      throw new EnterpriseOperationsError('conflict', 'team-run', run.runId)
    }
    if (TERMINAL_RUN_STATES.has(run.state)) {
      await auditCancel({ allowed: false, reason: 'run-terminal' })
      throw new EnterpriseOperationsError('invalid-transition', 'team-run', run.runId)
    }
    try {
      const result = await this.runtime.cancelRun({
        operationId: `team-run:cancel:${run.runId}:${input.idempotencyKey}`, run, actor: principal,
      })
      const cancelled = await this.projections.projectTeamRun({ orgId: principal.orgId, runId: run.runId, expectedRevision: run.revision,
        state: 'cancelled', runtimeRevision: result.runtimeRevision,
        ...(result.sourceEventSeq === undefined ? {} : { sourceEventSeq: result.sourceEventSeq }) })
      await auditCancel(authorizationDecision, 'cancelled')
      return cancelled
    } catch (error) {
      if (error instanceof EnterpriseOperationsError) {
        await auditCancel({ allowed: false, reason: error.code })
        throw error
      }
      if (error instanceof EnterpriseTeamRuntimeError && error.outcome === 'unknown') {
        await auditCancel(authorizationDecision, 'runtime-unknown')
        return run
      }
      await auditCancel(authorizationDecision, 'runtime-failed')
      throw error
    }
  }

  /** @param principal - authenticated viewer. @param input - visible page filters. @returns visible run page. */
  async listRuns(principal: EnterprisePrincipal, input: EnterpriseTeamRunListInput = {}): Promise<EnterpriseTeamRunPage> {
    await this.requireAuthorized(principal, 'enterpriseTeamRun.list', input, 'team-run', input.teamId ?? 'catalog')
    return this.projections.listTeamRuns({ orgId: principal.orgId, readScope: this.scope(principal), ...input })
  }

  /** @param principal - authenticated viewer. @param runId - run identity. @returns visible run. */
  async getRun(principal: EnterprisePrincipal, runId: string): Promise<EnterpriseTeamRun> {
    await this.requireAuthorized(principal, 'enterpriseTeamRun.get', { runId }, 'team-run', runId)
    const run = await this.projections.getTeamRun(principal.orgId, runId, this.scope(principal))
    if (run === undefined) throw new EnterpriseOperationsError('not-found', 'team-run', runId)
    return run
  }

  /** Host-only ingestion of a runtime-emitted decision projection. */
  async projectDecision(input: TeamDecision): Promise<TeamDecision> { return this.projections.projectDecision(input) }

  /** @param principal - authenticated viewer. @param input - visible decision filters. @returns decision page. */
  async listDecisions(principal: EnterprisePrincipal, input: EnterpriseTeamDecisionListInput = {}): Promise<TeamDecisionPage> {
    await this.requireAuthorized(principal, 'enterpriseTeamDecision.list', input, 'team-decision', input.runId ?? 'catalog')
    return this.projections.listDecisions({ orgId: principal.orgId, readScope: this.scope(principal), ...input })
  }

  /** @param principal - assigned human, team owner, or administrator. @param input - answer CAS. @returns answered projection. */
  async respondDecision(principal: EnterprisePrincipal, input: EnterpriseTeamDecisionRespondInput): Promise<TeamDecision> {
    const requestCorrelation = `team-decision:respond:${input.decisionId}:${input.idempotencyKey}`
    let correlationId = requestCorrelation
    let auditDetails: Readonly<Record<string, unknown>> = {}
    const auditResponse = async (
      decision: EnterpriseTeamControlAuthorizationDecision,
      outcome?: string,
    ): Promise<void> => this.audit(
      principal, 'enterpriseTeamDecision.respond', { type: 'team-decision', id: input.decisionId },
      decision, correlationId, { ...auditDetails, ...(outcome === undefined ? {} : { outcome }) },
    )
    const readScope = this.scope(principal)
    const decision = await this.projections.getDecision(principal.orgId, input.decisionId, readScope)
    if (decision === undefined) {
      await auditResponse({ allowed: false, reason: 'not-found' })
      throw new EnterpriseOperationsError('not-found', 'team-decision', input.decisionId)
    }
    correlationId = decision.runId
    const run = await this.projections.getTeamRun(principal.orgId, decision.runId)
    const definition = run === undefined ? undefined : await this.projections.getTeamDefinition(
      principal.orgId, run.teamId, this.scope(principal),
    )
    auditDetails = {
      runId: decision.runId,
      ...(run === undefined ? {} : { teamId: run.teamId }),
      ...(definition === undefined ? {} : { teamDefinitionRevision: definition.revision }),
    }
    const central = await this.decision(principal, 'enterpriseTeamDecision.respond', input)
    const authorizationReason = principal.roles.includes('administrator') && central.allowed
      ? 'administrator'
      : principal.userId === decision.assigneeUserId
        ? 'assigned-human'
        : principal.userId === definition?.ownerUserId ? 'creator-owner' : undefined
    if (authorizationReason === undefined) {
      await auditResponse({ allowed: false, reason: 'insufficient-role' })
      this.deny('enterpriseTeamDecision.respond')
    }
    const authorizationDecision = { allowed: true, reason: authorizationReason } as const
    const idempotencyFingerprint = createHash('sha256').update(JSON.stringify({
      decisionId: input.decisionId, answer: input.answer, expectedRevision: input.expectedRevision,
    })).digest('hex')
    try {
      const repeated = await this.projections.getDecisionResponseByKey(
        principal.orgId, input.idempotencyKey, idempotencyFingerprint,
      )
      if (repeated !== undefined) {
        await auditResponse(authorizationDecision, 'answered')
        return repeated
      }
      const reservation = await this.projections.reserveDecisionResponse({
        orgId: principal.orgId, decisionId: input.decisionId, expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey, idempotencyFingerprint,
      })
      if (reservation.completed) {
        await auditResponse(authorizationDecision, 'answered')
        return reservation.decision
      }
      let result: EnterpriseTeamRuntimeMutation
      try {
        result = await this.runtime.respondDecision({
          operationId: reservation.operationId, decision: reservation.decision, answer: input.answer, actor: principal,
        })
      } catch (error) {
        if (error instanceof EnterpriseTeamRuntimeError && error.outcome === 'unknown') {
          await auditResponse(authorizationDecision, 'runtime-unknown')
          return reservation.decision
        }
        await auditResponse(authorizationDecision, 'runtime-failed')
        throw error
      }
      const answered = await this.projections.answerDecision({ orgId: principal.orgId, decisionId: decision.decisionId,
        expectedRevision: reservation.decision.revision, answer: input.answer, runtimeRevision: result.runtimeRevision,
        ...(result.sourceEventSeq === undefined ? {} : { sourceEventSeq: result.sourceEventSeq }),
        idempotencyKey: input.idempotencyKey, idempotencyFingerprint, operationId: reservation.operationId,
      })
      await auditResponse(authorizationDecision, 'answered')
      return answered
    } catch (error) {
      if (error instanceof EnterpriseOperationsError) {
        await auditResponse({ allowed: false, reason: error.code })
      }
      throw error
    }
  }

  private async authorizeAutonomyManager(
    principal: EnterprisePrincipal,
    teamId: string,
    endpoint: EnterpriseTeamControlEndpoint,
    resourceId: string,
    details: Readonly<Record<string, unknown>>,
  ): Promise<{
    definition: EnterpriseTeamDefinition
    authorizationDecision: EnterpriseTeamControlAuthorizationDecision
  }> {
    const auditDenied = (reason: string, definitionRevision?: number): Promise<void> => this.audit(
      principal, endpoint, { type: 'team-autonomy-grant', id: resourceId },
      { allowed: false, reason }, resourceId, {
        ...details, teamId,
        ...(definitionRevision === undefined ? {} : { teamDefinitionRevision: definitionRevision }),
        outcomeReason: reason,
      },
    )
    const definition = await this.projections.getTeamDefinition(principal.orgId, teamId, this.scope(principal))
    if (definition === undefined) {
      await auditDenied('not-found')
      throw new EnterpriseOperationsError('not-found', 'team-definition', teamId)
    }
    const central = await this.decision(principal, endpoint, { teamId })
    const reason = principal.roles.includes('administrator') && central.allowed
      ? 'administrator'
      : definition.ownerUserId === principal.userId ? 'creator-owner' : undefined
    if (reason === undefined) {
      await auditDenied('insufficient-role', definition.revision)
      this.deny(endpoint)
    }
    return { definition, authorizationDecision: { allowed: true, reason } }
  }

  /** @param principal - authenticated viewer. @param input - grant filters. @returns visible grant page. */
  async listAutonomyGrants(
    principal: EnterprisePrincipal,
    input: EnterpriseTeamAutonomyListInput = {},
  ): Promise<EnterpriseTeamAutonomyGrantPage> {
    await this.requireAuthorized(principal, 'enterpriseTeamAutonomy.list', input, 'team-autonomy-grant', input.teamId ?? 'catalog')
    return this.projections.listAutonomyGrants({
      orgId: principal.orgId, readScope: this.scope(principal), ...input,
    })
  }

  /** @param principal - explicit human grantor. @param input - grant fields and CAS. @returns active grant. */
  async saveAutonomyGrant(principal: EnterprisePrincipal, input: EnterpriseTeamAutonomySaveInput): Promise<EnterpriseTeamAutonomyGrant> {
    const taskType = input.taskType.trim(); const capabilityScope = input.capabilityScope.trim()
    const resourceId = `${input.teamId}:${input.employeeReleaseId}:${taskType}:${capabilityScope}`
    const details = { employeeReleaseId: input.employeeReleaseId, taskType, capabilityScope }
    const { definition, authorizationDecision } = await this.authorizeAutonomyManager(
      principal, input.teamId, 'enterpriseTeamAutonomy.save', resourceId,
      details,
    )
    const auditGrant = (decision: EnterpriseTeamControlAuthorizationDecision, outcome?: string): Promise<void> => this.audit(
      principal, 'enterpriseTeamAutonomy.save', { type: 'team-autonomy-grant', id: resourceId },
      decision, resourceId, { ...details, teamId: input.teamId, teamDefinitionRevision: definition.revision,
        ...(outcome === undefined ? {} : { outcome }) },
    )
    if (taskType === '' || capabilityScope === '') {
      await auditGrant({ allowed: false, reason: 'invalid-scope' })
      throw new EnterpriseOperationsError('invalid-state', 'team-autonomy-grant')
    }
    if (!definition.roster.some(member => member.actor.kind === 'agent'
      && member.actor.employeeReleaseId === input.employeeReleaseId)) {
      await auditGrant({ allowed: false, reason: 'agent-not-rostered' })
      throw new EnterpriseOperationsError('invalid-state', 'team-autonomy-grant')
    }
    try {
      const grant = await this.projections.saveAutonomyGrant({ orgId: principal.orgId, teamId: input.teamId,
        employeeReleaseId: input.employeeReleaseId, taskType, capabilityScope, level: input.level,
        grantedBy: principal.userId, evidenceRefs: [...new Set(input.evidenceRefs.map(value => value.trim()).filter(Boolean))].sort(),
        expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey })
      await auditGrant(authorizationDecision, 'active')
      return grant
    } catch (error) {
      if (error instanceof EnterpriseOperationsError)
        await auditGrant({ allowed: false, reason: error.code })
      throw error
    }
  }

  /** @param principal - explicit human revoker. @param input - grant identity and CAS. @returns terminal revoked grant. */
  async revokeAutonomyGrant(
    principal: EnterprisePrincipal,
    input: EnterpriseTeamAutonomyRevokeInput,
  ): Promise<EnterpriseTeamAutonomyGrant> {
    const taskType = input.taskType.trim()
    const capabilityScope = input.capabilityScope.trim()
    const resourceId = `${input.teamId}:${input.employeeReleaseId}:${taskType}:${capabilityScope}`
    const details = { employeeReleaseId: input.employeeReleaseId, taskType, capabilityScope }
    const { definition, authorizationDecision } = await this.authorizeAutonomyManager(
      principal, input.teamId, 'enterpriseTeamAutonomy.revoke', resourceId,
      details,
    )
    const auditGrant = (decision: EnterpriseTeamControlAuthorizationDecision, outcome?: string): Promise<void> => this.audit(
      principal, 'enterpriseTeamAutonomy.revoke', { type: 'team-autonomy-grant', id: resourceId },
      decision, resourceId, { ...details, teamId: input.teamId, teamDefinitionRevision: definition.revision,
        ...(outcome === undefined ? {} : { outcome }) },
    )
    if (taskType === '' || capabilityScope === '') {
      await auditGrant({ allowed: false, reason: 'invalid-scope' })
      throw new EnterpriseOperationsError('invalid-state', 'team-autonomy-grant')
    }
    try {
      const grant = await this.projections.revokeAutonomyGrant({
        orgId: principal.orgId, ...input, taskType, capabilityScope,
      })
      await auditGrant(authorizationDecision, 'revoked')
      return grant
    } catch (error) {
      if (error instanceof EnterpriseOperationsError)
        await auditGrant({ allowed: false, reason: error.code })
      throw error
    }
  }
}
