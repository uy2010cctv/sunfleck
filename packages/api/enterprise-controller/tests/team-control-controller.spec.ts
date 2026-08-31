import { Context } from '@deepseek-ai/cordis'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  EnterpriseTeamAutonomyController,
  EnterpriseTeamDecisionController,
  EnterpriseTeamRunController,
  type EnterpriseTeamRun,
} from '../src/index.ts'

const definition = {
  teamId: 'team-a', orgId: 'org-a', name: 'Finance', northStar: 'Close.', ownerUserId: 'owner-a',
  visibility: 'organization' as const, leaderEmployeeReleaseId: 'release-a',
  roles: [{ roleId: 'lead', name: 'Lead', responsibility: 'Lead.' }],
  roster: [
    { actor: { kind: 'human' as const, userId: 'owner-a' }, roleId: 'lead' },
    { actor: { kind: 'agent' as const, employeeReleaseId: 'release-a' }, roleId: 'lead' },
  ],
  verificationPolicy: {}, attentionPolicy: {}, approvalPolicy: {}, state: 'active' as const,
  revision: 4, createdAt: 1, updatedAt: 1,
}
const starting: EnterpriseTeamRun = {
  runId: 'run-a', orgId: 'org-a', teamId: 'team-a', teamDefinitionRevision: 4,
  workspaceId: 'workspace-a', rosterSnapshot: definition.roster, createdBy: 'owner-a', source: 'console',
  state: 'starting', runtimeRevision: 0, revision: 1, createdAt: 1, updatedAt: 1,
}

function setup(allowStart = true, allowWorkspace = true) {
  let run: EnterpriseTeamRun = starting
  const decision = {
    decisionId: 'decision-a', orgId: 'org-a', runId: 'run-a', kind: 'approval' as const,
    question: 'Proceed?', options: ['yes'], contextDigest: 'digest', assigneeUserId: 'member-a',
    state: 'open' as const, runtimeRevision: 1, revision: 1, createdAt: 1, updatedAt: 1,
  }
  const teamControl = {
    getTeamRunByStartKey: vi.fn().mockResolvedValue(undefined),
    getTeamDefinition: vi.fn().mockResolvedValue(definition),
    createTeamRunStarting: vi.fn().mockResolvedValue({ run, created: true }),
    projectTeamRun: vi.fn().mockImplementation(async (input: Partial<EnterpriseTeamRun>) =>
      run = { ...run, ...input, revision: run.revision + 1 }),
    getTeamRun: vi.fn().mockImplementation(async () => run), listTeamRuns: vi.fn().mockResolvedValue({ items: [run] }),
    projectDecision: vi.fn(), getDecision: vi.fn().mockResolvedValue(decision),
    getDecisionResponseByKey: vi.fn().mockResolvedValue(undefined),
    reserveDecisionResponse: vi.fn().mockResolvedValue({
      decision, operationId: 'team-decision:respond:decision-a:answer', completed: false,
    }),
    listDecisions: vi.fn().mockResolvedValue({ items: [decision] }),
    answerDecision: vi.fn().mockResolvedValue({ ...decision, state: 'answered', answer: 'yes', revision: 2 }),
    listAutonomyGrants: vi.fn().mockResolvedValue({ items: [] }),
    saveAutonomyGrant: vi.fn().mockImplementation(async (input: Record<string, unknown>) => ({
      ...input, state: 'active', revision: 1, createdAt: 1, updatedAt: 1,
    })),
    revokeAutonomyGrant: vi.fn(),
  }
  const runtime = {
    startRun: vi.fn().mockResolvedValue({ rootSessionId: 'session-a', runtimeRevision: 1, sourceEventSeq: 2 }),
    cancelRun: vi.fn().mockResolvedValue({ runtimeRevision: 2, sourceEventSeq: 3 }),
    respondDecision: vi.fn().mockResolvedValue({ runtimeRevision: 2, sourceEventSeq: 3 }),
    reconcileRun: vi.fn(),
  }
  const authorizeApiAsync = vi.fn().mockImplementation(async (_principal, endpoint: string) => {
    const allowed = (endpoint === 'enterpriseTeamRun.start' && allowStart)
      || (endpoint === 'session.create' && allowWorkspace)
      || endpoint === 'enterpriseTeamDecision.respond' || endpoint === 'enterpriseTeamAutonomy.save'
      || endpoint.endsWith('.list') || endpoint.endsWith('.get')
    return { allowed, reason: allowed ? 'role' : 'insufficient-role' }
  })
  const auditApiAsync = vi.fn()
  const auditApiResourceAsync = vi.fn()
  const requestContext = new EnterpriseRequestContext()
  const ctx = new Context()
  ctx.provide('enterprisePostgres' as never, { teamControl } as never)
  ctx.provide('enterpriseTeamRuntimeDriver' as never, runtime as never)
  ctx.provide('enterpriseSecurity' as never, { authorizeApiAsync, auditApiAsync, auditApiResourceAsync } as never)
  ctx.provide('enterpriseRequestContext' as never, requestContext as never)
  return { run: new EnterpriseTeamRunController(ctx), decision: new EnterpriseTeamDecisionController(ctx),
    autonomy: new EnterpriseTeamAutonomyController(ctx), teamControl, runtime, authorizeApiAsync,
    auditApiAsync, auditApiResourceAsync, requestContext }
}

