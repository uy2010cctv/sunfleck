import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { load } from 'js-yaml'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import HttpServer from '@deepseek-ai/dsh-host-webserver'
import * as EnterprisePostgres from '@deepseek-ai/dsh-enterprise-postgres'
import * as EnterpriseAuth from '@deepseek-ai/dsh-enterprise-auth-web'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

const ENTERPRISE_OVERLAY = fileURLToPath(new URL('../../../../apps/cli/config/enterprise.cordis.patch.yml', import.meta.url))
const databaseUrl = process.env.DSH_TEST_POSTGRES_URL
const contexts: Context[] = []

interface PatchRow {
  id?: string
  inject?: string[]
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

async function loaderContext(bootstrapPassword?: string): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('credentials', {
    resolve: () => Promise.resolve(bootstrapPassword === undefined
      ? undefined
      : { value: bootstrapPassword, source: 'test' }),
  } as unknown as CredentialProvider)
  ctx.provide('webRuntime', { trustedHosts: [] } as never)
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  ctx.provide('workspaceRegistry', {
    list: () => [], archivedSessionIds: [], get: () => undefined,
  } as never)
  ctx.provide('apiProxy', createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp',
  }))
  await ctx.plugin(Loader)
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', HttpServer],
    ['@deepseek-ai/dsh-enterprise-postgres', EnterprisePostgres],
    ['@deepseek-ai/dsh-enterprise-auth-web', EnterpriseAuth],
    ['@deepseek-ai/dsh-client-connection', Connection],
  ])
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      const module = modules.get(specifier)
      if (module === undefined) throw new Error(`unexpected Loader import: ${specifier}`)
      return module
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({
    name: '@deepseek-ai/dsh-host-webserver',
    config: { host: '127.0.0.1', port: 0 },
  })
  await ctx.loader.await()
  return ctx
}

function enterpriseConnectionInject(): string[] {
  const rows = load(readFileSync(ENTERPRISE_OVERLAY, 'utf8'), { schema: entryListSchema }) as PatchRow[]
  const inject = rows.find(row => row.id === 'connection')?.inject
  if (inject === undefined) throw new Error('enterprise overlay does not patch Connection injection')
  return inject
}

async function get(ctx: Context, path: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${String(ctx.webServer.port)}${path}`)
}

async function post(ctx: Context, path: string, body: unknown, cookie?: string): Promise<Response> {
  const origin = `http://127.0.0.1:${String(ctx.webServer.port)}`
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', origin,
      ...(cookie === undefined ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  })
}

function rpc(method: string, payload: unknown): unknown {
  return { type: 'client-request', rpcId: randomUUID(), method, payload }
}

