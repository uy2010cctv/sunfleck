import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  EnterpriseIdentityRepository, memorySourceDigest,
  type EnterpriseIdentityStore, type EnterpriseMemoryEntry,
} from '@deepseek-ai/dsh-enterprise-identity'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { consolidationTunables } from '../src/consolidation.ts'
import type { ConsolidationLlm } from '../src/consolidation-llm.ts'
import {
  compartmentKey, compartmentTag, ConsolidationRunningError, consolidationRuntimeConfig,
  MemoryConsolidationRuntime, type MemoryConsolidationConfig,
} from '../src/consolidation-runtime.ts'

const NOW = Date.now()
const DAY_MS = 86_400_000
const ACTOR = 'service:consolidator'

/** Mutable fixture clock the identity repository stamps rows with; seed helpers set it per write. */
let fixtureClock = NOW

function makeIdentity(root: string): EnterpriseIdentityRepository {
  return new EnterpriseIdentityRepository(join(root, 'identity.sqlite'), { now: () => fixtureClock })
}

/** Seed org-a, the acting user, the consolidation service identity, and one department. */
function seedOrg(identity: EnterpriseIdentityRepository): void {
  identity.createOrganization({ id: 'org-a', name: 'Org A' })
  identity.createUser({ id: 'user-1', orgId: 'org-a', username: 'alice', displayName: 'Alice', disabled: false })
  identity.createUser({ id: ACTOR, orgId: 'org-a', username: 'consolidator', displayName: 'Consolidator', disabled: false })
  identity.saveDepartment({ id: 'dept-ops', orgId: 'org-a', name: 'Operations', parentId: null, sortOrder: 0, expectedRevision: 0 })
}

/** Propose and approve one shared or project memory at the given clock time. */
function seedApprovedMemory(
  identity: EnterpriseIdentityRepository,
  input: {
    id: string
    scope: EnterpriseMemoryEntry['scope']
    departmentId?: string
    projectId?: string
    kind: EnterpriseMemoryEntry['kind']
    summary: string
    at: number
  },
): EnterpriseMemoryEntry {
  fixtureClock = input.at
  const proposed = identity.proposeMemory({
    id: input.id, orgId: 'org-a', scope: input.scope,
    ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
    ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
    kind: input.kind, summary: input.summary, sourceDigest: memorySourceDigest(input.id), createdBy: 'user-1',
  })
  return identity.reviewMemory({
    id: input.id, orgId: 'org-a', decision: 'approved', reviewedBy: 'user-1', reason: 'verified',
    expectedRevision: proposed.revision,
  })
}

/** Write one approved agent note and pin its importance and access clock through the batch API. */
function seedAgentNote(
  identity: EnterpriseIdentityRepository,
  input: { summary: string; at: number; importance: number },
): string {
  fixtureClock = input.at
  const written = identity.writePrivateMemory({
    orgId: 'org-a', scope: 'agent', kind: 'preference', summary: input.summary, createdBy: 'user-1',
    agentEmployeeId: 'employee-1',
  })
  identity.batchUpdateImportance([{ id: written.id, importance: input.importance, lastAccessAt: input.at }])
  return written.id
}

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
        if (request.signal?.aborted) throw new DOMException('consolidation refinement timed out', 'AbortError')
        yield* textChunks(response)
      })()
    },
  }
}

/** One provide-safe `llm` service whose backing stub the test can swap between runs, because a
 * cordis service cannot be re-provided on the same context. */
function llmService(initial: ConsolidationLlm): { current: ConsolidationLlm; service: ConsolidationLlm } {
  const box: { current: ConsolidationLlm } = { current: initial }
  return {
    get current() { return box.current },
    set current(value: ConsolidationLlm) { box.current = value },
    service: { stream: options => box.current.stream(options) },
  }
}

/** Stream stub whose completion the test controls, for pinning the in-flight guard. */
function gatedLlm(): ConsolidationLlm & { release: () => void } {
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  return {
    release,
    stream: (): AsyncIterable<StreamChunk> =>
      (async function* (): AsyncGenerator<StreamChunk> { await gate; yield* textChunks('{"summary":"gated"}') })(),
  }
}

