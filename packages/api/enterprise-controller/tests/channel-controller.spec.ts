import { Context } from '@deepseek-ai/cordis'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'

const principal = { orgId: 'org-a', userId: 'admin-a', roles: ['administrator'] as const }

function stored(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    orgId: 'org-a', channelId: 'finance-wecom', name: '财务企业微信', provider: 'wecom', tenantId: 'corp-a',
    accountId: 'app-a', credentialRef: 'WECOM_FINANCE_SECRET', inboundEnabled: true, state: 'active',
    bindingStatus: 'unbound', createdBy: 'admin-a', revision: 1, createdAt: 1, updatedAt: 1,
    ...overrides,
  }
}

async function bindingBench(overrides: {
  row?: Record<string, unknown>
  describe?: ReturnType<typeof vi.fn>
  resolve?: ReturnType<typeof vi.fn>
  fetch?: typeof fetch
  now?: () => number
  authorize?: ReturnType<typeof vi.fn>
} = {}) {
  const api = await import('../src/index.ts') as Record<string, unknown>
  const Controller = api['EnterpriseChannelController'] as new (ctx: Context, options?: Record<string, unknown>) => {
    beginBinding(input: Record<string, unknown>): Promise<Record<string, unknown>>
    completeBinding(input: Record<string, unknown>): Promise<Record<string, unknown>>
  }
  const requestContext = new EnterpriseRequestContext()
  let row = overrides.row ?? stored()
  const getChannelConfiguration = vi.fn().mockImplementation(() => Promise.resolve(row))
  const verifyChannelBinding = vi.fn().mockImplementation((input: Record<string, unknown>) => {
    row = stored({
      ...row, bindingStatus: 'verified', boundProviderIdentityId: input['providerIdentityId'],
      boundProviderIdentityName: input['providerIdentityName'], verifiedTenantId: input['verifiedTenantId'],
      bindingVerifiedBy: input['actorUserId'], bindingVerifiedAt: 2, revision: Number(row['revision']) + 1,
    })
    return Promise.resolve(row)
  })
  const describe = overrides.describe ?? vi.fn().mockResolvedValue({ configured: true, writable: true })
  const resolve = overrides.resolve ?? vi.fn().mockResolvedValue({ value: 'app-secret-private', source: 'encrypted' })
  const authorizeApiAsync = overrides.authorize ?? vi.fn().mockResolvedValue({ allowed: true, reason: 'administrator' })
  const auditApiAsync = vi.fn()
  const ctx = new Context()
  ctx.provide('enterprisePostgres' as never, { operations: {
    getChannelConfiguration, verifyChannelBinding,
  } } as never)
  ctx.provide('enterpriseRequestContext' as never, requestContext as never)
  ctx.provide('enterpriseSecurity' as never, { authorizeApiAsync, auditApiAsync } as never)
  ctx.provide('credentials' as never, { describe, resolve } as never)
  const controller = new Controller(ctx, { fetch: overrides.fetch ?? vi.fn(), now: overrides.now })
  return {
    controller, requestContext, getChannelConfiguration, verifyChannelBinding, describe, resolve, authorizeApiAsync,
    auditApiAsync,
    setRow(value: Record<string, unknown>) { row = value },
  }
}

function begin(bench: Awaited<ReturnType<typeof bindingBench>>, actor = principal, input: Record<string, unknown> = {}) {
  return bench.requestContext.run(actor, () => bench.controller.beginBinding({
    channelId: 'finance-wecom', expectedRevision: 1, redirectUri: 'https://dsh.example.test/channel/callback', ...input,
  }))
}

function complete(
  bench: Awaited<ReturnType<typeof bindingBench>>,
  session: Record<string, unknown>,
  actor = principal,
  input: Record<string, unknown> = {},
) {
  const state = typeof session['authorizationUrl'] === 'string'
    ? new URL(session['authorizationUrl']).searchParams.get('state')
    : session['state']
  return bench.requestContext.run(actor, () => bench.controller.completeBinding({
    code: 'one-time-code', state, redirectUri: 'https://dsh.example.test/channel/callback',
    idempotencyKey: 'bind-a', ...input,
  }))
}

