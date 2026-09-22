import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { EmployeeAccountService, employeeId, surfaceId } from '@deepseek-ai/dsh-employee-account'
import type { EmployeeAccount, EmployeeAccounts } from '@deepseek-ai/dsh-employee-account'
import { migrateEnterpriseIdentity } from '@deepseek-ai/dsh-enterprise-identity'
import type { LlmCallConfig, UserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name } from '../src/index.ts'
import type { Surface } from '../src/index.ts'

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
  inheritedEventCount = 0
  private pinnedHeader: object | undefined = undefined

  constructor(readonly id: string) {}

  snapshotEvents(): Array<{ type: string; data: unknown }> {
    return this.events
  }

  requestHeader(): object | undefined {
    return this.pinnedHeader
  }

  pinRequestHeader(): void {
    this.pinnedHeader = {}
  }

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
    if (this.host.steerFailure !== undefined) throw this.host.steerFailure
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

  followup(message: UserMessage): void {
    this.session.append('user/message', message)
  }

  whenIdle(): Promise<void> {
    return Promise.resolve()
  }
}

/** Creation facts the registry passes to `ctx.agents.create`. */
interface CreatedAgentRecord {
  readonly sessionId: string
  readonly meta: { readonly cwd?: string; readonly agentPreset?: string } | undefined
  readonly agentOptions: { readonly provider: string; readonly model: string } | undefined
}

/** Minimal agent-host surface behind the ctx keys the registry injects. */
class FakeAgentHost {
  readonly agents: FakeAgent[] = []
  readonly created: CreatedAgentRecord[] = []
  readonly attached: string[] = []
  readonly detached: string[] = []
  readonly disposed: string[] = []
  readonly flushedSessions: FakeSession[] = []
  readonly renamedTitles: string[] = []
  readonly mountedPresets: string[] = []
  readonly resolvedPresets: string[] = []
  readonly steered: UserMessage[] = []
  steerFailure: Error | undefined = undefined
  silentSteer = false
  appendMode: 'spliced' | 'user-message' | 'canceled-splice' = 'spliced'
  failAttach = false
  failDetach = false
  failRename = false
  failDispose = false
  selection: { provider: string; model: string; reasoningEffort?: string } = {
    provider: 'mock',
    model: 'mock-model',
  }
  private readonly live = new Map<string, FakeAgent>()

  constructor(private readonly ctx: Context) {}

