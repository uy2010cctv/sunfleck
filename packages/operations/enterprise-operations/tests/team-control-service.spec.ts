import { describe, expect, it, vi } from 'vitest'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import {
  EnterpriseOperationsError,
  EnterpriseTeamControlService,
  EnterpriseTeamRuntimeError,
  type EnterpriseTeamAutonomyGrant,
  type EnterpriseTeamDefinition,
  type EnterpriseTeamRun,
  type EnterpriseTeamRuntimeDriver,
  type TeamDecision,
} from '../src/index.ts'

const owner: EnterprisePrincipal = { orgId: 'org-a', userId: 'owner-a', roles: ['creator'] }
const member: EnterprisePrincipal = { orgId: 'org-a', userId: 'member-a', roles: ['member'] }
const admin: EnterprisePrincipal = { orgId: 'org-a', userId: 'admin-a', roles: ['administrator'] }

function definition(overrides: Partial<EnterpriseTeamDefinition> = {}): EnterpriseTeamDefinition {
  return {
    teamId: 'team-a', orgId: 'org-a', name: 'Finance', northStar: 'Close accurately.', ownerUserId: 'owner-a',
    visibility: 'organization', leaderEmployeeReleaseId: 'release-a',
    roles: [{ roleId: 'lead', name: 'Lead', responsibility: 'Lead.' }],
    roster: [
      { actor: { kind: 'human', userId: 'owner-a' }, roleId: 'lead' },
      { actor: { kind: 'agent', employeeReleaseId: 'release-a' }, roleId: 'lead' },
    ],
    verificationPolicy: {}, attentionPolicy: {}, approvalPolicy: {}, state: 'active',
    revision: 4, createdAt: 1, updatedAt: 1, ...overrides,
  }
}

class MemoryProjection {
  definition = definition()
  runs = new Map<string, EnterpriseTeamRun>()
  startKeys = new Map<string, string>()
  startFingerprints = new Map<string, string>()
  decisions = new Map<string, TeamDecision>()
  grants = new Map<string, EnterpriseTeamAutonomyGrant>()
  grantKeys = new Map<string, EnterpriseTeamAutonomyGrant>()