describe('enterprise channel Remote controller', () => {
  it('publishes the authenticated enterpriseChannel Remote controller', async () => {
    const api = await import('../src/index.ts') as Record<string, unknown>
    expect(api['EnterpriseChannelController']).toBeTypeOf('function')
  })

  it('injects organization and actor, returns secret-free readiness, and preserves provider policy', async () => {
    const api = await import('../src/index.ts') as Record<string, unknown>
    const Controller = api['EnterpriseChannelController'] as new (ctx: Context) => {
      save(input: Record<string, unknown>): Promise<Record<string, unknown>>
      list(input: Record<string, unknown>): Promise<{ items: readonly Record<string, unknown>[] }>
    }
    const requestContext = new EnterpriseRequestContext()
    const saved = {
      orgId: 'org-a', channelId: 'finance-wecom', name: '财务企业微信', provider: 'wecom', tenantId: 'corp-a',
      accountId: 'app-a', credentialRef: 'WECOM_FINANCE_SECRET', inboundEnabled: true, state: 'active',
      createdBy: 'admin-a', revision: 1, createdAt: 1, updatedAt: 1,
    }
    const saveChannelConfiguration = vi.fn().mockResolvedValue(saved)
    const listChannelConfigurations = vi.fn().mockResolvedValue({ items: [saved] })
    const ctx = new Context()
    ctx.provide('enterprisePostgres' as never, { operations: {
      saveChannelConfiguration, listChannelConfigurations,
      getChannelConfiguration: vi.fn(), archiveChannelConfiguration: vi.fn(),
    } } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('enterpriseSecurity' as never, {
      authorizeApiAsync: vi.fn().mockResolvedValue({ allowed: true, reason: 'administrator' }),
      auditApiAsync: vi.fn(),
    } as never)
    ctx.provide('credentials' as never, {
      describe: vi.fn().mockResolvedValue({ configured: true, writable: true, source: 'encrypted' }),
    } as never)
    const controller = new Controller(ctx)
    const result = await requestContext.run(principal, () => controller.save({
      channelId: 'finance-wecom', name: '财务企业微信', provider: 'wecom', tenantId: 'corp-a',
      accountId: 'app-a', credentialRef: 'WECOM_FINANCE_SECRET', inboundEnabled: true,
      state: 'active', expectedRevision: 0, idempotencyKey: 'save-a',
    }))
    expect(saveChannelConfiguration).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-a', actorUserId: 'admin-a', channelId: 'finance-wecom',
    }))
    expect(result).toMatchObject({
      credentialStatus: 'configured', transportStatus: 'unverified',
      allowedIntents: ['notify', 'handoff', 'team-start', 'decision-response', 'status'],
    })
    expect(JSON.stringify(await requestContext.run(principal, () => controller.list({})))).not.toContain('encrypted')
  })

  it('fails closed when channel.manage is denied', async () => {
    const api = await import('../src/index.ts') as Record<string, unknown>
    const Controller = api['EnterpriseChannelController'] as new (ctx: Context) => {
      list(input: Record<string, unknown>): Promise<unknown>
    }
    const requestContext = new EnterpriseRequestContext()
    const ctx = new Context()
    ctx.provide('enterprisePostgres' as never, { operations: { listChannelConfigurations: vi.fn() } } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('enterpriseSecurity' as never, {
      authorizeApiAsync: vi.fn().mockResolvedValue({ allowed: false, reason: 'insufficient-role' }),
      auditApiAsync: vi.fn(),
    } as never)
    ctx.provide('credentials' as never, { describe: vi.fn() } as never)
    const failure = await requestContext.run(
      { orgId: 'org-a', userId: 'member-a', roles: ['member'] as const },
      () => new Controller(ctx).list({}),
    ).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RemoteError)
    expect(failure).toMatchObject({ code: 'enterprise-forbidden' })
  })

  it('begins an official authorization session without exposing the Credential value', async () => {
    const bench = await bindingBench()
    const session = await begin(bench)
    expect(session).toMatchObject({
      channelId: 'finance-wecom', provider: 'wecom',
      officialDocumentationUrl: 'https://developer.work.weixin.qq.com/document/path/98152',
    })
    expect(new URL(String(session['authorizationUrl'])).host).toBe('login.work.weixin.qq.com')
    const state = new URL(String(session['authorizationUrl'])).searchParams.get('state') ?? ''
    expect(session['bindingId']).toBe(state)
    expect(String(session['authorizationUrl'])).toContain(`state=${encodeURIComponent(state)}`)
    expect(state.length).toBeLessThanOrEqual(128)
    expect(bench.describe).toHaveBeenCalledTimes(1)
    expect(bench.resolve).not.toHaveBeenCalled()
    expect(JSON.stringify(session)).not.toContain('app-secret-private')
  })

  it.each([
    ['missing Credential', stored(), { configured: false, writable: true }, 'enterprise-invalid-state'],
    ['stale revision', stored({ revision: 2 }), { configured: true, writable: true }, 'enterprise-conflict'],
    ['archived channel', stored({ state: 'archived' }), { configured: true, writable: true }, 'enterprise-invalid-state'],
    ['missing provider prerequisite', stored({ tenantId: undefined }), { configured: true, writable: true }, 'enterprise-invalid-state'],
  ])('rejects beginBinding for %s', async (_name, row, credential, code) => {
    const bench = await bindingBench({ row, describe: vi.fn().mockResolvedValue(credential) })
    await expect(begin(bench)).rejects.toMatchObject({ code })
  })

  it('rejects tampered, unknown, expired, callback-mismatched, actor-mismatched, and org-mismatched state', async () => {
    let now = 1_000
    const bench = await bindingBench({ now: () => now })
    const tampered = await begin(bench)
    const tamperedState = `${new URL(String(tampered['authorizationUrl'])).searchParams.get('state') ?? ''}x`
    await expect(complete(bench, { state: tamperedState }))
      .rejects.toMatchObject({ code: 'enterprise-invalid-state' })
    await expect(complete(bench, { state: 'unknown.invalid' }))
      .rejects.toMatchObject({ code: 'enterprise-invalid-state' })

    const callback = await begin(bench)
    await expect(complete(bench, callback, principal, { redirectUri: 'https://dsh.example.test/other' }))
      .rejects.toMatchObject({ code: 'enterprise-invalid-state' })

    const actor = await begin(bench)
    await expect(complete(bench, actor, { ...principal, userId: 'admin-b' })).rejects.toThrow(/forbidden/i)

    const organization = await begin(bench)
    await expect(complete(bench, organization, { ...principal, orgId: 'org-b' })).rejects.toThrow(/forbidden/i)

    const expired = await begin(bench)
    now += 10 * 60_000 + 1
    await expect(complete(bench, expired)).rejects.toMatchObject({ code: 'enterprise-invalid-state' })
  })

  it('consumes state before a provider failure and redacts provider payload, code, and secret', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      errcode: 40013, errmsg: 'bad app-secret-private one-time-code', access_token: 'token-private',
    })))
    const bench = await bindingBench({ fetch: fetchImpl })
    const session = await begin(bench)
    const failure: unknown = await complete(bench, session).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RemoteError)
    expect(JSON.stringify(failure)).not.toMatch(/app-secret-private|one-time-code|token-private|bad/i)
    expect(JSON.stringify(bench.auditApiAsync.mock.calls)).not.toMatch(/app-secret-private|one-time-code|token-private|bad/i)
    await expect(complete(bench, session)).rejects.toMatchObject({ code: 'enterprise-invalid-state' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(bench.verifyChannelBinding).not.toHaveBeenCalled()
  })

  it('bounds pending sessions and evicts the oldest entry', async () => {
    const bench = await bindingBench()
    const oldest = await begin(bench)
    for (let index = 0; index < 256; index += 1) await begin(bench)
    await expect(complete(bench, oldest)).rejects.toMatchObject({ code: 'enterprise-invalid-state' })
  })

  it('rejects a same-revision identity configuration change before resolving the secret', async () => {
    const bench = await bindingBench()
    const session = await begin(bench)
    bench.setRow(stored({ accountId: 'other-app', revision: 1 }))
    await expect(complete(bench, session)).rejects.toMatchObject({ code: 'enterprise-invalid-state' })
    expect(bench.resolve).not.toHaveBeenCalled()
  })

  it('exchanges once and writes only verified identity evidence at the exact revision', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 0, access_token: 'token-private' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errcode: 0, userid: 'finance-service' })))
    const bench = await bindingBench({ fetch: fetchImpl })
    const session = await begin(bench)
    const result = await complete(bench, session)
    expect(bench.resolve).toHaveBeenCalledTimes(1)
    expect(bench.verifyChannelBinding).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-a', channelId: 'finance-wecom', expectedRevision: 1, idempotencyKey: 'bind-a',
      actorUserId: 'admin-a', providerIdentityId: 'finance-service', verifiedTenantId: 'corp-a',
    }))
    expect(result).toMatchObject({
      credentialStatus: 'configured', transportStatus: 'unverified',
      bindingStatus: 'verified', boundProviderIdentityId: 'finance-service', bindingVerifiedBy: 'admin-a', revision: 2,
    })
    expect(Array.isArray(result['allowedIntents'])).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/token-private|app-secret-private|one-time-code/)
  })

  it('fails closed before beginning a binding when channel.manage is denied', async () => {
    const bench = await bindingBench({ authorize: vi.fn().mockResolvedValue({ allowed: false, reason: 'insufficient-role' }) })
    await expect(begin(bench, { orgId: 'org-a', userId: 'member-a', roles: ['member'] as const }))
      .rejects.toMatchObject({ code: 'enterprise-forbidden' })
    expect(bench.describe).not.toHaveBeenCalled()
  })

  it('fails closed before completing a binding when channel.manage is denied', async () => {
    const authorize = vi.fn().mockResolvedValue({ allowed: true, reason: 'administrator' })
    const bench = await bindingBench({ authorize })
    const session = await begin(bench)
    authorize.mockResolvedValue({ allowed: false, reason: 'insufficient-role' })
    await expect(complete(bench, session)).rejects.toMatchObject({ code: 'enterprise-forbidden' })
    expect(bench.resolve).not.toHaveBeenCalled()
  })
})
