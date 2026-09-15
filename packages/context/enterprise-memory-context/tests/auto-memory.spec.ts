import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { agentPresetProjectionDefinition } from '../../../preset/agent-presets/src/session.ts'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import { EnterpriseIdentityRepository } from '@deepseek-ai/dsh-enterprise-identity'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, inject } from '../src/index.ts'
import * as LearningPlugin from '../src/learning-plugin.ts'
import type { LearnEmployeeAssetInput } from '@deepseek-ai/dsh-enterprise-catalog'

const signal = new AbortController().signal

function resultText(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []).join('\n')
}

function agentAt(cwd: string, name = 'memory-agent'): Agent {
  const id = SessionId(name)
  const session = Session.create(id, [], { version: 3, id, createdAt: 1, cwd, isSeeded: false })
  return { id, session } as unknown as Agent
}

function seedEnterpriseOrganization(
  identity: EnterpriseIdentityRepository,
  input: {
    orgId: string
    departmentId: string
    workspaceId: string
    rootPath: string
    sessionId: string
    adminUserId: string
    memberUserId: string
  },
): { agent: Agent } {
  identity.createOrganization({ id: input.orgId, name: input.orgId })
  identity.createUser({
    id: input.adminUserId, orgId: input.orgId, username: input.adminUserId,
    displayName: input.adminUserId, disabled: false,
  })
  identity.setRoles(input.adminUserId, ['administrator'])
  identity.createUser({
    id: input.memberUserId, orgId: input.orgId, username: input.memberUserId,
    displayName: input.memberUserId, disabled: false,
  })
  identity.saveDepartment({
    id: input.departmentId, orgId: input.orgId, parentId: null, name: input.departmentId,
    sortOrder: 0, expectedRevision: 0,
  })
  identity.saveWorkspaceGrant({
    workspaceId: input.workspaceId, orgId: input.orgId, name: input.workspaceId, kind: 'department',
    departmentId: input.departmentId, rootPath: input.rootPath, sandboxMode: 'workspace-write', expectedRevision: 0,
  })
  identity.bindSessionWorkspace({
    sessionId: input.sessionId, workspaceId: input.workspaceId, orgId: input.orgId, ownerUserId: input.memberUserId,
  })
  identity.putResourcePolicy({
    resourceType: 'enterprise-memory-autonomy', resourceId: `${input.orgId}:department:${input.departmentId}`,
    orgId: input.orgId, creatorUserId: input.adminUserId, visibility: 'organization', allowedUserIds: [input.memberUserId],
  })
  return { agent: agentAt(input.rootPath, input.sessionId) }
}

