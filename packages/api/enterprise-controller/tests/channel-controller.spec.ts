import { Context } from '@deepseek-ai/cordis'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'

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
    const principal = { orgId: 'org-a', userId: 'admin-a', roles: ['administrator'] as const }
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
    ).catch(error => error)
    expect(failure).toBeInstanceOf(RemoteError)
    expect(failure).toMatchObject({ code: 'enterprise-forbidden' })
  })
})
