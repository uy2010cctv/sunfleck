import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import type { EnterpriseWorkStartRequest } from '../src/contract/work.ts'
import { composeCollaboration } from '../src/collaboration-runtime.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { EnterpriseOperationsService, EnterpriseTeamControlService } from '@deepseek-ai/dsh-enterprise-operations'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { agentCarrier } from '@deepseek-ai/dsh-agent'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller'

const actor = { orgId: 'org', userId: 'alice', roles: ['administrator'] as const }

it('mounts room tools for a restored employee before its live actor map is populated', async () => {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const agent = await ctx.agentLoop.create(SessionId('restored-room'), { provider: 'mock', model: 'mock' })
  const binding = { surfaceId: 'group', topicId: '', employeeId: 'employee-a', sessionId: String(agent.id) }
  agent.session.append('enterprise-employee/selected', { orgId: 'org', ownerUserId: 'alice',
    employeeId: 'employee-a', releaseId: 'release-a', releaseVersion: 1 })
  ctx.provide('enterprisePostgres' as never, {
    collaboration: { bySession: async () => binding,
      get: async () => ({ id: 'group', orgId: 'org', name: 'Group', kind: 'group', workspaceId: 'shared',
        memberUserIds: ['alice'], memberEmployeeIds: ['employee-a'], dutyEmployeeIds: [] }) },
    roomEvents: { claimDispatch: async () => [] },
    identity: { sessionOwnerUserId: async () => 'alice', sessionWorkspaceGrant: async () => ({ orgId: 'org' }),
      listUsers: async () => [{ id: 'alice', disabled: false, roles: ['administrator'] }] },
    catalog: { getRelease: async () => ({ presetId: 'employee-a' }) },
  } as never)
  ctx.provide('sessionPersistence' as never, { open: async () => ({
    read: async () => ({ events: agent.session.snapshotEvents() }), close: async () => {},
  }) } as never)
  ctx.provide('enterpriseWorkController' as never, { employeeActor: () => undefined } as never)
  ctx.provide('enterpriseSecurity' as never, { authorizeApiAsync: async () => ({ allowed: true }) } as never)
  composeCollaboration(ctx, { operations: () => { throw new Error('not used') }, teams: () => { throw new Error('not used') },
    limits: { roomContextCharacters: 6000, roomContextEvents: 24, maxBotHops: 2,
      roomDispatchPollMs: 100, roomDispatchLeaseMs: 1000 } })
  ctx.provide('schedule' as never, {} as never)
  try {
    await ctx.serial(agentCarrier(agent), 'agent/created', { agent, source: 'startup' })
    expect(agent.ctx.tools.schemas(agent).map(tool => tool.name)).toContain('room_post')
    const assembly = await ctx.systemPrompt.assemble({ scope: agent, agent })
    expect(assembly.sections.find(section => section.name === 'enterprise-group-schedule')?.text)
      .toContain('room_post without sourceEventId')
  } finally { await ctx.fiber.dispose() }
})

function setup(state: 'completed' | 'waiting-human') {
  const ctx = new Context()
  const operations = vi.fn<() => EnterpriseOperationsService>(() => { throw new Error('receipt replay must precede charter lookup') })
  const teams = vi.fn<() => EnterpriseTeamControlService>(() => { throw new Error('receipt replay must precede lifecycle routing') })
  const binding = { surfaceId: 'group', topicId: 'run-old', employeeId: '', sessionId: 'original-root' }
  const close = vi.fn(async () => {})
  ctx.provide('enterprisePostgres' as never, {
    collaboration: {
      get: async () => ({ id: 'group', orgId: 'org', name: 'Team', kind: 'group', workspaceId: 'shared',
        memberUserIds: ['alice'], memberEmployeeIds: [], dutyEmployeeIds: [], teamDefinitionId: 'team-a' }),
      sessions: async () => [binding], bySession: async () => binding, topics: async () => [], bind: async () => {},
    },

  } as never)
  ctx.provide('sessionPersistence' as never, { open: async () => ({
    read: async () => ({ events: [
      { type: 'user/message', data: { source: { kind: 'user', rpcId: 'followup-1',
        runId: 'run-old', originSurfaceId: 'group', actorUserId: 'alice' } } },
      { type: 'team/run', data: { state } },
    ] }), close,
  }) } as never)
  ctx.provide('enterpriseSecurity' as never, {
    authenticateCookieAsync: async () => actor,
    authorizeResourceAsync: async () => ({ allowed: true, reason: 'role' }),
    authorizeApiAsync: async () => ({ allowed: true, reason: 'role' }),
    auditApiResourceAsync: async () => {},
  } as never)
  ctx.provide('enterpriseRequestContext' as never, { requirePrincipal: () => actor } as never)
  ctx.provide('enterpriseTeamRuntimeDriver' as never, {} as never)
  return { ctx, handler: composeCollaboration(ctx, { operations, teams,
    limits: { roomContextCharacters: 6000, roomContextEvents: 24, maxBotHops: 2 } }), operations, teams, close }
}

