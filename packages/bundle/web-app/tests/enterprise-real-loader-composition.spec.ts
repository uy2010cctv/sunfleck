import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
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

async function loaderContext(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  ctx.provide('credentials', {
    resolve: () => Promise.resolve(undefined),
  } as unknown as CredentialProvider)
  ctx.provide('webRuntime', { trustedHosts: [] } as never)
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
      const ctx = await loaderContext()
      await ctx.loader.create({
        name: '@deepseek-ai/dsh-client-connection',
        inject: enterpriseConnectionInject(),
      })
      expect(ctx.get('connection')).toBeUndefined()

      const organizationId = 'loader-enterprise-composition'
      const authEntryId = await ctx.loader.create({
        name: '@deepseek-ai/dsh-enterprise-auth-web',
        config: {
          databaseMode: 'postgres',
          organizationId,
          organizationName: organizationId,
          sessionCookieName: 'dsh_enterprise_session',
          sessionTtlMs: 60_000,
          secureCookies: false,
          autoProvisionSsoUsers: true,
          localEnabled: false,
          oidc: [], saml: [], ldap: [],
        },
      })
      expect(ctx.get('enterpriseSecurity')).toBeUndefined()

      await ctx.loader.create({
        name: '@deepseek-ai/dsh-enterprise-postgres',
        config: { connectionString: databaseUrl },
      })
      await ctx.loader.await()

      expect(ctx.get('enterprisePostgres')).toBeDefined()
      expect(ctx.get('enterpriseSecurity')).toBeDefined()
      expect(ctx.get('enterpriseRequestContext')).toBeDefined()
      expect(ctx.get('connection')).toBeDefined()
      await expect(get(ctx, '/auth/status')).resolves.toMatchObject({ status: 200 })
      await expect(get(ctx, '/api/profile.read')).resolves.toMatchObject({ status: 401 })

      await ctx.loader.remove(authEntryId)
      await ctx.loader.await()
      expect(ctx.get('enterpriseSecurity')).toBeUndefined()
      await expect(ctx.enterprisePostgres.database.health()).resolves.toMatchObject({ ok: true })
    },
  )
})
