import { createHash } from 'node:crypto'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type { EnterpriseEmployeeRelease } from './contract/employees.ts'
import type {
  EnterpriseWorkPreparation,
  EnterpriseWorkPrepareRequest,
  EnterpriseWorkStartRequest,
  EnterpriseWorkStartValue,
} from './contract/work.ts'
export type {
  EnterpriseWorkPreparation,
  EnterpriseWorkPrepareRequest,
  EnterpriseWorkStartRequest,
  EnterpriseWorkStartValue,
} from './contract/work.ts'
interface WorkStartSnapshot {
  readonly requestFingerprint: string
  readonly sessionId: string
  readonly workspaceId: string
  readonly employeeReleaseId: string
  readonly presetId: string
  readonly deadline?: string
  readonly state: 'starting' | 'completed'
}
/** Data used by `EnterpriseWorkStartDependencies`. */
export interface EnterpriseWorkStartDependencies {
  readonly workspaceGrant: (workspaceId: string) => Promise<{ orgId: string } | undefined>
  readonly visibleWorkspace: (principal: EnterprisePrincipal, workspaceId: string) => Promise<boolean>
  readonly sessionOwnedBy: (principal: EnterprisePrincipal, sessionId: string) => Promise<boolean>
  readonly sessionWorkspace: (sessionId: string) => Promise<string | undefined>
  readonly personalWorkspaces: (principal: EnterprisePrincipal) => Promise<readonly string[]>
  readonly releases: (principal: EnterprisePrincipal) => Promise<readonly EnterpriseEmployeeRelease[]>
  readonly workspaceEmployeeDefault?: (workspaceId: string) => Promise<string | null>
  readonly createSession: (input: {
    sessionId: string
    workspaceId: string
    employeeReleaseId: string
    agentPresetId: string
  }) => Promise<{ sessionId: string }>
  readonly bindSession: (principal: EnterprisePrincipal, sessionId: string, workspaceId: string) => Promise<void>
  readonly upsertRecord: (input: {
    principal: EnterprisePrincipal
    sessionId: string
    employeeReleaseId: string
    sourceReferences: Readonly<Record<string, string>>
    idempotencyKey: string
  }) => Promise<void>
  readonly reserveWorkStart: (input: {
    principal: EnterprisePrincipal
    orgId: string
    userId: string
    idempotencyKey: string
    requestFingerprint: string
    sessionId: string
    workspaceId: string
    employeeReleaseId: string
    presetId: string
    deadline?: string
    deadlineDigest?: string
  }) => Promise<WorkStartSnapshot>
  readonly getWorkStart: (input: {
    principal: EnterprisePrincipal
    orgId: string
    userId: string
    idempotencyKey: string
  }) => Promise<WorkStartSnapshot | undefined>
  readonly completeWorkStart: (input: {
    principal: EnterprisePrincipal
    orgId: string
    userId: string
    idempotencyKey: string
  }) => Promise<unknown>
}
/** Narrow policy-first work-start orchestration; it deliberately does not route models or teams. */
export class EnterpriseWorkStartService {
  constructor(private readonly deps: EnterpriseWorkStartDependencies) {}
  /** Executes `EnterpriseWorkStartService.prepare` for this instance.
   * @param principal - Input value used by this API.
   * @param request - Input value used by this API.
   * @returns Result produced by this API.
   */
  async prepare(principal: EnterprisePrincipal, request: EnterpriseWorkPrepareRequest): Promise<EnterpriseWorkPreparation> {
    if (request.objective.trim() === '') throw new Error('objective is required')
    if (request.deadline !== undefined && Number.isNaN(Date.parse(request.deadline))) throw new Error('deadline must be ISO date')
    const workspace = await this.workspace(principal, request)
    if (typeof workspace !== 'string') return workspace
    const workspaceId = workspace
    const releases = await this.deps.releases(principal)
    const preferred = request.preferredEmployeeReleaseId === undefined
      ? undefined
      : releases.find(item => item.releaseId === request.preferredEmployeeReleaseId)
    if (request.preferredEmployeeReleaseId !== undefined && preferred === undefined) throw new Error('employee release is not visible or published')
    if (preferred !== undefined) return { kind: 'ready', workspaceId, employeeReleaseId: preferred.releaseId }
    const current = currentReleases(releases)
    const defaultEmployeeId = await this.deps.workspaceEmployeeDefault?.(workspaceId)
    const workspaceDefault = current.find(item => item.presetId === defaultEmployeeId)
    if (workspaceDefault !== undefined) return { kind: 'ready', workspaceId, employeeReleaseId: workspaceDefault.releaseId }
    const [only] = current
    if (only !== undefined && current.length === 1) return { kind: 'ready', workspaceId, employeeReleaseId: only.releaseId }
    return { kind: 'needs-selection', workspaceId, availableEmployeeReleaseIds: current.map(item => item.releaseId) }
  }
  /** Executes `EnterpriseWorkStartService.start` for this instance.
   * @param principal - Input value used by this API.
   * @param request - Input value used by this API.
   * @returns Result produced by this API.
   */
  async start(principal: EnterprisePrincipal, request: EnterpriseWorkStartRequest): Promise<EnterpriseWorkStartValue> {
    const requestFingerprint = fingerprint(request)
    const existing = await this.deps.getWorkStart({
      principal, orgId: principal.orgId, userId: principal.userId, idempotencyKey: request.idempotencyKey,
    })
    if (existing !== undefined) {
      const reservation = await this.deps.reserveWorkStart({
        principal, orgId: principal.orgId, userId: principal.userId, idempotencyKey: request.idempotencyKey,
        requestFingerprint,
        sessionId: existing.sessionId, workspaceId: existing.workspaceId, employeeReleaseId: existing.employeeReleaseId,
        presetId: existing.presetId,
        ...(existing.deadline === undefined
          ? {}
          : { deadline: existing.deadline, deadlineDigest: digest(existing.deadline) }),
      })
      if (reservation.state === 'completed') return this.value(reservation)
      return this.resume(principal, request, reservation)
    }
    const prepared = await this.prepare(principal, request)
    if (prepared.kind === 'needs-workspace-selection') throw new Error('workspace selection is required')
    if (prepared.kind === 'needs-selection') throw new Error('employee selection is required')
    const release = (await this.deps.releases(principal)).find(item => item.releaseId === prepared.employeeReleaseId)
    if (release === undefined) throw new Error('employee release is not visible or published')
    const sessionId = deterministicSessionId(principal, request.idempotencyKey)
    const reservation = await this.deps.reserveWorkStart({
      principal, orgId: principal.orgId, userId: principal.userId, idempotencyKey: request.idempotencyKey,
      requestFingerprint, sessionId, workspaceId: prepared.workspaceId, employeeReleaseId: prepared.employeeReleaseId,
      presetId: release.presetId,
      ...(request.deadline === undefined ? {} : { deadline: request.deadline, deadlineDigest: digest(request.deadline) }),
    })
    return this.resume(principal, request, reservation)
  }
  private async resume(
    principal: EnterprisePrincipal,
    request: EnterpriseWorkStartRequest,
    reservation: Pick<WorkStartSnapshot, 'sessionId' | 'workspaceId' | 'employeeReleaseId' | 'presetId' | 'deadline'>,
  ): Promise<EnterpriseWorkStartValue> {
    const created = await this.deps.createSession({
      sessionId: reservation.sessionId,
      workspaceId: reservation.workspaceId,
      employeeReleaseId: reservation.employeeReleaseId,
      agentPresetId: reservation.presetId,
    })
    await this.deps.bindSession(principal, created.sessionId, reservation.workspaceId)
    await this.deps.upsertRecord({
      principal,
      sessionId: created.sessionId,
      employeeReleaseId: reservation.employeeReleaseId,
      idempotencyKey: request.idempotencyKey,
      sourceReferences: {
        requestFingerprint: fingerprint(request),
        objectiveDigest: digest(request.objective),
        employeeReleaseId: reservation.employeeReleaseId,
        releasePresetId: reservation.presetId,
        ...(reservation.deadline === undefined ? {} : { deadline: reservation.deadline }),
      },
    })
    await this.deps.completeWorkStart({
      principal, orgId: principal.orgId, userId: principal.userId, idempotencyKey: request.idempotencyKey,
    })
    return this.value(reservation)
  }
  private value(reservation: { sessionId: string; workspaceId: string; employeeReleaseId: string }): EnterpriseWorkStartValue {
    return { sessionId: reservation.sessionId, workspaceId: reservation.workspaceId, employeeReleaseId: reservation.employeeReleaseId, executionSummary: 'Enterprise work Session created with the selected workspace and employee.' }
  }
  private async workspace(principal: EnterprisePrincipal, request: EnterpriseWorkPrepareRequest): Promise<string | Extract<EnterpriseWorkPreparation, { kind: 'needs-workspace-selection' }>> {
    const allowed = async (workspaceId: string) => {
      const grant = await this.deps.workspaceGrant(workspaceId)
      return grant?.orgId === principal.orgId && await this.deps.visibleWorkspace(principal, workspaceId)
    }
    if (request.workspaceId !== undefined) {
      if (!await allowed(request.workspaceId)) throw new Error('workspace is not authorized')
      return request.workspaceId
    }
    if (request.currentSessionId !== undefined && await this.deps.sessionOwnedBy(principal, request.currentSessionId)) {
      const workspaceId = await this.deps.sessionWorkspace(request.currentSessionId)
      if (workspaceId !== undefined && await allowed(workspaceId)) return workspaceId
    }
    if (request.recentWorkspaceId !== undefined && await allowed(request.recentWorkspaceId)) return request.recentWorkspaceId
    const workspaces = await this.deps.personalWorkspaces(principal)
    const authorized = await Promise.all(workspaces.map(async workspaceId => await allowed(workspaceId) ? workspaceId : undefined))
    const availableWorkspaceIds = authorized.filter((workspaceId): workspaceId is string => workspaceId !== undefined)
    const [only] = availableWorkspaceIds
    if (availableWorkspaceIds.length === 1 && only !== undefined) return only
    return { kind: 'needs-workspace-selection', availableWorkspaceIds }
  }
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex') }

function fingerprint(request: EnterpriseWorkStartRequest): string {
  return digest(JSON.stringify({
    objective: request.objective, deadline: request.deadline, workspaceId: request.workspaceId,
    currentSessionId: request.currentSessionId, recentWorkspaceId: request.recentWorkspaceId,
    preferredEmployeeReleaseId: request.preferredEmployeeReleaseId,
  }))
}

function deterministicSessionId(principal: EnterprisePrincipal, idempotencyKey: string): string {
  return `session-work-${digest(JSON.stringify({ orgId: principal.orgId, userId: principal.userId, idempotencyKey }))}`
}

function currentReleases(releases: readonly EnterpriseEmployeeRelease[]): EnterpriseEmployeeRelease[] {
  const current = new Map<string, EnterpriseEmployeeRelease>()
  for (const release of releases) {
    const prior = current.get(release.presetId)
    if (prior === undefined || release.version > prior.version) current.set(release.presetId, release)
  }
  return [...current.values()]
}
