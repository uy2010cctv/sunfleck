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
export interface EnterpriseWorkStartDependencies {
  readonly workspaceGrant: (workspaceId: string) => Promise<{ orgId: string } | undefined>
  readonly visibleWorkspace: (principal: EnterprisePrincipal, workspaceId: string) => Promise<boolean>
  readonly sessionOwnedBy: (principal: EnterprisePrincipal, sessionId: string) => Promise<boolean>
  readonly sessionWorkspace: (sessionId: string) => Promise<string | undefined>
  readonly personalWorkspaces: (principal: EnterprisePrincipal) => Promise<readonly string[]>
  readonly releases: (principal: EnterprisePrincipal) => Promise<readonly EnterpriseEmployeeRelease[]>
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
}
/** Narrow policy-first work-start orchestration; it deliberately does not route models or teams. */
export class EnterpriseWorkStartService {
  constructor(private readonly deps: EnterpriseWorkStartDependencies) {}
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
    const [only] = current
    if (only !== undefined && current.length === 1) return { kind: 'ready', workspaceId, employeeReleaseId: only.releaseId }
    return { kind: 'needs-selection', workspaceId, availableEmployeeReleaseIds: current.map(item => item.releaseId) }
  }
  async start(principal: EnterprisePrincipal, request: EnterpriseWorkStartRequest): Promise<EnterpriseWorkStartValue> {
    const prepared = await this.prepare(principal, request)
    if (prepared.kind === 'needs-workspace-selection') throw new Error('workspace selection is required')
    if (prepared.kind === 'needs-selection') throw new Error('employee selection is required')
    const release = (await this.deps.releases(principal)).find(item => item.releaseId === prepared.employeeReleaseId)
    if (release === undefined) throw new Error('employee release is not visible or published')
    const requestFingerprint = fingerprint(request, prepared.workspaceId, release)
    const sessionId = deterministicSessionId(principal, request.idempotencyKey)
    const created = await this.deps.createSession({
      sessionId,
      workspaceId: prepared.workspaceId,
      employeeReleaseId: prepared.employeeReleaseId,
      agentPresetId: release.presetId,
    })
    await this.deps.bindSession(principal, created.sessionId, prepared.workspaceId)
    await this.deps.upsertRecord({
      principal,
      sessionId: created.sessionId,
      employeeReleaseId: prepared.employeeReleaseId,
      idempotencyKey: request.idempotencyKey,
      sourceReferences: {
        requestFingerprint,
        objectiveDigest: digest(request.objective),
        employeeReleaseId: release.releaseId,
        releasePresetId: release.presetId,
        ...(request.deadline === undefined ? {} : { deadline: request.deadline }),
      },
    })
    return { sessionId: created.sessionId, workspaceId: prepared.workspaceId, employeeReleaseId: prepared.employeeReleaseId, executionSummary: 'Enterprise work Session created with the selected workspace and employee.' }
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

function fingerprint(request: EnterpriseWorkStartRequest, workspaceId: string, release: EnterpriseEmployeeRelease): string {
  return digest(JSON.stringify({
    objective: request.objective, deadline: request.deadline, workspaceId: request.workspaceId,
    currentSessionId: request.currentSessionId, recentWorkspaceId: request.recentWorkspaceId,
    preferredEmployeeReleaseId: request.preferredEmployeeReleaseId, resolvedWorkspaceId: workspaceId,
    releaseId: release.releaseId, releasePresetId: release.presetId, releaseVersion: release.version,
    releaseDigest: release.digest,
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