  mount(): void {
    const ctx = this.ctx
    ctx.provide('agents' as never, {
      create: async (options: {
        sessionId: string
        meta?: CreatedAgentRecord['meta']
        agentOptions?: CreatedAgentRecord['agentOptions']
        setup?: (agentCtx: Context) => Promise<void>
      }) => {
        const agent = new FakeAgent(options.sessionId, this)
        this.created.push({
          sessionId: options.sessionId,
          meta: options.meta,
          agentOptions: options.agentOptions,
        })
        this.agents.push(agent)
        this.live.set(options.sessionId, agent)
        await options.setup?.(ctx)
        return {
          agent,
          dispose: async () => {
            if (this.failDispose) throw new Error('injected agent disposal failure')
            this.live.delete(options.sessionId)
            this.disposed.push(options.sessionId)
          },
        }
      },
      get: (id: string) => this.live.get(id),
    } as never)
    ctx.provide('agentDefaultModel' as never, {
      currentSelection: () => ({ ...this.selection }),
    } as never)
    ctx.provide('agentPresets' as never, {
      resolve: async (id: string) => {
        this.resolvedPresets.push(id)
        return { id }
      },
      standingKeyFor: async () => 'standing-key',
      mount: async (_agentCtx: Context, id: string) => {
        this.mountedPresets.push(id)
      },
    } as never)
    ctx.provide('sessionTitle' as never, {
      rename: (_session: unknown, title: string) => {
        if (this.failRename) throw new Error('injected rename failure')
        this.renamedTitles.push(title)
      },
    } as never)
    ctx.provide('sessions' as never, {
      flush: async (session: FakeSession) => {
        this.flushedSessions.push(session)
        return true
      },
    } as never)
    ctx.provide('workspaceRegistry' as never, {
      create: async (path: string) => ({
        id: `workspace-${path}`,
        path,
        attachSession: async (sessionId: string) => {
          this.attached.push(sessionId)
          if (this.failAttach) throw new Error('injected attach failure')
        },
        detachSession: async (sessionId: string) => {
          this.detached.push(sessionId)
          if (this.failDetach) throw new Error('injected detach failure')
        },
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
function makeCtx(options: { vanishInbox?: boolean } = {}): Setup {
  const ctx = new Context()
  const host = new FakeAgentHost(ctx)
  host.mount()
  const database = new DatabaseSync(':memory:')
  migrateEnterpriseIdentity(database)
  database.prepare('INSERT INTO organizations(id, name) VALUES (?, ?)').run('org-1', 'Existing enterprise')
  database.prepare('INSERT INTO organizations(id, name) VALUES (?, ?)').run('org-2', 'Other enterprise')
  database.prepare('INSERT INTO users(id, org_id, username, display_name, disabled) VALUES (?, ?, ?, ?, ?)')
    .run('user-1', 'org-1', 'alice', 'Alice', 0)
  const service = new EmployeeAccountService(database)
  const accounts = options.vanishInbox === true ? vanishingAccounts(service, database) : service
  ctx.provide('employeeAccounts' as never, accounts as never)
  apply(ctx, { database, defaultAgentPreset: PRESET })
  return { ctx, host, database, accounts }
}

/** Create one active employee account under one organization. */
function createEmployee(accounts: EmployeeAccounts, orgId = 'org-1', displayName = 'Support'): EmployeeAccount {
  return accounts.create({
    orgId, displayName, roleCard: '客服助理', homeWorkspacePath: '/managed/employees/support',
  })
}

/** Read one inbox row's delivery state straight from the store. */
function inboxState(database: DatabaseSync, surfaceIdValue: string): { id: string; state: string } {
  return database.prepare('SELECT id, state FROM employee_inbox WHERE surface_id = ?').get(surfaceIdValue) as
    { id: string; state: string }
}

/** Wrap the account service so every enqueued row vanishes before its claim. */
function vanishingAccounts(accounts: EmployeeAccountService, database: DatabaseSync): EmployeeAccounts {
  return {
    create: input => accounts.create(input),
    get: id => accounts.get(id),
    list: (orgId, options) => accounts.list(orgId, options),
    setState: (id, state) => {
      accounts.setState(id, state)
    },
    bindSticky: (orgId, actorKey, id) => {
      accounts.bindSticky(orgId, actorKey, id)
    },
    resolveSticky: (orgId, actorKey) => accounts.resolveSticky(orgId, actorKey),
    enqueue: (input) => {
      const item = accounts.enqueue(input)
      database.prepare('DELETE FROM employee_inbox WHERE id = ?').run(item.id)
      return item
    },
    claim: (id, limit) => accounts.claim(id, limit),
  }
}

describe('enterprise-surface plugin', () => {
  it('declares the agent-host services it injects', () => {
    expect(name).toBe('enterprise-surface')
    expect(inject).toEqual([
      'agentDefaultModel',
      'agentPresets',
      'agents',
      'employeeAccounts',
      'sessionTitle',
      'sessions',
      'workspaceRegistry',
    ])
  })

  it('refuses an empty defaultAgentPreset at load', () => {
    expect(() => {
      apply(new Context(), { database: new DatabaseSync(':memory:'), defaultAgentPreset: ' ' })
    }).toThrow(TypeError)
  })
})

describe('DmSurfaceRegistry.ensureDm', () => {
  it('creates one surface and anchored session, and repeats return the same surface', async () => {
    const { ctx, host, accounts } = makeCtx()
    const employee = createEmployee(accounts)
    const first = await ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id })
    const second = await ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id })

    expect(second).toEqual(first)
    expect(first).toMatchObject({ kind: 'dm', orgId: 'org-1', userId: 'user-1', employeeId: employee.id })
    expect(first.sessionId?.startsWith('employee-dm-')).toBe(true)
    expect(host.created).toHaveLength(1)
    expect(host.created[0]).toMatchObject({
      sessionId: first.sessionId,
      meta: { cwd: '/managed/employees/support', agentPreset: PRESET },
      agentOptions: { provider: 'mock', model: 'mock-model' },
    })
    expect(host.resolvedPresets).toEqual([PRESET])
    expect(host.mountedPresets).toEqual([PRESET])
    expect(host.attached).toEqual([first.sessionId])
    expect(host.renamedTitles).toEqual(['Support'])
  })

  it('refuses an unknown employee and an employee from another organization', async () => {
    const { ctx, host, accounts } = makeCtx()
    const foreign = createEmployee(accounts, 'org-2')

    await expect(ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: foreign.id }))
      .rejects.toThrow(`enterprise employee ${foreign.id} cannot be bound under org-1 (belongs to org-2)`)
    await expect(ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employeeId('employee-missing') }))
      .rejects.toThrow('enterprise employee employee-missing is missing')
    expect(host.created).toEqual([])
  })

  it('rolls the anchored session back when the workspace attach fails and retries cleanly', async () => {
    const { ctx, host, accounts } = makeCtx()
    const employee = createEmployee(accounts)
    const input = { orgId: 'org-1', userId: 'user-1', employeeId: employee.id }
    host.failAttach = true
    host.failDispose = true
    const warn = vi.spyOn(ctx.logger, 'warn')
    await expect(ctx.surfaces.ensureDm(input)).rejects.toThrow('injected attach failure')
    expect(host.detached).toEqual([])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Agent disposal'))
    host.failAttach = false
    host.failDispose = false
    warn.mockRestore()

    const retried = await ctx.surfaces.ensureDm(input)
    expect(host.created).toHaveLength(2)
    expect(retried.sessionId).toBe(host.created[1]?.sessionId)
    expect(host.attached).toEqual([host.created[0]?.sessionId, host.created[1]?.sessionId])
  })

  it('detaches and disposes when titling fails after the attach', async () => {
    const { ctx, host, accounts } = makeCtx()
    const employee = createEmployee(accounts)
    host.failRename = true
    host.failDetach = true
    const warn = vi.spyOn(ctx.logger, 'warn')
    await expect(ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id }))
      .rejects.toThrow('injected rename failure')
    expect(host.detached).toEqual([host.created[0]?.sessionId])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Workspace detach'))
    expect(host.disposed).toEqual([host.created[0]?.sessionId])
    warn.mockRestore()
  })
})

