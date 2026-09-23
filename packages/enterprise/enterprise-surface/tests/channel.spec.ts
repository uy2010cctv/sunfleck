import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { EmployeeAccountService } from '@deepseek-ai/dsh-employee-account'
import type { EmployeeAccount, EmployeeAccounts, EmployeeId } from '@deepseek-ai/dsh-employee-account'
import { dutyRoster, migrateEnterpriseIdentity, setDutyRoster } from '@deepseek-ai/dsh-enterprise-identity'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/index.ts'
import type { ChannelDeliveryResult, ChannelRoutedDelivery } from '../src/index.ts'

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
  /** Park every agent creation until released, modeling a slow anchored-session creation. */
  createGate: Promise<void> | undefined = undefined
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
        if (this.createGate !== undefined) await this.createGate
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

interface ChannelEnsureInput {
  readonly orgId: string
  readonly name: string
  readonly externalKey?: string
  readonly memberEmployeeIds: readonly EmployeeId[]
  readonly topicPolicy: 'thread' | 'command' | 'lane'
  readonly respondPolicy: 'mention_duty' | 'ingest_only'
  readonly dutyEmployeeIds: readonly EmployeeId[]
  readonly projectId?: string
}

/** Build one `ensureChannelSurface` input for org-1; overrides replace fields. */
function channelInput(overrides: Partial<ChannelEnsureInput> = {}): ChannelEnsureInput {
  return {
    orgId: 'org-1', name: '值班频道', externalKey: 'fe-c1', memberEmployeeIds: [],
    topicPolicy: 'thread', respondPolicy: 'mention_duty', dutyEmployeeIds: [],
    ...overrides,
  }
}

/** Recorded shape of one memory proposal the fake identity store accepts. */
interface ProposedMemory {
  readonly id: string
  readonly orgId: string
  readonly scope: string
  readonly kind: string
  readonly summary: string
  readonly sourceDigest: string
  readonly createdBy: string
}

/** Mount a fake enterprisePostgres identity store recording every proposal. */
function mountMemory(ctx: Context, options: { failPropose?: boolean } = {}): { proposed: ProposedMemory[] } {
  const proposed: ProposedMemory[] = []
  ctx.provide('enterprisePostgres' as never, {
    identity: {
      proposeMemory: async (input: ProposedMemory) => {
        if (options.failPropose) throw new Error('injected propose failure')
        proposed.push(input)
        return { id: `memory-${String(proposed.length)}` }
      },
    },
  } as never)
  return { proposed }
}

/** Read one channel topic row straight from the store. */
function topicRow(
  database: DatabaseSync,
  topicId: string,
): { topic_id: string; title: string; state: string; session_id: string | null } | undefined {
  return database.prepare('SELECT topic_id, title, state, session_id FROM channel_topics WHERE topic_id = ?')
    .get(topicId) as { topic_id: string; title: string; state: string; session_id: string | null } | undefined
}

/** Unwrap a delivered result expected to have routed into its topic session. */
function routedOf(result: ChannelDeliveryResult): ChannelRoutedDelivery {
  if (result.delivered && result.mode === 'routed') return result
  throw new Error(`expected a routed delivery, got ${JSON.stringify(result)}`)
}