describe('collaboration native runtime receipts', () => {
  it.each(['completed', 'waiting-human'] as const)('replays the original target after a delivered run becomes %s', async (state) => {
    const app = setup(state)
    try {
      const response = await app.handler.fetch(new Request('https://dsh/enterprise/surfaces/group/messages', {
        method: 'POST', body: JSON.stringify({ text: 'Delivered follow-up', messageId: 'followup-1' }),
      }))
      expect(await response.json()).toEqual({ delivered: true, targets: [{ sessionId: 'original-root' }] })
      expect(app.operations).not.toHaveBeenCalled()
      expect(app.teams).not.toHaveBeenCalled()
      expect(app.close).toHaveBeenCalledOnce()
    } finally { await app.ctx.fiber.dispose() }
  })

  it('returns the authorized native response target to the original composer on retry', async () => {
    const app = setup('completed')
    try {
      const request: SessionPromptRequest = { sessionId: SessionId('original-root'), requestId: brandString<SessionRequestId>('followup-1'), mode: 'steer',
        content: [{ type: 'text', text: 'Delivered follow-up' }] }
      const result = await app.ctx.waterfall('api/session-prompt', request, async () => { throw new Error('must route collaboration') })
      expect(result).toEqual({ accepted: true, routedSessionIds: ['original-root'] })
      expect(app.teams).not.toHaveBeenCalled()
    } finally { await app.ctx.fiber.dispose() }
  })
})

function employeeSetup() {
  const ctx = new Context()
  const bindings: Array<{ surfaceId: string; topicId: string; employeeId: string; sessionId: string }> = []
  const nativeCreate = vi.fn(async () => ({ sessionId: 'native-session' }))
  const workStart = vi.fn(async (_request: EnterpriseWorkStartRequest) => ({ sessionId: 'work-session' }))
  const nativeSession = Session.create(SessionId('work-session'))
  const nativeAgent = {
    session: nativeSession, inbox: { nextTurn: [], nextStep: [] },
    steer: (message: UserMessage) => { nativeSession.append('user/message', message, { surfaceOp: 'append' }) },
  }
  ctx.provide('enterprisePostgres' as never, {
    collaboration: {
      get: async () => ({ id: 'group', orgId: 'org', name: 'Group', kind: 'group', workspaceId: 'shared',
        memberUserIds: ['alice'], memberEmployeeIds: ['employee-a'], dutyEmployeeIds: [] }),
      sessions: async () => bindings,
      bind: async (binding: typeof bindings[number]) => { bindings.push(binding) },
    },
    catalog: {
      getDraft: async () => ({ status: 'published', profile: { name: 'Analyst' } }),
      listReleases: async () => [{ releaseId: 'release-exact', version: 7 }],
    },
  } as never)
  ctx.provide('enterpriseSecurity' as never, {
    authenticateCookieAsync: async () => actor,
    authorizeResourceAsync: async () => ({ allowed: true, reason: 'role' }),
    authorizeApiAsync: async () => ({ allowed: true, reason: 'role' }),
    auditApiResourceAsync: async () => {}, sessionAccessibleBy: async () => true,
    bindSessionWorkspaceAsync: async () => {},
  } as never)
  ctx.provide('enterpriseRequestContext' as never, { run: (_actor: unknown, callback: () => unknown) => callback() } as never)
  ctx.provide('enterpriseWorkController' as never, { start: workStart } as never)
  ctx.provide('sessionController' as never, { create: nativeCreate } as never)
  ctx.provide('agents' as never, { get: () => nativeAgent } as never)
  ctx.provide('sessions' as never, { flush: async () => {} } as never)
  const handler = composeCollaboration(ctx, {
    operations: () => ({ upsertWorkRecord: async () => {} }) as never,
    teams: () => { throw new Error('not a charter') },
    limits: { roomContextCharacters: 6000, roomContextEvents: 24, maxBotHops: 2 },
  })
  const post = (operation: string, body: unknown) => handler.fetch(new Request(`https://dsh/enterprise/surfaces/group/${operation}`, {
    method: 'POST', body: JSON.stringify(body),
  }))
  return { ctx, bindings, nativeCreate, workStart, post }
}

describe('collaboration employee selection compatibility', () => {
  it('creates through enterprise work with an exact release and stable destination key', async () => {
    const app = employeeSetup()
    try {
      const response = await app.post('open', { employeeId: 'employee-a' })
      expect(await response.json()).toMatchObject({ opened: true, sessionId: 'work-session' })
      expect(app.workStart.mock.calls[0]?.[0]).toMatchObject({
        objective: 'Group · Analyst', workspaceId: 'shared', preferredEmployeeReleaseId: 'release-exact',
      })
      expect(app.workStart.mock.calls[0]?.[0].idempotencyKey).toMatch(/^session-collaboration-/u)
      expect(app.nativeCreate).not.toHaveBeenCalled()
      await app.post('open', { employeeId: 'employee-a' })
      expect(app.workStart).toHaveBeenCalledOnce()
    } finally { await app.ctx.fiber.dispose() }
  })
  it('cold-resumes a recorded destination without replacing its work-mode preset', async () => {
    const app = employeeSetup()
    app.bindings.push({ surfaceId: 'group', topicId: '', employeeId: 'employee-a', sessionId: 'work-session' })
    try {
      const response = await app.post('messages', { text: '@Analyst continue', messageId: 'resume-1' })
      expect(await response.json()).toMatchObject({ delivered: true })
      expect(app.nativeCreate).toHaveBeenCalledWith({ sessionId: 'work-session', workspaceId: 'shared' })
      expect(app.workStart).not.toHaveBeenCalled()
    } finally { await app.ctx.fiber.dispose() }
  })
})