describe('real enterprise Loader composition', () => {
  it('starts the ordinary Web transport without enterprise security', async () => {
    const ctx = await loaderContext()
    await ctx.loader.create({ name: '@deepseek-ai/dsh-client-connection' })
    await ctx.loader.await()

    expect(ctx.get('connection')).toBeDefined()
    expect(ctx.get('enterpriseSecurity')).toBeUndefined()
    expect(ctx.get('enterpriseRequestContext')).toBeUndefined()
    await expect(get(ctx, '/api/profile.read')).resolves.toMatchObject({ status: 404 })
  })

  it.skipIf(databaseUrl === undefined)(
    'loads real Postgres, auth, and Connection packages through the enterprise overlay dependency',
    { timeout: 60_000 },
    async () => {
      const password = 'enterprise-loader-password'
      const ctx = await loaderContext(password)
      await ctx.loader.create({
        name: '@deepseek-ai/dsh-client-connection',
        inject: enterpriseConnectionInject(),
      })
      expect(ctx.get('connection')).toBeUndefined()

      const suffix = randomUUID()
      const organizationId = `loader-enterprise-${suffix}`
      const adminId = `loader-admin-${suffix}`
      const authConfig = {
        databaseMode: 'postgres' as const,
        organizationId,
        organizationName: organizationId,
        sessionCookieName: 'dsh_enterprise_session',
        sessionTtlMs: 60_000,
        secureCookies: false,
        autoProvisionSsoUsers: true,
        localEnabled: true,
        bootstrapAdmin: {
          userId: adminId, username: 'admin', displayName: 'Admin', passwordRef: 'LOADER_ADMIN_PASSWORD',
        },
        oidc: [], saml: [], ldap: [],
      }
      const authEntryId = await ctx.loader.create({
        name: '@deepseek-ai/dsh-enterprise-auth-web',
        config: authConfig,
      })
      expect(ctx.get('enterpriseSecurity')).toBeUndefined()

      await ctx.loader.create({
        name: '@deepseek-ai/dsh-enterprise-postgres',
        config: {
          connectionString: databaseUrl,
          cursorSigningKey: 'loader-test-cursor-key-0123456789abcdef',
        },
      })
      await ctx.loader.await()

      expect(ctx.get('enterprisePostgres')).toBeDefined()
      expect(ctx.get('enterpriseSecurity')).toBeDefined()
      expect(ctx.get('enterpriseRequestContext')).toBeDefined()
      expect(ctx.get('connection')).toBeDefined()
      await expect(get(ctx, '/auth/status')).resolves.toMatchObject({ status: 200 })
      await expect(post(ctx, '/api/enterpriseEmployee.list', rpc('enterpriseEmployee.list', {})))
        .resolves.toMatchObject({ status: 401 })

      const login = await post(ctx, '/auth/login/local', {
        organizationId, username: 'admin', password,
      })
      expect(login.status).toBe(200)
      const cookie = login.headers.get('set-cookie')?.split(';')[0]
      if (cookie === undefined) throw new Error('enterprise login did not return a session cookie')
      const presetId = `loader-preset-${suffix}`
      const saved = await post(ctx, '/api/enterpriseEmployee.saveDraft', rpc('enterpriseEmployee.saveDraft', {
        presetId, expectedRevision: 0, idempotencyKey: `loader-save-${suffix}`,
        visibility: 'private', profile: {}, bindings: [],
      }), cookie)
      expect(saved.status).toBe(200)
      await expect(saved.json()).resolves.toMatchObject({
        result: { ok: true, value: { presetId, ownerUserId: adminId, orgId: organizationId } },
      })
      await expect(post(ctx, '/api/enterpriseEmployee.list', rpc('enterpriseEmployee.list', {
        principal: { userId: 'forged', orgId: 'forged', roles: ['administrator'] },
      }), cookie)).resolves.toMatchObject({ status: 400 })

      const memberId = `loader-member-${suffix}`
      await ctx.enterprisePostgres.identity.createUser({
        id: memberId, orgId: organizationId, username: 'member', displayName: 'Member', disabled: false,
      })
      await ctx.enterprisePostgres.identity.setRoles(memberId, ['member'])
      const memberSession = await ctx.enterpriseSecurity.issueSessionAsync(memberId)
      const memberCookie = memberSession.cookie.split(';')[0]
      await expect(post(ctx, '/api/enterpriseEmployee.saveDraft', rpc('enterpriseEmployee.saveDraft', {
        presetId: `denied-${suffix}`, expectedRevision: 0, idempotencyKey: `denied-${suffix}`,
        visibility: 'private', profile: {}, bindings: [],
      }), memberCookie)).resolves.toMatchObject({ status: 403 })
      const memberList = await post(
        ctx, '/api/enterpriseEmployee.list', rpc('enterpriseEmployee.list', {}), memberCookie,
      )
      await expect(memberList.json()).resolves.toMatchObject({ result: { ok: true, value: { items: [] } } })

      const oldRequestContext = ctx.enterpriseRequestContext
      await ctx.loader.remove(authEntryId)
      await ctx.loader.await()
      expect(ctx.get('enterpriseSecurity')).toBeUndefined()
      expect(oldRequestContext.current()).toBeUndefined()
      await expect(ctx.enterprisePostgres.database.health()).resolves.toMatchObject({ ok: true })
      await ctx.loader.create({ name: '@deepseek-ai/dsh-enterprise-auth-web', config: authConfig })
      await ctx.loader.await()
      expect(ctx.enterpriseRequestContext).not.toBe(oldRequestContext)
      const afterReload = await post(
        ctx, '/api/enterpriseEmployee.list', rpc('enterpriseEmployee.list', {}), cookie,
      )
      expect(afterReload.status).toBe(200)
    },
  )
})
