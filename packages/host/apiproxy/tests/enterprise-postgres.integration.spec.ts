import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createEnterprisePostgresComposition } from '@deepseek-ai/dsh-enterprise-postgres'
import { createApiProxy } from '../src/api-proxy.ts'
import { RpcId } from '../src/api/rpc.ts'

const databaseUrl = process.env.DSH_TEST_POSTGRES_URL
const closes: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(closes.splice(0).map(close => close()))
})

describe.skipIf(databaseUrl === undefined)('enterprise ApiProxy with PostgreSQL', () => {
  it(
    'persists a principal-scoped employee draft through the wire handler',
    { timeout: 60_000 },
    async () => {
      const composition = await createEnterprisePostgresComposition({
        connectionString: databaseUrl!,
        cursorSigningKey: randomBytes(32),
      })
      closes.push(composition.close)
      const orgId = `api-org-${randomUUID()}`
      const userId = `api-user-${randomUUID()}`
      const presetId = `api-preset-${randomUUID()}`
      await composition.identity.createOrganization({
        id: orgId,
        name: orgId,
      })
      await composition.identity.createUser({
        id: userId,
        orgId,
        username: userId,
        displayName: userId,
        disabled: false,
      })
      await composition.identity.setRoles(userId, ['administrator'])
      const principal = { userId, orgId, roles: ['administrator'] as const }
      const ctx = new Context()
      ctx.provide('enterprisePostgres' as never, composition as never)
      ctx.provide(
        'enterpriseRequestContext' as never,
        { requirePrincipal: () => principal } as never,
      )
      ctx.provide(
        'enterpriseSecurity' as never,
        {
          authorizeApiAsync: async () => ({
            allowed: true,
            reason: 'administrator',
          }),
          auditApiAsync: async () => undefined,
        } as never,
      )
      const api = createApiProxy(ctx, {
        defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
        cwd: '/tmp',
      })

      const saved = await api.enterpriseEmployees.saveDraft({
        rpcId: RpcId('pg-save'),
        payload: {
          presetId,
          expectedRevision: 0,
          idempotencyKey: 'pg-save',
          visibility: 'private',
          profile: {},
          bindings: [],
        },
      })
      expect(saved.result).toMatchObject({
        ok: true,
        value: { presetId, orgId, ownerUserId: userId, revision: 1 },
      })
      await expect(composition.catalog.getDraft(presetId, orgId)).resolves.toMatchObject({
        presetId,
        ownerUserId: userId,
      })
    },
  )
})
