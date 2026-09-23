import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import { EmployeeAccountService } from '@deepseek-ai/dsh-employee-account'
import type { EmployeeAccount, EmployeeAccounts, EmployeeId } from '@deepseek-ai/dsh-employee-account'
import { migrateEnterpriseIdentity } from '@deepseek-ai/dsh-enterprise-identity'
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
    this.session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] })
  }
}

/** Minimal agent-host surface behind the ctx keys the surface registry injects. */
class FakeAgentHost {
  readonly steered: UserMessage[] = []
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
  return { ctx, host, accounts, database }
}

/** Create one handler whose cookie authenticates as the given principal. */
function makeHandler(
  env: Setup,
  principal: EnterprisePrincipal | undefined = principalOf(),
): EmployeeHttpHandler {
  return new EmployeeHttpHandler(env.accounts, env.ctx.surfaces, new RecordingSecurity(principal))
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

describe('employee http endpoints', () => {
  it('declares the two composed surface keys it reads from the context', () => {
    expect(inject).toEqual(['employeeAccounts', 'surfaces'])
  })

  it('rejects an unauthenticated request before authorizing or auditing', async () => {
    const env = makeEnv()
    const security = new RecordingSecurity(undefined)
    const handler = new EmployeeHttpHandler(env.accounts, env.ctx.surfaces, security)

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
  })
})
