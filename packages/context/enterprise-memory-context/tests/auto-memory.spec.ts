import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { agentPresetProjectionDefinition } from '../../../preset/agent-preset-registry/src/session.ts'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import {
  attachSurfaceSession,
  ensureSurface,
  EnterpriseIdentityRepository,
  memorySourceDigest,
  type EnterpriseMemoryEntry,
} from '@deepseek-ai/dsh-enterprise-identity'
import { EmployeeAccountService, surfaceId } from '@deepseek-ai/dsh-employee-account'
import LlmRuntime, { createUserMessage, LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply, inject } from '../src/index.ts'
import { consolidationTunables } from '../src/consolidation.ts'
import { MemoryConsolidationRuntime } from '../src/consolidation-runtime.ts'
import * as LearningPlugin from '../src/learning-plugin.ts'
import type { LearnEmployeeAssetInput } from '@deepseek-ai/dsh-enterprise-catalog'

const signal = new AbortController().signal

function resultText(result: { content: readonly { type: string; text?: string }[] }): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text ?? ''] : []).join('\n')
}

/** One scripted tool-call model response carrying the given arguments. */
function toolCallChunks(rawCallId: string, name: string, args: object): StreamChunk[] {
  const callId = ToolCallId(rawCallId)
  const json = JSON.stringify(args)
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id: callId, name, argumentsDelta: json },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name, arguments: json } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

/** One scripted plain-text model response. */
function textChunks(text: string): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...Array.from(text, (char): StreamChunk => ({ type: 'text-delta', index: 0, text: char })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: text.length } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Scripted adapter serving one queued response per model request and recording every request. */
class ScriptAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []

  constructor(private readonly script: StreamChunk[][]) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const chunks = this.script.shift()
    if (chunks === undefined) throw new Error('ScriptAdapter: script exhausted')
    for (const chunk of chunks) yield chunk
  }
}

