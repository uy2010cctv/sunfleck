import { Context } from '@deepseek-ai/cordis'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import { describe, expect, it, vi } from 'vitest'
import { EnterpriseEmployeeController, inject } from '../src/index.ts'

describe('enterprise employee publication', () => {
  it('restores published employees after Host startup and scopes their roster to the caller', async () => {
    const releases = [
      { releaseId: 'release-main', presetId: 'employee-main', orgId: 'org-a', version: 2,
        digest: 'main', publishedBy: 'owner-a', publishedAt: 2,
        snapshot: { profile: { name: 'Main employee', prompt: 'Work for org A.' }, bindings: [] } },
      { releaseId: 'release-test', presetId: 'employee-test', orgId: 'org-b', version: 1,
        digest: 'test', publishedBy: 'owner-b', publishedAt: 1,
        snapshot: { profile: { name: 'Test employee', prompt: 'Work for org B.' }, bindings: [] } },
    ]
    const register = vi.fn(async (_definition: unknown) => async () => {})
    let access: ((id: string) => Promise<boolean>) | undefined
    const requestContext = new EnterpriseRequestContext()
    const ctx = new Context()
    ctx.provide('loader' as never, { await: async () => {} } as never)
    ctx.provide('enterprisePostgres' as never, { catalog: {
      listLatestReleases: vi.fn(async () => releases),
      getDraft: vi.fn(async (id: string, orgId: string) => ({ presetId: id, orgId, ownerUserId: `owner-${orgId}`,
        visibility: 'organization' })),
    } } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('enterpriseSecurity' as never, { authorizeApiAsync: vi.fn(async (principal: { userId: string }) => ({
      allowed: principal.userId === 'owner-a', reason: 'role',
    })) } as never)
    ctx.provide('agentPresets' as never, {
      defaultId: 'standard',
      registerAccessPolicy: (policy: (id: string) => Promise<boolean>) => { access = policy; return () => {} },
      readDocument: vi.fn(async () => ({ agentPreset: 'standard', content: [
        '- id: persona', "  name: '@deepseek-ai/dsh-persona'", '  config:', '    prefix: Base',
      ].join('\n') })),
      register,
      resolve: vi.fn(async (id: string) => ({ id })),
    } as never)

    new EnterpriseEmployeeController(ctx)
    await vi.waitFor(() => { expect(register).toHaveBeenCalledTimes(2) })
    expect(register.mock.calls.map(call => (call[0] as { id: string }).id)).toEqual(['employee-main', 'employee-test'])
    expect(access).toBeDefined()
    await requestContext.run({ orgId: 'org-a', userId: 'owner-a', roles: ['member'] }, async () => {
      expect(await access!('employee-main')).toBe(true)
      expect(await access!('employee-test')).toBe(false)
      expect(await access!('standard')).toBe(true)
    })
    await requestContext.run({ orgId: 'org-a', userId: 'reader-a', roles: ['member'] }, async () => {
      expect(await access!('employee-main')).toBe(false)
    })
    await ctx.fiber.dispose()
  })

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
    ctx.provide('loader' as never, { await: async () => {} } as never)
    ctx.provide('enterprisePostgres' as never, { catalog: {
      listDrafts: vi.fn().mockResolvedValue({ items, nextCursor: 'next' }),
      listLatestReleases: vi.fn(async () => []),
    } } as never)
    ctx.provide('enterpriseSecurity' as never, { authorizeApiAsync, auditApiAsync: vi.fn() } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('agentPresets' as never, { registerAccessPolicy: () => () => {} } as never)
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
    expect(inject).toContain('loader')
  })

  it('compiles the immutable release identity into the registered Agent preset declaration', async () => {
    const release = {
      releaseId: 'release-finance-1', presetId: 'employee-finance', orgId: 'org-a', version: 1,
      digest: 'digest', publishedBy: 'admin-1', publishedAt: 1,
      snapshot: { profile: {
        name: '小钱', description: '负责企业财务事务。', position: '财务总监', department: '财务部',
        capabilities: ['报销审核', '财务分析'], prompt: '审核报销单据并编制财务报表。', modelRef: 'deepseek/model',
      }, bindings: [] },
    }
    const publishDraft = vi.fn(() => Promise.resolve(release))
    const sourceComposition = [
      '- id: persona',
      "  name: '@deepseek-ai/dsh-persona'",
      '  config:',
      '    prefix: You are a coding agent powered by the {{model}} model.',
      '    suffix: Your working directory is {{cwd}}.',
      '- id: tool-fs',
      "  name: '@deepseek-ai/dsh-tool-fs'",
    ].join('\n')
    const register = vi.fn((_declaration: unknown) => Promise.resolve(() => Promise.resolve()))
    const authorizeApiAsync = vi.fn(() => Promise.resolve({ allowed: true, reason: 'role' }))
    const auditApiAsync = vi.fn(() => Promise.resolve())
    const requestContext = new EnterpriseRequestContext()
    const ctx = new Context()
    ctx.provide('loader' as never, { await: async () => {} } as never)
    ctx.provide('enterprisePostgres' as never, { catalog: { publishDraft, listLatestReleases: async () => [] } } as never)
    ctx.provide('enterpriseSecurity' as never, { authorizeApiAsync, auditApiAsync } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('agentPresets' as never, {
      registerAccessPolicy: () => () => {},
      defaultId: 'standard',
      readDocument: vi.fn(async () => ({ agentPreset: 'standard', content: sourceComposition })),
      register,
      resolve: vi.fn(async () => ({ id: 'employee-finance' })),
    } as never)
    const controller = new EnterpriseEmployeeController(ctx)

    await requestContext.run({ orgId: 'org-a', userId: 'admin-1', roles: ['administrator'] }, () =>
      controller.publish({ presetId: 'employee-finance', expectedRevision: 1, idempotencyKey: 'publish-1' }))

    expect(register).toHaveBeenCalledTimes(1)
    const declaration = register.mock.calls[0]![0] as {
      id: string
      name?: string
      description?: string
      plugins: { id?: string; name: string; config?: Record<string, unknown> }[]
    }
    expect(declaration.id).toBe('employee-finance')
    expect(declaration.name).toBe('小钱')
    expect(declaration.description).toBe('负责企业财务事务。')
    expect(declaration.plugins.map(row => row.name)).toEqual([
      '@deepseek-ai/dsh-persona', '@deepseek-ai/dsh-tool-fs',
    ])
    expect(declaration.plugins[0]!.config).toEqual({
      prefix: '你是企业数字员工“小钱”，岗位是“财务总监”，所属部门是“财务部”。\n\n'
        + '审核报销单据并编制财务报表。\n\n'
        + '已发布能力：报销审核、财务分析。这些能力描述你的职责，不授予额外工具或数据权限。\n\n'
        + '身份一致性规则：当用户询问你是谁或要求自我介绍时，应基于上述数字员工身份、岗位和职责回答；'
        + '不要把自己描述为通用编码 Agent 或 DSH 系统本身。',
      suffix: 'Your working directory is {{cwd}}.',
    })
  })

  it('retries a transient registry registration without publishing another release', async () => {
    const release = {
      releaseId: 'release-finance-1', presetId: 'employee-finance', orgId: 'org-a', version: 1,
      digest: 'digest', publishedBy: 'admin-1', publishedAt: 1,
      snapshot: { profile: { name: '小钱', prompt: '审核报销单据。' }, bindings: [] },
    }
    const publishDraft = vi.fn(() => Promise.resolve(release))
    const sourceComposition = [
      '- id: persona',
      "  name: '@deepseek-ai/dsh-persona'",
      '  config:',
      '    prefix: You are a coding agent powered by the {{model}} model.',
    ].join('\n')
    const register = vi.fn()
      .mockRejectedValueOnce(new Error('temporary preset write collision'))
      .mockResolvedValueOnce(() => Promise.resolve())
    const requestContext = new EnterpriseRequestContext()
    const ctx = new Context()
    ctx.provide('loader' as never, { await: async () => {} } as never)
    ctx.provide('enterprisePostgres' as never, { catalog: { publishDraft, listLatestReleases: async () => [] } } as never)
    ctx.provide('enterpriseSecurity' as never, {
      authorizeApiAsync: () => Promise.resolve({ allowed: true, reason: 'role' }),
      auditApiAsync: () => Promise.resolve(),
    } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    ctx.provide('agentPresets' as never, {
      registerAccessPolicy: () => () => {},
      defaultId: 'standard',
      readDocument: vi.fn(async () => ({ agentPreset: 'standard', content: sourceComposition })),
      register,
      resolve: vi.fn(async () => ({ id: 'employee-finance' })),
    } as never)
    const controller = new EnterpriseEmployeeController(ctx)

    await expect(requestContext.run({ orgId: 'org-a', userId: 'admin-1', roles: ['administrator'] }, () =>
      controller.publish({ presetId: 'employee-finance', expectedRevision: 1, idempotencyKey: 'publish-1' })))
      .resolves.toMatchObject({ releaseId: 'release-finance-1' })
    expect(publishDraft).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledTimes(2)
  })
})