  async getTeamDefinition(orgId: string, teamId: string, scope: { userId: string; isAdministrator: boolean }) {
    if (orgId !== this.definition.orgId || teamId !== this.definition.teamId) return undefined
    if (this.definition.visibility === 'private' && !scope.isAdministrator && scope.userId !== this.definition.ownerUserId)
      return undefined
    return structuredClone(this.definition)
  }
  async createTeamRunStarting(input: Omit<EnterpriseTeamRun, 'revision' | 'createdAt' | 'updatedAt'> & { idempotencyKey: string; idempotencyFingerprint?: string }) {
    const existingId = this.startKeys.get(`${input.orgId}:${input.idempotencyKey}`)
    if (existingId !== undefined) return { run: this.runs.get(existingId)!, created: false }
    const run = { ...input, revision: 1, createdAt: 10, updatedAt: 10 }
    delete (run as { idempotencyKey?: string }).idempotencyKey
    delete (run as { idempotencyFingerprint?: string }).idempotencyFingerprint
    this.runs.set(run.runId, run)
    this.startKeys.set(`${input.orgId}:${input.idempotencyKey}`, run.runId)
    this.startFingerprints.set(`${input.orgId}:${input.idempotencyKey}`, input.idempotencyFingerprint ?? '')
    return { run, created: true }
  }
  async getTeamRun(orgId: string, runId: string) {
    const run = this.runs.get(runId)
    return run?.orgId === orgId ? run : undefined
  }
  async getTeamRunByStartKey(orgId: string, idempotencyKey: string, idempotencyFingerprint?: string) {
    const stored = this.startFingerprints.get(`${orgId}:${idempotencyKey}`)
    if (stored !== undefined && stored !== idempotencyFingerprint)
      throw new EnterpriseOperationsError('idempotency-conflict', 'team-run')
    const runId = this.startKeys.get(`${orgId}:${idempotencyKey}`)
    return runId === undefined ? undefined : this.runs.get(runId)
  }
  async listTeamRuns({ orgId }: { orgId: string }) {
    return { items: [...this.runs.values()].filter(run => run.orgId === orgId) }
  }
  async projectTeamRun(input: { orgId: string; runId: string; expectedRevision: number; state: EnterpriseTeamRun['state']; rootSessionId?: string; runtimeRevision: number; sourceEventSeq?: number; failure?: EnterpriseTeamRun['failure'] }) {
    const before = this.runs.get(input.runId)
    if (before === undefined || before.orgId !== input.orgId) throw new EnterpriseOperationsError('not-found', 'team-run', input.runId)
    if (before.revision !== input.expectedRevision) throw new EnterpriseOperationsError('conflict', 'team-run', input.runId)
    const run = { ...before, ...input, revision: before.revision + 1, updatedAt: before.updatedAt + 1 }
    delete (run as { expectedRevision?: number }).expectedRevision
    this.runs.set(input.runId, run)
    return run
  }
  async projectDecision(input: TeamDecision) { this.decisions.set(input.decisionId, input); return input }
  async getDecision(orgId: string, decisionId: string) {
    const decision = this.decisions.get(decisionId)
    return decision?.orgId === orgId ? decision : undefined
  }
  async listDecisions({ orgId }: { orgId: string }) {
    return { items: [...this.decisions.values()].filter(decision => decision.orgId === orgId) }
  }
  async answerDecision(input: {
    orgId: string
    decisionId: string
    expectedRevision: number
    answer: string
    runtimeRevision: number
    sourceEventSeq?: number
  }) {
    const before = this.decisions.get(input.decisionId)!
    if (before.revision !== input.expectedRevision) throw new EnterpriseOperationsError('conflict', 'team-decision', input.decisionId)
    const decision = { ...before, answer: input.answer, state: 'answered' as const, runtimeRevision: input.runtimeRevision,
      ...(input.sourceEventSeq === undefined ? {} : { sourceEventSeq: input.sourceEventSeq }),
      revision: before.revision + 1, updatedAt: before.updatedAt + 1,
    }
    this.decisions.set(input.decisionId, decision)
    return decision
  }
  async listAutonomyGrants({ orgId }: { orgId: string }) {
    return { items: [...this.grants.values()].filter(grant => grant.orgId === orgId) }
  }
  async saveAutonomyGrant(input: Omit<EnterpriseTeamAutonomyGrant, 'revision' | 'createdAt' | 'updatedAt' | 'state'> & { expectedRevision: number; idempotencyKey: string }) {
    const remembered = this.grantKeys.get(`save:${input.orgId}:${input.idempotencyKey}`)
    if (remembered !== undefined) return remembered
    const key = `${input.orgId}:${input.teamId}:${input.employeeReleaseId}:${input.taskType}:${input.capabilityScope}`
    const before = this.grants.get(key)
    if (before?.state === 'revoked') throw new EnterpriseOperationsError('invalid-transition', 'team-autonomy-grant')
    const value: EnterpriseTeamAutonomyGrant = { ...input, state: 'active', revision: (before?.revision ?? 0) + 1,
      createdAt: before?.createdAt ?? 10, updatedAt: 10 }
    delete (value as { expectedRevision?: number; idempotencyKey?: string }).expectedRevision
    delete (value as { expectedRevision?: number; idempotencyKey?: string }).idempotencyKey
    this.grants.set(key, value)
    this.grantKeys.set(`save:${input.orgId}:${input.idempotencyKey}`, value)
    return value
  }
  async revokeAutonomyGrant(input: {
    orgId: string
    teamId: string
    employeeReleaseId: string
    taskType: string
    capabilityScope: string
    expectedRevision: number
  }) {
    const key = `${input.orgId}:${input.teamId}:${input.employeeReleaseId}:${input.taskType}:${input.capabilityScope}`
    const before = this.grants.get(key)!
    const value = { ...before, state: 'revoked' as const, revision: before.revision + 1, updatedAt: before.updatedAt + 1 }
    this.grants.set(key, value)
    return value
  }
}