function agentAt(cwd: string, name = 'memory-agent'): Agent {
  const id = SessionId(name)
  const session = Session.create(id, [], { version: 4, id, createdAt: 1, cwd, isSeeded: false })
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

  /** Expose a surface-anchored employee resolution for one session id. A cordis service cannot
   * be re-provided, so the returned handle swaps the resolved actor between calls. */
  function provideAnchoredEmployee(
    ctx: Context,
    sessionId: string,
    actor: { orgId: string; userId: string; employeeId: string; projectId?: string } = { orgId: 'org-a', userId: 'member-1', employeeId: 'employee-1' },
  ): { set(actor: { orgId: string; userId: string; employeeId: string; projectId?: string } | undefined): void } {
    const box: { current: { orgId: string; userId: string; employeeId: string; projectId?: string } | undefined } = { current: actor }
    ctx.provide('employeeAccounts' as never, {
      resolveSessionActor: (asked: string) => (asked === sessionId ? box.current : undefined),
    } as never)
    return { set: (next: { orgId: string; userId: string; employeeId: string; projectId?: string } | undefined) => { box.current = next } }
  }

  /** Provide the project governance double that admits any principal to the active project-1
   * unless `member` is false, reporting the configured lifecycle state. `archive` moves the
   * project to its terminal archived state like the real service. A cordis service cannot
   * be re-provided, so the returned handle swaps the behavior between calls. */
  function provideProjectService(
    ctx: Context,
    options: { state?: string; member?: boolean } = {},
  ): {
    set(options: { state?: string; member?: boolean }): void
    archive(): Promise<{ orgId: string; name: string; state: string }>
  } {
    const box = { current: options }
    const projects = {
      get: async (projectId: string) => projectId === 'project-1'
        ? { orgId: 'org-a', name: '项目一', state: box.current.state ?? 'active' }
        : undefined,
      requireMember: async (orgId: string, projectId: string, principal: unknown) =>
        box.current.member === false || orgId !== 'org-a' || projectId !== 'project-1'
          ? undefined
          : { projectId, principal },
      archive: async () => {
        box.current = { ...box.current, state: 'archived' }
        return { orgId: 'org-a', name: '项目一', state: 'archived' }
      },
    }
    ctx.provide('enterpriseProjects' as never, projects as never)
    return {
      set: (next: { state?: string; member?: boolean }) => { box.current = next },
      archive: () => projects.archive(),
    }
  }

  /** One consolidation refinement response split across two deltas like a real stream. */
  function refinementChunks(text: string): StreamChunk[] {
    return [
      { type: 'text-delta', index: 0, text: text.slice(0, 4) },
      { type: 'text-delta', index: 0, text: text.slice(4) },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
  }

  /** Streaming double for the consolidation and distillation refinement calls; it records every
   * request and replays one queued response per call. */
  function refinementLlm(responses: string[]): {
    requests: GenerateOptions[]
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>
  } {
    const requests: GenerateOptions[] = []
    return {
      requests,
      stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        requests.push(options)
        const response = responses.shift() ?? ''
        return (async function* (): AsyncGenerator<StreamChunk> { yield* refinementChunks(response) })()
      },
    }
  }

  /** Execute one memory tool for the standard managed-workspace agent. */
  async function callTool(ctx: Context, name: string, args: unknown, agent: Agent = agentAt('/managed/ops')) {
    return ctx.tools.execute({
      signal, callId: ToolCallId(`${name}-call`), name, arguments: args, agent,
    })
  }

  /** Seed one approved shared memory owned by member-1. */
  function seedApprovedShared(
    identity: EnterpriseIdentityRepository,
    input: {
      id: string
      scope: 'organization' | 'department'
      departmentId?: string
      kind: EnterpriseMemoryEntry['kind']
      summary: string
    },
  ): void {
    const proposed = identity.proposeMemory({
      id: input.id, orgId: 'org-a', scope: input.scope,
      ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
      kind: input.kind, summary: input.summary, sourceDigest: memorySourceDigest(input.id), createdBy: 'member-1',
    })
    identity.reviewMemory({
      id: input.id, orgId: 'org-a', decision: 'approved', reviewedBy: 'member-1', reason: 'verified',
      expectedRevision: proposed.revision,
    })
  }

  /** Seed one private agent-compartment note for an employee account id. */
  function seedAgentNote(
    identity: EnterpriseIdentityRepository,
    summary: string,
    agentEmployeeId = 'employee-1',
  ): EnterpriseMemoryEntry {
    return identity.writePrivateMemory({
      orgId: 'org-a', scope: 'agent', kind: 'preference', summary, createdBy: 'member-1', agentEmployeeId,
    })
  }

  it('registers learned source files for the session employee and injects its learned content', async () => {
    const learnEmployeeAsset = vi.fn(async (input: LearnEmployeeAssetInput) => ({ asset: { assetId: input.assetId, version: 1 }, release: { releaseId: 'learned-release', version: 2 } }))
    const catalog = { learnEmployeeAsset, listReleases: vi.fn(async () => [{ snapshot: { bindings: [{ kind: 'sop', assetId: 'learned', version: 1 }] } }]),
      getAsset: vi.fn(async () => ({ archived: false })), listAssetVersions: vi.fn(async () => [{ version: 1, content: { learnedBy: 'employee-1', workspaceRoot: await realpath(root), name: 'Checking', content: 'Verify the totals.' } }]) }
    const { ctx, identity } = await setupLearning(catalog)
    await writeFile(join(root, 'check.md'), '# Check totals\nVerify the totals.')
    const agent = { ...agentAt(root), session: Session.create(SessionId('learning'), [], { version: 4, id: SessionId('learning'), createdAt: 1, cwd: root, isSeeded: false, agentPreset: 'employee-old' }) } as Agent
    identity.bindSessionWorkspace({ sessionId: String(agent.id), workspaceId: 'workspace-ops', orgId: 'org-a', ownerUserId: 'admin-1' })
    agent.session.append('agent-preset/selected', { agentPreset: 'employee-1' })
    const result = await ctx.tools.execute({ signal, callId: ToolCallId('learn'), rootCallId: ToolCallId('batch'), name: 'learn_employee_capability', arguments: { kind: 'sop', name: 'Checking', sourcePath: 'check.md' }, agent })
    expect(result.isError).toBe(false)
    expect(learnEmployeeAsset).toHaveBeenCalledWith(expect.objectContaining({ presetId: 'employee-1', orgId: 'org-a', kind: 'sop', content: expect.objectContaining({ sourcePath: 'check.md', learnedBy: 'employee-1', content: '# Check totals\nVerify the totals.' }) as unknown }))
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
      id: expect.stringMatching(/^agent-memory-[a-f0-9]{64}$/) as unknown, scope: 'department', departmentId: 'dept-ops',
      kind: 'process', status: 'approved', summary: '采购订单必须在入库前完成审批。',
      createdBy: 'member-1', reviewedBy: 'member-1', reviewReason: 'Agent 自动评估并直接启用',
    })])
    const audit = identity.listAudit({ orgId: 'org-a', action: 'capability.manage', limit: 10 })
    expect(audit).toEqual([expect.objectContaining({
      actorUserId: 'member-1', resourceType: 'enterprise-memory', resourceId: memories[0]?.id,
      details: expect.objectContaining({ source: 'agent-auto-memory', scope: 'department', sessionId: 'memory-agent' }) as unknown,
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
    expect(identity.resourcePolicy('enterprise-memory-autonomy', 'org-a:department:dept-ops')).toEqual(
      expect.objectContaining({
        orgId: 'org-a', creatorUserId: 'admin-1', allowedUserIds: expect.arrayContaining(['member-1', 'admin-1']) as unknown,
      }),
    )
    expect(identity.resourcePolicy('enterprise-memory-autonomy', 'org-b:department:dept-finance')).toEqual(
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
      expect.objectContaining({ actorUserId: 'member-1', details: expect.objectContaining({ autoApproved: true }) as unknown }),
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

  it('ranks memory_search by query hits, honors scopeFilter, and caps results', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    provideAnchoredEmployee(ctx, 'memory-agent')
    seedApprovedShared(identity, {
      id: 'org-note', scope: 'organization', kind: 'business-fact', summary: '合同审批需要部门复核。',
    })
    for (const index of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      seedApprovedShared(identity, {
        id: `filler-0${index}`, scope: 'organization', kind: 'business-fact', summary: `填充记忆${index}。`,
      })
    }
    const agentNote = seedAgentNote(identity, '偏好简短回答。')
    const pairNote = identity.writePrivateMemory({
      orgId: 'org-a', scope: 'pair', kind: 'preference', summary: '偏好中文回复。', createdBy: 'member-1', pairUserId: 'member-1',
    })
    seedAgentNote(identity, '其他员工的笔记。', 'employee-2')

    const search = await callTool(ctx, 'memory_search', { query: '合同' })
    expect(search.isError).toBe(false)
    const text = resultText(search)
    // Two points for the only keyword hit rank org-note first; the eight-result cap drops the tail.
    expect(text.indexOf('[org-note]')).toBeGreaterThanOrEqual(0)
    expect(text.indexOf('[org-note]')).toBeLessThan(text.indexOf('[filler-01]'))
    expect(text).not.toContain('[filler-08]')
    expect(text).not.toContain('[filler-09]')
    expect(text).not.toContain('其他员工的笔记')
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: [], statuses: ['approved'] })
      .find(entry => entry.id === 'org-note')?.lastAccessAt).toBeGreaterThan(0)

    const agents = await callTool(ctx, 'memory_search', { query: '偏好', scopeFilter: 'agent' })
    expect(agents.isError).toBe(false)
    expect(resultText(agents)).toContain('偏好简短回答。')
    expect(resultText(agents)).not.toContain('偏好中文回复。')

    const pairs = await callTool(ctx, 'memory_search', { query: '偏好', scopeFilter: 'pair' })
    expect(pairs.isError).toBe(false)
    expect(resultText(pairs)).toContain(pairNote.summary)

    const organizations = await callTool(ctx, 'memory_search', { query: '合同', scopeFilter: 'organization' })
    expect(organizations.isError).toBe(false)
    expect(resultText(organizations)).toContain('合同审批需要部门复核。')
    expect(resultText(organizations)).not.toContain(`[${agentNote.id}]`)
    identity.close()
  })

  it('writes a private agent note for an anchored employee and deduplicates it', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    provideAnchoredEmployee(ctx, 'memory-agent')

    const first = await callTool(ctx, 'memory_write', { scope: 'agent', kind: 'preference', summary: '偏好简短回答。' })
    expect(first.isError).toBe(false)
    expect(resultText(first)).toMatch(/Private note saved and active: /)
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['agent'], agentEmployeeId: 'employee-1' })).toEqual([
      expect.objectContaining({ scope: 'agent', kind: 'preference', status: 'approved', summary: '偏好简短回答。' }),
    ])

    const second = await callTool(ctx, 'memory_write', { scope: 'agent', kind: 'preference', summary: '偏好简短回答。' })
    expect(second.isError).toBe(false)
    expect(resultText(second)).toMatch(/Private note already recorded: /)
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['agent'], agentEmployeeId: 'employee-1' })).toHaveLength(1)

    const blank = await callTool(ctx, 'memory_write', { scope: 'agent', kind: 'preference', summary: '   ' })
    expect(blank.isError).toBe(true)
    expect(resultText(blank)).toMatch(/must not be empty/iu)
    identity.close()
  })

  it('writes approved project memory for a member of the anchored project and deduplicates it', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    provideAnchoredEmployee(ctx, 'memory-agent', {
      orgId: 'org-a', userId: 'member-1', employeeId: 'employee-1', projectId: 'project-1',
    })
    provideProjectService(ctx)

    const first = await callTool(ctx, 'memory_write', { scope: 'project', kind: 'business-fact', summary: '联调环境每晚重置。' })
    expect(first.isError).toBe(false)
    expect(resultText(first)).toMatch(/Project memory saved and active: /)
    const rows = () => identity.listMemories({ orgId: 'org-a', scopes: ['project'], projectId: 'project-1' })
    expect(rows()).toEqual([expect.objectContaining({
      scope: 'project', projectId: 'project-1', kind: 'business-fact', status: 'approved', createdBy: 'member-1',
    })])

    const second = await callTool(ctx, 'memory_write', { scope: 'project', kind: 'business-fact', summary: '联调环境每晚重置。' })
    expect(second.isError).toBe(false)
    expect(resultText(second)).toMatch(/Project memory already recorded: /)
    expect(rows()).toHaveLength(1)
    identity.close()
  })

  it('gates project writes on membership, project state, kind, privacy, and anchoring', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    provideAnchoredEmployee(ctx, 'memory-agent', {
      orgId: 'org-a', userId: 'member-1', employeeId: 'employee-1', projectId: 'project-1',
    })
    const projects = provideProjectService(ctx, { member: false })
    const foreign = await callTool(ctx, 'memory_write', { scope: 'project', kind: 'business-fact', summary: '非成员写入。' })
    expect(foreign.isError).toBe(true)
    expect(resultText(foreign)).toMatch(/requires project membership/iu)

    projects.set({ member: true, state: 'archived' })
    const archived = await callTool(ctx, 'memory_write', { scope: 'project', kind: 'business-fact', summary: '归档后写入。' })
    expect(archived.isError).toBe(true)
    expect(resultText(archived)).toMatch(/archived and accepts no new memory/iu)

    projects.set({})
    const preference = await callTool(ctx, 'memory_write', { scope: 'project', kind: 'preference', summary: '项目偏好不算项目记忆。' })
    expect(preference.isError).toBe(true)
    expect(resultText(preference)).toMatch(/preference is personal/iu)

    const gated = await callTool(ctx, 'memory_write', { scope: 'project', kind: 'business-fact', summary: '联系 alice@example.com 索取报告。' })
    expect(gated.isError).toBe(true)
    expect(resultText(gated)).toMatch(/privacy check failed/iu)
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['project'] })).toEqual([])
    identity.close()
  })

  it('keeps project memory unavailable without an anchored project or the project service', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    const actor = provideAnchoredEmployee(ctx, 'memory-agent')
    const unanchored = await callTool(ctx, 'memory_write', { scope: 'project', kind: 'business-fact', summary: '无锚定项目。' })
    expect(unanchored.isError).toBe(true)
    expect(resultText(unanchored)).toMatch(/anchored to a project/iu)

    actor.set({ orgId: 'org-a', userId: 'member-1', employeeId: 'employee-1', projectId: 'project-1' })
    const unmounted = await callTool(ctx, 'memory_write', { scope: 'project', kind: 'business-fact', summary: '无项目服务。' })
    expect(unmounted.isError).toBe(true)
    expect(resultText(unmounted)).toMatch(/project service, which is not mounted/iu)
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['project'] })).toEqual([])
    identity.close()
  })

  it('searches and reads the project compartment only for project-anchored member sessions', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    const row = identity.writePrivateMemory({
      orgId: 'org-a', scope: 'project', kind: 'business-fact', summary: '联调环境每晚重置。',
      createdBy: 'member-1', projectId: 'project-1',
    })
    seedApprovedShared(identity, { id: 'org-note', scope: 'organization', kind: 'business-fact', summary: '公司统一合同编号。' })

    const actor = provideAnchoredEmployee(ctx, 'memory-agent', {
      orgId: 'org-a', userId: 'member-1', employeeId: 'employee-1', projectId: 'project-1',
    })
    const projects = provideProjectService(ctx)
    const search = await callTool(ctx, 'memory_search', { query: '联调', scopeFilter: 'project' })
    expect(search.isError).toBe(false)
    expect(resultText(search)).toContain(`[${row.id}]`)
    const read = await callTool(ctx, 'memory_read', { ids: [row.id, 'org-note'] })
    expect(read.isError).toBe(false)
    expect(resultText(read)).toContain(`[${row.id}]`)
    expect(resultText(read)).toContain('[org-note]')

    // The same surface's non-member session resolves the project but sees no compartment.
    projects.set({ member: false })
    const outsider = await callTool(ctx, 'memory_search', { query: '联调', scopeFilter: 'project' })
    expect(outsider.isError).toBe(false)
    expect(resultText(outsider)).toMatch(/No approved enterprise memory matched/iu)

    // A session anchored to no project never queries the compartment either.
    projects.set({})
    actor.set({ orgId: 'org-a', userId: 'member-1', employeeId: 'employee-1' })
    const unanchored = await callTool(ctx, 'memory_search', { query: '联调', scopeFilter: 'project' })
    expect(unanchored.isError).toBe(false)
    expect(resultText(unanchored)).toMatch(/No approved enterprise memory matched/iu)
    identity.close()
  })

  it('keeps memory tools on an unanchored session read-only for shared compartments', async () => {
    const { ctx, identity } = await setup()

    const search = await callTool(ctx, 'memory_search', { query: 'anything' })
    expect(search.isError).toBe(false)
    expect(resultText(search)).toMatch(/No approved enterprise memory matched/iu)

    const read = await callTool(ctx, 'memory_read', { ids: ['whatever'] })
    expect(read.isError).toBe(false)
    expect(resultText(read)).toMatch(/None of the requested memory ids/iu)

    const retire = await callTool(ctx, 'memory_retire', { ids: ['whatever'] })
    expect(retire.isError).toBe(false)
    expect(resultText(retire)).toMatch(/No requested id belongs/iu)

    const write = await callTool(ctx, 'memory_write', { scope: 'agent', kind: 'preference', summary: '偏好简短回答。' })
    expect(write.isError).toBe(true)
    expect(resultText(write)).toMatch(/anchored employee session/iu)
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['agent'] })).toEqual([])

    const promote = await callTool(ctx, 'promote_proposal', {
      targetScope: 'organization', kind: 'decision', summary: '公司统一使用年度合同模板。', rationale: '全员适用。',
    })
    expect(promote.isError).toBe(true)
    expect(resultText(promote)).toMatch(/attribute the proposal/iu)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: [] })).toEqual([])
    identity.close()
  })

  it('requires an owning agent on an enterprise-managed workspace for memory tools', async () => {
    const { ctx } = await setup()
    const noAgent = await ctx.tools.execute({
      signal, callId: ToolCallId('no-agent'), name: 'memory_search', arguments: { query: 'x' },
    })
    expect(noAgent.isError).toBe(true)
    expect(resultText(noAgent)).toMatch(/owning Agent with a Workspace/iu)

    const noCwdAgent = {
      id: SessionId('no-cwd'),
      session: Session.create(SessionId('no-cwd'), [], { version: 4, id: SessionId('no-cwd'), createdAt: 1, isSeeded: false }),
    } as unknown as Agent
    const noCwd = await callTool(ctx, 'memory_search', { query: 'x' }, noCwdAgent)
    expect(noCwd.isError).toBe(true)
    expect(resultText(noCwd)).toMatch(/owning Agent with a Workspace/iu)

    const unmanaged = await callTool(ctx, 'memory_search', { query: 'x' }, agentAt('/unmanaged/other'))
    expect(unmanaged.isError).toBe(true)
    expect(resultText(unmanaged)).toMatch(/not enterprise-managed/iu)
  })

  it('reads only session-visible ids and silently omits foreign ones', async () => {
    const { ctx, identity } = await setup()
    provideAnchoredEmployee(ctx, 'memory-agent')
    seedApprovedShared(identity, { id: 'org-note', scope: 'organization', kind: 'business-fact', summary: '公司统一合同编号。' })
    seedApprovedShared(identity, {
      id: 'dept-note', scope: 'department', departmentId: 'dept-ops', kind: 'process', summary: '运营审批保留版本记录。',
    })
    const own = seedAgentNote(identity, '偏好简短回答。')
    const foreign = seedAgentNote(identity, '其他员工的笔记。', 'employee-2')
    const pair = identity.writePrivateMemory({
      orgId: 'org-a', scope: 'pair', kind: 'preference', summary: '偏好中文回复。', createdBy: 'member-1', pairUserId: 'member-1',
    })

    const result = await callTool(ctx, 'memory_read', { ids: ['org-note', 'dept-note', own.id, pair.id, foreign.id, 'missing-id'] })
    expect(result.isError).toBe(false)
    const text = resultText(result)
    expect(text).toContain('[org-note]')
    expect(text).toContain('[dept-note]')
    expect(text).toContain(`[${own.id}]`)
    expect(text).toContain(`[${pair.id}]`)
    expect(text).not.toContain(`[${foreign.id}]`)
    expect(text).not.toContain('其他员工的笔记')
    expect(text).not.toContain('[missing-id]')
    identity.close()
  })

  it('retires only own private entries and skips foreign ids without error', async () => {
    const { ctx, identity } = await setup()
    provideAnchoredEmployee(ctx, 'memory-agent')
    const own = seedAgentNote(identity, '过时的偏好。')
    const foreign = seedAgentNote(identity, '其他员工的笔记。', 'employee-2')
    const pair = identity.writePrivateMemory({
      orgId: 'org-a', scope: 'pair', kind: 'preference', summary: '偏好中文回复。', createdBy: 'member-1', pairUserId: 'member-1',
    })

    const result = await callTool(ctx, 'memory_retire', { ids: [own.id, foreign.id, 'missing-id'] })
    expect(result.isError).toBe(false)
    expect(resultText(result)).toContain(`Retired: ${own.id}`)
    const ownNotes = identity.listMemories({ orgId: 'org-a', scopes: ['agent'], agentEmployeeId: 'employee-1' })
    expect(ownNotes).toEqual([expect.objectContaining({ id: own.id, status: 'retired', reviewReason: 'memory_retire tool' })])
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['agent'], agentEmployeeId: 'employee-2' })).toEqual([
      expect.objectContaining({ id: foreign.id, status: 'approved' }),
    ])
    // The pair note sits in an own compartment but was not requested, so it stays approved.
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['pair'], pairUserId: 'member-1' })).toEqual([
      expect.objectContaining({ id: pair.id, status: 'approved' }),
    ])
    identity.close()
  })

  it('proposes shared memory with structured outcomes across actors', async () => {
    const { ctx, identity, requestContext } = await setup({ autoApproval: true })
    identity.setUserDepartments({
      orgId: 'org-a', userId: 'member-1', departmentIds: ['dept-ops'], primaryDepartmentId: 'dept-ops', expectedRevision: 0,
    })
    identity.setUserDepartments({ orgId: 'org-a', userId: 'admin-1', departmentIds: ['dept-ops'], expectedRevision: 0 })
    const memberArgs = {
      targetScope: 'department', kind: 'process', summary: '付款申请必须关联已审批发票。', rationale: '该流程在本部门反复出现。',
    }
    const proposed = await requestContext.run({ orgId: 'org-a', userId: 'member-1', roles: ['member'] }, () =>
      callTool(ctx, 'promote_proposal', memberArgs))
    expect(proposed.isError).toBe(false)
    expect(resultText(proposed)).toMatch(/submitted for review/)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'], statuses: ['proposed'] })).toEqual([
      expect.objectContaining({ scope: 'department', departmentId: 'dept-ops', status: 'proposed', createdBy: 'member-1' }),
    ])

    const duplicate = await requestContext.run({ orgId: 'org-a', userId: 'member-1', roles: ['member'] }, () =>
      callTool(ctx, 'promote_proposal', memberArgs))
    expect(duplicate.isError).toBe(false)
    expect(resultText(duplicate)).toMatch(/already stands/)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'], statuses: ['proposed'] })).toHaveLength(1)

    const soleDepartment = await requestContext.run({ orgId: 'org-a', userId: 'admin-1', roles: ['administrator'] }, () =>
      callTool(ctx, 'promote_proposal', {
        targetScope: 'department', kind: 'process', summary: '入库需要两人在场复核。', rationale: '部门入库流程。',
      }))
    expect(soleDepartment.isError).toBe(false)
    expect(resultText(soleDepartment)).toMatch(/submitted for review/)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'], statuses: ['proposed'] })).toHaveLength(2)

    const blank = await requestContext.run({ orgId: 'org-a', userId: 'member-1', roles: ['member'] }, () =>
      callTool(ctx, 'promote_proposal', { ...memberArgs, summary: '   ' }))
    expect(blank.isError).toBe(true)
    expect(resultText(blank)).toMatch(/must not be empty/iu)

    const audit = identity.listAudit({ orgId: 'org-a', action: 'capability.manage', limit: 10 })
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        actorUserId: 'member-1', resourceId: expect.stringMatching(/^agent-memory-[a-f0-9]{64}$/) as unknown,
        details: expect.objectContaining({ source: 'agent-memory-tools', rationale: '该流程在本部门反复出现。' }) as unknown,
      }),
    ]))
    identity.close()
  })

  it('rejects a department proposal when the actor resolves to no single department', async () => {
    const { ctx, identity, requestContext } = await setup()
    const result = await requestContext.run({ orgId: 'org-a', userId: 'member-1', roles: ['member'] }, () =>
      callTool(ctx, 'promote_proposal', {
        targetScope: 'department', kind: 'process', summary: '付款申请必须关联已审批发票。', rationale: '部门流程。',
      }))
    expect(result.isError).toBe(false)
    expect(resultText(result)).toMatch(/exactly one department/iu)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'] })).toEqual([])
    identity.close()
  })

  it('rejects a personal preference from shared memory with a structured result', async () => {
    const { ctx, identity, requestContext } = await setup()
    const runAsMember = <T>(fn: () => Promise<T>) =>
      requestContext.run({ orgId: 'org-a', userId: 'member-1', roles: ['member'] }, fn)
    const rejected = await runAsMember(() => callTool(ctx, 'promote_proposal', {
      targetScope: 'organization', kind: 'business-fact', summary: '我喜欢深色主题。', rationale: '常驻偏好。',
    }))
    expect(rejected.isError).toBe(false)
    expect(resultText(rejected)).toMatch(/never enter shared/iu)

    // A non-preference statement proposes normally through the same tool.
    const accepted = await runAsMember(() => callTool(ctx, 'promote_proposal', {
      targetScope: 'organization', kind: 'decision', summary: '公司统一使用年度合同模板。', rationale: '全员适用。',
    }))
    expect(accepted.isError).toBe(false)
    expect(resultText(accepted)).toMatch(/submitted for review/)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: [] })).toEqual([
      expect.objectContaining({ scope: 'organization', status: 'proposed', createdBy: 'member-1' }),
    ])
    identity.close()
  })

  it('throws when a matching approved shared memory already records the proposed statement', async () => {
    const { ctx, identity, requestContext } = await setup()
    const summary = '公司统一使用年度合同模板。'
    const digest = memorySourceDigest(JSON.stringify(['org-a', 'organization', null, 'process', summary]))
    seedApprovedShared(identity, { id: `agent-memory-${digest}`, scope: 'organization', kind: 'process', summary })
    const result = await requestContext.run({ orgId: 'org-a', userId: 'member-1', roles: ['member'] }, () =>
      callTool(ctx, 'promote_proposal', {
        targetScope: 'organization', kind: 'process', summary, rationale: '重复提升同一条陈述。',
      }))
    expect(result.isError).toBe(true)
    expect(resultText(result)).toMatch(/approved and cannot be promoted/iu)
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: [] })).toHaveLength(1)
    identity.close()
  })

  it('records memory tool calls as session log events while running the agent loop', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-agent-memory-loop-'))
    const identity = new EnterpriseIdentityRepository(join(root, 'identity.sqlite'), { now: () => 1_700_000_000_000 })
    identity.createOrganization({ id: 'org-a', name: 'Org A' })
    identity.createUser({ id: 'member-1', orgId: 'org-a', username: 'member', displayName: 'Member', disabled: false })
    identity.saveDepartment({ id: 'dept-ops', orgId: 'org-a', parentId: null, name: 'Operations', sortOrder: 0, expectedRevision: 0 })
    identity.saveWorkspaceGrant({
      workspaceId: 'workspace-ops', orgId: 'org-a', name: 'Operations', kind: 'department',
      departmentId: 'dept-ops', rootPath: '/managed/ops', sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    identity.bindSessionWorkspace({
      sessionId: 'loop-agent', workspaceId: 'workspace-ops', orgId: 'org-a', ownerUserId: 'member-1',
    })
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    ctx.provide('enterprisePostgres' as never, { identity } as never)
    ctx.provide('enterpriseRequestContext' as never, new EnterpriseRequestContext() as never)
    provideAnchoredEmployee(ctx, 'loop-agent')
    apply(ctx, { maxEntries: 20, maxChars: 8_000, autoSave: true })
    ctx.llm.registerAdapter(['mock'], new ScriptAdapter([
      toolCallChunks('memory-write-call', 'memory_write', { scope: 'agent', kind: 'preference', summary: '偏好简短回答。' }),
      textChunks('已记录你的偏好。'),
    ]))
    const agent = await ctx.agentLoop.create(SessionId('loop-agent'), { provider: 'mock', model: 'mock' }, { cwd: '/managed/ops' })
    agent.followup(createUserMessage({ content: [{ type: 'text', text: '记住我喜欢简短回答。' }], source: { kind: 'user' } }))
    await new Promise<void>((resolve) => {
      const dispose = ctx.on('agent/status', ({ agent: subject, status }) => {
        if (subject === agent && status === 'idle') {
          dispose()
          resolve()
        }
      })
    })

    const events = agent.session.snapshotEvents()
    const call = events.find(event => event.type === 'tool/call')
    expect(call?.type === 'tool/call' ? call.data.name : undefined).toBe('memory_write')
    expect(events.some(event => event.type === 'tool/result')).toBe(true)
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['agent'], agentEmployeeId: 'employee-1' })).toEqual([
      expect.objectContaining({ status: 'approved', summary: '偏好简短回答。' }),
    ])
    identity.close()
  })

  it('carries an employee note across sessions and through shared promotion end to end', async () => {
    const { ctx, identity } = await setup({ autoApproval: true })
    // The real surface→service actor chain over the same identity database: one employee
    // account, one dm surface bound to session A, and session B re-attached to that surface.
    const database = new DatabaseSync(join(root, 'identity.sqlite'))
    const accounts = new EmployeeAccountService(database)
    const employee = accounts.create({
      orgId: 'org-a', displayName: '档案员', roleCard: 'Archivist', homeWorkspacePath: '/managed/ops',
    })
    ensureSurface(database, {
      id: surfaceId('surface-employee-1'), orgId: 'org-a', kind: 'dm', userId: 'member-1',
      employeeId: employee.id, sessionId: 'session-a', createdAt: 1_700_000_000_000,
    })
    ctx.provide('employeeAccounts' as never, accounts as never)

    // Session A (same home workspace cwd as session B): the model records one private note.
    const write = await callTool(ctx, 'memory_write', {
      scope: 'agent', kind: 'preference', summary: '汇报优先给结论，再给依据。',
    }, agentAt('/managed/ops', 'session-a'))
    expect(write.isError).toBe(false)
    expect(resultText(write)).toMatch(/Private note saved and active: /)
    const privateRows = identity.listMemories({ orgId: 'org-a', scopes: ['agent'], agentEmployeeId: employee.id })
    expect(privateRows).toEqual([
      expect.objectContaining({ scope: 'agent', status: 'approved', summary: '汇报优先给结论，再给依据。' }),
    ])

    // Session B: the same surface resolves the same employee, so recall injects the note.
    attachSurfaceSession(database, surfaceId('surface-employee-1'), 'session-b')
    const sessionB = agentAt('/managed/ops', 'session-b')
    const prompt = await ctx.systemPrompt.assemble({ agent: sessionB })
    const memory = prompt.contexts.find(item => item.name === 'enterprise:memory')
    expect(memory?.text).toContain('[My notes]')
    expect(memory?.text).toContain('汇报优先给结论，再给依据。')

    // From session B, promote a company-wide finding; an administrator approves it in the store.
    const promote = await callTool(ctx, 'promote_proposal', {
      targetScope: 'organization', kind: 'decision', summary: '公司统一使用年度合同模板。', rationale: '全员适用。',
    }, sessionB)
    expect(promote.isError).toBe(false)
    expect(resultText(promote)).toMatch(/submitted for review/)
    const proposedRow = identity.listMemories({ orgId: 'org-a', departmentIds: [] })
      .find(row => row.summary === '公司统一使用年度合同模板。')
    expect(proposedRow).toEqual(expect.objectContaining({
      scope: 'organization', status: 'proposed', createdBy: 'member-1',
    }))
    if (proposedRow === undefined) throw new Error('proposed organization memory row is missing')
    const approvedRow = identity.reviewMemory({
      id: proposedRow.id, orgId: 'org-a', decision: 'approved', reviewedBy: 'admin-1',
      reason: 'verified', expectedRevision: proposedRow.revision,
    })
    expect(approvedRow.status).toBe('approved')

    // The approved shared memory reaches the next session-B assembly under its own label.
    const sharedPrompt = await ctx.systemPrompt.assemble({ agent: sessionB })
    const sharedMemory = sharedPrompt.contexts.find(item => item.name === 'enterprise:memory')
    expect(sharedMemory?.text).toContain('[Organization memory]')
    expect(sharedMemory?.text).toContain('公司统一使用年度合同模板。')

    // A personal preference is refused with the structured result and never becomes a shared row.
    const rejected = await callTool(ctx, 'promote_proposal', {
      targetScope: 'organization', kind: 'business-fact', summary: '我喜欢深色主题。', rationale: '常驻偏好。',
    }, sessionB)
    if (rejected.isError) expect.fail('a personal preference must be a structured refusal, not a tool error')
    expect(rejected.value).toEqual({ proposed: false, reason: 'personal-preference' })
    expect(identity.listMemories({ orgId: 'org-a', departmentIds: [] })
      .some(row => row.summary === '我喜欢深色主题。')).toBe(false)

    identity.close()
    database.close()
  })

  it('distills archived project lessons through review into organization recall and consolidates them', async () => {
    const NOW = 1_700_000_000_000
    const DAY_MS = 86_400_000
    const ACTOR = 'service:consolidator'
    const { ctx, identity } = await setup({ autoApproval: true })
    identity.createUser({ id: ACTOR, orgId: 'org-a', username: 'consolidator', displayName: 'Consolidator', disabled: false })
    provideAnchoredEmployee(ctx, 'memory-agent', {
      orgId: 'org-a', userId: 'member-1', employeeId: 'employee-1', projectId: 'project-1',
    })
    const projects = provideProjectService(ctx)

    // Project session writes three lessons: the near-duplicate pair both lands (the write dedupe
    // is exact-digest only) and the email-bearing one is refused, because the project compartment
    // sits under the same shared-scope privacy policy as organization and department.
    const lessonA = await callTool(ctx, 'memory_write', { scope: 'project', kind: 'business-fact', summary: '联调环境每晚重置，回归前必须重建测试数据。' })
    const lessonB = await callTool(ctx, 'memory_write', { scope: 'project', kind: 'business-fact', summary: '联调环境每晚重置，回归前必须重建测试数据集。' })
    const lessonWithEmail = await callTool(ctx, 'memory_write', { scope: 'project', kind: 'process', summary: '数据导出异常联系 alice@example.com 处理。' })
    expect(lessonA.isError).toBe(false)
    expect(lessonB.isError).toBe(false)
    expect(lessonWithEmail.isError).toBe(true)
    expect(resultText(lessonWithEmail)).toMatch(/privacy check failed/iu)
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['project'], projectId: 'project-1', statuses: ['approved'] }))
      .toHaveLength(2)

    // Archival closes the compartment to writes, then distillation proposes the lessons for
    // organization review. The refinement model is faked with two near-duplicate lessons so the
    // later consolidation run has a duplicate group to supersede.
    await projects.archive()
    const archivedWrite = await callTool(ctx, 'memory_write', { scope: 'project', kind: 'business-fact', summary: '归档后补写的教训。' })
    expect(archivedWrite.isError).toBe(true)
    expect(resultText(archivedWrite)).toMatch(/archived and accepts no new memory/iu)

    const llm = refinementLlm([
      JSON.stringify({ lessons: [
        { summary: '联调环境必须可随时重建。', targetScope: 'organization', rationale: '跨项目复用的环境前提。' },
        { summary: '联调环境必须可随时重建！', targetScope: 'organization', rationale: '每晚重置后的回归前提。' },
      ] }),
      JSON.stringify({ summary: '组织流程摘要：环境与结算的关键口径汇总。' }),
    ])
    ctx.provide('llm' as never, llm as never)
    const distill = await ctx.memoryConsolidation.distillProject({ orgId: 'org-a', projectId: 'project-1', actorUserId: ACTOR })
    expect(distill).toMatchObject({
      orgId: 'org-a', projectId: 'project-1', distilled: 2,
      droppedPrivacy: 0, droppedDepartment: 0, skippedDuplicate: 0, failed: 0,
    })
    const proposals = identity.listMemories({ orgId: 'org-a', departmentIds: [], statuses: ['proposed'] })
    expect(proposals).toHaveLength(2)
    expect(proposals.map(row => row.summary).sort()).toEqual(['联调环境必须可随时重建。', '联调环境必须可随时重建！'])
    expect(proposals.every(row => row.scope === 'organization' && row.kind === 'business-fact'
      && row.createdBy === ACTOR && row.id.startsWith('project-distill-'))).toBe(true)
    const distillAudit = identity.listAudit({ orgId: 'org-a', limit: 50 })
      .find(row => row.resourceType === 'enterprise-memory-consolidation' && row.details['pass'] === 'distill')
    expect(distillAudit).toMatchObject({
      actorUserId: ACTOR, decision: 'allowed', resourceId: 'org-a:project:project-1',
    })

    // An administrator approves both lessons and the next unanchored session of the same
    // organization recalls them under the organization label.
    for (const row of proposals) {
      identity.reviewMemory({
        id: row.id, orgId: 'org-a', decision: 'approved', reviewedBy: 'admin-1',
        reason: '结项教训核实', expectedRevision: row.revision,
      })
    }
    const closing = agentAt('/managed/ops', 'session-closing')
    const recall = await ctx.systemPrompt.assemble({ agent: closing })
    const recallMemory = recall.contexts.find(item => item.name === 'enterprise:memory')
    expect(recallMemory?.text).toContain('[Organization memory]')
    expect(recallMemory?.text).toContain('联调环境必须可随时重建。')
    expect(recallMemory?.text).toContain('联调环境必须可随时重建！')

    // Consolidation over the organization compartment: the near-duplicate distilled pair
    // supersedes onto one survivor, decay rewrites the pinned importance, the stale low-importance
    // entry retires, and the fresh digest supersedes the previous one.
    seedApprovedShared(identity, { id: 'org-digest-old', scope: 'organization', kind: 'summary', summary: '上一周期的组织记忆摘要。' })
    seedApprovedShared(identity, { id: 'org-decay', scope: 'organization', kind: 'decision', summary: '结算周期为 T+N。' })
    identity.batchUpdateImportance([{ id: 'org-decay', importance: 1, lastAccessAt: NOW - 30 * DAY_MS }])
    seedApprovedShared(identity, { id: 'org-stale', scope: 'organization', kind: 'decision', summary: '旧版供应商准入口径。' })
    identity.batchUpdateImportance([{ id: 'org-stale', importance: 0.05, lastAccessAt: NOW - 40 * DAY_MS }])
    const consolidation = new MemoryConsolidationRuntime(ctx, identity, {
      intervalMs: 0, orgIds: [], actorUserId: ACTOR,
      provider: 'deepseek', model: 'v4', maxTokens: 512, timeoutMs: 5_000,
      tunables: consolidationTunables(),
    }, { now: () => NOW })
    const report = await consolidation.runCompartment('org-a', { kind: 'shared', scope: 'organization' })
    expect(report).toMatchObject({
      orgId: 'org-a', superseded: 1, retired: 1, importanceUpdates: 3, digest: 'written',
      reflections: { proposed: 0, droppedPrivacy: 0, failed: 0 },
    })
    const rows = () => identity.listMemories({ orgId: 'org-a' })
    const survivor = rows().find(row => row.status === 'approved' && row.summary.startsWith('联调环境必须可随时重建'))
    const supersededDuplicate = rows().find(row => row.status === 'retired' && row.id.startsWith('project-distill-'))
    expect(survivor).toBeDefined()
    expect(supersededDuplicate).toMatchObject({ invalidatedBy: survivor?.id })
    expect(rows().find(row => row.id === 'org-decay')).toMatchObject({ status: 'approved' })
    expect(rows().find(row => row.id === 'org-decay')?.importance).toBeCloseTo(0.5, 6)
    expect(rows().find(row => row.id === 'org-stale')).toMatchObject({
      status: 'retired', reviewReason: 'consolidation retired decayed memory',
    })
    const digests = identity.listMemories({ orgId: 'org-a', kinds: ['summary'], statuses: ['approved'] })
    expect(digests).toHaveLength(1)
    expect(digests[0]).toMatchObject({ kind: 'summary', scope: 'organization', createdBy: ACTOR })
    expect(digests[0]?.summary).toBe('组织流程摘要：环境与结算的关键口径汇总。')
    expect(rows().find(row => row.id === 'org-digest-old')).toMatchObject({ status: 'retired', invalidatedBy: digests[0]?.id })

    // The flywheel closes: the superseded duplicate leaves recall while the survivor and the
    // fresh digest stay, and the reflection pass never called the model without agent notes.
    const flywheel = await ctx.systemPrompt.assemble({ agent: closing })
    const flywheelMemory = flywheel.contexts.find(item => item.name === 'enterprise:memory')
    expect(flywheelMemory?.text).toContain('[Organization memory]')
    expect(flywheelMemory?.text).toContain(survivor?.summary ?? '')
    const supersededText = ['联调环境必须可随时重建。', '联调环境必须可随时重建！'].find(text => text !== survivor?.summary)
    expect(flywheelMemory?.text).not.toContain(supersededText)
    expect(flywheelMemory?.text).toContain('组织流程摘要：环境与结算的关键口径汇总。')
    expect(llm.requests).toHaveLength(2)
    identity.close()
  })
})
