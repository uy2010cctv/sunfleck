import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { EnterpriseIdentityRepository, memorySourceDigest, type EnterpriseAuditRecord } from '@deepseek-ai/dsh-enterprise-identity'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { consolidationRuntimeConfig, MemoryConsolidationRuntime } from '../src/consolidation-runtime.ts'
import type { ConsolidationLlm } from '../src/consolidation-llm.ts'
import { distillProjectMemory, PROJECT_DISTILL_LESSON_LIMIT } from '../src/distillation.ts'
import type { ProjectDistillationProjects } from '../src/distillation.ts'

const NOW = 1_700_000_000_000
const ACTOR = 'user-1'

/** Split the response so the fake exercises multi-chunk delta assembly like a real stream. */
function textChunks(text: string): readonly StreamChunk[] {
  return [
    { type: 'text-delta', index: 0, text: text.slice(0, 4) },
    { type: 'text-delta', index: 0, text: text.slice(4) },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Stream stub recording every request and replaying one scripted response per call. */
function fakeLlm(responses: string[]): ConsolidationLlm & { requests: GenerateOptions[] } {
  const requests: GenerateOptions[] = []
  return {
    requests,
    stream: (request): AsyncIterable<StreamChunk> => {
      requests.push(request)
      const response = responses.shift() ?? ''
      return (async function* (): AsyncGenerator<StreamChunk> {
        if (request.signal?.aborted) throw new DOMException('distillation refinement timed out', 'AbortError')
        yield* textChunks(response)
      })()
    },
  }
}

/** Project governance double that knows one active project in org-a. */
function fakeProjects(options: { state?: string } = {}): ProjectDistillationProjects {
  return {
    get: async (projectId: string) => projectId === 'project-1'
      ? { orgId: 'org-a', name: '中台项目', state: options.state ?? 'active' }
      : undefined,
  }
}

describe('project distillation', () => {
  let root = ''

  afterEach(async () => {
    if (root !== '') {
      await rm(root, { recursive: true, force: true })
      root = ''
    }
  })

  function makeIdentity(name = 'identity.sqlite'): EnterpriseIdentityRepository {
    const identity = new EnterpriseIdentityRepository(join(root, name), { now: () => NOW })
    identity.createOrganization({ id: 'org-a', name: 'Org A' })
    identity.createUser({ id: ACTOR, orgId: 'org-a', username: 'alice', displayName: 'Alice', disabled: false })
    return identity
  }

  function seedProjectMemory(
    identity: EnterpriseIdentityRepository,
    input: { id: string; summary: string; kind?: 'business-fact' | 'summary' },
  ): void {
    const proposed = identity.proposeMemory({
      id: input.id, orgId: 'org-a', scope: 'project', projectId: 'project-1',
      kind: input.kind ?? 'business-fact', summary: input.summary,
      sourceDigest: memorySourceDigest(input.id), createdBy: ACTOR,
    })
    identity.reviewMemory({
      id: input.id, orgId: 'org-a', decision: 'approved', reviewedBy: ACTOR,
      reason: 'verified', expectedRevision: proposed.revision,
    })
  }

  function distillAudit(identity: EnterpriseIdentityRepository): EnterpriseAuditRecord[] {
    return identity.listAudit({ orgId: 'org-a', limit: 100 })
      .filter(row => row.resourceType === 'enterprise-memory-consolidation')
  }

  it('distills lessons, drops privacy and department targets, and proposes the survivors', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-project-distill-'))
    const identity = makeIdentity()
    seedProjectMemory(identity, { id: 'proj-one', summary: '项目联调环境每晚重置。' })
    seedProjectMemory(identity, { id: 'proj-two', summary: '客户数据导出必须走审批。' })
    seedProjectMemory(identity, { id: 'proj-digest', summary: '旧摘要。', kind: 'summary' })
    const llm = fakeLlm([JSON.stringify({ lessons: [
      { summary: '联调环境必须可随时重建。', targetScope: 'organization', rationale: '跨项目复用。' },
      { summary: '导出审批人 alice@example.com。', targetScope: 'organization', rationale: '合规。' },
      { summary: '该部门结算周期为 T+N。', targetScope: 'department', rationale: '部门流程。' },
    ] })])
    const audits: Array<{ reason: string; details: Record<string, unknown> }> = []

    const report = await distillProjectMemory({
      identity, projects: fakeProjects(), llm,
      options: { provider: 'deepseek', model: 'v4', maxTokens: 512, timeoutMs: 5_000 },
      now: () => NOW,
      audit: async (input) => { audits.push(input) },
    }, { orgId: 'org-a', projectId: 'project-1', actorUserId: ACTOR })

    // The summary row never feeds the model, and the request names the project.
    expect(llm.requests).toHaveLength(1)
    const payload = JSON.stringify(llm.requests[0]?.messages[0]?.content)
    expect(payload).toContain('中台项目')
    expect(payload).not.toContain('旧摘要')
    expect(report).toMatchObject({
      orgId: 'org-a', projectId: 'project-1', distilled: 1, droppedPrivacy: 1, droppedDepartment: 1,
      skippedDuplicate: 0, failed: 0, at: NOW,
    })
    const expectedDigest = memorySourceDigest(JSON.stringify(['project-1', '联调环境必须可随时重建。']))
    const proposal = identity.listMemories({ orgId: 'org-a', scopes: ['organization'], statuses: ['proposed'] })[0]
    expect(proposal).toMatchObject({
      id: `project-distill-${expectedDigest}`, kind: 'business-fact', status: 'proposed',
      summary: '联调环境必须可随时重建。', createdBy: ACTOR,
    })
    expect(audits).toHaveLength(1)
    // The department drop records a failure entry like the reflection pass does, so the run
    // reason names the partial application even though the report counts it separately.
    expect(audits[0]?.reason).toBe('project distillation applied with failures')
    expect(audits[0]?.details['distilled']).toBe(1)
    expect(audits[0]?.details['droppedPrivacy']).toBe(1)
    expect(audits[0]?.details['droppedDepartment']).toBe(1)
    expect(audits[0]?.details['proposals']).toEqual([{
      memoryId: `project-distill-${expectedDigest}`, targetScope: 'organization', rationale: '跨项目复用。',
    }])
    expect(audits[0]?.details['failures']).toEqual([expect.stringContaining('department target')])
    identity.close()
  })

  it('skips lessons whose deterministic id already stands and stays idempotent', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-project-distill-'))
    const identity = makeIdentity()
    seedProjectMemory(identity, { id: 'proj-one', summary: '项目联调环境每晚重置。' })
    const lesson = JSON.stringify({ lessons: [
      { summary: '联调环境必须可随时重建。', targetScope: 'organization', rationale: '跨项目复用。' },
    ] })
    const audits: Array<{ reason: string; details: Record<string, unknown> }> = []
    const deps = {
      identity, projects: fakeProjects(), llm: fakeLlm([lesson]) as ConsolidationLlm,
      options: { provider: 'deepseek', model: 'v4', maxTokens: 512, timeoutMs: 5_000 },
      now: () => NOW,
      audit: async (input: { reason: string; details: Record<string, unknown> }) => { audits.push(input) },
    }

    const first = await distillProjectMemory(deps, { orgId: 'org-a', projectId: 'project-1', actorUserId: ACTOR })
    expect(first.distilled).toBe(1)
    const second = await distillProjectMemory(
      { ...deps, llm: fakeLlm([lesson]) }, { orgId: 'org-a', projectId: 'project-1', actorUserId: ACTOR },
    )

    expect(second).toMatchObject({ distilled: 0, skippedDuplicate: 1, droppedPrivacy: 0, failed: 0 })
    expect(identity.listMemories({ orgId: 'org-a', statuses: ['proposed'] })).toHaveLength(1)
    expect(audits[1]?.details['skippedDuplicate']).toBe(1)
    identity.close()
  })

  it('resolves structured skips for an empty compartment, an unmounted llm, and a failed call', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-project-distill-'))
    const identity = makeIdentity()
    seedProjectMemory(identity, { id: 'proj-one', summary: '项目联调环境每晚重置。' })
    const audits: Array<{ reason: string; details: Record<string, unknown> }> = []
    const base = {
      identity, projects: fakeProjects(), llm: undefined,
      options: { provider: 'deepseek', model: 'v4', maxTokens: 512, timeoutMs: 5_000 },
      now: () => NOW,
      audit: async (input: { reason: string; details: Record<string, unknown> }) => { audits.push(input) },
    }

    await expect(distillProjectMemory(base, { orgId: 'org-a', projectId: 'project-1', actorUserId: ACTOR }))
      .resolves.toMatchObject({ distilled: 0, reason: 'llm-unavailable' })
    await expect(distillProjectMemory({ ...base, llm: fakeLlm(['not json']) }, { orgId: 'org-a', projectId: 'project-1', actorUserId: ACTOR }))
      .resolves.toMatchObject({ distilled: 0, reason: 'llm-failed' })
    await expect(distillProjectMemory(
      { ...base, llm: fakeLlm([JSON.stringify({ lessons: [] })]) },
      { orgId: 'org-a', projectId: 'project-empty', actorUserId: ACTOR },
    )).rejects.toThrow(/missing or outside organization/u)

    const emptyIdentity = makeIdentity('empty.sqlite')
    await expect(distillProjectMemory(
      { ...base, identity: emptyIdentity, llm: fakeLlm([JSON.stringify({ lessons: [] })]) },
      { orgId: 'org-a', projectId: 'project-1', actorUserId: ACTOR },
    )).resolves.toMatchObject({ distilled: 0, reason: 'empty' })
    expect(audits.map(audit => audit.reason)).toEqual([
      'distillation skipped without the llm service',
      'project distillation refinement failed',
      'distillation skipped for empty project compartment',
    ])
    expect(identity.listMemories({ orgId: 'org-a', statuses: ['proposed'] })).toEqual([])
    identity.close()
    emptyIdentity.close()
  })

  it('fails loud on an unmounted project service or a foreign project', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-project-distill-'))
    const identity = makeIdentity()
    seedProjectMemory(identity, { id: 'proj-one', summary: '项目联调环境每晚重置。' })
    const base = {
      identity, projects: undefined, llm: fakeLlm([]) as ConsolidationLlm,
      options: { provider: 'deepseek', model: 'v4', maxTokens: 512, timeoutMs: 5_000 },
      now: () => NOW,
      audit: async (): Promise<void> => {},
    }
    await expect(distillProjectMemory(base, { orgId: 'org-a', projectId: 'project-1', actorUserId: ACTOR }))
      .rejects.toThrow(/project service, which is not mounted/u)
    await expect(distillProjectMemory(
      { ...base, projects: fakeProjects() },
      { orgId: 'org-b', projectId: 'project-1', actorUserId: ACTOR },
    )).rejects.toThrow(/missing or outside organization/u)
    identity.close()
  })

  it('caps the lesson batch and distills through the runtime service surface', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-project-distill-'))
    const identity = makeIdentity()
    seedProjectMemory(identity, { id: 'proj-one', summary: '项目联调环境每晚重置。' })
    const overLimit = fakeLlm([JSON.stringify({ lessons: Array.from(
      { length: PROJECT_DISTILL_LESSON_LIMIT + 1 },
      () => ({ summary: '有效经验。', targetScope: 'organization', rationale: '长期有效。' }),
    ) })])
    const ok = fakeLlm([JSON.stringify({ lessons: [
      { summary: '联调环境必须可随时重建。', targetScope: 'organization', rationale: '跨项目复用。' },
    ] })])
    // One provide-safe `llm` service whose backing stub the test swaps between runs, because a
    // cordis service cannot be re-provided on the same context.
    const llmBox = { current: overLimit as ConsolidationLlm }
    const ctx = new Context()
    ctx.provide('llm' as never, { stream: (options: GenerateOptions) => llmBox.current.stream(options) } as never)
    ctx.provide('enterpriseProjects' as never, fakeProjects() as never)
    const runtime = new MemoryConsolidationRuntime(ctx, identity, consolidationRuntimeConfig({
      intervalMs: 0, orgIds: [], actorUserId: 'service:consolidator', provider: 'deepseek', model: 'v4',
      maxTokens: 512, timeoutMs: 5_000, tunables: {},
    }))

    // The runtime surface resolves the project service and llm lazily and audits in the
    // consolidation shape; an over-limit lesson list is a structured llm-failed skip.
    const report = await runtime.distillProject({ orgId: 'org-a', projectId: 'project-1', actorUserId: ACTOR })
    expect(report).toMatchObject({ distilled: 0 })
    expect(report.reason).toBe('llm-failed')
    const audit = distillAudit(identity).find(row => row.details['pass'] === 'distill')
    expect(audit).toMatchObject({
      actorUserId: ACTOR, resourceType: 'enterprise-memory-consolidation',
      resourceId: 'org-a:project:project-1',
    })
    expect(audit?.details['reason']).toBe('llm-failed')

    llmBox.current = ok
    const wired = await runtime.distillProject({ orgId: 'org-a', projectId: 'project-1', actorUserId: ACTOR })
    expect(wired.distilled).toBe(1)
    expect(wired.reason).toBeUndefined()
    expect(identity.listMemories({ orgId: 'org-a', statuses: ['proposed'] })).toHaveLength(1)
    identity.close()
  })
})
