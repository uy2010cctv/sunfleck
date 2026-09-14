import { Context } from '@deepseek-ai/cordis'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import { describe, expect, it, vi } from 'vitest'
import { EnterpriseEmployeeController, inject } from '../src/index.ts'

describe('enterprise employee publication', () => {
  it('omits employees that are outside the caller hierarchy scope', async () => {
    const items = [
      { presetId: 'finance', orgId: 'org-a', ownerUserId: 'finance-owner', visibility: 'organization', profile: {}, bindings: [], revision: 1, status: 'published', updatedAt: 1 },
      { presetId: 'sales', orgId: 'org-a', ownerUserId: 'sales-owner', visibility: 'organization', profile: {}, bindings: [], revision: 1, status: 'published', updatedAt: 1 },
    ]
    const authorizeApiAsync = vi.fn((_principal, endpoint: string, input: { presetId?: string }) =>
      Promise.resolve({
        allowed: endpoint === 'enterpriseEmployee.list' || input.presetId === 'finance',
        reason: input.presetId === 'sales' ? 'scope-mismatch' : 'department-member',
      }))
    const requestContext = new EnterpriseRequestContext()
    const ctx = new Context()
    ctx.provide('enterprisePostgres' as never, { catalog: {
      listDrafts: vi.fn().mockResolvedValue({ items, nextCursor: 'next' }),
    } } as never)
    ctx.provide('enterpriseSecurity' as never, { authorizeApiAsync, auditApiAsync: vi.fn() } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('agentPresets' as never, {} as never)
    ctx.provide('llm' as never, {} as never)

    const page = await requestContext.run(
      { orgId: 'org-a', userId: 'finance-member', roles: ['member'] },
      () => new EnterpriseEmployeeController(ctx).list({}),
    )

    expect(page.items.map(item => item.presetId)).toEqual(['finance'])
    expect(page.nextCursor).toBe('next')
  })

  it('declares the Agent Preset service required by publication', () => {
    expect(inject).toContain('agentPresets')
  })

  it('compiles the immutable release identity into the native Agent Preset', async () => {
    const release = {
      releaseId: 'release-finance-1', presetId: 'employee-finance', orgId: 'org-a', version: 1,
      digest: 'digest', publishedBy: 'admin-1', publishedAt: 1,
      snapshot: { profile: {
        name: '小钱', description: '负责企业财务事务。', position: '财务总监', department: '财务部',
        capabilities: ['报销审核', '财务分析'], prompt: '审核报销单据并编制财务报表。', modelRef: 'deepseek/model',
      }, bindings: [] },
    }
    const publishDraft = vi.fn(() => Promise.resolve(release))
    const configureEmployee = vi.fn(() => Promise.resolve())
    const authorizeApiAsync = vi.fn(() => Promise.resolve({ allowed: true, reason: 'role' }))
    const auditApiAsync = vi.fn(() => Promise.resolve())
    const requestContext = new EnterpriseRequestContext()
    const ctx = new Context()
    ctx.provide('enterprisePostgres' as never, { catalog: { publishDraft } } as never)
    ctx.provide('enterpriseSecurity' as never, { authorizeApiAsync, auditApiAsync } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('agentPresets' as never, { configureEmployee } as never)
    const controller = new EnterpriseEmployeeController(ctx)

    await requestContext.run({ orgId: 'org-a', userId: 'admin-1', roles: ['administrator'] }, () =>
      controller.publish({ presetId: 'employee-finance', expectedRevision: 1, idempotencyKey: 'publish-1' }))

    expect(configureEmployee).toHaveBeenCalledWith('employee-finance', {
      name: '小钱', description: '负责企业财务事务。', position: '财务总监', department: '财务部',
      capabilities: ['报销审核', '财务分析'], prompt: '审核报销单据并编制财务报表。',
    })
  })

  it('retries a transient native Preset write without publishing another release', async () => {
    const release = {
      releaseId: 'release-finance-1', presetId: 'employee-finance', orgId: 'org-a', version: 1,
      digest: 'digest', publishedBy: 'admin-1', publishedAt: 1,
      snapshot: { profile: { name: '小钱', prompt: '审核报销单据。' }, bindings: [] },
    }
    const publishDraft = vi.fn(() => Promise.resolve(release))
    const configureEmployee = vi.fn()
      .mockRejectedValueOnce(new Error('temporary preset write collision'))
      .mockResolvedValueOnce(undefined)
    const requestContext = new EnterpriseRequestContext()
    const ctx = new Context()
    ctx.provide('enterprisePostgres' as never, { catalog: { publishDraft } } as never)
    ctx.provide('enterpriseSecurity' as never, {
      authorizeApiAsync: () => Promise.resolve({ allowed: true, reason: 'role' }),
      auditApiAsync: () => Promise.resolve(),
    } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('agentPresets' as never, { configureEmployee } as never)
    const controller = new EnterpriseEmployeeController(ctx)

    await expect(requestContext.run({ orgId: 'org-a', userId: 'admin-1', roles: ['administrator'] }, () =>
      controller.publish({ presetId: 'employee-finance', expectedRevision: 1, idempotencyKey: 'publish-1' })))
      .resolves.toMatchObject({ releaseId: 'release-finance-1' })
    expect(publishDraft).toHaveBeenCalledTimes(1)
    expect(configureEmployee).toHaveBeenCalledTimes(2)
  })
})