function runtime(overrides: Partial<EnterpriseTeamRuntimeDriver> = {}) {
  return {
    startRun: vi.fn(overrides.startRun ?? (async () => ({ rootSessionId: 'session-root', runtimeRevision: 1, sourceEventSeq: 1 }))),
    cancelRun: vi.fn(overrides.cancelRun ?? (async () => ({ runtimeRevision: 2, sourceEventSeq: 2 }))),
    respondDecision: vi.fn(overrides.respondDecision ?? (async () => ({ runtimeRevision: 3, sourceEventSeq: 3 }))),
    reconcileRun: vi.fn(overrides.reconcileRun ?? (async () => ({ rootSessionId: 'session-root', state: 'active' as const, runtimeRevision: 1, sourceEventSeq: 1 }))),
  } satisfies EnterpriseTeamRuntimeDriver
}

function service(projection = new MemoryProjection(), runtimeDriver = runtime()) {
  const authorize = vi.fn().mockImplementation(async (principal: EnterprisePrincipal, endpoint: string) => ({
    allowed: principal.roles.includes('administrator') || principal.userId === 'owner-a'
      || endpoint.endsWith('.list') || endpoint.endsWith('.get'),
  }))
  const authorizeWorkspace = vi.fn().mockResolvedValue(true)
  const audit = vi.fn()
  return { projection, runtimeDriver, authorize, authorizeWorkspace, audit, value: new EnterpriseTeamControlService(
    projection, runtimeDriver, { authorize, authorizeWorkspace, audit, runId: () => 'run-a' },
  ) }
}

