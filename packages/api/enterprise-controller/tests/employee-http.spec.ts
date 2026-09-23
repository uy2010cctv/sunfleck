import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { EmployeeAccountService } from '@deepseek-ai/dsh-employee-account'
import type { EmployeeAccount, EmployeeAccounts, EmployeeId } from '@deepseek-ai/dsh-employee-account'
import {
  EnterpriseIdentityRepository, memorySourceDigest, migrateEnterpriseIdentity,
} from '@deepseek-ai/dsh-enterprise-identity'
import type { EnterpriseMemoryEntry } from '@deepseek-ai/dsh-enterprise-identity'
import { authorizeEnterprise } from '@deepseek-ai/dsh-enterprise-governance'
import type {
  EnterpriseAction, EnterpriseAuthorizationDecision, EnterprisePrincipal, EnterpriseResource, EnterpriseRole,
} from '@deepseek-ai/dsh-enterprise-governance'
import { apply as applySurfaces } from '@deepseek-ai/dsh-enterprise-surface'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { EmployeeHttpHandler, inject } from '../src/employee-http.ts'
import type { EmployeeHttpSecurity } from '../src/employee-http.ts'

const PRESET = 'employee-preset'
const ACCOUNT_FIELDS = ['displayName', 'id', 'roleCard', 'state']

/** One session log double whose appends land synchronously like the real store. */
class FakeSession {
  readonly events: Array<{ type: string; data: unknown }> = []
  constructor(readonly id: string) {}
  ownEvents(): Array<{ type: string; data: unknown }> { return this.events }
  append(type: string, data: unknown): void { this.events.push({ type, data }) }
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
    // Mirror the real loop's consumption: the splice stores the pending input
    // and the opened turn appends the claimed message, so the log holds the
    // model-visible user message and its source.
    this.session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] })
    this.session.append('user/message', message)
  }
}

/** Minimal agent-host surface behind the ctx keys the surface registry injects. */
class FakeAgentHost {
  readonly steered: UserMessage[] = []
  /** Agents created through the mount, in creation order. */
  readonly created: FakeAgent[] = []
  silentSteer = false
  steerFailure: Error | undefined = undefined
  private readonly live = new Map<string, FakeAgent>()

  constructor(private readonly ctx: Context) {}

  mount(): void {
    const ctx = this.ctx
    ctx.provide('agents' as never, {
      create: async (options: {
        sessionId: string
        setup?: (agentCtx: Context) => Promise<void>
      }) => {
        const agent = new FakeAgent(options.sessionId, this)
        this.live.set(options.sessionId, agent)
        this.created.push(agent)
        await options.setup?.(ctx)
        return { agent, dispose: async () => { this.live.delete(options.sessionId) } }
      },
      get: (id: string) => this.live.get(id),
    } as never)
    ctx.provide('agentDefaultModel' as never, {
      currentSelection: () => ({ provider: 'mock', model: 'mock-model' }),
    } as never)
    ctx.provide('agentPresets' as never, {
      resolve: async () => ({ id: PRESET }),
      standingKeyFor: async () => 'standing-key',
      mount: async () => {},
    } as never)
    ctx.provide('sessionTitle' as never, { rename: () => {} } as never)
    ctx.provide('sessions' as never, { flush: async () => true } as never)
    ctx.provide('workspaceRegistry' as never, {
      create: async (path: string) => ({
        id: `workspace-${path}`, path, attachSession: async () => {}, detachSession: async () => {},
      }),
    } as never)
  }
}

/** Authentication and authorization seam double that delegates to the real shared policy. */
class RecordingSecurity implements EmployeeHttpSecurity {
  readonly audited: Array<{
    endpoint: string
    decision: EnterpriseAuthorizationDecision
    resource: { type: string; id: string }
  }> = []

  constructor(readonly principal: EnterprisePrincipal | undefined) {}

  async authenticateCookieAsync(cookieHeader: string): Promise<EnterprisePrincipal | undefined> {
    return this.principal === undefined || cookieHeader === '' ? undefined : this.principal
  }