describe('ChannelSurfaceRegistry.ensureChannelSurface', () => {
  it('creates once keyed by external key, stores policies and members, and dedups the roster', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const reviewer = createEmployee(accounts, 'reviewer', 'Reviewer')

    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      memberEmployeeIds: [support.id, reviewer.id],
      dutyEmployeeIds: [reviewer.id, support.id, reviewer.id],
    }))
    expect(dutyRoster(database, surface.id)).toEqual([reviewer.id, support.id])
    const members = database.prepare('SELECT principal_id FROM surface_members ORDER BY principal_id')
      .all() as Array<{ principal_id: string }>
    expect(members.map(member => member.principal_id).sort()).toEqual([support.id, reviewer.id].sort())

    const repeated = await ctx.surfaces.ensureChannelSurface(channelInput({
      name: '改名频道', memberEmployeeIds: [support.id],
    }))
    // The stored policies survive the repeat while the member set mirrors the latest call.
    expect(repeated).toEqual(surface)
    expect(dutyRoster(database, surface.id)).toEqual([reviewer.id, support.id])
    const replaced = database.prepare('SELECT principal_id FROM surface_members ORDER BY principal_id')
      .all() as Array<{ principal_id: string }>
    expect(replaced.map(member => member.principal_id)).toEqual([support.id])
    const { externalKey: _dropped, ...unkeyed } = channelInput({
      name: '项目频道', memberEmployeeIds: [support.id], projectId: 'project-1',
    })
    const keyed = await ctx.surfaces.ensureChannelSurface(unkeyed)
    // Without an external key the id alone keys the row, and the project reference rides along.
    expect(keyed).toMatchObject({ kind: 'channel', name: '项目频道', projectId: 'project-1' })
    expect(surface).toMatchObject({
      kind: 'channel', orgId: 'org-1', name: '值班频道', topicPolicy: 'thread', respondPolicy: 'mention_duty',
    })
    expect(host.created).toEqual([])
  })

  it('refuses members and duty employees from another organization', async () => {
    const { ctx, accounts } = makeCtx()
    const foreign = accounts.create({
      orgId: 'org-2', displayName: 'Support', roleCard: '客服助理', homeWorkspacePath: '/managed/employees/foreign',
    })

    await expect(ctx.surfaces.ensureChannelSurface(channelInput({ memberEmployeeIds: [foreign.id] })))
      .rejects.toMatchObject({ code: 'employee-cross-org' })
    await expect(ctx.surfaces.ensureChannelSurface(channelInput({ dutyEmployeeIds: [foreign.id] })))
      .rejects.toMatchObject({ code: 'employee-cross-org' })
  })
})