describe('enterprise TeamRun control service', () => {
  it('freezes the active definition roster, reuses operationId, and returns the same idempotent run', async () => {
    const app = service()
    const input = { teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'workspace-a', prompt: 'Close books.', source: 'console' as const, idempotencyKey: 'start-a' }
    const first = await app.value.startRun(owner, input)
    app.projection.definition = definition({ revision: 5, roster: [] })
    const repeated = await app.value.startRun(owner, input)
    expect(first).toMatchObject({ runId: 'run-a', rootSessionId: 'session-root', state: 'active', teamDefinitionRevision: 4 })
    expect(repeated).toEqual(first)
    expect(first.rosterSnapshot).toEqual(definition().roster)
    expect(app.runtimeDriver.startRun).toHaveBeenCalledTimes(1)
    expect(app.runtimeDriver.startRun).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'team-run:start:run-a' }))
    await expect(app.value.startRun(owner, { ...input, prompt: 'Different prompt.' }))
      .rejects.toMatchObject({ code: 'idempotency-conflict' })
  })

  it('rejects stale, inactive, hidden, workspace-denied, and member starts before runtime', async () => {
    const stale = service()
    await expect(stale.value.startRun(owner, { teamId: 'team-a', expectedTeamRevision: 3, workspaceId: 'w', prompt: 'p', source: 'console', idempotencyKey: 'a' }))
      .rejects.toMatchObject({ code: 'conflict' })
    const inactive = service(); inactive.projection.definition = definition({ state: 'needs-charter' })
    await expect(inactive.value.startRun(owner, { teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'w', prompt: 'p', source: 'console', idempotencyKey: 'b' }))
      .rejects.toMatchObject({ code: 'invalid-state' })
    const hidden = service(); hidden.projection.definition = definition({ visibility: 'private', ownerUserId: 'other-a' })
    await expect(hidden.value.startRun(owner, { teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'w', prompt: 'p', source: 'console', idempotencyKey: 'c' }))
      .rejects.toMatchObject({ code: 'not-found' })
    const denied = service(); denied.authorizeWorkspace.mockResolvedValue(false)
    await expect(denied.value.startRun(owner, { teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'w', prompt: 'p', source: 'console', idempotencyKey: 'd' }))
      .rejects.toMatchObject({ code: 'admission-rejected' })
    const memberApp = service()
    await expect(memberApp.value.startRun(member, { teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'w', prompt: 'p', source: 'console', idempotencyKey: 'e' }))
      .rejects.toBeTruthy()
    expect(stale.runtimeDriver.startRun).not.toHaveBeenCalled()
  })

  it('projects deterministic start failure and preserves unknown outcomes for reconciliation', async () => {
    const deterministic = service(new MemoryProjection(), runtime({ startRun: vi.fn().mockRejectedValue(new EnterpriseTeamRuntimeError('deterministic', 'invalid-runtime-input')) }))
    await expect(deterministic.value.startRun(owner, { teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'w', prompt: 'p', source: 'console', idempotencyKey: 'a' }))
      .resolves.toMatchObject({ state: 'failed', failure: { code: 'invalid-runtime-input' } })
    const unknown = service(new MemoryProjection(), runtime({ startRun: vi.fn().mockRejectedValue(new EnterpriseTeamRuntimeError('unknown', 'transport-lost')) }))
    const starting = await unknown.value.startRun(owner, { teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'w', prompt: 'p', source: 'console', idempotencyKey: 'b' })
    expect(starting.state).toBe('starting')
    await expect(unknown.value.reconcileRun({ orgId: 'org-a', runId: starting.runId })).resolves.toMatchObject({ state: 'active' })
    expect(unknown.runtimeDriver.reconcileRun).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'team-run:start:run-a' }))
  })

  it('cancels through runtime, rejects terminal cancellation, and preserves unknown cancellation', async () => {
    const app = service()
    const run = await app.value.startRun(owner, { teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'w', prompt: 'p', source: 'console', idempotencyKey: 'a' })
    const cancelled = await app.value.cancelRun(owner, { runId: run.runId, expectedRevision: run.revision, idempotencyKey: 'cancel-a' })
    expect(cancelled.state).toBe('cancelled')
    expect(app.runtimeDriver.cancelRun).toHaveBeenCalledWith(expect.objectContaining({ operationId: `team-run:cancel:${run.runId}:cancel-a` }))
    await expect(app.value.cancelRun(owner, { runId: run.runId, expectedRevision: run.revision, idempotencyKey: 'cancel-a' })).resolves.toEqual(cancelled)
    expect(app.runtimeDriver.cancelRun).toHaveBeenCalledTimes(1)
    await expect(app.value.cancelRun(owner, { runId: run.runId, expectedRevision: cancelled.revision, idempotencyKey: 'again' }))
      .rejects.toMatchObject({ code: 'invalid-transition' })

    const unknown = service(new MemoryProjection(), runtime({
      cancelRun: vi.fn().mockRejectedValue(new EnterpriseTeamRuntimeError('unknown', 'transport-lost')),
      reconcileRun: vi.fn().mockResolvedValue({ state: 'cancelled', runtimeRevision: 2, sourceEventSeq: 2 }),
    }))
    const active = await unknown.value.startRun(owner, { teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'w', prompt: 'p', source: 'console', idempotencyKey: 'b' })
    await expect(unknown.value.cancelRun(owner, { runId: active.runId, expectedRevision: active.revision, idempotencyKey: 'unknown' })).resolves.toEqual(active)
    await expect(unknown.value.reconcileRun({ orgId: 'org-a', runId: active.runId })).resolves.toMatchObject({ state: 'cancelled' })
  })

  it('filters run query projections through current definition visibility without changing frozen snapshots', async () => {
    const app = service()
    const created = await app.value.startRun(owner, { teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'w', prompt: 'p', source: 'console', idempotencyKey: 'visible' })
    app.projection.definition = definition({ visibility: 'private', ownerUserId: 'other-a', revision: 5, roster: [] })
    await expect(app.value.listRuns(member, {})).resolves.toEqual({ items: [] })
    await expect(app.value.getRun(member, created.runId)).rejects.toMatchObject({ code: 'not-found' })
    expect(created.rosterSnapshot).toEqual(definition().roster)
  })
})

