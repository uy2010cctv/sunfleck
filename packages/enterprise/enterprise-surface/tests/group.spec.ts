import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { EmployeeAccountService } from '@deepseek-ai/dsh-employee-account'
import type { EmployeeAccount, EmployeeAccounts, EmployeeId } from '@deepseek-ai/dsh-employee-account'
import type { EnterpriseTeamRun } from '@deepseek-ai/dsh-enterprise-operations'
import { migrateEnterpriseIdentity } from '@deepseek-ai/dsh-enterprise-identity'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import type { GroupEmployeeTarget, GroupSurface } from '../src/index.ts'

const PRESET = 'employee-preset'

/** One session log double whose appends land synchronously like the real store. */
class FakeSession {
  /* Seed decoy events so the landing scan exercises its non-matching arms. */
  readonly events: Array<{ type: string; data: unknown }> = [
    { type: 'turn/start', data: {} },
    { type: 'user/message', data: { source: { kind: 'user' } } },
    {
      type: 'agent/inbox/spliced',
      data: { target: 'next-step', start: 0, inserted: [{ source: { kind: 'user' } }] },
    },
  ]

  constructor(readonly id: string) {}

  ownEvents(): Array<{ type: string; data: unknown }> {
    return this.events
  }

  requestHeader(): object | undefined {
    return undefined
  }

  pinRequestHeader(): void {}

  append(type: string, data: unknown): void {
    this.events.push({ type, data })
  }
}

/** One agent double whose steer lands the message in the session log. */
class FakeAgent {
  readonly session: FakeSession

  constructor(
    id: string,
    private readonly host: FakeAgentHost,
  ) {
    this.session = new FakeSession(id)
  }

  steer(message: UserMessage): void {
    this.host.steered.push(message)
    if (this.host.silentSteer) return
    if (this.host.appendMode === 'user-message') {
      this.session.append('user/message', message)
    } else if (this.host.appendMode === 'canceled-splice') {
      this.session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] })
      this.session.append('agent/inbox/spliced', {
        target: 'next-step', start: 0, removedCount: 1, inserted: [], outcome: 'canceled',
      })
    } else {
      this.session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] })
    }
  }

  whenIdle(): Promise<void> {
    return Promise.resolve()
  }
}

/** Creation facts the registry passes to `ctx.agents.create`. */
interface CreatedAgentRecord {
  readonly sessionId: string
  readonly meta: { readonly cwd?: string; readonly agentPreset?: string } | undefined
}

/** Minimal agent-host surface behind the ctx keys the registry injects. */
class FakeAgentHost {
  readonly agents: FakeAgent[] = []
  readonly created: CreatedAgentRecord[] = []
  readonly flushedSessions: FakeSession[] = []
  readonly steered: UserMessage[] = []
  silentSteer = false
  appendMode: 'spliced' | 'user-message' | 'canceled-splice' = 'spliced'
  /** Park every session flush until released, modeling a slow durable landing. */
  flushGate: Promise<void> | undefined = undefined
  private readonly live = new Map<string, FakeAgent>()

  constructor(private readonly ctx: Context) {}

  mount(): void {
    const ctx = this.ctx
    ctx.provide('agents' as never, {
      create: async (options: {
        sessionId: string
        meta?: CreatedAgentRecord['meta']
        setup?: (agentCtx: Context) => Promise<void>
      }) => {
        this.created.push({ sessionId: options.sessionId, meta: options.meta })
        const agent = new FakeAgent(options.sessionId, this)
        this.agents.push(agent)
        this.live.set(options.sessionId, agent)
        await options.setup?.(ctx)
        return { agent, dispose: async () => this.live.delete(options.sessionId) }
      },
      get: (id: string) => this.live.get(id),
    } as never)
    ctx.provide('agentDefaultModel' as never, {
      currentSelection: () => ({ provider: 'mock', model: 'mock-model' }),
    } as never)
    ctx.provide('agentPresets' as never, {
      resolve: async (id: string) => ({ id }),
      standingKeyFor: async () => 'standing-key',
      mount: async () => {},
    } as never)
    ctx.provide('sessionTitle' as never, {
      rename: () => {},
    } as never)
    ctx.provide('sessions' as never, {
      flush: async (session: FakeSession) => {
        this.flushedSessions.push(session)
        if (this.flushGate !== undefined) await this.flushGate
        return true
      },
    } as never)
    ctx.provide('workspaceRegistry' as never, {
      create: async (path: string) => ({
        id: `workspace-${path}`,
        path,
        attachSession: async () => {},
        detachSession: async () => {},
      }),
    } as never)
  }