describe('deliverToChannel topic routing', () => {
  it('auto-creates the thread topic from the first routed message and steers its session once', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      memberEmployeeIds: [support.id], dutyEmployeeIds: [support.id],
    }))
    const longText = 'Q3 排期讨论，先从存储服务的容量评估开始，再过一遍迁移清单，请支持'.repeat(2)

    const first = routedOf(await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: longText }))
    const second = await ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-2', text: '跟进一下', topicId: first.topicId,
    })

    expect(first).toMatchObject({ delivered: true, mode: 'routed', employeeIds: [support.id] })
    expect(first.sessionId.startsWith('employee-topic-')).toBe(true)
    expect(topicRow(database, first.topicId)).toMatchObject({ state: 'open', title: longText.trim().slice(0, 40) })
    expect(topicRow(database, first.topicId)?.session_id).toBe(first.sessionId)
    expect(host.created).toEqual([{
      sessionId: first.sessionId,
      meta: { cwd: '/managed/employees/support', agentPreset: PRESET },
    }])
    expect(host.steered[0]?.source).toEqual({
      kind: 'surface-message', surfaceId: surface.id, originActor: 'user-1', topicId: first.topicId,
    })
    // The pinned follow-up reuses the same topic and session.
    expect(second).toMatchObject({
      delivered: true, mode: 'routed', topicId: first.topicId, sessionId: first.sessionId,
    })
    expect(host.created).toHaveLength(1)
  })

  it('steers a later mention of another employee into the same topic session', async () => {
    const { ctx, host, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const reviewer = createEmployee(accounts, 'reviewer', 'Reviewer')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      memberEmployeeIds: [support.id, reviewer.id], dutyEmployeeIds: [support.id],
    }))

    const first = routedOf(await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '开工' }))
    const second = await ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-2', text: '@Reviewer 请复核', topicId: first.topicId,
    })

    expect(second).toMatchObject({
      delivered: true, mode: 'routed', employeeIds: [reviewer.id], topicId: first.topicId, sessionId: first.sessionId,
    })
    expect(host.created).toHaveLength(1)
  })

  it('falls back to the duty roster head for unaddressed messages', async () => {
    const { ctx, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const reviewer = createEmployee(accounts, 'reviewer', 'Reviewer')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      memberEmployeeIds: [support.id, reviewer.id], dutyEmployeeIds: [reviewer.id],
    }))

    const result = await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '大家注意' })

    expect(result).toMatchObject({ delivered: true, mode: 'routed', employeeIds: [reviewer.id] })
  })

  it('answers no-target without creating sessions when nobody matches', async () => {
    const { ctx, host, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const outsider = createEmployee(accounts, 'outsider', 'Outsider')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({ memberEmployeeIds: [support.id] }))

    const unaddressed = await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '无人值班' })
    const outsideMember = await ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '外部指派', mentionedEmployeeIds: [outsider.id],
    })

    expect(unaddressed).toEqual({ delivered: false, reason: 'no-target' })
    expect(outsideMember).toEqual({ delivered: false, reason: 'no-target' })
    expect(host.created).toEqual([])
  })

  it('creates one session when concurrent first messages address the same topic', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      memberEmployeeIds: [support.id], dutyEmployeeIds: [support.id],
    }))
    database.prepare(`INSERT INTO channel_topics(topic_id, surface_id, title, state, session_id, created_by, created_at, settled_at)
      VALUES ('topic-race', ?, '并发话题', 'open', NULL, 'user-1', ?, NULL)`).run(surface.id, Date.now())

    let release!: () => void
    host.createGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '@Support 第一条', topicId: 'topic-race',
    })
    await vi.waitFor(() => {
      expect(host.created).toHaveLength(1)
    })
    const second = ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-2', text: '@Support 第二条', topicId: 'topic-race',
    })
    release()

    const landedFirst = routedOf(await first)
    expect(await second).toMatchObject({
      delivered: true, mode: 'routed', topicId: 'topic-race', sessionId: landedFirst.sessionId,
    })
    expect(host.created).toHaveLength(1)
    expect(topicRow(database, 'topic-race')?.session_id).toBe(landedFirst.sessionId)
  })

  it('reports routing failures as structured results', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      memberEmployeeIds: [support.id], dutyEmployeeIds: [support.id],
    }))

    host.silentSteer = true
    const silent = await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '静默' })
    host.silentSteer = false
    host.appendMode = 'canceled-splice'
    const canceled = await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '撤回' })
    host.appendMode = 'spliced'
    const landed = routedOf(await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '正常' }))
    host.dropLive(landed.sessionId)
    const dropped = await ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '再来一条', topicId: landed.topicId,
    })

    if (!silent.delivered && silent.reason === 'routing-failed') expect(silent.error).toContain('did not land')
    if (!canceled.delivered && canceled.reason === 'routing-failed') expect(canceled.error).toContain('did not land')
    if (!dropped.delivered && dropped.reason === 'routing-failed') expect(dropped.error).toContain('is not live')
    expect(silent).toMatchObject({ delivered: false, reason: 'routing-failed' })
    expect(canceled).toMatchObject({ delivered: false, reason: 'routing-failed' })
    expect(dropped).toMatchObject({ delivered: false, reason: 'routing-failed' })
    expect(topicRow(database, landed.topicId)?.session_id).toBe(landed.sessionId)
  })
})