describe('DmSurfaceRegistry.deliverToEmployee', () => {
  it('enqueues one message, steers it into the anchored session, and leaves the row delivered', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const employee = createEmployee(accounts)
    const surface = await ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id })

    const id = await ctx.surfaces.deliverToEmployee(surface, 'actor-a', '你好')

    expect(inboxState(database, surface.id)).toMatchObject({ id, state: 'delivered' })
    expect(host.steered).toHaveLength(1)
    expect(host.steered[0]?.source).toEqual({
      kind: 'surface-message',
      surfaceId: surface.id,
      inboxItemId: id,
      originActor: 'actor-a',
    })
    expect(host.steered[0]?.content).toEqual([{ type: 'text', text: '你好' }])
    expect(host.flushedSessions).toEqual([host.agents[0]?.session])
  })

  it('delivers older queued items first and returns the id of the item this call enqueued', async () => {
    const { ctx, host, accounts } = makeCtx()
    const employee = createEmployee(accounts)
    const surface = await ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id })
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_000)
    const earlier = accounts.enqueue({
      employeeId: employee.id, surfaceId: surface.id, originActor: 'actor-earlier', payloadText: 'earlier',
    })
    clock.mockReturnValue(2_000)

    const id = await ctx.surfaces.deliverToEmployee(surface, 'actor-a', '你好')
    clock.mockRestore()

    expect(id).not.toBe(earlier.id)
    const steeredIds = host.steered.map(message =>
      message.source.kind === 'surface-message' ? message.source.inboxItemId : '')
    expect(steeredIds).toEqual([earlier.id, id])
    const steeredActors = host.steered.map(message =>
      message.source.kind === 'surface-message' ? message.source.originActor : '')
    expect(steeredActors).toEqual(['actor-earlier', 'actor-a'])
  })

  it('marks the row failed and rethrows when the host rejects the steering', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const employee = createEmployee(accounts)
    const surface = await ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id })
    host.steerFailure = new Error('injected steer failure')

    await expect(ctx.surfaces.deliverToEmployee(surface, 'actor-a', '你好'))
      .rejects.toThrow('injected steer failure')
    expect(inboxState(database, surface.id).state).toBe('failed')
  })

  it('marks the row failed when the message never lands in the session log', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const employee = createEmployee(accounts)
    const surface = await ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id })
    host.silentSteer = true

    await expect(ctx.surfaces.deliverToEmployee(surface, 'actor-a', '你好'))
      .rejects.toThrow(/did not land in anchored session/)
    expect(inboxState(database, surface.id).state).toBe('failed')
  })

  it('un-lands the item when a cancellation splice removes the pending steering', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const employee = createEmployee(accounts)
    const surface = await ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id })
    host.appendMode = 'canceled-splice'

    await expect(ctx.surfaces.deliverToEmployee(surface, 'actor-a', '你好'))
      .rejects.toThrow(/did not land in anchored session/)
    expect(inboxState(database, surface.id).state).toBe('failed')
  })

  it('marks the row failed when the anchored session is not live', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const employee = createEmployee(accounts)
    const surface = await ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id })
    host.dropLive(surface.sessionId ?? '')

    await expect(ctx.surfaces.deliverToEmployee(surface, 'actor-a', '你好'))
      .rejects.toThrow(/is not live/)
    expect(inboxState(database, surface.id).state).toBe('failed')
  })

  it('counts the appended user message as a durable landing', async () => {
    const { ctx, host, accounts } = makeCtx()
    const employee = createEmployee(accounts)
    const surface = await ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id })
    host.appendMode = 'user-message'

    await expect(ctx.surfaces.deliverToEmployee(surface, 'actor-a', '你好')).resolves.toBeTypeOf('string')
  })

  it('refuses a surface without an anchored session before queueing anything', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const employee = createEmployee(accounts)
    const bare: Surface = {
      id: surfaceId('surface-bare'), kind: 'dm', orgId: 'org-1', userId: 'user-1', employeeId: employee.id,
    }

    await expect(ctx.surfaces.deliverToEmployee(bare, 'actor-a', '你好'))
      .rejects.toThrow('enterprise surface surface-bare has no anchored session')
    expect(host.steered).toEqual([])
    expect(database.prepare('SELECT COUNT(*) AS count FROM employee_inbox').get()).toEqual({ count: 0 })
  })

  it('fails loud when the enqueued item vanishes from the claimed queue', async () => {
    const { ctx, accounts } = makeCtx({ vanishInbox: true })
    const employee = createEmployee(accounts)
    const surface = await ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id })

    await expect(ctx.surfaces.deliverToEmployee(surface, 'actor-a', '你好'))
      .rejects.toThrow(/vanished from the claimed queue/)
  })

  it('refuses delivery when the surface names another organization than the employee account', async () => {
    const { ctx, host, accounts } = makeCtx()
    const employee = createEmployee(accounts)
    const surface = await ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id })
    const crossOrg: Surface = { ...surface, orgId: 'org-2' }

    await expect(ctx.surfaces.deliverToEmployee(crossOrg, 'actor-a', '你好'))
      .rejects.toThrow(`enterprise employee ${employee.id} cannot be bound under org-2 (belongs to org-1)`)
    expect(host.steered).toEqual([])
  })
})

