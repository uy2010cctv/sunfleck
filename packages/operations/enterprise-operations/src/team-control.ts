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
    input: Omit<EnterpriseTeamRun, 'runId' | 'revision' | 'createdAt' | 'updatedAt'> & {
      readonly idempotencyKey: string
      readonly idempotencyFingerprint: string
    },
    allocateRunId: () => string,
  ): Promise<{ readonly run: EnterpriseTeamRun; readonly created: boolean }>
  getTeamRunByStartKey(
    orgId: string,
    idempotencyKey: string,
    idempotencyFingerprint?: string,
  ): Promise<EnterpriseTeamRun | undefined>
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

  private async definition(principal: EnterprisePrincipal, teamId: string): Promise<EnterpriseTeamDefinition> {
    const value = await this.projections.getTeamDefinition(principal.orgId, teamId, this.scope(principal))
    if (value === undefined) throw new EnterpriseOperationsError('not-found', 'team-definition', teamId)
    return value
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
    let repeated: EnterpriseTeamRun | undefined
    try {
      repeated = await this.projections.getTeamRunByStartKey(
        principal.orgId, input.idempotencyKey, idempotencyFingerprint,
      )
    } catch (error) {
      if (error instanceof EnterpriseOperationsError && error.code === 'idempotency-conflict')
        await deniedDefinition('idempotency-conflict')
      throw error
    }
    if (repeated !== undefined) {
      if (repeated.createdBy !== principal.userId
        || await this.projections.getTeamDefinition(principal.orgId, repeated.teamId, this.scope(principal)) === undefined) {
        await deniedDefinition('definition-hidden')
        throw new EnterpriseOperationsError('not-found', 'team-run', repeated.runId)
      }
      await this.audit(
        principal, 'enterpriseTeamRun.start', { type: 'team-run', id: repeated.runId },
        authorizationDecision, repeated.runId, {
          teamId: repeated.teamId,
          teamDefinitionRevision: repeated.teamDefinitionRevision,
        },
      )
      return repeated
    }
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
    let created: { readonly run: EnterpriseTeamRun; readonly created: boolean }
    try {
      created = await this.projections.createTeamRunStarting({
        orgId: principal.orgId, teamId: definition.teamId, teamDefinitionRevision: definition.revision,
        workspaceId: input.workspaceId, rosterSnapshot: structuredClone(definition.roster), createdBy: principal.userId,
        source: input.source, state: 'starting', runtimeRevision: 0, idempotencyKey: input.idempotencyKey,
        idempotencyFingerprint,
      }, this.runId)
    } catch (error) {
      if (error instanceof EnterpriseOperationsError && error.code === 'idempotency-conflict')
        await deniedDefinition('idempotency-conflict')
      throw error
    }
    if (created.run.createdBy !== principal.userId) {
      await deniedDefinition('definition-hidden')
      throw new EnterpriseOperationsError('not-found', 'team-run', created.run.runId)
    }
    const runAudit = async (
      decision: EnterpriseTeamControlAuthorizationDecision,
      reason?: string,
    ): Promise<void> => this.audit(
      principal, 'enterpriseTeamRun.start', { type: 'team-run', id: created.run.runId },
      decision, created.run.runId, {
        teamId: created.run.teamId,
        teamDefinitionRevision: created.run.teamDefinitionRevision,
        ...(reason === undefined ? {} : { outcomeReason: reason }),
      },
    )
    if (!created.created || created.run.state !== 'starting' || created.run.rootSessionId !== undefined) {
      const settled = created.run.state === 'active' || created.run.state === 'completed'
      await runAudit(settled
        ? { allowed: true, ...(authorizationDecision.reason === undefined ? {} : { reason: authorizationDecision.reason }) }
        : { allowed: false, reason: 'runtime-pending' }, settled ? undefined : 'runtime-pending')
      return created.run
    }
    try {
      const result = await this.runtime.startRun({ operationId: `team-run:start:${created.run.runId}`, runId: created.run.runId,
        orgId: principal.orgId, definition: { ...definition, roster: structuredClone(created.run.rosterSnapshot) },
        workspaceId: input.workspaceId, prompt: input.prompt, actor: principal })
      const active = await this.projections.projectTeamRun({ orgId: principal.orgId, runId: created.run.runId,
        expectedRevision: created.run.revision, state: 'active', rootSessionId: result.rootSessionId,
        runtimeRevision: result.runtimeRevision,
        ...(result.sourceEventSeq === undefined ? {} : { sourceEventSeq: result.sourceEventSeq }),
      })
      await runAudit(authorizationDecision)
      return active
    } catch (error) {
      if (error instanceof EnterpriseTeamRuntimeError && error.outcome === 'deterministic') {
        const failed = await this.projections.projectTeamRun({ orgId: principal.orgId, runId: created.run.runId,
          expectedRevision: created.run.revision, state: 'failed', runtimeRevision: created.run.runtimeRevision,
          failure: { code: error.code, message: error.message } })
        await runAudit({ allowed: false, reason: 'runtime-deterministic-failure' }, error.code)
        return failed
      }
      if (error instanceof EnterpriseTeamRuntimeError && error.outcome === 'unknown') {
        await runAudit({ allowed: false, reason: 'runtime-unknown' }, error.code)
        return created.run
      }
      await runAudit({ allowed: false, reason: 'runtime-failure' }, 'runtime-failure')
      throw error
    }
  }

  /** @param input - Host-only reconciliation address. @returns event-log-derived projection. */
  async reconcileRun(input: { readonly orgId: string; readonly runId: string }): Promise<EnterpriseTeamRun> {
    const run = await this.projections.getTeamRun(input.orgId, input.runId)
    if (run === undefined) throw new EnterpriseOperationsError('not-found', 'team-run', input.runId)
    if (TERMINAL_RUN_STATES.has(run.state)) return run
    const operationId = run.state === 'starting'
      ? `team-run:start:${run.runId}`
      : `team-run:reconcile:${run.runId}`
    const result = await this.runtime.reconcileRun({ operationId, run })
    return this.projections.projectTeamRun({ orgId: run.orgId, runId: run.runId, expectedRevision: run.revision,
      state: result.state, runtimeRevision: result.runtimeRevision,
      ...(result.rootSessionId === undefined ? {} : { rootSessionId: result.rootSessionId }),
      ...(result.sourceEventSeq === undefined ? {} : { sourceEventSeq: result.sourceEventSeq }),
      ...(result.failure === undefined ? {} : { failure: result.failure }) })
  }

  /** @param principal - authenticated Host actor. @param input - run CAS and idempotency fields. @returns cancelled projection. */
  async cancelRun(principal: EnterprisePrincipal, input: EnterpriseTeamRunCancelInput): Promise<EnterpriseTeamRun> {
    const run = await this.projections.getTeamRun(principal.orgId, input.runId, this.scope(principal))
    if (run === undefined) throw new EnterpriseOperationsError('not-found', 'team-run', input.runId)
    await this.requireAuthorized(principal, 'enterpriseTeamRun.cancel', input, 'team-run', run.runId, run.runId)
    if (run.state === 'cancelled' && input.expectedRevision === run.revision - 1) return run
    if (run.revision !== input.expectedRevision) throw new EnterpriseOperationsError('conflict', 'team-run', run.runId)
    if (TERMINAL_RUN_STATES.has(run.state)) throw new EnterpriseOperationsError('invalid-transition', 'team-run', run.runId)
    try {
      const result = await this.runtime.cancelRun({
        operationId: `team-run:cancel:${run.runId}:${input.idempotencyKey}`, run, actor: principal,
      })
      return await this.projections.projectTeamRun({ orgId: principal.orgId, runId: run.runId, expectedRevision: run.revision,
        state: 'cancelled', runtimeRevision: result.runtimeRevision,
        ...(result.sourceEventSeq === undefined ? {} : { sourceEventSeq: result.sourceEventSeq }) })
    } catch (error) {
      if (error instanceof EnterpriseTeamRuntimeError && error.outcome === 'unknown') return run
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
    const readScope = this.scope(principal)
    const decision = await this.projections.getDecision(principal.orgId, input.decisionId, readScope)
    if (decision === undefined) throw new EnterpriseOperationsError('not-found', 'team-decision', input.decisionId)
    const run = await this.projections.getTeamRun(principal.orgId, decision.runId)
    const definition = run === undefined ? undefined : await this.projections.getTeamDefinition(
      principal.orgId, run.teamId, this.scope(principal),
    )
    const central = await this.decision(principal, 'enterpriseTeamDecision.respond', input)
    const allowed = (principal.roles.includes('administrator') && central.allowed)
      || principal.userId === decision.assigneeUserId
      || principal.userId === definition?.ownerUserId
    await this.audit(
      principal, 'enterpriseTeamDecision.respond', { type: 'team-decision', id: decision.decisionId },
      { allowed, ...allowed ? {} : { reason: 'insufficient-role' } }, decision.runId, {
        runId: decision.runId,
        ...(run === undefined ? {} : { teamId: run.teamId }),
        ...(definition === undefined ? {} : { teamDefinitionRevision: definition.revision }),
        ...allowed ? {} : { outcomeReason: 'insufficient-role' },
      },
    )
    if (!allowed) this.deny('enterpriseTeamDecision.respond')
    const idempotencyFingerprint = createHash('sha256').update(JSON.stringify({
      decisionId: input.decisionId, answer: input.answer, expectedRevision: input.expectedRevision,
    })).digest('hex')
    const repeated = await this.projections.getDecisionResponseByKey(
      principal.orgId, input.idempotencyKey, idempotencyFingerprint,
    )
    if (repeated !== undefined) return repeated
    if (decision.state !== 'open') throw new EnterpriseOperationsError('invalid-transition', 'team-decision', input.decisionId)
    if (decision.revision !== input.expectedRevision) throw new EnterpriseOperationsError('conflict', 'team-decision', input.decisionId)
    const result = await this.runtime.respondDecision({ operationId: `team-decision:respond:${decision.decisionId}:${input.idempotencyKey}`,
      decision, answer: input.answer, actor: principal })
    return this.projections.answerDecision({ orgId: principal.orgId, decisionId: decision.decisionId,
      expectedRevision: decision.revision, answer: input.answer, runtimeRevision: result.runtimeRevision,
      ...(result.sourceEventSeq === undefined ? {} : { sourceEventSeq: result.sourceEventSeq }),
      idempotencyKey: input.idempotencyKey, idempotencyFingerprint,
    })
  }

  private async requireAutonomyManager(
    principal: EnterprisePrincipal,
    teamId: string,
    endpoint: EnterpriseTeamControlEndpoint,
    resourceId: string,
    details: Readonly<Record<string, unknown>>,
  ): Promise<EnterpriseTeamDefinition> {
    const definition = await this.definition(principal, teamId)
    const central = await this.decision(principal, endpoint, { teamId })
    const allowed = (principal.roles.includes('administrator') && central.allowed)
      || definition.ownerUserId === principal.userId
    await this.audit(
      principal, endpoint, { type: 'team-autonomy-grant', id: resourceId },
      { allowed, ...allowed ? {} : { reason: 'insufficient-role' } }, resourceId, {
        ...details, teamId, teamDefinitionRevision: definition.revision,
        ...allowed ? {} : { outcomeReason: 'insufficient-role' },
      },
    )
    if (!allowed) this.deny(endpoint)
    return definition
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
    const definition = await this.requireAutonomyManager(
      principal, input.teamId, 'enterpriseTeamAutonomy.save', resourceId,
      { employeeReleaseId: input.employeeReleaseId, taskType, capabilityScope },
    )
    if (taskType === '' || capabilityScope === '' || !definition.roster.some(member =>
      member.actor.kind === 'agent' && member.actor.employeeReleaseId === input.employeeReleaseId))
      throw new EnterpriseOperationsError('invalid-state', 'team-autonomy-grant')
    return this.projections.saveAutonomyGrant({ orgId: principal.orgId, teamId: input.teamId,
      employeeReleaseId: input.employeeReleaseId, taskType, capabilityScope, level: input.level,
      grantedBy: principal.userId, evidenceRefs: [...new Set(input.evidenceRefs.map(value => value.trim()).filter(Boolean))].sort(),
      expectedRevision: input.expectedRevision, idempotencyKey: input.idempotencyKey })
  }

  /** @param principal - explicit human revoker. @param input - grant identity and CAS. @returns terminal revoked grant. */
  async revokeAutonomyGrant(
    principal: EnterprisePrincipal,
    input: EnterpriseTeamAutonomyRevokeInput,
  ): Promise<EnterpriseTeamAutonomyGrant> {
    const resourceId = `${input.teamId}:${input.employeeReleaseId}:${input.taskType}:${input.capabilityScope}`
    await this.requireAutonomyManager(
      principal, input.teamId, 'enterpriseTeamAutonomy.revoke', resourceId,
      { employeeReleaseId: input.employeeReleaseId, taskType: input.taskType, capabilityScope: input.capabilityScope },
    )
    return this.projections.revokeAutonomyGrant({ orgId: principal.orgId, ...input })
  }
}