  async authorizeResourceAsync(
    principal: EnterprisePrincipal,
    action: EnterpriseAction,
    resource?: EnterpriseResource,
  ): Promise<EnterpriseAuthorizationDecision> {
    return authorizeEnterprise({ principal, action, ...(resource === undefined ? {} : { resource }) })
  }

  async auditApiResourceAsync(
    _principal: EnterprisePrincipal,
    endpoint: string,
    _input: unknown,
    decision: EnterpriseAuthorizationDecision,
    _correlationId: string,
    resource: { type: string; id: string },
  ): Promise<void> {
    this.audited.push({ endpoint, decision, resource })
  }
}

interface Setup {
  readonly ctx: Context
  readonly host: FakeAgentHost
  readonly accounts: EmployeeAccounts
  readonly memories: EnterpriseIdentityRepository
  readonly database: DatabaseSync
}

/** Open one migrated identity database, mount the fake agent host, and apply the surface plugin. */
function makeEnv(): Setup {
  const ctx = new Context()
  const host = new FakeAgentHost(ctx)
  host.mount()
  const database = new DatabaseSync(':memory:')
  migrateEnterpriseIdentity(database)
  database.prepare('INSERT INTO organizations(id, name) VALUES (?, ?)').run('org-1', 'Existing enterprise')
  database.prepare('INSERT INTO organizations(id, name) VALUES (?, ?)').run('org-2', 'Other enterprise')
  database.prepare('INSERT INTO users(id, org_id, username, display_name, disabled) VALUES (?, ?, ?, ?, ?)')
    .run('user-1', 'org-1', 'alice', 'Alice', 0)
  database.prepare('INSERT INTO users(id, org_id, username, display_name, disabled) VALUES (?, ?, ?, ?, ?)')
    .run('user-2', 'org-1', 'bob', 'Bob', 0)
  const accounts = new EmployeeAccountService(database)
  ctx.provide('employeeAccounts' as never, accounts as never)
  applySurfaces(ctx, { database, defaultAgentPreset: PRESET })
  const memories = new EnterpriseIdentityRepository(':memory:', { now: () => 1_700_000_000_000 })
  memories.createOrganization({ id: 'org-1', name: 'Existing enterprise' })
  memories.createOrganization({ id: 'org-2', name: 'Other enterprise' })
  memories.createUser({ id: 'user-1', orgId: 'org-1', username: 'alice', displayName: 'Alice', disabled: false })
  memories.createUser({ id: 'user-2', orgId: 'org-1', username: 'bob', displayName: 'Bob', disabled: false })
  memories.createUser({ id: 'user-3', orgId: 'org-2', username: 'carol', displayName: 'Carol', disabled: false })
  return { ctx, host, accounts, memories, database }
}

/** Create one handler whose cookie authenticates as the given principal. */
function makeHandler(
  env: Setup,
  principal: EnterprisePrincipal | undefined = principalOf(),
): EmployeeHttpHandler {
  return new EmployeeHttpHandler(env.accounts, env.ctx.surfaces, env.memories, new RecordingSecurity(principal))
}

/** Create one authenticated principal for the tests. */
function principalOf(roles: EnterpriseRole[] = ['operator'], userId = 'user-1'): EnterprisePrincipal {
  return { orgId: 'org-1', userId, roles }
}