describe('DmSurfaceRegistry.stickyEmployee', () => {
  it('resolves sticky bindings through the account service', async () => {
    const { ctx, accounts } = makeCtx()
    const employee = createEmployee(accounts)
    accounts.bindSticky('org-1', 'actor-a', employee.id)

    expect(ctx.surfaces.stickyEmployee('org-1', 'actor-a')).toBe(employee.id)
    expect(ctx.surfaces.stickyEmployee('org-1', 'actor-unbound')).toBeUndefined()
    expect(ctx.surfaces.stickyEmployee('org-2', 'actor-a')).toBeUndefined()
  })
})

describe('anchored session model selection', () => {
  /** Fire the pinned agent/request waterfall once against the first created agent. */
  async function fireRequest(setup: Setup, next: LlmCallConfig): Promise<LlmCallConfig> {
    const agent = setup.host.agents[0]
    expect(agent).toBeDefined()
    return await setup.ctx.waterfall(
      'agent/request',
      { agent: agent as never, turn: 1, step: 1, signal: new AbortController().signal } as never,
      () => Promise.resolve(next),
    )
  }

  it('pins the creation-time selection, drops inherited reasoning effort, and passes mismatches through', async () => {
    const setup = makeCtx()
    const employee = createEmployee(setup.accounts)
    await setup.ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id })

    await expect(fireRequest(setup, { provider: 'mock', model: 'mock-model', reasoningEffort: 'low' as never }))
      .resolves.toEqual({ provider: 'mock', model: 'mock-model' })
    await expect(fireRequest(setup, { provider: 'other', model: 'mock-model', reasoningEffort: 'low' as never }))
      .resolves.toEqual({ provider: 'other', model: 'mock-model', reasoningEffort: 'low' })
    await expect(fireRequest(setup, { provider: 'mock', model: 'other-model' }))
      .resolves.toEqual({ provider: 'mock', model: 'other-model' })
    setup.host.agents[0]?.session.pinRequestHeader()
    await expect(fireRequest(setup, { provider: 'mock', model: 'mock-model', reasoningEffort: 'low' as never }))
      .resolves.toEqual({ provider: 'mock', model: 'mock-model', reasoningEffort: 'low' })
  })

  it('applies the selection reasoning effort over the inherited one', async () => {
    const setup = makeCtx()
    setup.host.selection = { provider: 'mock', model: 'mock-model', reasoningEffort: 'high' }
    const employee = createEmployee(setup.accounts)
    await setup.ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: employee.id })

    await expect(fireRequest(setup, { provider: 'mock', model: 'mock-model', reasoningEffort: 'low' as never }))
      .resolves.toEqual({ provider: 'mock', model: 'mock-model', reasoningEffort: 'high' })
  })
})