  /** Drop one live agent so anchored-session lookups miss. */
  dropLive(sessionId: string): void {
    this.live.delete(sessionId)
  }
}

interface Setup {
  readonly ctx: Context
  readonly host: FakeAgentHost
  readonly database: DatabaseSync
  readonly accounts: EmployeeAccounts
}

/** Open one migrated identity database, mount the fake host, and apply the plugin. */
function makeCtx(): Setup {
  const ctx = new Context()
  const host = new FakeAgentHost(ctx)
  host.mount()
  const database = new DatabaseSync(':memory:')
  migrateEnterpriseIdentity(database)
  database.prepare('INSERT INTO organizations(id, name) VALUES (?, ?)').run('org-1', 'Existing enterprise')
  database.prepare('INSERT INTO organizations(id, name) VALUES (?, ?)').run('org-2', 'Other enterprise')
  database.prepare('INSERT INTO users(id, org_id, username, display_name, disabled) VALUES (?, ?, ?, ?, ?)')
    .run('user-1', 'org-1', 'alice', 'Alice', 0)
  ctx.provide('employeeAccounts' as never, new EmployeeAccountService(database) as never)
  apply(ctx, { database, defaultAgentPreset: PRESET })
  return { ctx, host, database, accounts: ctx.employeeAccounts }
}

/** Create one active employee account under org-1 with its own home workspace and display name. */
function createEmployee(
  accounts: EmployeeAccounts,
  id: string,
  displayName: string,
): EmployeeAccount {
  return accounts.create({
    orgId: 'org-1', displayName, roleCard: '客服助理', homeWorkspacePath: `/managed/employees/${id}`,
  })
}

/** One active team run projecting the chartered team a group surface routes to. */
function teamRun(overrides: Partial<EnterpriseTeamRun> = {}): EnterpriseTeamRun {
  return {
    runId: 'run-active', orgId: 'org-1', teamId: 'team-1', teamDefinitionRevision: 3,
    workspaceId: 'workspace-1', rosterSnapshot: [], createdBy: 'user-1', source: 'console',
    state: 'active', runtimeRevision: 2, revision: 1, createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

interface MountedTeamServices {
  readonly started: Array<{
    orgId: string
    teamId: string
    userId: string
    prompt: string
    source: string
    idempotencyKey: string
  }>
  readonly submitted: Array<{
    runId: string
    input: { readonly actorUserId: string; readonly text: string; readonly originSurfaceId: string }
  }>
}

/** Mount fake team control and runtime services under their lazy service names. */
function mountTeamServices(ctx: Context, options: { activeRuns?: EnterpriseTeamRun[] } = {}): MountedTeamServices {
  const started: MountedTeamServices['started'] = []
  const submitted: MountedTeamServices['submitted'] = []
  ctx.provide('enterpriseTeamControl' as never, {
    listTeamRuns: async (input: { state: string }) =>
      input.state === 'active' ? (options.activeRuns ?? []) : [],
    startRun: async (input: MountedTeamServices['started'][number]) => {
      started.push(input)
      return teamRun({ runId: `run-started-${String(started.length)}`, state: 'starting' })
    },
  } as never)
  ctx.provide('enterpriseTeamRuntimeDriver' as never, {
    submitRunInput: async (runId: string, input: MountedTeamServices['submitted'][number]['input']) => {
      submitted.push({ runId, input })
      return { runtimeRevision: 2, sourceEventSeq: 9 }
    },
  } as never)
  return { started, submitted }
}

/** Create one chartered group surface routed to team-1. */
async function teamSurface(ctx: Setup['ctx'], teamId = 'team-1'): Promise<GroupSurface> {
  return await ctx.surfaces.ensureGroupSurface({
    orgId: 'org-1', name: '章程群', externalKey: 'fe-team', memberEmployeeIds: [], teamDefinitionId: teamId,
  })
}

describe('GroupSurfaceRegistry.ensureGroupSurface', () => {
  it('creates once keyed by external key, replaces members, and creates no session', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const first = createEmployee(accounts, 'support', 'Support')
    const second = createEmployee(accounts, 'reviewer', 'Reviewer')

    const surface = await ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '支持群', externalKey: 'fe-g1', memberEmployeeIds: [first.id, second.id],
    })
    const repeated = await ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '改名群', externalKey: 'fe-g1', memberEmployeeIds: [second.id],
    })

    expect(repeated).toEqual(surface)
    expect(surface).toMatchObject({ kind: 'group', orgId: 'org-1', name: '支持群' })
    expect(database.prepare('SELECT principal_id FROM surface_members ORDER BY principal_id').all())
      .toEqual([{ principal_id: second.id }])
    expect(host.created).toEqual([])
  })

  it('keeps the stored row when re-keyed by external key and stores the charter and project references', async () => {
    const { ctx, accounts } = makeCtx()
    const member = createEmployee(accounts, 'support', 'Support')

    const surface = await ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '支持群', externalKey: 'fe-g2', memberEmployeeIds: [member.id],
      teamDefinitionId: 'team-1', projectId: 'project-1',
    })
    const repeated = await ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '支持群', externalKey: 'fe-g2', memberEmployeeIds: [member.id],
    })

    expect(repeated).toEqual(surface)
    expect(surface).toMatchObject({ teamDefinitionId: 'team-1', projectId: 'project-1' })
  })

  it('refuses a federated group without members and members from another organization', async () => {
    const { ctx, accounts } = makeCtx()
    const foreign = accounts.create({
      orgId: 'org-2', displayName: 'Support', roleCard: '客服助理', homeWorkspacePath: '/managed/employees/foreign',
    })

    await expect(ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '空群', memberEmployeeIds: [],
    })).rejects.toMatchObject({ code: 'group-members-missing' })
    await expect(ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '跨组织群', memberEmployeeIds: [foreign.id],
    })).rejects.toMatchObject({ code: 'employee-cross-org' })
  })
})