/** Send one request to the employee routes. */
async function call(
  handler: EmployeeHttpHandler,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  return handler.fetch(new Request(`http://dsh/enterprise/employees${path}`, {
    method,
    headers: {
      cookie: 'dsh_enterprise_session=ticket',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
}

/** Create one active employee account under one organization. */
function createEmployee(accounts: EmployeeAccounts, orgId = 'org-1', displayName = '支持助理'): EmployeeAccount {
  return accounts.create({
    orgId, displayName, roleCard: '客服助理', homeWorkspacePath: '/managed/employees/support',
  })
}

/** Propose one shared memory into one organization's promotion queue. */
function proposeShared(
  memories: EnterpriseIdentityRepository,
  orgId: string,
  userId: string,
  scope: 'organization' | 'department',
  summary: string,
): EnterpriseMemoryEntry {
  return memories.proposeMemory({
    id: `agent-memory-${memorySourceDigest(JSON.stringify([orgId, scope, null, 'business-fact', summary]))}`,
    orgId, scope, kind: 'business-fact', summary,
    sourceDigest: memorySourceDigest(JSON.stringify([orgId, scope, null, 'business-fact', summary])),
    createdBy: userId,
  })
}

/** Write one approved private memory into the employee's agent compartment. */
function writeAgentMemory(
  memories: EnterpriseIdentityRepository,
  employeeId: string,
  summary: string,
): EnterpriseMemoryEntry {
  return memories.writePrivateMemory({
    orgId: 'org-1', scope: 'agent', kind: 'process', summary, createdBy: 'user-1', agentEmployeeId: employeeId,
  })
}

describe('employee http endpoints', () => {
  it('declares the three composed keys it reads from the context', () => {
    expect(inject).toEqual(['employeeAccounts', 'surfaces', 'enterprisePostgres'])
  })

  it('rejects an unauthenticated request before authorizing or auditing', async () => {
    const env = makeEnv()
    const security = new RecordingSecurity(undefined)
    const handler = new EmployeeHttpHandler(env.accounts, env.ctx.surfaces, env.memories, security)

    const anonymous = await call(handler, 'GET', '')
    expect(anonymous.status).toBe(401)
    const cookieless = await handler.fetch(
      new Request('http://dsh/enterprise/employees', { method: 'GET' }),
    )
    expect(cookieless.status).toBe(401)
    expect(security.audited).toEqual([])
  })

  it('lists only the caller organization with the governance fields only', async () => {
    const env = makeEnv()
    const local = createEmployee(env.accounts)
    createEmployee(env.accounts, 'org-2', '外部员工')
    const handler = makeHandler(env)

    const response = await call(handler, 'GET', '')
    const body = await response.json() as Record<string, unknown>[]

    expect(response.status).toBe(200)
    expect(body).toHaveLength(1)
    expect(Object.keys(body[0] as Record<string, unknown>).sort()).toEqual(ACCOUNT_FIELDS)
    expect(body[0]).toMatchObject({
      id: local.id, displayName: '支持助理', roleCard: '客服助理', state: 'active',
    })
  })

  it('creates one employee and reads the same governance fields back', async () => {
    const env = makeEnv()
    const handler = makeHandler(env, principalOf(['creator']))

    const created = await call(handler, 'POST', '', {
      displayName: '报销助理', roleCard: '负责报销审核', homeWorkspacePath: '/managed/employees/finance',
      activeReleaseId: 'release-1',
    })
    const createdBody = await created.json() as Record<string, unknown>
    expect(created.status).toBe(201)
    expect(Object.keys(createdBody).sort()).toEqual(ACCOUNT_FIELDS)
    expect(createdBody).toMatchObject({ displayName: '报销助理', roleCard: '负责报销审核', state: 'active' })

    const read = await call(handler, 'GET', `/${String(createdBody['id'])}`)
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual(createdBody)
  })

  it('rejects an invalid create body and an unauthorized creator role', async () => {
    const env = makeEnv()
    const handler = makeHandler(env, principalOf(['creator']))

    const missingPath = await call(handler, 'POST', '', { displayName: 'x', roleCard: 'y' })
    expect(missingPath.status).toBe(400)
    const relativePath = await call(handler, 'POST', '', {
      displayName: 'x', roleCard: 'y', homeWorkspacePath: 'employees/relative',
    })
    expect(relativePath.status).toBe(400)

    const withoutRelease = await call(handler, 'POST', '', {
      displayName: '值班助理', roleCard: '负责值班答疑', homeWorkspacePath: '/managed/employees/duty',
    })
    expect(withoutRelease.status).toBe(201)
    expect(Object.keys(await withoutRelease.json() as Record<string, unknown>).sort()).toEqual(ACCOUNT_FIELDS)

    const malformed = await handler.fetch(new Request('http://dsh/enterprise/employees', {
      method: 'POST', headers: { cookie: 'dsh_enterprise_session=ticket' }, body: 'not-json',
    }))
    expect(malformed.status).toBe(400)

    const forbidden = await call(makeHandler(env), 'POST', '', {
      displayName: 'x', roleCard: 'y', homeWorkspacePath: '/managed/employees/x',
    })
    expect(forbidden.status).toBe(403)
  })

  it('denies reads without a role and delivery for the auditor role', async () => {
    const env = makeEnv()
    const employee = createEmployee(env.accounts)

    const reader = makeHandler(env, principalOf([]))
    expect((await call(reader, 'GET', '')).status).toBe(403)
    expect((await call(reader, 'GET', `/${employee.id}`)).status).toBe(403)
    expect((await call(reader, 'GET', '/sticky')).status).toBe(403)

    const auditor = makeHandler(env, principalOf(['auditor']))
    const denied = await call(auditor, 'POST', `/${employee.id}/messages`, { text: '你好' })
    expect(denied.status).toBe(403)
    expect(env.host.steered).toEqual([])
  })

  it('delivers one message, binds the sticky employee, and resolves sticky afterwards', async () => {
    const env = makeEnv()
    const employee = createEmployee(env.accounts)
    const handler = makeHandler(env)

    const response = await call(handler, 'POST', `/${employee.id}/messages`, { text: '你好' })
    const body = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body['employeeId']).toBe(employee.id)
    expect(typeof body['inboxItemId']).toBe('string')
    const steered = env.host.steered[0]
    expect(steered?.source).toMatchObject({ kind: 'surface-message', originActor: 'user-1' })
    expect(steered?.content).toEqual([{ type: 'text', text: '你好' }])
    const inbox = env.database
      .prepare('SELECT state FROM employee_inbox WHERE employee_id = ?').get(employee.id) as { state: string }
    expect(inbox.state).toBe('delivered')
    expect(env.accounts.resolveSticky('org-1', 'user-1')).toBe(employee.id)

    const sticky = await call(handler, 'GET', '/sticky')
    expect(sticky.status).toBe(200)
    expect(await sticky.json()).toMatchObject({ id: employee.id })
  })

  it('replays the delivered message and its provenance from the anchored session log', async () => {
    const env = makeEnv()
    const handler = makeHandler(env, principalOf(['creator']))

    const created = await call(handler, 'POST', '', {
      displayName: '报销助理', roleCard: '负责报销审核', homeWorkspacePath: '/managed/employees/finance',
      activeReleaseId: 'release-1',
    })
    const employee = await created.json() as Record<string, unknown>
    expect(created.status).toBe(201)

    const delivery = await call(handler, 'POST', `/${String(employee['id'])}/messages`, { text: '帮我核对报销' })
    expect(delivery.status).toBe(200)
    const delivered = await delivery.json() as { employeeId: string; inboxItemId: string }

    const agent = env.host.created[0]
    const surfaceRow = env.database
      .prepare('SELECT id, session_id FROM surfaces WHERE employee_id = ?')
      .get(delivered.employeeId) as { id: string; session_id: string }
    expect(agent?.session.id).toBe(surfaceRow.session_id)
    const userMessages = agent?.session.ownEvents().filter(event => event.type === 'user/message') ?? []
    expect(userMessages).toHaveLength(1)
    const message = userMessages[0]?.data as UserMessage | undefined
    expect(message?.content).toEqual([{ type: 'text', text: '帮我核对报销' }])
    expect(message?.source).toEqual({
      kind: 'surface-message',
      surfaceId: surfaceRow.id,
      inboxItemId: delivered.inboxItemId,
      originActor: 'user-1',
    })

    const inboxRow = env.database
      .prepare('SELECT state, origin_actor, payload_text FROM employee_inbox WHERE id = ?')
      .get(delivered.inboxItemId) as { state: string; origin_actor: string; payload_text: string }
    expect(inboxRow.state).toBe('delivered')
    expect(inboxRow.origin_actor).toBe('user-1')
    expect(inboxRow.payload_text).toBe('帮我核对报销')

    const sticky = await call(handler, 'GET', '/sticky')
    expect(sticky.status).toBe(200)
    expect(await sticky.json()).toMatchObject({ id: employee['id'] })
  })

  it('refuses sticky resolution while the actor key is unbound', async () => {
    const env = makeEnv()
    const handler = makeHandler(env, principalOf(['operator'], 'user-2'))

    const response = await call(handler, 'GET', '/sticky')

    expect(response.status).toBe(404)
  })

  it('refuses messaging a suspended or archived employee without binding sticky', async () => {
    const env = makeEnv()
    const suspended = createEmployee(env.accounts)
    env.accounts.setState(suspended.id, 'suspended')
    const archived = createEmployee(env.accounts, 'org-1', '归档员工')
    env.accounts.setState(archived.id, 'archived')
    const handler = makeHandler(env)

    const suspendedResponse = await call(handler, 'POST', `/${suspended.id}/messages`, { text: '你好' })
    expect(suspendedResponse.status).toBe(409)
    const archivedResponse = await call(handler, 'POST', `/${archived.id}/messages`, { text: '你好' })
    expect(archivedResponse.status).toBe(409)
    expect(env.accounts.resolveSticky('org-1', 'user-1')).toBeUndefined()
    expect(env.host.steered).toEqual([])
  })

  it('rejects an empty or missing message text and unreadable bodies', async () => {
    const env = makeEnv()
    const employee = createEmployee(env.accounts)
    const handler = makeHandler(env)

    const blank = await call(handler, 'POST', `/${employee.id}/messages`, { text: '   ' })
    expect(blank.status).toBe(400)
    const missing = await call(handler, 'POST', `/${employee.id}/messages`, {})
    expect(missing.status).toBe(400)
    const malformed = await handler.fetch(new Request(`http://dsh/enterprise/employees/${employee.id}/messages`, {
      method: 'POST', headers: { cookie: 'dsh_enterprise_session=ticket' }, body: 'not-json',
    }))
    expect(malformed.status).toBe(400)
    const nonObject = await call(handler, 'POST', `/${employee.id}/messages`, ['text'])
    expect(nonObject.status).toBe(400)
    expect(env.host.steered).toEqual([])
  })

  it('hides missing and cross-organization employees behind 404 on detail and messages', async () => {
    const env = makeEnv()
    const foreign = createEmployee(env.accounts, 'org-2', '外部员工')
    const handler = makeHandler(env)

    for (const employee of [foreign, { id: 'employee-missing' as EmployeeId }]) {
      const detail = await call(handler, 'GET', `/${employee.id}`)
      expect(detail.status).toBe(404)
      const message = await call(handler, 'POST', `/${employee.id}/messages`, { text: '你好' })
      expect(message.status).toBe(404)
    }
    expect(env.host.steered).toEqual([])
  })

  it('maps surface delivery failures to 502 and foreign failures to 500', async () => {
    const env = makeEnv()
    const employee = createEmployee(env.accounts)
    const handler = makeHandler(env)

    env.host.silentSteer = true
    const unlanded = await call(handler, 'POST', `/${employee.id}/messages`, { text: '你好' })
    expect(unlanded.status).toBe(502)
    expect(env.accounts.resolveSticky('org-1', 'user-1')).toBeUndefined()

    env.host.silentSteer = false
    env.host.steerFailure = new Error('injected steer failure')
    const foreign = await call(handler, 'POST', `/${employee.id}/messages`, { text: '你好' })
    expect(foreign.status).toBe(500)
    expect(env.accounts.resolveSticky('org-1', 'user-1')).toBeUndefined()
    env.host.steerFailure = undefined

    const retry = await call(handler, 'POST', `/${employee.id}/messages`, { text: '你好' })
    expect(retry.status).toBe(200)
    expect(env.accounts.resolveSticky('org-1', 'user-1')).toBe(employee.id)
  })

  it('answers wrong methods with 405 and unknown paths with 404', async () => {
    const env = makeEnv()
    const employee = createEmployee(env.accounts)
    const handler = makeHandler(env)

    expect((await call(handler, 'PUT', '')).status).toBe(405)
    expect((await call(handler, 'POST', '/sticky')).status).toBe(405)
    expect((await call(handler, 'DELETE', `/${employee.id}`)).status).toBe(405)
    expect((await call(handler, 'GET', `/${employee.id}/messages`)).status).toBe(405)
    expect((await call(handler, 'GET', `/${employee.id}/unknown`)).status).toBe(404)
    expect((await call(handler, 'PUT', `/${employee.id}/memories`)).status).toBe(405)
    expect((await call(handler, 'GET', `/${employee.id}/memories/mem-1/review`)).status).toBe(405)
  })
})

describe('employee memory governance endpoints', () => {
  it('lists agent rows plus the shared promotion queue with governance fields only', async () => {
    const env = makeEnv()
    const employee = createEmployee(env.accounts)
    const agentRow = writeAgentMemory(env.memories, employee.id, '客户按周索取报价摘要')
    const proposed = proposeShared(env.memories, 'org-1', 'user-1', 'organization', '供应商报价需双人复核')
    // An approved shared row has left the promotion queue and stays out of the view.
    const approved = proposeShared(env.memories, 'org-1', 'user-1', 'organization', '报销流程已归档')
    env.memories.reviewMemory({
      id: approved.id, orgId: 'org-1', decision: 'approved', reviewedBy: 'user-1',
      reason: '确认', expectedRevision: 1,
    })
    // A foreign organization's agent row never leaks into the view.
    env.memories.writePrivateMemory({
      orgId: 'org-2', scope: 'agent', kind: 'process', summary: '外部组织私有记忆',
      createdBy: 'user-3', agentEmployeeId: 'employee-foreign',
    })
    const handler = makeHandler(env)

    const response = await call(handler, 'GET', `/${employee.id}/memories`)
    expect(response.status).toBe(200)
    const body = await response.json() as Array<Record<string, unknown>>

    expect(body.map(entry => entry['id'])).toEqual([proposed.id, agentRow.id])
    for (const entry of body) {
      expect(Object.keys(entry).sort()).toEqual(
        ['createdAt', 'id', 'kind', 'revision', 'scope', 'status', 'summary'],
      )
    }
    expect(body[0]).toMatchObject({ scope: 'organization', status: 'proposed', revision: 1 })
    expect(body[1]).toMatchObject({ scope: 'agent', status: 'approved' })
    expect(JSON.stringify(body)).not.toContain('privacyFindings')
    expect(JSON.stringify(body)).not.toContain('sourceDigest')
  })

  it('filters the memory view by status and rejects unknown statuses', async () => {
    const env = makeEnv()
    const employee = createEmployee(env.accounts)
    const agentRow = writeAgentMemory(env.memories, employee.id, '客户按周索取报价摘要')
    const proposed = proposeShared(env.memories, 'org-1', 'user-1', 'organization', '供应商报价需双人复核')
    const handler = makeHandler(env)

    const proposedOnly = await call(handler, 'GET', `/${employee.id}/memories?status=proposed`)
    expect((await proposedOnly.json() as Record<string, unknown>[]).map(entry => entry['id']))
      .toEqual([proposed.id])
    const approvedOnly = await call(handler, 'GET', `/${employee.id}/memories?status=approved`)
    expect((await approvedOnly.json() as Record<string, unknown>[]).map(entry => entry['id']))
      .toEqual([agentRow.id])
    const rejected = await call(handler, 'GET', `/${employee.id}/memories?status=rejected`)
    expect(await rejected.json()).toEqual([])
    expect((await call(handler, 'GET', `/${employee.id}/memories?status=latest`)).status).toBe(400)
  })

  it('folds missing and cross-organization employees into 404 and denies role-less callers', async () => {
    const env = makeEnv()
    const foreign = createEmployee(env.accounts, 'org-2', '外部员工')
    const handler = makeHandler(env, principalOf(['administrator']))

    for (const employee of [foreign, { id: 'employee-missing' as EmployeeId }]) {
      expect((await call(handler, 'GET', `/${employee.id}/memories`)).status).toBe(404)
      const review = await call(handler, 'POST', `/${employee.id}/memories/mem-1/review`, {
        decision: 'approved', reason: '确认', revision: 1,
      })
      expect(review.status).toBe(404)
      expect((await call(handler, 'POST', `/${employee.id}/memories/mem-1/retire`)).status).toBe(404)
    }
    const own = createEmployee(env.accounts)
    expect((await call(makeHandler(env, principalOf([])), 'GET', `/${own.id}/memories`)).status).toBe(403)
    expect((await call(makeHandler(env, principalOf([])), 'POST', `/${own.id}/memories/mem-1/review`, {
      decision: 'approved', reason: '确认', revision: 1,
    })).status).toBe(403)
  })

  it('requires authentication on every memory route', async () => {
    const env = makeEnv()
    const employee = createEmployee(env.accounts)
    const security = new RecordingSecurity(undefined)
    const handler = new EmployeeHttpHandler(env.accounts, env.ctx.surfaces, env.memories, security)

    expect((await call(handler, 'GET', `/${employee.id}/memories`)).status).toBe(401)
    expect((await call(handler, 'POST', `/${employee.id}/memories/mem-1/review`, {
      decision: 'approved', reason: '确认', revision: 1,
    })).status).toBe(401)
    expect((await call(handler, 'POST', `/${employee.id}/memories/mem-1/retire`)).status).toBe(401)
    expect(security.audited).toEqual([])
  })

  it('approves one shared proposal with the caller-pinned revision', async () => {
    const env = makeEnv()
    const employee = createEmployee(env.accounts)
    const proposed = proposeShared(env.memories, 'org-1', 'user-1', 'organization', '供应商报价需双人复核')
    const handler = makeHandler(env, principalOf(['administrator']))

    const response = await call(handler, 'POST', `/${employee.id}/memories/${proposed.id}/review`, {
      decision: 'approved', reason: '确认无误', revision: 1,
    })
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(
      ['createdAt', 'id', 'kind', 'reviewedBy', 'revision', 'scope', 'status', 'summary'],
    )
    expect(body).toMatchObject({ id: proposed.id, status: 'approved', revision: 2, reviewedBy: 'user-1' })
  })

  it('rejects review with stale revisions, illegal transitions, missing memories, or invalid bodies', async () => {
    const env = makeEnv()
    const employee = createEmployee(env.accounts)
    const proposed = proposeShared(env.memories, 'org-1', 'user-1', 'organization', '供应商报价需双人复核')
    const foreignProposed = proposeShared(env.memories, 'org-2', 'user-3', 'organization', '外部组织提案')
    const handler = makeHandler(env, principalOf(['administrator']))
    const review = (memoryId: string, body: unknown): Promise<Response> =>
      call(handler, 'POST', `/${employee.id}/memories/${memoryId}/review`, body)

    expect((await review(proposed.id, { decision: 'approved', reason: '确认', revision: 99 })).status).toBe(409)
    await review(proposed.id, { decision: 'approved', reason: '确认', revision: 1 })
    expect((await review(proposed.id, { decision: 'rejected', reason: '反悔', revision: 2 })).status).toBe(409)
    expect((await review('mem-missing', { decision: 'approved', reason: '确认', revision: 1 })).status).toBe(404)
    expect((await review(foreignProposed.id, { decision: 'approved', reason: '确认', revision: 1 })).status).toBe(404)
    expect((await review(proposed.id, { decision: 'retired', reason: '确认', revision: 2 })).status).toBe(400)
    expect((await review(proposed.id, { decision: 'approved', revision: 2 })).status).toBe(400)
    expect((await review(proposed.id, { decision: 'approved', reason: '确认', revision: '2' })).status).toBe(400)
    const malformed = await handler.fetch(
      new Request(`http://dsh/enterprise/employees/${employee.id}/memories/mem-1/review`, {
        method: 'POST', headers: { cookie: 'dsh_enterprise_session=ticket' }, body: 'not-json',
      }),
    )
    expect(malformed.status).toBe(400)
    // Operators hold memory.read but not memory.manage.
    expect((await call(makeHandler(env), 'POST', `/${employee.id}/memories/${proposed.id}/review`, {
      decision: 'rejected', reason: '拒绝', revision: 2,
    })).status).toBe(403)
  })

  it('retires one approved memory with and without a revision pin', async () => {
    const env = makeEnv()
    const employee = createEmployee(env.accounts)
    const pinned = writeAgentMemory(env.memories, employee.id, '客户按周索取报价摘要')
    const unpinned = writeAgentMemory(env.memories, employee.id, '客户偏好中文回复')
    const shared = proposeShared(env.memories, 'org-1', 'user-1', 'organization', '供应商报价需双人复核')
    env.memories.reviewMemory({
      id: shared.id, orgId: 'org-1', decision: 'approved', reviewedBy: 'user-1',
      reason: '确认', expectedRevision: 1,
    })
    const handler = makeHandler(env, principalOf(['administrator']))

    const withPin = await call(handler, 'POST', `/${employee.id}/memories/${pinned.id}/retire`, { revision: 1 })
    expect(withPin.status).toBe(200)
    expect(await withPin.json()).toMatchObject({ id: pinned.id, status: 'retired', revision: 2 })

    const withoutPin = await call(handler, 'POST', `/${employee.id}/memories/${unpinned.id}/retire`)
    expect(withoutPin.status).toBe(200)
    expect(await withoutPin.json()).toMatchObject({ id: unpinned.id, status: 'retired', revision: 2 })

    const sharedRetired = await call(handler, 'POST', `/${employee.id}/memories/${shared.id}/retire`)
    expect(sharedRetired.status).toBe(200)
    expect(await sharedRetired.json()).toMatchObject({ id: shared.id, status: 'retired' })
  })

  it('rejects retire for proposed, stale, missing, or cross-organization memories', async () => {
    const env = makeEnv()
    const employee = createEmployee(env.accounts)
    const proposed = proposeShared(env.memories, 'org-1', 'user-1', 'organization', '供应商报价需双人复核')
    const approved = writeAgentMemory(env.memories, employee.id, '客户按周索取报价摘要')
    const foreignProposed = proposeShared(env.memories, 'org-2', 'user-3', 'organization', '外部组织提案')
    const handler = makeHandler(env, principalOf(['administrator']))

    expect((await call(handler, 'POST', `/${employee.id}/memories/${proposed.id}/retire`, {
      revision: 1,
    })).status).toBe(409)
    expect((await call(handler, 'POST', `/${employee.id}/memories/${approved.id}/retire`, {
      revision: 5,
    })).status).toBe(409)
    expect((await call(handler, 'POST', `/${employee.id}/memories/mem-missing/retire`)).status).toBe(404)
    expect((await call(handler, 'POST', `/${employee.id}/memories/${foreignProposed.id}/retire`, {
      revision: 1,
    })).status).toBe(404)
    expect((await call(handler, 'POST', `/${employee.id}/memories/${approved.id}/retire`, {
      revision: '1',
    })).status).toBe(400)
    expect((await call(makeHandler(env), 'POST', `/${employee.id}/memories/${approved.id}/retire`, {
      revision: 1,
    })).status).toBe(403)
  })
})