describe('deliverToChannel commands and policies', () => {
  it('creates the commanded topic, settles it with a marker, and refuses a second settle', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      topicPolicy: 'command', memberEmployeeIds: [support.id], dutyEmployeeIds: [support.id],
    }))

    const opened = routedOf(await ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '/topic 设计评审', mentionedEmployeeIds: [support.id],
    }))
    expect(topicRow(database, opened.topicId)).toMatchObject({ title: '设计评审', state: 'open' })

    const done = await ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '/done', topicId: opened.topicId,
    })
    expect(done).toEqual({ delivered: true, mode: 'settled', topicId: opened.topicId, sessionId: opened.sessionId })
    expect(topicRow(database, opened.topicId)).toMatchObject({ state: 'settled' })
    expect(host.steered[1]?.source).toEqual({
      kind: 'surface-message', surfaceId: surface.id, originActor: 'user-1', topicId: opened.topicId,
    })
    expect(host.steered[1]?.content).toEqual([{ type: 'text', text: '/done' }])

    const again = await ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '/done', topicId: opened.topicId,
    })
    expect(again).toEqual({ delivered: false, reason: 'already-settled' })
    expect(host.steered).toHaveLength(2)
  })

  it('keeps unpinned command-policy messages out of undeclared topics', async () => {
    const { ctx, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      topicPolicy: 'command', memberEmployeeIds: [support.id], dutyEmployeeIds: [support.id],
    }))

    await expect(ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '没有话题' }))
      .resolves.toEqual({ delivered: false, reason: 'no-topic' })
    await expect(ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '/done' }))
      .resolves.toEqual({ delivered: false, reason: 'no-topic' })
    await expect(ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '/done', topicId: 'topic-x' }))
      .resolves.toEqual({ delivered: false, reason: 'no-topic' })
    await expect(ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '/topic ' }))
      .resolves.toEqual({ delivered: false, reason: 'invalid-command' })
  })

  it('settles a sessionless topic without a marker and rejects foreign topic ids', async () => {
    const { ctx, database, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const roster = { memberEmployeeIds: [support.id], dutyEmployeeIds: [support.id] }
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({ topicPolicy: 'command', ...roster }))
    const foreign = await ctx.surfaces.ensureChannelSurface(channelInput({
      externalKey: 'fe-c2', name: '别处频道', topicPolicy: 'command', ...roster,
    }))
    const threadSurface = await ctx.surfaces.ensureChannelSurface(channelInput({
      externalKey: 'fe-c3', name: '线程频道', ...roster,
    }))
    database.prepare(`INSERT INTO channel_topics(topic_id, surface_id, title, state, session_id, created_by, created_at, settled_at)
      VALUES ('topic-bare', ?, '无会话话题', 'open', NULL, 'user-1', ?, NULL)`).run(surface.id, Date.now())

    const openedForeign = routedOf(await ctx.surfaces.deliverToChannel(foreign, {
      originUserId: 'user-1', text: '/topic 别处', mentionedEmployeeIds: [support.id],
    }))

    await expect(ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '隔壁的话题', topicId: openedForeign.topicId,
    })).resolves.toEqual({ delivered: false, reason: 'no-topic' })
    // A thread channel never auto-resolves a foreign topic id either.
    await expect(ctx.surfaces.deliverToChannel(threadSurface, {
      originUserId: 'user-1', text: '外部话题', topicId: openedForeign.topicId,
    })).resolves.toEqual({ delivered: false, reason: 'no-topic' })
    await expect(ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '/done', topicId: 'topic-bare',
    })).resolves.toEqual({ delivered: true, mode: 'settled', topicId: 'topic-bare' })
    expect(topicRow(database, 'topic-bare')).toMatchObject({ state: 'settled', session_id: null })
  })

  it('settles without a marker when the topic session is gone or silent', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      topicPolicy: 'command', memberEmployeeIds: [support.id], dutyEmployeeIds: [support.id],
    }))

    const gone = routedOf(await ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '/topic 已丢失', mentionedEmployeeIds: [support.id],
    }))
    host.dropLive(gone.sessionId)
    await expect(ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '/done', topicId: gone.topicId,
    })).resolves.toEqual({ delivered: true, mode: 'settled', topicId: gone.topicId })

    const silent = routedOf(await ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '/topic 静默收尾', mentionedEmployeeIds: [support.id],
    }))
    host.silentSteer = true
    await expect(ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '/done', topicId: silent.topicId,
    })).resolves.toEqual({ delivered: true, mode: 'settled', topicId: silent.topicId })
    expect(topicRow(database, silent.topicId)).toMatchObject({ state: 'settled' })
  })

  it('propagates a duty employee that no longer resolves', async () => {
    const { ctx, database, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      memberEmployeeIds: [support.id], dutyEmployeeIds: [support.id],
    }))
    setDutyRoster(database, surface.id, ['employee-ghost'])

    await expect(ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '没人值班' }))
      .rejects.toMatchObject({ code: 'employee-missing' })
  })

  it('routes every lane message into the one surface-wide topic', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      topicPolicy: 'lane', name: '值班lane', memberEmployeeIds: [support.id], dutyEmployeeIds: [support.id],
    }))

    const first = await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '开闸' })
    const second = await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '/topic 另起' })

    const topicId = `${surface.id}:lane`
    expect(first).toMatchObject({ delivered: true, mode: 'routed', topicId })
    expect(second).toMatchObject({ delivered: true, mode: 'routed', topicId })
    expect(topicRow(database, topicId)).toMatchObject({ title: '值班lane', state: 'open' })
    expect(host.created).toHaveLength(1)
  })

  it('refuses routing into a settled topic and reports kind mismatches', async () => {
    const { ctx, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      memberEmployeeIds: [support.id], dutyEmployeeIds: [support.id],
    }))
    const dm = await ctx.surfaces.ensureDm({ orgId: 'org-1', userId: 'user-1', employeeId: support.id })

    const opened = routedOf(await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '第一条' }))
    await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '/done', topicId: opened.topicId })

    await expect(ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '晚了', topicId: opened.topicId,
    })).resolves.toEqual({ delivered: false, reason: 'already-settled' })
    await expect(ctx.surfaces.deliverToChannel(dm, { originUserId: 'user-1', text: '任何消息' }))
      .rejects.toMatchObject({
        code: 'surface-kind-mismatch',
        message: `enterprise surface ${dm.id} is a dm surface, not a channel surface`,
      })
  })
})