/** Delegating store double whose listed methods fail on their first calls to drive failure
 * recording; every other method passes through to the real repository. */
function flakyIdentity(
  identity: EnterpriseIdentityStore,
  overrides: Record<string, (attempt: number, args: unknown[]) => unknown>,
): EnterpriseIdentityStore {
  const attempts: Record<string, number> = {}
  return new Proxy(identity, {
    get(target, property: string | symbol): unknown {
      if (typeof property !== 'string') return Reflect.get(target, property, target) as unknown
      const override = overrides[property]
      if (override !== undefined) {
        return (...args: unknown[]) => {
          const attempt = (attempts[property] = (attempts[property] ?? 0) + 1)
          return override(attempt, args)
        }
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    },
  })
}

function config(overrides: Partial<MemoryConsolidationConfig> = {}): MemoryConsolidationConfig {
  return {
    intervalMs: 0, orgIds: [], actorUserId: ACTOR,
    provider: 'deepseek', model: 'v4', maxTokens: 512, timeoutMs: 5_000,
    tunables: consolidationTunables(),
    ...overrides,
  }
}

/** List the consolidation audit records of org-a. */
function auditRows(identity: EnterpriseIdentityRepository): ReturnType<EnterpriseIdentityRepository['listAudit']> {
  return identity.listAudit({ orgId: 'org-a', limit: 100 })
    .filter(row => row.resourceType === 'enterprise-memory-consolidation')
}

describe('memory consolidation runtime', () => {
  let root = ''

  afterEach(async () => {
    vi.useRealTimers()
    if (root !== '') {
      await rm(root, { recursive: true, force: true })
      root = ''
    }
  })

  it('supersedes duplicates, decays importance, and writes a gated digest in one run', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    seedApprovedMemory(identity, {
      id: 'org-old', scope: 'organization', kind: 'process',
      summary: '公司统一使用电子合同签署平台。', at: NOW - 2 * DAY_MS,
    })
    seedApprovedMemory(identity, {
      id: 'org-new', scope: 'organization', kind: 'process',
      summary: '公司统一使用电子合同签署平台！', at: NOW - DAY_MS,
    })
    seedApprovedMemory(identity, {
      id: 'org-decay', scope: 'organization', kind: 'decision', summary: '结算周期为 T+N。', at: NOW - 30 * DAY_MS,
    })
    // Pin a decayable importance of 1; the access clock stays at the seeded 30-days-ago write.
    identity.batchUpdateImportance([{ id: 'org-decay', importance: 1 }])
    const ctx = new Context()
    const llm = fakeLlm([JSON.stringify({ summary: '公司合同与结算流程摘要。' })])
    ctx.provide('llm' as never, llm as never)
    const runtime = new MemoryConsolidationRuntime(ctx, identity, config())
    const report = await runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' })

    // Duplicate: the older exact-normalized twin retired and superseded by the survivor.
    expect(report).toMatchObject({ orgId: 'org-a', superseded: 1, retired: 0, digest: 'written' })
    expect(report.compartment).toEqual({ kind: 'shared', scope: 'organization' })
    expect(report.reflections).toEqual({ proposed: 0, droppedPrivacy: 0, failed: 0 })
    const superseded = identity.listMemories({ orgId: 'org-a' }).find(entry => entry.id === 'org-old')
    expect(superseded).toMatchObject({ status: 'retired', invalidatedBy: 'org-new' })
    // Decay: 30 days at a 30-day half life halves the pinned importance of 1 (the live run
    // clock sits milliseconds past the fixture write, hence the tolerance).
    const decayed = identity.listMemories({ orgId: 'org-a' }).find(entry => entry.id === 'org-decay')
    expect(decayed?.status).toBe('approved')
    expect(decayed?.importance).toBeCloseTo(0.5, 6)
    // Digest: written through the proposal store, activated by consolidation, and attributed
    // to the service actor.
    const digest = identity.listMemories({ orgId: 'org-a', kinds: ['summary'], statuses: ['approved'] })[0]
    expect(digest).toMatchObject({ kind: 'summary', status: 'approved', createdBy: ACTOR, scope: 'organization' })
    expect(digest?.summary).toBe('公司合同与结算流程摘要。')
    expect(digest?.id).toBe(`consolidation-digest-${digest?.sourceDigest}`)
    // Audit: one record per pass (newest first) in the writeback store-audit shape.
    const passes = auditRows(identity).map(row => row.details['pass'])
    expect(passes).toHaveLength(3)
    expect(new Set(passes)).toEqual(new Set(['structure', 'digest', 'reflection']))
    expect(auditRows(identity).every(row => row.actorUserId === ACTOR && row.decision === 'allowed')).toBe(true)
    identity.close()
  })

  it('reports an identical regenerated digest as unchanged without superseding', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    seedApprovedMemory(identity, {
      id: 'org-one', scope: 'organization', kind: 'process', summary: '月度报表每月 5 日前完成。', at: NOW - DAY_MS,
    })
    const ctx = new Context()
    const response = JSON.stringify({ summary: '月度报表流程摘要。' })
    const llm = llmService(fakeLlm([response]))
    ctx.provide('llm' as never, llm.service as never)
    const runtime = new MemoryConsolidationRuntime(ctx, identity, config())
    const first = await runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' })
    const live = identity.listMemories({ orgId: 'org-a', kinds: ['summary'] })
    llm.current = fakeLlm([response])
    const second = await runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' })

    expect(first.digest).toBe('written')
    expect(second.digest).toBe('unchanged')
    expect(identity.listMemories({ orgId: 'org-a', kinds: ['summary'] })).toEqual(live)
    identity.close()
  })

  it('skips the digest on privacy findings and on refinement failure', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    seedApprovedMemory(identity, {
      id: 'org-one', scope: 'organization', kind: 'process', summary: '月度报表每月 5 日前完成。', at: NOW - DAY_MS,
    })
    const runtime = new MemoryConsolidationRuntime(new Context(), identity, config())
    // Hand-off: the digest gate classifies the summary against the compartment scope before any
    // persistence, so a digest carrying a shared-blocking finding never reaches proposeMemory.
    const ctxPrivacy = new Context()
    ctxPrivacy.provide('llm' as never, fakeLlm([JSON.stringify({ summary: '联系 alice@example.com 索取报表。' })]) as never)
    const privacy = new MemoryConsolidationRuntime(ctxPrivacy, identity, config())
    await expect(privacy.runCompartment('org-a', { kind: 'shared', scope: 'organization' }))
      .resolves.toMatchObject({ digest: 'skipped-privacy' })
    // Refinement failure is a structured skip over a non-empty compartment.
    const ctxBroken = new Context()
    ctxBroken.provide('llm' as never, fakeLlm(['not json']) as never)
    const broken = new MemoryConsolidationRuntime(ctxBroken, identity, config())
    await expect(broken.runCompartment('org-a', { kind: 'shared', scope: 'organization' }))
      .resolves.toMatchObject({ digest: 'skipped-llm' })
    // Without the llm service the pass skips the same way.
    await expect(runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' }))
      .resolves.toMatchObject({ digest: 'skipped-llm' })
    expect(identity.listMemories({ orgId: 'org-a', kinds: ['summary'] })).toEqual([])
    identity.close()
  })

  it('keeps an empty compartment unchanged without a model call and defers project digests', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    const ctx = new Context()
    const llm = llmService(fakeLlm([]))
    ctx.provide('llm' as never, llm.service as never)
    const runtime = new MemoryConsolidationRuntime(ctx, identity, config())
    await expect(runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' }))
      .resolves.toMatchObject({ digest: 'unchanged' })
    expect((llm.current as ReturnType<typeof fakeLlm>).requests).toHaveLength(0)

    seedApprovedMemory(identity, {
      id: 'proj-one', scope: 'project', projectId: 'project-1', kind: 'process',
      summary: '项目评审每周三进行。', at: NOW - DAY_MS,
    })
    const projectLlm = fakeLlm([JSON.stringify({ summary: '项目摘要。' })])
    llm.current = projectLlm
    const project = await runtime.runCompartment('org-a', { kind: 'project', projectId: 'project-1' })
    // P3 keeps digests in the shared compartments: the structure pass ran, the digest did not.
    expect(project).toMatchObject({ digest: 'unchanged', importanceUpdates: 1 })
    expect(projectLlm.requests).toHaveLength(0)
    expect(identity.listMemories({ orgId: 'org-a', kinds: ['summary'] })).toEqual([])
    identity.close()
  })

  it('proposes organization reflections, drops privacy-blocked ones, and records the rationale in audit only', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    const note = seedAgentNote(identity, {
      summary: '团队约定评审输出必须带验收清单。', at: NOW - DAY_MS, importance: 1,
    })
    const ctx = new Context()
    const rationale = '多个 notes 重复记录同一约定，值得共享。'.padEnd(600, '补')
    const llm = fakeLlm([JSON.stringify({ reflections: [
      { summary: '评审输出必须带验收清单。', targetScope: 'organization', rationale },
      { summary: '联系 alice@example.com 确认。', targetScope: 'organization', rationale: '联系人' },
      { summary: '该部门结算周期为 T+N。', targetScope: 'department', rationale: '流程' },
    ] })])
    ctx.provide('llm' as never, llm as never)
    const runtime = new MemoryConsolidationRuntime(ctx, identity, config())
    const report = await runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' })

    expect(report.reflections).toEqual({ proposed: 1, droppedPrivacy: 1, failed: 1 })
    const proposal = identity.listMemories({ orgId: 'org-a', statuses: ['proposed'] })[0]
    expect(proposal).toMatchObject({ status: 'proposed', kind: 'business-fact', createdBy: ACTOR })
    expect(proposal?.summary).toBe('评审输出必须带验收清单。')
    // The candidate note itself stays an approved agent row.
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['agent'], statuses: ['approved'] })
      .find(entry => entry.id === note)).toMatchObject({ scope: 'agent' })
    // Hand-off: the rationale is capped at 500 characters and lives in the audit record only.
    const reflectionAudit = auditRows(identity).find(row => row.details['pass'] === 'reflection')
    const proposals = reflectionAudit?.details['proposals'] as Array<{ rationale: string; memoryId: string }>
    expect(proposals).toHaveLength(1)
    expect(proposals[0]?.rationale).toHaveLength(500)
    expect(proposals[0]?.memoryId).toBe(proposal?.id)
    identity.close()
  })

  it('counts a standing reflection proposal without re-proposing it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    seedAgentNote(identity, { summary: '团队约定评审输出必须带验收清单。', at: NOW - DAY_MS, importance: 1 })
    const ctx = new Context()
    const reflection = JSON.stringify({ reflections: [
      { summary: '评审输出必须带验收清单。', targetScope: 'organization', rationale: '重复记录' },
    ] })
    const llm = llmService(fakeLlm([reflection]))
    ctx.provide('llm' as never, llm.service as never)
    const runtime = new MemoryConsolidationRuntime(ctx, identity, config())
    await runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' })
    llm.current = fakeLlm([reflection])
    const second = await runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' })

    expect(second.reflections).toEqual({ proposed: 1, droppedPrivacy: 0, failed: 0 })
    expect(identity.listMemories({ orgId: 'org-a', statuses: ['proposed'] })).toHaveLength(1)
    identity.close()
  })

  it('records per-row failures without aborting the run', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    seedApprovedMemory(identity, {
      id: 'org-a-one', scope: 'organization', kind: 'process', summary: '公司统一使用电子合同签署平台。', at: NOW - 2 * DAY_MS,
    })
    seedApprovedMemory(identity, {
      id: 'org-a-two', scope: 'organization', kind: 'process', summary: '公司统一使用电子合同签署平台！', at: NOW - DAY_MS,
    })
    const flaky = flakyIdentity(identity, {
      // First supersede call fails; the duplicate stays and the run continues. The concrete
      // repository supersede is synchronous, so the pass-through is a plain statement.
      supersedeMemory: (attempt, args) => {
        if (attempt === 1) throw new Error('store busy')
        identity.supersedeMemory(args[0] as string, args[1] as string, args[2] as number)
      },
    })
    const ctx = new Context()
    ctx.provide('llm' as never, fakeLlm(['not json']) as never)
    const runtime = new MemoryConsolidationRuntime(ctx, flaky, config())
    const report = await runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' })

    expect(report.superseded).toBe(0)
    expect(report.digest).toBe('skipped-llm')
    const structure = auditRows(identity).find(row => row.details['pass'] === 'structure')
    expect(structure?.reason).toContain('with failures')
    expect(structure?.details['failures']).toEqual([expect.stringContaining('supersede org-a-one: Error: store busy')])
    identity.close()
  })

  it('retires decayed entries through the review path and records retire failures', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    seedApprovedMemory(identity, {
      id: 'org-stale', scope: 'organization', kind: 'decision', summary: '旧决策已无参考价值。', at: NOW - 40 * DAY_MS,
    })
    identity.batchUpdateImportance([{ id: 'org-stale', importance: 0.05 }])
    // First review call fails (a stale revision conflict); the next run of the same entry
    // retires cleanly, so both branches of the retire recording stay pinned.
    const flaky = flakyIdentity(identity, {
      reviewMemory: (attempt, args) => {
        if (attempt === 1) throw new Error('revision conflict')
        return identity.reviewMemory(args[0] as Parameters<EnterpriseIdentityRepository['reviewMemory']>[0])
      },
    })
    const ctx = new Context()
    const runtime = new MemoryConsolidationRuntime(ctx, flaky, config())
    const failed = await runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' })
    expect(failed.retired).toBe(0)
    expect(auditRows(identity).some(row => row.details['pass'] === 'structure'
      && JSON.stringify(row.details['failures']).includes('retire org-stale'))).toBe(true)

    const clean = new MemoryConsolidationRuntime(ctx, identity, config())
    const report = await clean.runCompartment('org-a', { kind: 'shared', scope: 'organization' })
    expect(report.retired).toBe(1)
    expect(identity.listMemories({ orgId: 'org-a' }).find(entry => entry.id === 'org-stale'))
      .toMatchObject({ status: 'retired', reviewReason: 'consolidation retired decayed memory' })
    identity.close()
  })

  it('skips an overlapping run of the same compartment and throws for the manual caller', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    seedApprovedMemory(identity, {
      id: 'org-one', scope: 'organization', kind: 'process', summary: '月度报表每月 5 日前完成。', at: NOW - DAY_MS,
    })
    const ctx = new Context()
    const gated = gatedLlm()
    const llm = llmService(gated)
    ctx.provide('llm' as never, llm.service as never)
    const runtime = new MemoryConsolidationRuntime(ctx, identity, config())
    const first = runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' })
    await expect(runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' }))
      .rejects.toThrow(ConsolidationRunningError)
    // A different compartment never shares the guard key.
    await expect(runtime.runCompartment('org-a', { kind: 'shared', scope: 'department', departmentId: 'dept-ops' }))
      .resolves.toMatchObject({ compartment: { kind: 'shared', scope: 'department' } })
    gated.release()
    await expect(first).resolves.toMatchObject({ digest: 'written' })
    // The guard clears on completion, so the next run proceeds.
    llm.current = fakeLlm([JSON.stringify({ summary: '后续摘要。' })])
    await expect(runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' }))
      .resolves.toMatchObject({ digest: 'written' })
    identity.close()
  })

  it('fails loud when the consolidation actor does not resolve in the org', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    const runtime = new MemoryConsolidationRuntime(new Context(), identity, config({ actorUserId: 'service:ghost' }))
    await expect(runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' }))
      .rejects.toThrow(/actor is unavailable/u)
    identity.close()
  })

  it('runs the interval per configured org and stops on close', async () => {
    vi.useFakeTimers()
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    seedApprovedMemory(identity, {
      id: 'org-one', scope: 'organization', kind: 'process', summary: '月度报表每月 5 日前完成。', at: NOW - DAY_MS,
    })
    const ctx = new Context()
    const runtime = new MemoryConsolidationRuntime(ctx, identity, config({ intervalMs: 10, orgIds: ['org-a'] }))
    await runtime.start()
    await vi.advanceTimersByTimeAsync(10)
    expect(auditRows(identity).map(row => row.details['pass'])).toContain('structure')
    runtime.close()

    // A foreign org only logs its failure; no audit rows appear for it.
    const warn = vi.spyOn(ctx.logger, 'warn')
    const foreign = new MemoryConsolidationRuntime(ctx, identity, config({ intervalMs: 10, orgIds: ['org-x'] }))
    await foreign.start()
    await vi.advanceTimersByTimeAsync(10)
    expect(warn).toHaveBeenCalledOnce()
    foreign.close()

    // intervalMs 0 starts no timer at all.
    const baseline = auditRows(identity).length
    const disabled = new MemoryConsolidationRuntime(ctx, identity, config({ intervalMs: 0, orgIds: ['org-a'] }))
    await disabled.start()
    await vi.advanceTimersByTimeAsync(1_000_000)
    expect(auditRows(identity)).toHaveLength(baseline)
    disabled.close()
    identity.close()
  })

  it('pins the decay anchor: untouched entries re-apply the full anchor age each run, recall resets it', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    seedApprovedMemory(identity, {
      id: 'org-decay', scope: 'organization', kind: 'decision', summary: '结算周期为 T+N。', at: NOW,
    })
    // Pin importance 1 anchored at the seeded updatedAt; consolidation never writes the clock.
    identity.batchUpdateImportance([{ id: 'org-decay', importance: 1 }])
    let clock = NOW + 30 * DAY_MS
    const ctx = new Context()
    const runtime = new MemoryConsolidationRuntime(ctx, identity, config(), { now: () => clock })

    const first = await runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' })
    expect(first.retired).toBe(0)
    expect(identity.listMemories({ orgId: 'org-a' }).find(entry => entry.id === 'org-decay')?.importance)
      .toBe(0.5)

    // Second run with no access in between: the full anchor age (60d) is re-applied to the
    // already-decayed 0.5, so the stored weight compounds to 0.125 instead of the true anchored
    // 0.25. Pinned intentionally — see the structurePass anchor note.
    clock = NOW + 60 * DAY_MS
    const second = await runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' })
    expect(second.retired).toBe(0)
    expect(identity.listMemories({ orgId: 'org-a' }).find(entry => entry.id === 'org-decay')?.importance)
      .toBe(0.125)

    // Recall advances the anchor, so the next run decays only the elapsed window; here the
    // decayed weight also crosses the retirement threshold and the stale entry retires.
    identity.touchMemoryAccess('org-decay', NOW + 59 * DAY_MS)
    clock = NOW + 90 * DAY_MS
    const third = await runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' })
    expect(third.retired).toBe(1)
    const decayed = identity.listMemories({ orgId: 'org-a' }).find(entry => entry.id === 'org-decay')
    expect(decayed?.status).toBe('retired')
    expect(decayed?.importance).toBeCloseTo(0.125 * 0.5 ** (31 / 30), 12)
    identity.close()
  })

  it('fails loud when a rejected digest is regenerated with identical text', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    seedApprovedMemory(identity, {
      id: 'org-one', scope: 'organization', kind: 'process', summary: '月度报表每月 5 日前完成。', at: NOW - DAY_MS,
    })
    // A digest row left proposed by a crashed run and then rejected by an administrator keeps
    // the deterministic id; regenerating identical text must hit the store id conflict.
    const digestText = '报表流程摘要。'
    const sourceDigest = memorySourceDigest(JSON.stringify(['org-a', 'organization', 'summary', digestText]))
    const digestId = `consolidation-digest-${sourceDigest}`
    const proposed = identity.proposeMemory({
      id: digestId, orgId: 'org-a', scope: 'organization', kind: 'summary',
      summary: digestText, sourceDigest, createdBy: 'user-1',
    })
    identity.reviewMemory({
      id: digestId, orgId: 'org-a', decision: 'rejected', reviewedBy: 'user-1',
      reason: '不适宜共享', expectedRevision: proposed.revision,
    })
    const ctx = new Context()
    ctx.provide('llm' as never, fakeLlm([JSON.stringify({ summary: digestText })]) as never)
    const runtime = new MemoryConsolidationRuntime(ctx, identity, config())

    await expect(runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' }))
      .rejects.toThrow(/UNIQUE constraint failed: enterprise_memories\.id/u)
    const summaries = identity.listMemories({ orgId: 'org-a', kinds: ['summary'] })
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({ id: digestId, status: 'rejected' })
    identity.close()
  })

  it('marks reflection as structurally skipped when the llm service is unmounted', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-consolidation-runtime-'))
    const identity = makeIdentity(root)
    seedOrg(identity)
    seedAgentNote(identity, { summary: '团队约定评审输出必须带验收清单。', at: NOW - DAY_MS, importance: 1 })
    const runtime = new MemoryConsolidationRuntime(new Context(), identity, config())
    const report = await runtime.runCompartment('org-a', { kind: 'shared', scope: 'organization' })

    expect(report.reflections).toEqual({ proposed: 0, droppedPrivacy: 0, failed: 0, skippedLlm: true })
    const reflectionAudit = auditRows(identity).find(row => row.details['pass'] === 'reflection')
    expect(reflectionAudit?.reason).toBe('reflection skipped without the llm service')
    expect(reflectionAudit?.details['reflectionLlm']).toBe('unavailable')
    identity.close()
  })

  it('validates the runtime configuration loud at the boundary', () => {
    expect(consolidationRuntimeConfig({
      intervalMs: 21_600_000, orgIds: ['org-a'], actorUserId: ACTOR,
      provider: 'deepseek', model: 'v4', maxTokens: 512, timeoutMs: 5_000, tunables: {},
    })).toMatchObject({ intervalMs: 21_600_000, orgIds: ['org-a'], tunables: { halfLifeDays: 30 } })
    expect(() => consolidationRuntimeConfig({
      intervalMs: 0, orgIds: [], actorUserId: 'consolidator', provider: '', model: '',
      maxTokens: 512, timeoutMs: 5_000, tunables: {},
    })).toThrow(/service: prefix/u)
    expect(() => consolidationRuntimeConfig({
      intervalMs: 10, orgIds: ['org-a'], actorUserId: '', provider: 'deepseek', model: '',
      maxTokens: 512, timeoutMs: 5_000, tunables: {},
    })).toThrow(/interval requires/u)
    expect(() => consolidationRuntimeConfig({
      intervalMs: 10, orgIds: ['org-a'], actorUserId: ACTOR, provider: 'deepseek', model: 'v4',
      maxTokens: 512, timeoutMs: 5_000, tunables: { halfLifeDays: 0 },
    })).toThrow(/half-life/u)
  })

  it('keys the guard and audit resource per org and compartment', () => {
    expect(compartmentTag({ kind: 'shared', scope: 'organization' })).toBe('organization')
    expect(compartmentTag({ kind: 'shared', scope: 'department', departmentId: 'd1' })).toBe('department:d1')
    expect(compartmentTag({ kind: 'project', projectId: 'p1' })).toBe('project:p1')
    expect(compartmentKey('org-a', { kind: 'project', projectId: 'p1' })).toBe('org-a:project:p1')
  })
})