describe('deliverToGroup in federated mode', () => {
  it('steers the @-mentioned member group session with the surface-message source', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const member = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '支持群', externalKey: 'fe-g1', memberEmployeeIds: [member.id],
    })

    const result = await ctx.surfaces.deliverToGroup(surface, { originUserId: 'user-1', text: '@Support 请出今天的报表' })

    expect(result).toMatchObject({ delivered: true, mode: 'federated' })
    const target = result.delivered ? employeeTarget(result, member) : undefined
    expect(target).toMatchObject({ employeeId: member.id, delivered: true })
    const sessionId = target?.sessionId
    expect(sessionId?.startsWith('employee-group-')).toBe(true)
    expect(groupSessionId(database, surface.id, member.id)).toBe(sessionId)
    expect(host.created).toHaveLength(1)
    expect(host.created[0]).toMatchObject({
      meta: { cwd: '/managed/employees/support', agentPreset: PRESET },
    })
    expect(host.steered).toHaveLength(1)
    expect(host.steered[0]?.source).toEqual({
      kind: 'surface-message', surfaceId: surface.id, originActor: 'user-1',
    })
    expect(host.steered[0]?.content).toEqual([{ type: 'text', text: '@Support 请出今天的报表' }])
    expect(host.flushedSessions).toEqual([host.agents[0]?.session])
  })

  it('delivers to explicit member ids without a token and ignores ids outside the member set', async () => {
    const { ctx, accounts } = makeCtx()
    const member = createEmployee(accounts, 'support', 'Support')
    const outsider = createEmployee(accounts, 'outsider', 'Outsider')
    const surface = await ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '支持群', externalKey: 'fe-g1', memberEmployeeIds: [member.id],
    })

    const delivered = await ctx.surfaces.deliverToGroup(surface, {
      originUserId: 'user-1', text: '没有提及的消息', mentionedEmployeeIds: [member.id],
    })
    expect(delivered).toMatchObject({ delivered: true, mode: 'federated' })

    const missed = await ctx.surfaces.deliverToGroup(surface, {
      originUserId: 'user-1', text: '外部指派', mentionedEmployeeIds: [outsider.id],
    })
    expect(missed).toEqual({ delivered: false, reason: 'no-target' })
  })

  it('answers no-target without creating sessions when no member matches', async () => {
    const { ctx, host, accounts } = makeCtx()
    const member = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '支持群', externalKey: 'fe-g1', memberEmployeeIds: [member.id],
    })

    // The punctuation-only token strips to an empty name and matches nobody.
    const result = await ctx.surfaces.deliverToGroup(surface, { originUserId: 'user-1', text: '大家安静 @!!!' })

    expect(result).toEqual({ delivered: false, reason: 'no-target' })
    expect(host.created).toEqual([])
  })

  it('serializes concurrent deliveries to the same member in queued order', async () => {
    const { ctx, host, accounts } = makeCtx()
    const member = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '支持群', externalKey: 'fe-g1', memberEmployeeIds: [member.id],
    })

    let release!: () => void
    host.flushGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = ctx.surfaces.deliverToGroup(surface, { originUserId: 'user-1', text: '@Support 第一条' })
    await vi.waitFor(() => {
      expect(host.steered).toHaveLength(1)
    })
    const second = ctx.surfaces.deliverToGroup(surface, { originUserId: 'user-2', text: '@Support 第二条' })
    release()

    expect(await first).toMatchObject({ delivered: true, mode: 'federated' })
    expect(await second).toMatchObject({ delivered: true, mode: 'federated' })
    expect(host.created).toHaveLength(1)
    expect(host.steered.map(message => (message.content[0] as { text: string }).text))
      .toEqual(['@Support 第一条', '@Support 第二条'])
  })

  it('routes to every display-name match across case and reuses one session per member', async () => {
    const { ctx, host, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const buyer = createEmployee(accounts, 'buyer', 'Buyer')
    const surface = await ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '支持群', externalKey: 'fe-g1', memberEmployeeIds: [support.id, buyer.id],
    })

    const first = await ctx.surfaces.deliverToGroup(surface, { originUserId: 'user-1', text: '@support @Buyer 都看一下' })
    const second = await ctx.surfaces.deliverToGroup(surface, { originUserId: 'user-2', text: '@support 跟进' })

    expect(first).toMatchObject({ delivered: true, mode: 'federated' })
    expect(second).toMatchObject({ delivered: true, mode: 'federated' })
    expect(host.created).toHaveLength(2)
    if (first.delivered && second.delivered) {
      const supportTarget = employeeTarget(first, support)
      const supportAgain = employeeTarget(second, support)
      expect(supportTarget?.sessionId).toBe(supportAgain?.sessionId)
      expect(host.created.filter(record => record.sessionId === supportTarget?.sessionId)).toHaveLength(1)
    }
    expect(host.steered).toHaveLength(3)
  })

  it('counts a failed member target and keeps the rest of the batch landing', async () => {
    const { ctx, host, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const buyer = createEmployee(accounts, 'buyer', 'Buyer')
    const surface = await ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '支持群', externalKey: 'fe-g1', memberEmployeeIds: [support.id, buyer.id],
    })
    const first = await ctx.surfaces.deliverToGroup(surface, {
      originUserId: 'user-1', text: '准备', mentionedEmployeeIds: [support.id, buyer.id],
    })
    expect(first).toMatchObject({ delivered: true })
    if (first.delivered) host.dropLive(employeeTarget(first, support)?.sessionId ?? '')

    const second = await ctx.surfaces.deliverToGroup(surface, {
      originUserId: 'user-1', text: '继续', mentionedEmployeeIds: [support.id, buyer.id],
    })

    expect(second).toMatchObject({ delivered: true, mode: 'federated' })
    if (second.delivered) {
      const failed = employeeTarget(second, support)
      const landed = employeeTarget(second, buyer)
      expect(failed).toMatchObject({ delivered: false })
      expect(failed?.error).toContain('is not live')
      expect(landed).toMatchObject({ delivered: true })
    }
    expect(host.created).toHaveLength(2)
  })

  it('captures a steering that never lands as a failed target', async () => {
    const { ctx, host, accounts } = makeCtx()
    const member = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '支持群', externalKey: 'fe-g1', memberEmployeeIds: [member.id],
    })
    host.silentSteer = true

    const result = await ctx.surfaces.deliverToGroup(surface, {
      originUserId: 'user-1', text: '@Support 静默', mentionedEmployeeIds: [member.id],
    })

    expect(result).toMatchObject({ delivered: true, mode: 'federated' })
    const target = result.delivered ? employeeTarget(result, member) : undefined
    expect(target).toMatchObject({ employeeId: member.id, delivered: false })
    expect(target?.error).toContain('did not land')
  })

  it('un-lands a steering whose pending splice is canceled', async () => {
    const { ctx, host, accounts } = makeCtx()
    const member = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '支持群', externalKey: 'fe-g1', memberEmployeeIds: [member.id],
    })
    host.appendMode = 'canceled-splice'

    const result = await ctx.surfaces.deliverToGroup(surface, {
      originUserId: 'user-1', text: '@Support 撤回', mentionedEmployeeIds: [member.id],
    })

    const target = result.delivered ? employeeTarget(result, member) : undefined
    expect(target).toMatchObject({ employeeId: member.id, delivered: false })
    expect(target?.error).toContain('did not land')
  })
})