describe('deliverToChannel announcement intake', () => {
  it('proposes a truncated summary without touching a session', async () => {
    const { ctx, host, database, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      respondPolicy: 'ingest_only', memberEmployeeIds: [support.id], dutyEmployeeIds: [support.id],
    }))
    const memory = mountMemory(ctx)

    const result = await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: `公告：${'A'.repeat(600)}` })
    const command = await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '/topic 需求' })

    expect(result).toEqual({ delivered: true, mode: 'ingested', proposedMemoryId: 'memory-1' })
    expect(memory.proposed).toHaveLength(2)
    expect(memory.proposed[0]).toMatchObject({
      orgId: 'org-1', scope: 'organization', kind: 'business-fact', createdBy: 'user-1',
      summary: `公告：${'A'.repeat(497)}`,
    })
    expect(memory.proposed[0]?.summary).toHaveLength(500)
    expect(memory.proposed[0]?.sourceDigest).toMatch(/^[0-9a-f]{64}$/u)
    expect(command).toMatchObject({ delivered: true, mode: 'ingested' })
    expect(database.prepare('SELECT COUNT(*) AS count FROM channel_topics').get()).toEqual({ count: 0 })
    expect(host.created).toEqual([])
    expect(host.steered).toEqual([])
  })

  it('drops privacy-gated announcements without proposing them', async () => {
    const { ctx, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      respondPolicy: 'ingest_only', memberEmployeeIds: [support.id],
    }))
    const memory = mountMemory(ctx)

    const result = await ctx.surfaces.deliverToChannel(surface, {
      originUserId: 'user-1', text: '联系 alice@example.com 索取报告',
    })

    expect(result).toEqual({ delivered: false, reason: 'privacy-gated' })
    expect(memory.proposed).toEqual([])
  })

  it('reports memory-unavailable when the identity store is not mounted', async () => {
    const { ctx, host, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      respondPolicy: 'ingest_only', memberEmployeeIds: [support.id],
    }))

    const result = await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '公告' })

    expect(result).toEqual({ delivered: false, reason: 'memory-unavailable' })
    expect(host.created).toEqual([])
  })

  it('reports intake failures after the privacy gate allowed the announcement', async () => {
    const { ctx, accounts } = makeCtx()
    const support = createEmployee(accounts, 'support', 'Support')
    const surface = await ctx.surfaces.ensureChannelSurface(channelInput({
      respondPolicy: 'ingest_only', memberEmployeeIds: [support.id],
    }))
    mountMemory(ctx, { failPropose: true })

    const result = await ctx.surfaces.deliverToChannel(surface, { originUserId: 'user-1', text: '公告' })

    expect(result).toMatchObject({ delivered: false, reason: 'intake-failed' })
    if (!result.delivered && result.reason === 'intake-failed') expect(result.error).toContain('injected propose failure')
  })
})
