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
import { EnterpriseIdentityRepository } from '@deepseek-ai/dsh-enterprise-identity'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as LearningContext from '../src/index.ts'
import * as LearningPlugin from '../src/learning-plugin.ts'
import type { LearnEmployeeAssetInput } from '@deepseek-ai/dsh-enterprise-catalog'

const signal = new AbortController().signal

function resultText(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []).join('\n')
}

function agentAt(cwd: string, name = 'memory-agent'): Agent {
  const id = SessionId(name)
  const session = Session.create(id, [], { version: 0, id, createdAt: 1, cwd, isSeeded: false })
  return { id, session } as unknown as Agent
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

  async function setup(options: { allowOrganizationScope?: boolean; catalog?: unknown; managedRoot?: boolean } = {}) {
    root = await mkdtemp(join(tmpdir(), 'dsh-agent-auto-memory-'))
    const identity = new EnterpriseIdentityRepository(join(root, 'identity.sqlite'), { now: () => 1_700_000_000_000 })
    identity.createOrganization({ id: 'org-a', name: 'Org A' })
    identity.createUser({ id: 'admin-1', orgId: 'org-a', username: 'admin', displayName: 'Admin', disabled: false })
    identity.setRoles('admin-1', ['administrator'])
    identity.saveDepartment({
      id: 'dept-ops', orgId: 'org-a', parentId: null, name: 'Operations', sortOrder: 0, expectedRevision: 0,
    })
    identity.saveWorkspaceGrant({
      workspaceId: 'workspace-ops', orgId: 'org-a', name: 'Operations', kind: 'department',
      departmentId: 'dept-ops', rootPath: options.managedRoot ? root : '/managed/ops', sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    const ctx = new Context()
    context = ctx
    ctx.provide('enterprisePostgres' as never, { identity, catalog: options.catalog } as never)
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, JSON.stringify([
      { id: 'prompt', name: 'test-system-prompt', config: { includeHarnessIdentity: false, includeRuntimeContext: true, persona: '' } },
      { id: 'tools', name: 'test-tools' },
      { id: 'projections', name: 'test-projections' },
      { id: 'preset-projection', name: 'test-preset-projection' },
      ...(options.catalog === undefined ? [] : [{ id: 'self-learning', name: 'employee-self-learning' }]),
      { id: 'learning', name: 'enterprise-learning', config: { maxEntries: 20, maxChars: 8000, autoSave: true, actorUserId: 'admin-1', allowOrganizationScope: options.allowOrganizationScope ?? true } },
    ]))
    ctx.baseUrl = pathToFileURL(root).href + '/'
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['test-projections', { default: SessionProjectionRegistry }],
      ['test-preset-projection', { inject: ['sessionProjections'], apply(ctx: Context) { ctx.sessionProjections.register(agentPresetProjectionDefinition) } }],
      ['test-system-prompt', { default: SystemPrompt }], ['test-tools', { default: ToolRuntime }], ['enterprise-learning', LearningContext], ['employee-self-learning', LearningPlugin],
    ])
    ctx.loader.internal = { version: 'v2', async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected module ${specifier}`)
      return modules.get(specifier)
    } } as NonNullable<typeof ctx.loader.internal>
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
    const { ctx, identity } = await setup({ catalog, managedRoot: true })
    await writeFile(join(root, 'check.md'), '# Check totals\nVerify the totals.')
    const agent = { ...agentAt(root), session: Session.create(SessionId('learning'), [], { version: 0, id: SessionId('learning'), createdAt: 1, cwd: root, isSeeded: false, agentPreset: 'employee-old' }) } as Agent
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
    const { ctx, identity } = await setup()
    const result = await remember(ctx, {
      scope: 'department', kind: 'process', summary: '采购订单必须在入库前完成审批。',
    })

    expect(result.isError).toBe(false)
    const memories = identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })
    expect(memories).toEqual([expect.objectContaining({
      id: expect.stringMatching(/^agent-memory-[a-f0-9]{64}$/), scope: 'department', departmentId: 'dept-ops',
      kind: 'process', status: 'approved', summary: '采购订单必须在入库前完成审批。',
      createdBy: 'admin-1', reviewedBy: 'admin-1', reviewReason: 'Agent 自动评估并直接启用',
    })])
    const audit = identity.listAudit({ orgId: 'org-a', action: 'capability.manage', limit: 10 })
    expect(audit).toEqual([expect.objectContaining({
      actorUserId: 'admin-1', resourceType: 'enterprise-memory', resourceId: memories[0]?.id,
      details: expect.objectContaining({ source: 'agent-auto-memory', scope: 'department', sessionId: 'memory-agent' }),
    })])
    expect(JSON.stringify(audit)).not.toContain('采购订单必须')

    const prompt = await ctx.systemPrompt.assemble({ agent: agentAt('/managed/ops') })
    expect(prompt.sections.some(section => section.text.includes('remember_business_knowledge'))).toBe(true)
    expect(prompt.sections.some(section => section.text.includes('Creating SOP or SKILL.md files does not register enterprise capability assets.'))).toBe(true)
    identity.close()
  })

  it('is idempotent for the same normalized knowledge and scope', async () => {
    const { ctx, identity } = await setup()
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
    const { ctx, identity } = await setup()
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
    const { ctx, identity } = await setup()
    identity.setUserDepartments({
      orgId: 'org-a', userId: 'admin-1', departmentIds: ['dept-ops'],
      primaryDepartmentId: 'dept-ops', expectedRevision: 0,
    })
    identity.saveWorkspaceGrant({
      workspaceId: 'workspace-admin', orgId: 'org-a', name: 'Admin', kind: 'personal',
      ownerUserId: 'admin-1', rootPath: '/managed/admin', sandboxMode: 'workspace-write', expectedRevision: 0,
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

  it('rejects privacy findings and disabled organization scope without saving', async () => {
    const { ctx, identity } = await setup({ allowOrganizationScope: false })
    const sensitive = await remember(ctx, {
      scope: 'department', kind: 'business-fact', summary: 'password=enterprise-secret',
    })
    const organization = await remember(ctx, {
      scope: 'organization', kind: 'decision', summary: '公司统一使用年度合同模板。',
    })

    expect(sensitive.isError).toBe(true)
    expect(organization.isError).toBe(true)
    expect(resultText(sensitive)).toMatch(/privacy|credential/iu)
    expect(resultText(organization)).toMatch(/organization scope.*disabled/iu)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })).toEqual([])
    identity.close()
  })
})
