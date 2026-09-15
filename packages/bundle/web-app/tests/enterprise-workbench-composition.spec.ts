import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const ENTERPRISE_OVERLAY = fileURLToPath(new URL('../../../../apps/cli/config/enterprise.cordis.patch.yml', import.meta.url))

interface PatchRow {
  id?: string
  name?: string
  inject?: string[]
  config?: Record<string, unknown>
  insert?: PatchRow[]
}

function readEnterpriseOverlay(): PatchRow[] {
  return load(readFileSync(ENTERPRISE_OVERLAY, 'utf8'), { schema: entryListSchema }) as PatchRow[]
}

describe('enterprise workbench Web composition', () => {
  it('mounts the enterprise browser plugin', () => {
    const rows = load(
      readFileSync(`${PACKAGE_ROOT}/cordis.patch.yml`, 'utf8'),
      { schema: entryListSchema },
    ) as PatchRow[]
    const inserted = rows.flatMap(row => row.insert ?? [])
    expect(inserted).toContainEqual({
      id: 'ui-enterprise-workbench',
      name: '@deepseek-ai/dsh-client-ui-enterprise-workbench',
    })
  })

  it('declares the enterprise plugin in the published bundle closure', () => {
    const manifest = JSON.parse(readFileSync(`${PACKAGE_ROOT}/package.json`, 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.['@deepseek-ai/dsh-client-ui-enterprise-workbench'])
      .toBe('workspace:^')
    expect(manifest.dependencies?.['@deepseek-ai/dsh-session-persistence-postgres'])
      .toBe('workspace:^')
    expect(manifest.dependencies?.['@deepseek-ai/dsh-enterprise-identity-postgres'])
      .toBe('workspace:^')
    expect(manifest.dependencies?.['@deepseek-ai/dsh-enterprise-catalog'])
      .toBe('workspace:^')
  })

  it('ships an opt-in enterprise security overlay with encrypted credentials, auth, and governance UI', () => {
    const rows = readEnterpriseOverlay()
    expect(rows).toContainEqual(expect.objectContaining({
      id: 'credentials', name: '@deepseek-ai/dsh-credentials-encrypted',
    }))
    const inserted = rows.flatMap(row => row.insert ?? [])
    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'enterprise-auth-web', name: '@deepseek-ai/dsh-enterprise-auth-web' }),
      { id: 'ui-enterprise-governance', name: '@deepseek-ai/dsh-client-ui-enterprise-governance' },
    ]))
  })

  it('gives completed-turn memory extraction enough output budget for bounded candidates', () => {
    const inserted = readEnterpriseOverlay().flatMap(row => row.insert ?? [])
    expect(inserted.find(row => row.id === 'enterprise-memory-context')?.config?.writebackMaxTokens)
      .toBe(4_096)
  })

  it('orders private Agent Teams Host, Client, and runtime rows before the enterprise controller', () => {
    const rows = readEnterpriseOverlay()
    const inserted = rows.flatMap(row => row.insert ?? [])
    const ids = inserted.map(row => row.id)
    expect(ids).toEqual(expect.arrayContaining([
      'agent-team', 'tool-agent-team', 'ui-agent-team', 'enterprise-team-runtime', 'enterprise-controller',
    ]))
    expect(ids.indexOf('agent-team')).toBeLessThan(ids.indexOf('tool-agent-team'))
    expect(ids.indexOf('tool-agent-team')).toBeLessThan(ids.indexOf('enterprise-team-runtime'))
    expect(ids.indexOf('ui-agent-team')).toBeLessThan(ids.indexOf('enterprise-controller'))
    expect(ids.indexOf('enterprise-team-runtime')).toBeLessThan(ids.indexOf('enterprise-controller'))
    expect(inserted.find(row => row.id === 'enterprise-team-runtime')).toMatchObject({
      name: '@deepseek-ai/dsh-experimental-enterprise-team-runtime',
    })
    const ordinaryRows = load(
      readFileSync(`${PACKAGE_ROOT}/cordis.patch.yml`, 'utf8'),
      { schema: entryListSchema },
    ) as PatchRow[]
    expect(ordinaryRows.flatMap(row => row.insert ?? []).map(row => row.id)).not.toContain('enterprise-team-runtime')
  })

  it('makes enterprise Postgres and auth visible before Loader activates connection', async () => {
    const rows = readEnterpriseOverlay()
    const connection = rows.find(row => row.id === 'connection')
    const connectionInject = connection?.inject
    expect(connectionInject).toEqual([
      'webRuntime', 'enterpriseSecurity', 'enterpriseRequestContext',
    ])
    if (connectionInject === undefined) throw new Error('enterprise connection injection is missing')
    const ordinaryRows = load(
      readFileSync(`${PACKAGE_ROOT}/cordis.patch.yml`, 'utf8'),
      { schema: entryListSchema },
    ) as PatchRow[]
    const ordinaryConnection = ordinaryRows.flatMap(row => row.insert ?? [])
      .find(row => row.id === 'connection')
    expect(ordinaryConnection?.inject).toEqual(['webRuntime'])

    const order: string[] = []
    const ctx = new Context()
    await ctx.plugin(Loader)
    ctx.provide('webRuntime', {} as never)
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (specifier === '@test/connection') return {
          apply(connectionCtx: Context) {
            expect(connectionCtx.get('enterpriseSecurity')).toBeDefined()
            expect(connectionCtx.get('enterpriseRequestContext')).toBeDefined()
            order.push('connection')
          },
        }
        if (specifier === '@test/auth') return {
          inject: ['enterprisePostgres'],
          apply(authCtx: Context) {
            expect(authCtx.get('enterprisePostgres')).toBeDefined()
            order.push('auth')
            authCtx.provide('enterpriseSecurity', {} as never)
            authCtx.provide('enterpriseRequestContext', {} as never)
          },
        }
        if (specifier === '@test/postgres') return {
          apply(postgresCtx: Context) {
            order.push('postgres')
            postgresCtx.provide('enterprisePostgres', {} as never)
          },
        }
        throw new Error(`unexpected Loader import: ${specifier}`)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>

    try {
      await ctx.loader.create({ name: '@test/connection', inject: connectionInject })
      await ctx.loader.create({ name: '@test/auth' })
      await ctx.loader.create({ name: '@test/postgres' })
      await ctx.loader.await()
      expect(order).toEqual(['postgres', 'auth', 'connection'])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
