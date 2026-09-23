import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type { EnterpriseTeamDefinition, EnterpriseTeamRun, TeamDecision } from '@deepseek-ai/dsh-enterprise-operations'
import { EnterpriseTeamRuntimeError } from '@deepseek-ai/dsh-enterprise-operations'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import TeamService from '@deepseek-ai/dsh-experimental-agent-team'
import { teamProjectionDefinition } from '@deepseek-ai/dsh-experimental-agent-team/src/projection.ts'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import SubagentService from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { TestSessionQuery } from '../../agent-team/tests/test-session-query.ts'
import * as Runtime from '../src/index.ts'

const roots: string[] = []
const contexts = new Set<Context>()
const actor: EnterprisePrincipal = { userId: 'owner-a', orgId: 'org-a', roles: ['creator'] }

function projectTeam(header: SessionHeader, events: readonly SessionEvent[]) {
  let state = teamProjectionDefinition.init(header)
  for (const event of events) state = teamProjectionDefinition.apply(state, event)
  return state
}

async function readStoredTeam(ctx: Context, id: string) {
  const handle = await ctx.sessionPersistence.open(id as never, 'read')
  try {
    return projectTeam(handle.header, (await handle.read()).events)
  } finally {
    await handle.close()
  }
}

afterEach(async () => {
  for (const ctx of [...contexts]) await ctx.fiber.dispose().catch(() => undefined)
  contexts.clear()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function release(releaseId: string, overrides: Record<string, unknown> = {}) {
  const profile = {
    name: releaseId === 'release-lead' ? 'Lead employee' : 'Buyer employee',
    prompt: releaseId === 'release-lead' ? 'Lead the team.' : 'Handle buying.',
    modelRef: 'mock/mock',
    ...overrides,
  }
  const snapshot = { profile, bindings: [] as Array<{ kind: string; assetId: string; version: number }> }
  return {
    releaseId,
    presetId: releaseId === 'release-lead' ? 'lead-preset' : 'buyer-preset',
    orgId: 'org-a',
    version: 1,
    digest: `${releaseId}-digest`,
    snapshot,
    publishedBy: 'publisher-a',
    publishedAt: 1,
  }
}

function definition(overrides: Partial<EnterpriseTeamDefinition> = {}): EnterpriseTeamDefinition {
  return {
    teamId: 'team-a', orgId: 'org-a', name: 'Procurement', northStar: 'Buy safely', ownerUserId: 'owner-a',
    visibility: 'organization', leaderEmployeeReleaseId: 'release-lead',
    roster: [
      { actor: { kind: 'agent', employeeReleaseId: 'release-lead' }, roleId: 'lead' },
      { actor: { kind: 'human', userId: 'reviewer-a' }, roleId: 'reviewer' },
      { actor: { kind: 'agent', employeeReleaseId: 'release-buyer' }, roleId: 'buyer' },
    ],
    roles: [
      { roleId: 'lead', name: 'Lead', responsibility: 'Coordinate' },
      { roleId: 'reviewer', name: 'Reviewer', responsibility: 'Decide' },
      { roleId: 'buyer', name: 'Buyer', responsibility: 'Buy' },
    ],
    verificationPolicy: {}, attentionPolicy: {}, approvalPolicy: {}, revision: 4, state: 'active',
    createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

async function setup(options: { failBuyerSpawn?: boolean; failWorkspaceBinding?: boolean; storageRoot?: string } = {}) {
  const ctx = new Context()
  contexts.add(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const storageRoot = options.storageRoot ?? mkdtempSync(join(tmpdir(), 'dsh-enterprise-team-runtime-'))
  roots.push(storageRoot)
  await ctx.plugin(JsonlSessionPersistence, { root: storageRoot })
  await ctx.plugin(TestSessionQuery)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentService)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(TeamService)
  if (options.failBuyerSpawn) {
    vi.spyOn(ctx.subagents, 'startContinuable').mockRejectedValueOnce(new Error('injected secret=super-secret'))
  }
  ctx.llm.registerAdapter(['mock'], new MockAdapter([
    textResponse('lead answer'),
    ...(options.failBuyerSpawn ? [] : [textResponse('buyer answer')]),
    textResponse('decision answer'),
  ]))

  const requestContext = new EnterpriseRequestContext()
  const attached: string[] = []
  const bound: unknown[] = []
  const resolvedPresets: string[] = []
  const releases = new Map([
    ['release-lead', release('release-lead')],
    ['release-buyer', release('release-buyer')],
  ])
  const workspace = {
    id: 'workspace-a', path: storageRoot, title: 'Workspace', sessionIds: [],
    status: async () => 'ok' as const,
    attachSession: async (id: string) => { attached.push(id) },
    detachSession: async () => {},
  }
  ctx.provide('agentPresets' as never, {
    resolve: async (id: string) => { resolvedPresets.push(id); return { id } },
    mount: async () => {},
    composedPreset: () => 'lead-preset',
    composeFrom: () => {},
  } as never)
  ctx.provide('workspaceRegistry' as never, { get: (id: string) => id === 'workspace-a' ? workspace : undefined } as never)
  ctx.provide('enterpriseRequestContext' as never, requestContext as never)
  ctx.provide('enterprisePostgres' as never, {
    identity: {
      workspaceGrant: async (id: string) => id === 'workspace-a'
        ? { workspaceId: id, orgId: 'org-a', rootPath: storageRoot }
        : undefined,
      listUsers: async () => [
        { id: 'owner-a', orgId: 'org-a', displayName: 'Owner A' },
        { id: 'reviewer-a', orgId: 'org-a', displayName: 'Reviewer A' },
      ],
      bindSessionWorkspace: async (input: unknown) => {
        if (options.failWorkspaceBinding) throw new Error('injected workspace binding failure')
        bound.push(input)
      },
    },
    catalog: {
      getRelease: async (id: string, orgId: string) => {
        const found = releases.get(id)
        return found?.orgId === orgId ? found : undefined
      },
    },
  } as never)

  Runtime.apply(ctx)
  const driver = ctx.get('enterpriseTeamRuntimeDriver')
  return { ctx, driver, requestContext, attached, bound, resolvedPresets, releases, storageRoot }
}

function startInput() {
  return {
    operationId: 'team-run:start:run-a', runId: 'run-a', orgId: 'org-a', definition: definition(),
    workspaceId: 'workspace-a', prompt: 'Close the books.', actor,
  }
}

describe('enterprise Agent Teams runtime driver', () => {
  it('provides the real driver implementation', async () => {
    const app = await setup()
    expect(Runtime.apply).toBeTypeOf('function')
    expect(app.driver).toBeDefined()
  })

  it('starts one root with pinned releases, Human roster, Workspace binding, and no inherited principal', async () => {
    const app = await setup()
    const driver = app.driver!
    let currentInsideFollowup: EnterprisePrincipal | undefined = actor
    let currentInsideChildStart: EnterprisePrincipal | undefined = actor
    const startContinuable = app.ctx.subagents.startContinuable.bind(app.ctx.subagents)
    vi.spyOn(app.ctx.subagents, 'startContinuable').mockImplementation((spec) => {
      currentInsideChildStart = app.requestContext.current()
      return startContinuable(spec)
    })
    app.ctx.on('agent/inbox/inserted', () => { currentInsideFollowup = app.requestContext.current() })
    const result = await app.requestContext.run(actor, () => driver.startRun(startInput()))
    const root = app.ctx.agents.get(result.rootSessionId as never)!
    const state = projectTeam(root.session.header, root.session.snapshotEvents())

    expect(result).toMatchObject({ runtimeRevision: 2 })
    expect(root.session.header.cwd).toBe(app.storageRoot)
    expect(root.session.header.agentPreset).toBe('lead-preset')
    expect(root.session.header).toMatchObject({ version: 3, isSeeded: false })
    expect(state.run).toMatchObject({ runId: 'run-a', state: 'active', leader: { release: { releaseId: 'release-lead' } } })
    expect([...state.humans.values()]).toEqual([{ userId: 'reviewer-a', displayName: 'Reviewer A', roleId: 'reviewer' }])
    const teamMembers = [...state.members.values()]
    expect(teamMembers).toHaveLength(1)
    expect(teamMembers[0]).toMatchObject({
      employeeReleaseId: 'release-buyer', roleId: 'buyer', release: { releaseId: 'release-buyer' },
    })
    expect(app.attached).toEqual([String(root.id)])
    expect(app.bound).toEqual([expect.objectContaining({ ownerUserId: 'owner-a', orgId: 'org-a', workspaceId: 'workspace-a' })])
    expect(currentInsideChildStart).toBeUndefined()
    expect(currentInsideFollowup).toBeUndefined()
    expect(app.resolvedPresets).toEqual(expect.arrayContaining(['lead-preset']))

    await expect(driver.startRun(startInput())).resolves.toMatchObject(result)
  })

  it('fails loud for unknown, cross-organization, and unsupported release bindings', async () => {
    const app = await setup()
    const driver = app.driver!
    await expect(driver.startRun({ ...startInput(), definition: definition({ leaderEmployeeReleaseId: 'missing-release' }) }))
      .rejects.toMatchObject({ constructor: EnterpriseTeamRuntimeError, outcome: 'deterministic' })
    app.releases.set('release-cross', { ...release('release-lead'), releaseId: 'release-cross', orgId: 'org-b' })
    await expect(driver.startRun({ ...startInput(), runId: 'run-cross', operationId: 'team-run:start:run-cross', definition: definition({ leaderEmployeeReleaseId: 'release-cross' }) }))
      .rejects.toMatchObject({ outcome: 'deterministic' })
    app.releases.set('release-bound', {
      ...release('release-lead'), releaseId: 'release-bound',
      snapshot: { ...release('release-lead').snapshot, bindings: [{ kind: 'tool', assetId: 'tool-a', version: 1 }] },
    })
    await expect(driver.startRun({ ...startInput(), runId: 'run-bound', operationId: 'team-run:start:run-bound', definition: definition({ leaderEmployeeReleaseId: 'release-bound' }) }))
      .rejects.toMatchObject({ outcome: 'deterministic', code: 'unsupported-release-bindings' })
  })

  it('records failed and stops every partially started Agent when teammate creation fails', async () => {
    const app = await setup({ failBuyerSpawn: true })
    await expect(app.driver!.startRun(startInput())).rejects.toMatchObject({
      outcome: 'deterministic', code: 'team-member-start-failed',
    })
    expect(app.ctx.agents.list()).toEqual([])
    const snapshots = await app.ctx.sessionPersistence.list()
    const root = snapshots.find(snapshot => String(snapshot.header.id).startsWith('enterprise-team-'))
    expect(root).toBeDefined()
    const failedRun = (await readStoredTeam(app.ctx, root!.header.id)).run
    expect(failedRun).toMatchObject({
      state: 'failed', failure: { code: 'team-member-start-failed' },
    })
    expect(JSON.stringify(failedRun)).not.toContain('super-secret')
  })

  it('disposes an unpublished runtime root when enterprise Workspace binding fails', async () => {
    const app = await setup({ failWorkspaceBinding: true })
    await expect(app.driver!.startRun(startInput())).rejects.toMatchObject({
      outcome: 'deterministic', code: 'team-member-start-failed',
    })
    expect(app.ctx.agents.list()).toEqual([])
  })

  it('replays an active root after process restart and cold-resumes it for a Human decision response', async () => {
    const first = await setup()
    const started = await first.driver!.startRun(startInput())
    const firstRoot = first.ctx.agents.get(started.rootSessionId as never)!
    await first.ctx.agentTeams.projectDecision(firstRoot, {
      operationId: 'team-decision:project:decision-restart', decisionId: 'decision-restart', runId: 'run-a',
      kind: 'clarification', question: 'Continue after restart?', options: ['yes'], contextDigest: 'restart-digest',
      assigneeUserId: 'reviewer-a',
    })
    const projected = projectTeam(firstRoot.session.header, firstRoot.session.snapshotEvents()).decisions.get('decision-restart')!
    await first.ctx.fiber.dispose()
    contexts.delete(first.ctx)

    const second = await setup({ storageRoot: first.storageRoot })
    await expect(second.driver!.reconcileRun({
      operationId: 'team-run:start:run-a',
      run: {
        runId: 'run-a', orgId: 'org-a', teamId: 'team-a', teamDefinitionRevision: 4,
        workspaceId: 'workspace-a', rootSessionId: started.rootSessionId, rosterSnapshot: definition().roster,
        createdBy: 'owner-a', source: 'console', state: 'starting', runtimeRevision: 0, revision: 1,
        createdAt: 1, updatedAt: 1,
      },
    })).resolves.toMatchObject({ state: 'active', rootSessionId: started.rootSessionId })
    await expect(second.driver!.startRun(startInput())).resolves.toMatchObject(started)
    expect(second.ctx.agents.get(started.rootSessionId as never)).toBeUndefined()

    await second.driver!.respondDecision({
      operationId: 'team-decision:respond:decision-restart:key-a',
      decision: {
        orgId: 'org-a', sourceEventSeq: projected.runtimeRevision,
        createdAt: 1, updatedAt: 1, ...projected,
      },
      answer: 'yes',
      actor: { ...actor, userId: 'reviewer-a' },
    })
    expect(second.ctx.agents.get(started.rootSessionId as never)).toBeDefined()
    const resumed = second.ctx.agents.get(started.rootSessionId as never)!
    expect(projectTeam(resumed.session.header, resumed.session.snapshotEvents()).decisions.get('decision-restart')).toMatchObject({
      state: 'answered', answer: 'yes', respondedBy: { userId: 'reviewer-a' },
    })
  })

  it('cancels with inbox preservation, answers a decision, wakes the lead, and cold-reconciles after restart', async () => {
    const app = await setup()
    const driver = app.driver!
    const started = await driver.startRun(startInput())
    const root = app.ctx.agents.get(started.rootSessionId as never)!
    await app.ctx.agentTeams.projectDecision(root, {
      operationId: 'team-decision:project:decision-a', decisionId: 'decision-a', runId: 'run-a',
      kind: 'clarification', question: 'Proceed?', options: ['yes', 'no'], contextDigest: 'digest-a',
      assigneeUserId: 'reviewer-a',
    })
    const projected = projectTeam(root.session.header, root.session.snapshotEvents()).decisions.get('decision-a')!
    const decision: TeamDecision = {
      orgId: 'org-a', sourceEventSeq: 3,
      createdAt: 1, updatedAt: 1, ...projected,
    }
    const insertionCount = root.session.snapshotEvents().length
    await driver.respondDecision({
      operationId: 'team-decision:respond:decision-a:key-a', decision, answer: 'yes', actor: { ...actor, userId: 'reviewer-a' },
    })
    expect(root.session.snapshotEvents().length).toBeGreaterThan(insertionCount)
    await driver.cancelRun({
      operationId: 'team-run:cancel:run-a:key-a',
      run: {
        runId: 'run-a', orgId: 'org-a', teamId: 'team-a', teamDefinitionRevision: 4,
        workspaceId: 'workspace-a', rootSessionId: String(root.id), rosterSnapshot: definition().roster,
        createdBy: 'owner-a', source: 'console', state: 'active', runtimeRevision: 4, revision: 2,
        createdAt: 1, updatedAt: 1,
      } satisfies EnterpriseTeamRun,
      actor,
    })
    expect(projectTeam(root.session.header, root.session.snapshotEvents()).run?.state).toBe('cancelled')
    await expect(driver.reconcileRun({
      operationId: 'team-run:start:run-a',
      run: {
        runId: 'run-a', orgId: 'org-a', teamId: 'team-a', teamDefinitionRevision: 4,
        workspaceId: 'workspace-a', rootSessionId: String(root.id), rosterSnapshot: definition().roster,
        createdBy: 'owner-a', source: 'console', state: 'starting', runtimeRevision: 0, revision: 1,
        createdAt: 1, updatedAt: 1,
      },
    })).resolves.toMatchObject({ state: 'cancelled', rootSessionId: String(root.id) })
  })

  it('submits surface-originated input into the run root and records the team-run-message source', async () => {
    const app = await setup()
    const driver = app.driver!
    const started = await driver.startRun(startInput())
    const root = app.ctx.agents.get(started.rootSessionId as never)!

    const receipt = await driver.submitRunInput('run-a', {
      actorUserId: 'reviewer-a', text: '来自支持群的新指令', originSurfaceId: 'surface-group-1',
    })

    expect(receipt).toMatchObject({ runtimeRevision: 2 })
    const events = root.session.snapshotEvents()
    const appended = events.filter(event =>
      event.type === 'user/message' && (event.data as { source: { kind: string } }).source.kind === 'team-run-message')
    expect(appended).toHaveLength(1)
    const landed = appended[0]
    expect(landed).toBeDefined()
    expect(landed?.seq).toBe(receipt.sourceEventSeq)
    expect((landed?.data as { source: unknown; content: unknown }).source).toEqual({
      kind: 'team-run-message', runId: 'run-a', originSurfaceId: 'surface-group-1', actorUserId: 'reviewer-a',
    })
    expect((landed?.data as { content: Array<{ type: string; text: string }> }).content)
      .toEqual([{ type: 'text', text: '来自支持群的新指令' }])
  })

  it('rejects a submission for an unknown run with the coded team-run-not-found error', async () => {
    const app = await setup()
    await expect(app.driver!.submitRunInput('run-missing', {
      actorUserId: 'reviewer-a', text: '任何输入', originSurfaceId: 'surface-group-1',
    })).rejects.toMatchObject({ constructor: EnterpriseTeamRuntimeError, outcome: 'deterministic', code: 'team-run-not-found' })
  })

  it('reports an unknown outcome when the submitted input never lands in the root log', async () => {
    const app = await setup()
    const driver = app.driver!
    const started = await driver.startRun(startInput())
    const root = app.ctx.agents.get(started.rootSessionId as never)!
    vi.spyOn(root, 'followup').mockImplementation(() => {})

    await expect(driver.submitRunInput('run-a', {
      actorUserId: 'reviewer-a', text: '不会落地的输入', originSurfaceId: 'surface-group-1',
    })).rejects.toMatchObject({
      constructor: EnterpriseTeamRuntimeError, outcome: 'unknown', code: 'team-run-input-not-landed',
    })
  })

  it('refuses surface input for a terminal run with the coded team-run-not-active error', async () => {
    const app = await setup()
    const driver = app.driver!
    const started = await driver.startRun(startInput())
    const root = app.ctx.agents.get(started.rootSessionId as never)!
    await driver.cancelRun({
      operationId: 'team-run:cancel:run-a:key-a',
      run: {
        runId: 'run-a', orgId: 'org-a', teamId: 'team-a', teamDefinitionRevision: 4,
        workspaceId: 'workspace-a', rootSessionId: String(root.id), rosterSnapshot: definition().roster,
        createdBy: 'owner-a', source: 'console', state: 'active', runtimeRevision: 4, revision: 2,
        createdAt: 1, updatedAt: 1,
      } satisfies EnterpriseTeamRun,
      actor,
    })

    await expect(driver.submitRunInput('run-a', {
      actorUserId: 'reviewer-a', text: '取消后的输入', originSurfaceId: 'surface-group-1',
    })).rejects.toMatchObject({
      constructor: EnterpriseTeamRuntimeError, outcome: 'deterministic', code: 'team-run-not-active',
    })
  })
})
