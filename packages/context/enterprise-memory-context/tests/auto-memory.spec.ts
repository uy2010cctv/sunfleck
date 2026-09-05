import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { EnterpriseIdentityRepository } from '@deepseek-ai/dsh-enterprise-identity'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.ts'

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

  afterEach(async () => {
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
      for (const resourceId of ['department:dept-ops', 'organization']) {
        identity.putResourcePolicy({
          resourceType: 'enterprise-memory-autonomy', resourceId, orgId: 'org-a', creatorUserId: 'admin-1',
          visibility: 'organization', allowedUserIds: ['member-1', 'admin-1'],
        })
      }
    }
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true, persona: '' })
    await ctx.plugin(ToolRuntime)
    ctx.provide('enterprisePostgres' as never, { identity } as never)
    apply(ctx, {
      maxEntries: 20, maxChars: 8_000, autoSave: true,
      ...(options.backgroundServiceUserId === undefined ? {} : { backgroundServiceUserId: options.backgroundServiceUserId }),
    })
    return { ctx, identity }
  }

  async function remember(ctx: Context, args: unknown, agent: Agent = agentAt('/managed/ops')) {
    return ctx.tools.execute({
      signal, callId: ToolCallId('remember-call'), name: 'remember_business_knowledge', arguments: args, agent,
    })
  }

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
      createdBy: 'member-1', reviewedBy: 'member-1', reviewReason: expect.stringContaining('企业记忆自治策略'),
    })])
    const audit = identity.listAudit({ orgId: 'org-a', action: 'capability.manage', limit: 10 })
    expect(audit).toEqual([expect.objectContaining({
      actorUserId: 'member-1', resourceType: 'enterprise-memory', resourceId: memories[0]?.id,
      details: expect.objectContaining({ source: 'agent-auto-memory', scope: 'department', sessionId: 'memory-agent' }),
    })])
    expect(JSON.stringify(audit)).not.toContain('采购订单必须')

    const prompt = await ctx.systemPrompt.assemble({ agent: agentAt('/managed/ops') })
    expect(prompt.sections.some(section => section.text.includes('remember_business_knowledge'))).toBe(true)
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

  it('defaults to a proposal when no validated organization autonomy policy permits approval', async () => {
    const { ctx, identity } = await setup()
    const result = await remember(ctx, {
      scope: 'department', kind: 'process', summary: '采购订单必须在入库前完成审批。',
    })

    expect(result.isError).toBe(false)
    expect(resultText(result)).toMatch(/proposed for review/iu)
    const [memory] = identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })
    expect(memory).toEqual(expect.objectContaining({ createdBy: 'member-1', status: 'proposed' }))
    expect(memory).not.toHaveProperty('reviewedBy')
    expect(identity.listAudit({ orgId: 'org-a', action: 'capability.manage', limit: 10 })).toEqual([
      expect.objectContaining({ actorUserId: 'member-1', details: expect.objectContaining({ autoApproved: false }) }),
    ])
    identity.close()
  })

  it('uses an explicit service identity for unbound background automation', async () => {
    const { ctx, identity } = await setup({ backgroundServiceUserId: 'service:memory-bot' })
    const result = await remember(ctx, {
      scope: 'department', kind: 'process', summary: '后台任务仅记录已确认的业务规则。',
    }, agentAt('/managed/ops', 'background-agent'))

    expect(result.isError).toBe(false)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })).toEqual([
      expect.objectContaining({ createdBy: 'service:memory-bot', status: 'proposed' }),
    ])
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

  it('rejects privacy findings while organization memory remains proposed without policy approval', async () => {
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
    expect(resultText(organization)).toMatch(/proposed for review/iu)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: [] })).toEqual([
      expect.objectContaining({ scope: 'organization', status: 'proposed' }),
    ])
    identity.close()
  })
})