describe('collaboration persisted TeamRun lookup', () => {
  it.each(['open', 'messages'] as const)('finds an older bound run for %s without relying on the first team catalog page', async (operation) => {
    const app = setup('completed')
    const run = { runId: 'run-old', teamId: 'team-a', workspaceId: 'shared', rootSessionId: 'original-root', state: 'active', createdAt: 1 }
    const getRun = vi.fn(async () => run)
    const listRuns = vi.fn(async () => ({ items: [], nextCursor: 'older-page' }))
    const startRun = vi.fn(async () => ({ ...run, runId: 'duplicate-run', rootSessionId: 'duplicate-root' }))
    app.operations.mockImplementation(() => ({ getTeamDefinition: async () => ({ teamId: 'team-a', name: 'Team', state: 'active', revision: 1 }) }) as never)
    app.teams.mockImplementation(() => ({ getRun, listRuns, startRun }) as never)
    Object.assign(app.ctx.enterpriseTeamRuntimeDriver, { submitRunInput: async () => ({}) })
    try {
      const response = await app.handler.fetch(new Request(`https://dsh/enterprise/surfaces/group/${operation}`, {
        method: 'POST', body: JSON.stringify(operation === 'open' ? {} : { text: 'Continue the existing run' }),
      }))
      expect(await response.json()).toMatchObject(operation === 'open'
        ? { opened: true, sessionId: 'original-root' }
        : { delivered: true, targets: [{ sessionId: 'original-root' }] })
      expect(getRun).toHaveBeenCalledWith(actor, 'run-old')
      expect(startRun).not.toHaveBeenCalled()
    } finally { await app.ctx.fiber.dispose() }
  })
})

describe('room member choices from current identity and releases', () => {
  it('returns only active Workspace people and actor-authorized published employees', async () => {
    const ctx = new Context()
    ctx.provide('enterprisePostgres' as never, {
      collaboration: { get: async () => ({ id: 'group', orgId: 'org', name: 'Group', kind: 'group', workspaceId: 'shared',
        adminUserId: 'alice', memberUserIds: ['alice'], memberEmployeeIds: ['existing'], dutyEmployeeIds: [] }) },
      identity: {
        listUsers: async () => [
          { id: 'alice', displayName: 'Alice', disabled: false }, { id: 'bob', displayName: 'Bob', disabled: false },
          { id: 'disabled', displayName: 'Disabled', disabled: true }, { id: 'outsider', displayName: 'Outsider', disabled: false },
        ],
        listWorkspaceGrants: async (input: { userId: string }) => input.userId === 'outsider' ? [] : [{ workspaceId: 'shared' }],
      },
      catalog: {
        listDrafts: async () => ({ items: ['existing', 'published', 'draft', 'denied', 'unreleased'].map(presetId => ({ presetId })) }),
        getDraft: async (id: string) => ({ status: id === 'draft' ? 'draft' : 'published', profile: { name: id, avatarSeed: 'seed' } }),
        listReleases: async (id: string) => id === 'unreleased' ? [] : [{ releaseId: 'release', version: 1 }],
      },
    } as never)
    ctx.provide('enterpriseSecurity' as never, {
      authenticateCookieAsync: async () => actor,
      authorizeResourceAsync: async () => ({ allowed: true }), auditApiResourceAsync: async () => {},
      authorizeApiAsync: async (_actor: unknown, _operation: string, input: { presetId?: string }) => ({ allowed: input.presetId !== 'denied' }),
    } as never)
    const handler = composeCollaboration(ctx, { operations: () => { throw new Error('not needed') }, teams: () => { throw new Error('not needed') },
      limits: { roomContextCharacters: 6000, roomContextEvents: 24, maxBotHops: 2 } })
    try {
      const response = await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/member-options'))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ people: [{ id: 'bob', name: 'Bob' }],
        employees: [{ id: 'published', name: 'published', avatarSeed: 'seed' }] })
      for (const userId of ['disabled', 'outsider', 'foreign']) {
        const rejected = await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/members/add', {
          method: 'POST', body: JSON.stringify({ memberUserIds: [userId] }),
        }))
        expect(rejected.status).toBe(409)
      }
      for (const employeeId of ['draft', 'denied', 'unreleased']) {
        const rejected = await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/members/add', {
          method: 'POST', body: JSON.stringify({ memberEmployeeIds: [employeeId] }),
        }))
        expect(rejected.status).toBe(409)
      }
    } finally { await ctx.fiber.dispose() }
  })
})