describe('enterprise team-control Remote namespaces', () => {
  it('injects principal identity into TeamRun start and keeps runtime fields Host-only', async () => {
    const app = setup()
    const principal = { orgId: 'org-a', userId: 'owner-a', roles: ['creator'] as const }
    const request = { teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'workspace-a', prompt: 'Close.', source: 'console' as const, idempotencyKey: 'start-a' }
    await app.requestContext.run(principal, () => app.run.start(request))
    expect(app.teamControl.createTeamRunStarting).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-a', createdBy: 'owner-a', expectedTeamRevision: 4 }),
      expect.any(Function),
    )
    expect(request).not.toHaveProperty('orgId')
    expect(request).not.toHaveProperty('createdBy')
    expect(request).not.toHaveProperty('runtimeRevision')
    expect(app.auditApiResourceAsync).toHaveBeenCalledWith(
      principal, 'enterpriseTeamRun.start', { runId: 'run-a' }, { allowed: true, reason: 'role' }, 'run-a',
      { type: 'team-run', id: 'run-a', details: {
        teamId: 'team-a', teamDefinitionRevision: 4, outcome: 'active',
      } },
    )
  })

  it('exposes list/get/cancel, decision list/respond, and autonomy list/save/revoke namespace methods', () => {
    const app = setup()
    expect(typeof app.run.list).toBe('function'); expect(typeof app.run.get).toBe('function')
    expect(typeof app.run.cancel).toBe('function'); expect(typeof app.decision.respond).toBe('function')
    expect(typeof app.decision.list).toBe('function'); expect(typeof app.autonomy.save).toBe('function')
    expect(typeof app.autonomy.revoke).toBe('function'); expect(typeof app.autonomy.list).toBe('function')
  })

  it('maps control-plane authorization denial to the stable enterprise-forbidden failure', async () => {
    const app = setup(false)
    const principal = { orgId: 'org-a', userId: 'member-a', roles: ['member'] as const }
    const failure = await app.requestContext.run(principal, () => app.run.start({
      teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'workspace-a', prompt: 'Close.',
      source: 'console', idempotencyKey: 'denied-a',
    })).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(TypertRemoteFailure)
    expect((failure as TypertRemoteFailure).failure.code).toBe('enterprise-forbidden')
    expect(app.teamControl.createTeamRunStarting).not.toHaveBeenCalled()
    expect(app.auditApiResourceAsync).toHaveBeenCalledWith(
      principal, 'enterpriseTeamRun.start', expect.objectContaining({ teamId: 'team-a' }),
      { allowed: false, reason: 'insufficient-role' }, 'team-run:start:denied-a',
      { type: 'team-definition', id: 'team-a',
        // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
        details: expect.objectContaining({
          teamId: 'team-a', teamDefinitionRevision: 4, outcomeReason: 'insufficient-role',
        }) },
    )
  })

  it('maps decision and autonomy service denials to enterprise-forbidden', async () => {
    const app = setup()
    const principal = { orgId: 'org-a', userId: 'outsider-a', roles: ['member'] as const }
    const failures = await app.requestContext.run(principal, async () => Promise.all([
      app.decision.respond({
        decisionId: 'decision-a', answer: 'yes', expectedRevision: 1, idempotencyKey: 'denied-answer',
      }).catch((error: unknown) => error),
      app.autonomy.save({
        teamId: 'team-a', employeeReleaseId: 'release-a', taskType: 'close', capabilityScope: 'ledger.read',
        level: 'observe', evidenceRefs: [], expectedRevision: 0, idempotencyKey: 'denied-grant',
      }).catch((error: unknown) => error),
    ]))
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(TypertRemoteFailure)
      expect((failure as TypertRemoteFailure).failure.code).toBe('enterprise-forbidden')
    }
    expect(app.runtime.respondDecision).not.toHaveBeenCalled()
    expect(app.teamControl.saveAutonomyGrant).not.toHaveBeenCalled()
    expect(app.auditApiResourceAsync).toHaveBeenCalledWith(
      principal, 'enterpriseTeamDecision.respond', expect.anything(), expect.objectContaining({ allowed: false }),
      'run-a', { type: 'team-decision', id: 'decision-a',
        // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
        details: expect.objectContaining({ teamId: 'team-a' }) },
    )
    expect(app.auditApiResourceAsync).toHaveBeenCalledWith(
      principal, 'enterpriseTeamAutonomy.save', expect.anything(), expect.objectContaining({ allowed: false }),
      'team-a:release-a:close:ledger.read', {
        type: 'team-autonomy-grant', id: 'team-a:release-a:close:ledger.read',
        // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
        details: expect.objectContaining({ teamId: 'team-a', teamDefinitionRevision: 4 }),
      },
    )
  })

  it('preserves the workspace admission reason in the structured denied audit', async () => {
    const app = setup(true, false)
    const principal = { orgId: 'org-a', userId: 'owner-a', roles: ['creator'] as const }
    const failure = await app.requestContext.run(principal, () => app.run.start({
      teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'workspace-denied', prompt: 'Close.',
      source: 'console', idempotencyKey: 'workspace-denied',
    })).catch((error: unknown) => error)
    expect((failure as TypertRemoteFailure).failure.code).toBe('enterprise-forbidden')
    expect(app.auditApiResourceAsync).toHaveBeenCalledWith(
      principal, 'enterpriseTeamRun.start', { teamId: 'team-a' },
      { allowed: false, reason: 'workspace-forbidden' }, 'team-run:start:workspace-denied',
      { type: 'team-definition', id: 'team-a',
        // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
        details: expect.objectContaining({
          outcomeReason: 'workspace-forbidden',
        }) },
    )
  })
})