describe('deliverToGroup in team mode', () => {
  it('refuses a dm surface with the coded kind mismatch', async () => {
    const { ctx, accounts } = makeCtx()
    const member = createEmployee(accounts, 'support', 'Support')
    const dm = await ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: member.id })

    await expect(ctx.surfaces.deliverToGroup(dm, { originUserId: 'user-1', text: '任何消息' }))
      .rejects.toMatchObject({
        code: 'surface-kind-mismatch',
        message: `enterprise surface ${dm.id} is a dm surface, not a group surface`,
      })
  })

  it('submits into the active run and never touches member sessions or startRun', async () => {
    const setup = makeCtx()
    const member = createEmployee(setup.accounts, 'support', 'Support')
    const surface = await setup.ctx.surfaces.ensureGroupSurface({
      orgId: 'org-1', name: '章程群', externalKey: 'fe-team', memberEmployeeIds: [member.id],
      teamDefinitionId: 'team-1',
    })
    const team = mountTeamServices(setup.ctx, { activeRuns: [teamRun()] })

    const result = await setup.ctx.surfaces.deliverToGroup(surface, {
      originUserId: 'user-1', text: '请推进采购', mentionedEmployeeIds: [member.id],
    })

    expect(result).toEqual({
      delivered: true, mode: 'team',
      targets: [{ kind: 'team-run', runId: 'run-active', delivered: true }],
    })
    expect(team.started).toEqual([])
    expect(team.submitted).toEqual([{
      runId: 'run-active',
      input: { actorUserId: 'user-1', text: '请推进采购', originSurfaceId: surface.id },
    }])
    expect(setup.host.created).toEqual([])
  })

  it('starts one channel-sourced run with the stable idempotency key when none is active', async () => {
    const setup = makeCtx()
    const surface = await teamSurface(setup.ctx)
    const team = mountTeamServices(setup.ctx, { activeRuns: [] })

    const result = await setup.ctx.surfaces.deliverToGroup(surface, {
      originUserId: 'user-1', text: '启动团队',
    })

    expect(result).toMatchObject({ delivered: true, mode: 'team' })
    expect(team.started).toEqual([{
      orgId: 'org-1', teamId: 'team-1', userId: 'user-1', prompt: '启动团队',
      source: 'channel', idempotencyKey: `${surface.id}:user-1`,
    }])
    expect(team.submitted).toHaveLength(1)
    expect(team.submitted[0]).toMatchObject({ runId: 'run-started-1', input: { originSurfaceId: surface.id } })
  })

  it('reports the team runtime as unavailable when its services are not mounted', async () => {
    const setup = makeCtx()
    const surface = await teamSurface(setup.ctx)

    const result = await setup.ctx.surfaces.deliverToGroup(surface, { originUserId: 'user-1', text: '任何消息' })

    expect(result).toEqual({ delivered: false, reason: 'team-runtime-unavailable' })
    expect(setup.host.created).toEqual([])
  })

  it('captures a failed team submission as a structured team-run failure', async () => {
    const setup = makeCtx()
    const surface = await teamSurface(setup.ctx)
    setup.ctx.provide('enterpriseTeamControl' as never, {
      listTeamRuns: async () => [teamRun()],
      startRun: async () => teamRun(),
    } as never)
    setup.ctx.provide('enterpriseTeamRuntimeDriver' as never, {
      submitRunInput: async () => {
        throw new Error('injected submit failure')
      },
    } as never)

    const result = await setup.ctx.surfaces.deliverToGroup(surface, { originUserId: 'user-1', text: '任何消息' })

    expect(result).toMatchObject({ delivered: false, reason: 'team-run-failed' })
    if (!result.delivered && result.reason === 'team-run-failed') {
      expect(result.error).toContain('injected submit failure')
    }
  })
})

/** Read the group session bound to one (surface, employee) pair straight from the store. */
function groupSessionId(database: DatabaseSync, surface: string, member: EmployeeId): string | undefined {
  const row = database.prepare('SELECT session_id FROM surface_sessions WHERE surface_id = ? AND employee_id = ?')
    .get(surface, member) as { session_id: string } | undefined
  return row?.session_id
}

/** Read one member's target from a delivered result. */
function employeeTarget(
  result: Extract<Awaited<ReturnType<Setup['ctx']['surfaces']['deliverToGroup']>>, { delivered: true }>,
  member: EmployeeAccount,
): GroupEmployeeTarget | undefined {
  return result.targets.filter((target): target is GroupEmployeeTarget =>
    target.kind === 'employee' && target.employeeId === member.id)[0]
}