describe('enterprise TeamDecision and autonomy control service', () => {
  it('projects decisions only through the Host method and admits assignee, owner, and administrator responses', async () => {
    for (const actor of [member, owner, admin]) {
      const app = service()
      const projected = await app.value.projectDecision({
        decisionId: `decision-${actor.userId}`, orgId: 'org-a', runId: 'run-a', kind: 'approval', question: 'Proceed?',
        options: ['yes', 'no'], contextDigest: 'sha256:context', assigneeUserId: 'member-a', state: 'open',
        runtimeRevision: 2, sourceEventSeq: 2, revision: 1, createdAt: 10, updatedAt: 10,
      })
      await expect(app.value.respondDecision(actor, { decisionId: projected.decisionId, answer: 'yes', expectedRevision: 1, idempotencyKey: 'answer-a' }))
        .resolves.toMatchObject({ state: 'answered', answer: 'yes' })
    }
  })

  it('denies unrelated humans and enforces decision CAS and operation idempotency', async () => {
    const app = service()
    await app.value.projectDecision({ decisionId: 'decision-a', orgId: 'org-a', runId: 'run-a', kind: 'clarification', question: 'Q?', options: [],
      contextDigest: 'digest', assigneeUserId: 'other-a', state: 'open', runtimeRevision: 1, revision: 1, createdAt: 1, updatedAt: 1 })
    await expect(app.value.respondDecision(member, { decisionId: 'decision-a', answer: 'A', expectedRevision: 1, idempotencyKey: 'x' })).rejects.toBeTruthy()
    const answered = await app.value.respondDecision(owner, { decisionId: 'decision-a', answer: 'A', expectedRevision: 1, idempotencyKey: 'x' })
    await expect(app.value.respondDecision(owner, { decisionId: 'decision-a', answer: 'A', expectedRevision: 1, idempotencyKey: 'x' })).resolves.toEqual(answered)
    expect(app.runtimeDriver.respondDecision).toHaveBeenCalledTimes(1)
  })

  it('requires explicit authorized autonomy writes, validates agent roster and terminal revoke, and never auto-promotes', async () => {
    const app = service()
    await expect(app.value.saveAutonomyGrant(member, { teamId: 'team-a', employeeReleaseId: 'release-a', taskType: 'close', capabilityScope: 'ledger.read', level: 'execute-delegated', evidenceRefs: [], expectedRevision: 0, idempotencyKey: 'deny' })).rejects.toBeTruthy()
    await expect(app.value.saveAutonomyGrant(owner, { teamId: 'team-a', employeeReleaseId: 'missing', taskType: 'close', capabilityScope: 'ledger.read', level: 'observe', evidenceRefs: [], expectedRevision: 0, idempotencyKey: 'missing' })).rejects.toMatchObject({ code: 'invalid-state' })
    await expect(app.value.saveAutonomyGrant(owner, { teamId: 'team-a', employeeReleaseId: 'release-a', taskType: ' ', capabilityScope: 'ledger.read', level: 'observe', evidenceRefs: [], expectedRevision: 0, idempotencyKey: 'empty' })).rejects.toMatchObject({ code: 'invalid-state' })
    const grant = await app.value.saveAutonomyGrant(owner, { teamId: 'team-a', employeeReleaseId: 'release-a', taskType: 'close', capabilityScope: 'ledger.read', level: 'propose', evidenceRefs: ['b', 'a', 'a'], expectedRevision: 0, idempotencyKey: 'save' })
    expect(grant).toMatchObject({ grantedBy: 'owner-a', evidenceRefs: ['a', 'b'], level: 'propose', state: 'active' })
    await expect(app.value.saveAutonomyGrant(owner, { teamId: 'team-a', employeeReleaseId: 'release-a', taskType: 'close', capabilityScope: 'ledger.read', level: 'propose', evidenceRefs: ['b', 'a', 'a'], expectedRevision: 0, idempotencyKey: 'save' })).resolves.toEqual(grant)
    const revoked = await app.value.revokeAutonomyGrant(owner, { teamId: 'team-a', employeeReleaseId: 'release-a', taskType: 'close', capabilityScope: 'ledger.read', expectedRevision: grant.revision, idempotencyKey: 'revoke' })
    expect(revoked.state).toBe('revoked')
    await expect(app.value.saveAutonomyGrant(owner, { teamId: 'team-a', employeeReleaseId: 'release-a', taskType: 'close', capabilityScope: 'ledger.read', level: 'execute-reviewed', evidenceRefs: [], expectedRevision: revoked.revision, idempotencyKey: 'resurrect' })).rejects.toMatchObject({ code: 'invalid-transition' })
  })
})