describe('Agent automatic enterprise memory', () => {
  let root = ''
  let context: Context | undefined

  afterEach(async () => {
    await context?.fiber.dispose()
    context = undefined
    if (root !== '') await rm(root, { recursive: true, force: true })
    root = ''
  })

  async function setup(options: { autoApproval?: boolean; backgroundServiceUserId?: string } = {}) {
    root = await mkdtemp(join(tmpdir(), 'dsh-agent-auto-memory-'))
    const identity = new EnterpriseIdentityRepository(join(root, 'identity.sqlite'), { now: () => 1_700_000_000_000 })
    identity.createOrganization({ id: 'org-a', name: 'Org A' })
    identity.createUser({ id: 'admin-1', orgId: 'org-a', username: 'admin', displayName: 'Admin', disabled: false })
    identity.setRoles('admin-1', ['administrator'])
    identity.createUser({ id: 'member-1', orgId: 'org-a', username: 'member', displayName: 'Member', disabled: false })
    identity.createUser({ id: 'service:memory-bot', orgId: 'org-a', username: 'memory-bot', displayName: 'Memory bot', disabled: false })
    identity.saveDepartment({
      id: 'dept-ops', orgId: 'org-a', parentId: null, name: 'Operations', sortOrder: 0, expectedRevision: 0,
    })
    identity.saveWorkspaceGrant({
      workspaceId: 'workspace-ops', orgId: 'org-a', name: 'Operations', kind: 'department',
      departmentId: 'dept-ops', rootPath: '/managed/ops', sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    identity.bindSessionWorkspace({
      sessionId: 'memory-agent', workspaceId: 'workspace-ops', orgId: 'org-a', ownerUserId: 'member-1',
    })
    if (options.autoApproval) {
      for (const resourceId of ['org-a:department:dept-ops', 'org-a:organization']) {
        identity.putResourcePolicy({
          resourceType: 'enterprise-memory-autonomy', resourceId, orgId: 'org-a', creatorUserId: 'admin-1',
          visibility: 'organization', allowedUserIds: ['member-1', 'admin-1'],
        })
      }
    }
    const ctx = new Context()
    context = ctx
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true })
    await ctx.plugin(ToolRuntime)
    ctx.provide('enterprisePostgres' as never, { identity } as never)
    const requestContext = new EnterpriseRequestContext()
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    apply(ctx, {
      maxEntries: 20, maxChars: 8_000, autoSave: true,
      ...(options.backgroundServiceUserId === undefined ? {} : { backgroundServiceUserId: options.backgroundServiceUserId }),
    })
    return { ctx, identity, requestContext }
  }

  async function setupLearning(catalog: unknown) {
    root = await mkdtemp(join(tmpdir(), 'dsh-agent-learning-'))
    const identity = new EnterpriseIdentityRepository(join(root, 'identity.sqlite'), { now: () => 1_700_000_000_000 })
    identity.createOrganization({ id: 'org-a', name: 'Org A' })
    identity.createUser({ id: 'admin-1', orgId: 'org-a', username: 'admin', displayName: 'Admin', disabled: false })
    identity.setRoles('admin-1', ['administrator'])
    identity.saveDepartment({
      id: 'dept-ops', orgId: 'org-a', parentId: null, name: 'Operations', sortOrder: 0, expectedRevision: 0,
    })
    identity.saveWorkspaceGrant({
      workspaceId: 'workspace-ops', orgId: 'org-a', name: 'Operations', kind: 'department',
      departmentId: 'dept-ops', rootPath: root, sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    const ctx = new Context()
    context = ctx
    ctx.provide('enterprisePostgres' as never, { identity, catalog } as never)
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([
      { id: 'prompt', name: 'test-system-prompt', config: { includeHarnessIdentity: false, includeRuntimeContext: true, persona: '' } },
      { id: 'tools', name: 'test-tools' },
      { id: 'projections', name: 'test-projections' },
      { id: 'preset-projection', name: 'test-preset-projection' },
      { id: 'self-learning', name: 'employee-self-learning' },
    ]))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['test-projections', { default: SessionProjectionRegistry }],
      ['test-preset-projection', { inject: ['sessionProjections'], apply(ctx: Context) { ctx.sessionProjections.register(agentPresetProjectionDefinition) } }],
      ['test-system-prompt', { default: SystemPrompt }], ['test-tools', { default: ToolRuntime }], ['employee-self-learning', LearningPlugin],
    ])
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected module ${specifier}`)
      return modules.get(specifier)
    } } as unknown as NonNullable<typeof ctx.loader.internal>
    await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await ctx.loader.await()
    return { ctx, identity }
  }

  async function remember(ctx: Context, args: unknown, agent: Agent = agentAt('/managed/ops')) {
    return ctx.tools.execute({
      signal, callId: ToolCallId('remember-call'), name: 'remember_business_knowledge', arguments: args, agent,
    })
  }

  it('registers learned source files for the session employee and injects its learned content', async () => {
    const learnEmployeeAsset = vi.fn(async (input: LearnEmployeeAssetInput) => ({ asset: { assetId: input.assetId, version: 1 }, release: { releaseId: 'learned-release', version: 2 } }))
    const catalog = { learnEmployeeAsset, listReleases: vi.fn(async () => [{ snapshot: { bindings: [{ kind: 'sop', assetId: 'learned', version: 1 }] } }]),
      getAsset: vi.fn(async () => ({ archived: false })), listAssetVersions: vi.fn(async () => [{ version: 1, content: { learnedBy: 'employee-1', workspaceRoot: await realpath(root), name: 'Checking', content: 'Verify the totals.' } }]) }
    const { ctx, identity } = await setupLearning(catalog)
    await writeFile(join(root, 'check.md'), '# Check totals\nVerify the totals.')
    const agent = { ...agentAt(root), session: Session.create(SessionId('learning'), [], { version: 3, id: SessionId('learning'), createdAt: 1, cwd: root, isSeeded: false, agentPreset: 'employee-old' }) } as Agent
    identity.bindSessionWorkspace({ sessionId: String(agent.id), workspaceId: 'workspace-ops', orgId: 'org-a', ownerUserId: 'admin-1' })
    agent.session.append('agent-preset/selected', { agentPreset: 'employee-1' })
    const result = await ctx.tools.execute({ signal, callId: ToolCallId('learn'), rootCallId: ToolCallId('batch'), name: 'learn_employee_capability', arguments: { kind: 'sop', name: 'Checking', sourcePath: 'check.md' }, agent })
    expect(result.isError).toBe(false)
    expect(learnEmployeeAsset).toHaveBeenCalledWith(expect.objectContaining({ presetId: 'employee-1', orgId: 'org-a', kind: 'sop', content: expect.objectContaining({ sourcePath: 'check.md', learnedBy: 'employee-1', content: '# Check totals\nVerify the totals.' }) }))
    const prompt = await ctx.systemPrompt.assemble({ agent })
    expect(prompt.contexts.find(item => item.name === 'enterprise:learned-capabilities')?.text).toContain('Verify the totals.')
    const rejected = await ctx.tools.execute({ signal, callId: ToolCallId('escape'), name: 'learn_employee_capability', arguments: { kind: 'sop', name: 'Escape', sourcePath: '../outside.md' }, agent })
    expect(rejected.isError).toBe(true)
    expect(learnEmployeeAsset).toHaveBeenCalledTimes(1)
    const second = await ctx.tools.execute({ signal, callId: ToolCallId('learn-skill'), rootCallId: ToolCallId('batch'), name: 'learn_employee_capability', arguments: { kind: 'skill', name: 'Checking skill', sourcePath: 'check.md' }, agent })
    expect(second.isError).toBe(false)
    expect(learnEmployeeAsset.mock.calls[0]?.[0].idempotencyKey).not.toBe(learnEmployeeAsset.mock.calls[1]?.[0].idempotencyKey)
    const other = await ctx.systemPrompt.assemble({ agent: agentAt(root) })
    expect(other.contexts.find(item => item.name === 'enterprise:learned-capabilities')).toBeUndefined()
    identity.close()
  })

  it('auto-approves department knowledge in the calling Workspace and writes a masked audit', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    const result = await remember(ctx, {
      scope: 'department', kind: 'process', summary: '采购订单必须在入库前完成审批。',
    })

    expect(result.isError).toBe(false)
    const memories = identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })
    expect(memories).toEqual([expect.objectContaining({
      id: expect.stringMatching(/^agent-memory-[a-f0-9]{64}$/), scope: 'department', departmentId: 'dept-ops',
      kind: 'process', status: 'approved', summary: '采购订单必须在入库前完成审批。',
      createdBy: 'member-1', reviewedBy: 'member-1', reviewReason: 'Agent 自动评估并直接启用',
    })])
    const audit = identity.listAudit({ orgId: 'org-a', action: 'capability.manage', limit: 10 })
    expect(audit).toEqual([expect.objectContaining({
      actorUserId: 'member-1', resourceType: 'enterprise-memory', resourceId: memories[0]?.id,
      details: expect.objectContaining({ source: 'agent-auto-memory', scope: 'department', sessionId: 'memory-agent' }),
    })])
    expect(JSON.stringify(audit)).not.toContain('采购订单必须')

    const prompt = await ctx.systemPrompt.assemble({ agent: agentAt('/managed/ops') })
    expect(prompt.sections.some(section => section.text.includes('remember_business_knowledge'))).toBe(true)
    expect(prompt.sections.some(section => section.text.includes('Creating SOP or SKILL.md files does not register enterprise capability assets.'))).toBe(true)
    identity.close()
  })

  it('attributes an interactive session memory proposal and review to its bound enterprise owner', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    const result = await remember(ctx, {
      scope: 'department', kind: 'process', summary: '采购订单必须在入库前完成审批。',
    })

    expect(result.isError).toBe(false)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })).toEqual([
      expect.objectContaining({ createdBy: 'member-1', reviewedBy: 'member-1' }),
    ])
    expect(identity.listAudit({ orgId: 'org-a', action: 'capability.manage', limit: 10 })).toEqual([
      expect.objectContaining({ actorUserId: 'member-1' }),
    ])
    identity.close()
  })

  it('requires the enterprise request context dependency', () => {
    expect(inject).toContain('enterpriseRequestContext')
  })

  it('declares the llm dependency used by completed-turn extraction', () => {
    expect(inject).toContain('llm')
  })

  it('keeps an organization policy valid after another organization configures the same scope', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    identity.createOrganization({ id: 'org-b', name: 'Org B' })
    identity.createUser({ id: 'admin-b', orgId: 'org-b', username: 'admin-b', displayName: 'Admin B', disabled: false })
    identity.setRoles('admin-b', ['administrator'])
    identity.putResourcePolicy({
      resourceType: 'enterprise-memory-autonomy', resourceId: 'org-b:department:dept-ops', orgId: 'org-b',
      creatorUserId: 'admin-b', visibility: 'organization', allowedUserIds: ['admin-b'],
    })

    const result = await remember(ctx, {
      scope: 'department', kind: 'process', summary: '采购订单必须在入库前完成审批。',
    })

    expect(result.isError).toBe(false)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })).toEqual([
      expect.objectContaining({ status: 'approved' }),
    ])
    identity.close()
  })

  it('isolates department auto-approval across organizations with independent Workspaces, Sessions, actors, and policies', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    const organizationB = seedEnterpriseOrganization(identity, {
      orgId: 'org-b', departmentId: 'dept-finance', workspaceId: 'workspace-finance', rootPath: '/managed/finance',
      sessionId: 'finance-agent', adminUserId: 'admin-b', memberUserId: 'member-b',
    })

    const [organizationAResult, organizationBResult] = await Promise.all([
      remember(ctx, { scope: 'department', kind: 'process', summary: '采购订单必须在入库前完成审批。' }),
      remember(ctx, { scope: 'department', kind: 'process', summary: '付款申请必须关联已审批发票。' }, organizationB.agent),
    ])

    expect(organizationAResult.isError).toBe(false)
    expect(organizationBResult.isError).toBe(false)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })).toEqual([
      expect.objectContaining({ departmentId: 'dept-ops', createdBy: 'member-1', reviewedBy: 'member-1', status: 'approved' }),
    ])
    expect(identity.listMemories({ orgId: 'org-b', departmentIds: ['dept-finance'] })).toEqual([
      expect.objectContaining({ departmentId: 'dept-finance', createdBy: 'member-b', reviewedBy: 'member-b', status: 'approved' }),
    ])
    expect(await identity.resourcePolicy('enterprise-memory-autonomy', 'org-a:department:dept-ops')).toEqual(
      expect.objectContaining({
        orgId: 'org-a', creatorUserId: 'admin-1', allowedUserIds: expect.arrayContaining(['member-1', 'admin-1']),
      }),
    )
    expect(await identity.resourcePolicy('enterprise-memory-autonomy', 'org-b:department:dept-finance')).toEqual(
      expect.objectContaining({ orgId: 'org-b', creatorUserId: 'admin-b', allowedUserIds: ['member-b'] }),
    )
    identity.close()
  })

  it('prefers an authenticated request principal over the bound Session owner', async () => {
    const { ctx, identity, requestContext } = await setup({ autoApproval: true })
    const result = await requestContext.run({ orgId: 'org-a', userId: 'admin-1', roles: ['administrator'] }, () =>
      remember(ctx, { scope: 'department', kind: 'process', summary: '发票入账需关联采购订单。' }),
    )

    expect(result.isError).toBe(false)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })).toEqual([
      expect.objectContaining({ createdBy: 'admin-1', reviewedBy: 'admin-1' }),
    ])
    identity.close()
  })

  it('falls back to the bound Session owner when the request principal is outside the organization or disabled', async () => {
    const { ctx, identity, requestContext } = await setup({ autoApproval: true })
    identity.createOrganization({ id: 'org-b', name: 'Org B' })
    identity.createUser({ id: 'member-b', orgId: 'org-b', username: 'member-b', displayName: 'Member B', disabled: false })
    identity.createUser({ id: 'disabled-a', orgId: 'org-a', username: 'disabled', displayName: 'Disabled', disabled: true })
    const outside = await requestContext.run({ orgId: 'org-b', userId: 'member-b', roles: ['member'] }, () =>
      remember(ctx, { scope: 'department', kind: 'process', summary: '质检完成后才可入库。' }),
    )
    const disabled = await requestContext.run({ orgId: 'org-a', userId: 'disabled-a', roles: ['member'] }, () =>
      remember(ctx, { scope: 'department', kind: 'process', summary: '供应商准入需要资质复核。' }),
    )

    expect(outside.isError).toBe(false)
    expect(disabled.isError).toBe(false)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })).toEqual([
      expect.objectContaining({ createdBy: 'member-1', summary: '质检完成后才可入库。' }),
      expect.objectContaining({ createdBy: 'member-1', summary: '供应商准入需要资质复核。' }),
    ])
    identity.close()
  })

  it('activates confirmed routine knowledge without an administrator policy', async () => {
    const { ctx, identity } = await setup()
    const result = await remember(ctx, {
      scope: 'department', kind: 'process', summary: '采购订单必须在入库前完成审批。',
    })

    expect(result.isError).toBe(false)
    expect(resultText(result)).toMatch(/saved and active/iu)
    const [memory] = identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })
    expect(memory).toEqual(expect.objectContaining({ createdBy: 'member-1', status: 'approved' }))
    expect(memory).toHaveProperty('reviewedBy', 'member-1')
    expect(identity.listAudit({ orgId: 'org-a', action: 'capability.manage', limit: 10 })).toEqual([
      expect.objectContaining({ actorUserId: 'member-1', details: expect.objectContaining({ autoApproved: true }) }),
    ])
    identity.close()
  })

  it('keeps explicitly uncertain knowledge pending confirmation', async () => {
    const { ctx, identity } = await setup()
    const result = await remember(ctx, { scope: 'department', kind: 'process', summary: '采购流程的核验标准存在冲突。', needsConfirmation: true })
    expect(result.isError).toBe(false)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })[0]?.status).toBe('proposed')
    const repeated = await remember(ctx, { scope: 'department', kind: 'process', summary: '采购流程的核验标准存在冲突。' })
    expect(repeated.isError).toBe(false)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })[0]?.status).toBe('proposed')
    identity.close()
  })

  it('uses an explicit service identity for unbound background automation', async () => {
    const { ctx, identity } = await setup({ backgroundServiceUserId: 'service:memory-bot' })
    const result = await remember(ctx, {
      scope: 'department', kind: 'process', summary: '后台任务仅记录已确认的业务规则。',
    }, agentAt('/managed/ops', 'background-agent'))

    expect(result.isError).toBe(false)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })).toEqual([
      expect.objectContaining({ createdBy: 'service:memory-bot', status: 'approved' }),
    ])
    identity.close()
  })

  it('fails closed for unbound background automation without a service identity', async () => {
    const { ctx, identity } = await setup()
    const result = await remember(ctx, {
      scope: 'department', kind: 'process', summary: '后台任务仅记录已确认的业务规则。',
    }, agentAt('/managed/ops', 'background-agent'))

    expect(result.isError).toBe(true)
    expect(resultText(result)).toMatch(/Session owner.*service identity/iu)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })).toEqual([])
    identity.close()
  })

  it('is idempotent for the same normalized knowledge and scope', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    const first = await remember(ctx, {
      scope: 'department', kind: 'terminology', summary: '  SKU 指库存单位。  ',
    })
    const second = await remember(ctx, {
      scope: 'department', kind: 'terminology', summary: 'SKU 指库存单位。',
    })

    expect(first.isError).toBe(false)
    expect(second.isError).toBe(false)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })).toHaveLength(1)
    expect(identity.listAudit({ orgId: 'org-a', action: 'capability.manage', limit: 10 })).toHaveLength(1)
    identity.close()
  })

  it('auto-approves organization knowledge when the enterprise profile allows it', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    const result = await remember(ctx, {
      scope: 'organization', kind: 'decision', summary: '公司统一使用年度合同模板。',
    })

    expect(result.isError).toBe(false)
    const memories = identity.listMemories({ orgId: 'org-a', departmentIds: [] })
    expect(memories).toEqual([expect.objectContaining({ scope: 'organization', status: 'approved' })])
    expect('departmentId' in (memories[0] ?? {})).toBe(false)
    identity.close()
  })

  it('derives department scope from a personal Workspace owner primary department', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    identity.setUserDepartments({
      orgId: 'org-a', userId: 'admin-1', departmentIds: ['dept-ops'],
      primaryDepartmentId: 'dept-ops', expectedRevision: 0,
    })
    identity.saveWorkspaceGrant({
      workspaceId: 'workspace-admin', orgId: 'org-a', name: 'Admin', kind: 'personal',
      ownerUserId: 'admin-1', rootPath: '/managed/admin', sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    identity.bindSessionWorkspace({
      sessionId: 'personal-agent', workspaceId: 'workspace-admin', orgId: 'org-a', ownerUserId: 'admin-1',
    })
    const result = await remember(ctx, {
      scope: 'department', kind: 'business-fact', summary: '部门使用统一业务编号。',
    }, agentAt('/managed/admin', 'personal-agent'))

    expect(result.isError).toBe(false)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })).toEqual([
      expect.objectContaining({ departmentId: 'dept-ops', status: 'approved' }),
    ])
    identity.close()
  })

  it('rejects privacy findings while confirmed organization knowledge activates automatically', async () => {
    const { ctx, identity } = await setup()
    const sensitive = await remember(ctx, {
      scope: 'department', kind: 'business-fact', summary: 'password=enterprise-secret',
    })
    const organization = await remember(ctx, {
      scope: 'organization', kind: 'decision', summary: '公司统一使用年度合同模板。',
    })

    expect(sensitive.isError).toBe(true)
    expect(organization.isError).toBe(false)
    expect(resultText(sensitive)).toMatch(/privacy|credential/iu)
    expect(resultText(organization)).toMatch(/saved and active/iu)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: [] })).toEqual([
      expect.objectContaining({ scope: 'organization', status: 'approved' }),
    ])
    identity.close()
  })
})
