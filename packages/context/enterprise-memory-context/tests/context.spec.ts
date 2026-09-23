import { mkdtemp, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  attachSurfaceSession,
  EnterpriseIdentityRepository,
  ensureSurface,
  memorySourceDigest,
  migrateEnterpriseIdentity,
  surfaceBySession,
} from '@deepseek-ai/dsh-enterprise-identity'
import type { EnterpriseMemoryEntry } from '@deepseek-ai/dsh-enterprise-identity'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  apply,
  limitEnterpriseMemories,
  memoryRecallScore,
  rankEnterpriseMemories,
  renderEnterpriseMemory,
} from '../src/index.ts'

// Wall-clock anchor for recency buckets; the listener ranks against the real time, so fixture
// writes are placed at whole-day offsets that no test run can cross.
const NOW = Date.now()
const DAY_MS = 86_400_000

/** Mutable fixture clock the identity repository stamps rows with; seed helpers set it per write. */
let fixtureClock = NOW

/** Open a fresh identity repository over one sqlite file driven by the fixture clock. */
function makeIdentity(root: string): EnterpriseIdentityRepository {
  return new EnterpriseIdentityRepository(join(root, 'identity.sqlite'), { now: () => fixtureClock })
}

/** Seed org-a, two users, the ops department, and the personal workspace granted to user-1. */
function seedWorkspace(identity: EnterpriseIdentityRepository): void {
  identity.createOrganization({ id: 'org-a', name: 'Org A' })
  identity.createUser({ id: 'user-1', orgId: 'org-a', username: 'alice', displayName: 'Alice', disabled: false })
  identity.createUser({ id: 'user-2', orgId: 'org-a', username: 'bob', displayName: 'Bob', disabled: false })
  identity.saveDepartment({ id: 'dept-ops', orgId: 'org-a', name: 'Operations', parentId: null, sortOrder: 0, expectedRevision: 0 })
  identity.setUserDepartments({
    orgId: 'org-a', userId: 'user-1', departmentIds: ['dept-ops'], primaryDepartmentId: 'dept-ops', expectedRevision: 0,
  })
  identity.saveWorkspaceGrant({
    workspaceId: 'workspace-1', orgId: 'org-a', name: 'Alice', kind: 'personal', ownerUserId: 'user-1',
    rootPath: '/managed/alice', sandboxMode: 'workspace-write', expectedRevision: 0,
  })
}

/** Propose one shared memory at the given clock time and approve it immediately. */
function seedApprovedMemory(
  identity: EnterpriseIdentityRepository,
  input: {
    id: string
    scope: 'organization' | 'department'
    departmentId?: string
    kind: EnterpriseMemoryEntry['kind']
    summary: string
    at: number
  },
): void {
  fixtureClock = input.at
  const proposed = identity.proposeMemory({
    id: input.id, orgId: 'org-a', scope: input.scope,
    ...(input.departmentId === undefined ? {} : { departmentId: input.departmentId }),
    kind: input.kind, summary: input.summary, sourceDigest: memorySourceDigest(input.id), createdBy: 'user-1',
  })
  identity.reviewMemory({
    id: input.id, orgId: 'org-a', decision: 'approved', reviewedBy: 'user-1', reason: 'verified',
    expectedRevision: proposed.revision,
  })
}

/** Write one private-compartment memory; the store derives its id from the write digest. */
function seedPrivateMemory(
  identity: EnterpriseIdentityRepository,
  input: { scope: 'agent' | 'pair'; summary: string; agentEmployeeId?: string; pairUserId?: string; at?: number },
): EnterpriseMemoryEntry {
  fixtureClock = input.at ?? NOW - DAY_MS
  return identity.writePrivateMemory({
    orgId: 'org-a', scope: input.scope, kind: 'preference', summary: input.summary, createdBy: 'user-1',
    ...(input.agentEmployeeId === undefined ? {} : { agentEmployeeId: input.agentEmployeeId }),
    ...(input.pairUserId === undefined ? {} : { pairUserId: input.pairUserId }),
  })
}

/** Anchor one dm surface for (user-1, employee-1) to a session and expose the actor resolution. */
function provideEmployeeAccounts(ctx: Context, sessionId: string): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  migrateEnterpriseIdentity(database)
  // The surfaces table references organizations, users, and employee_accounts; seed the trio.
  database.prepare('INSERT INTO organizations(id, name) VALUES (?, ?)').run('org-a', 'Org A')
  database.prepare('INSERT INTO users(id, org_id, username, display_name, disabled) VALUES (?, ?, ?, ?, ?)')
    .run('user-1', 'org-a', 'alice', 'Alice', 0)
  database.prepare(`INSERT INTO employee_accounts(
      id, org_id, display_name, role_card, active_release_id, state,
      home_workspace_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('employee-1', 'org-a', 'Support', '客服助理', null, 'active', '/managed/employees/support', 1, 1)
  ensureSurface(database, {
    id: 'surface-1', orgId: 'org-a', kind: 'dm', userId: 'user-1', employeeId: 'employee-1',
    sessionId: null, createdAt: 1,
  })
  attachSurfaceSession(database, 'surface-1', sessionId)
  ctx.provide('employeeAccounts' as never, {
    resolveSessionActor: (anchorSessionId: string) => {
      const surface = surfaceBySession(database, anchorSessionId)
      return surface === undefined
        ? undefined
        : { orgId: surface.orgId, userId: surface.userId, employeeId: surface.employeeId }
    },
  } as never)
  return database
}

/** Assemble the prompt for one session cwd and return the injected enterprise memory text. */
async function assembleMemory(ctx: Context, cwd: string, sessionId?: string): Promise<string> {
  const assembly = await ctx.systemPrompt.assemble({
    agent: { id: sessionId, session: { header: { cwd } } },
  } as never)
  return assembly.contexts.find(item => item.name === 'enterprise:memory')?.text ?? ''
}

/** List the approved shared (organization and department) memories of org-a. */
function sharedMemories(identity: EnterpriseIdentityRepository): EnterpriseMemoryEntry[] {
  return identity.listMemories({ orgId: 'org-a', departmentIds: ['dept-ops'], statuses: ['approved'] })
}

describe('enterprise memory prompt context', () => {
  let root = ''

  afterEach(async () => {
    if (root !== '') await rm(root, { recursive: true, force: true })
  })

  it('injects approved organization and current-department memory without proposed entries', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-memory-context-'))
    const identity = makeIdentity(root)
    seedWorkspace(identity)
    seedApprovedMemory(identity, {
      id: 'org-memory', scope: 'organization', kind: 'business-fact', summary: '公司使用统一合同编号。', at: NOW - DAY_MS,
    })
    seedApprovedMemory(identity, {
      id: 'dept-memory', scope: 'department', departmentId: 'dept-ops', kind: 'process', summary: '运营审批保留版本记录。', at: NOW - DAY_MS,
    })
    const proposed = identity.proposeMemory({
      id: 'proposed-memory', orgId: 'org-a', scope: 'organization', kind: 'decision',
      summary: '尚未批准。', sourceDigest: memorySourceDigest('proposed-memory'), createdBy: 'user-1',
    })
    expect(proposed.status).toBe('proposed')
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true })
    ctx.provide('enterprisePostgres' as never, { identity } as never)
    apply(ctx, { maxEntries: 20, maxChars: 8_000 })
    const rendered = await assembleMemory(ctx, '/managed/alice')

    expect(rendered).toContain('[org-memory]')
    expect(rendered).toContain('[dept-memory]')
    expect(rendered).not.toContain('proposed-memory')
    expect(rendered).toContain('[Organization memory]')
    expect(rendered).toContain('[Department memory]')
    expect(rendered).toMatch(/never infer personal traits/iu)
    // No anchored employee session: the private compartments never participate.
    expect(rendered).not.toContain('[My notes]')
    expect(rendered).not.toContain('[Collaboration preference]')
    identity.close()
  })

  it('recalls own notes and pair preference only for an anchored employee session', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-memory-context-'))
    const identity = makeIdentity(root)
    seedWorkspace(identity)
    seedApprovedMemory(identity, {
      id: 'org-memory', scope: 'organization', kind: 'business-fact', summary: '公司使用统一合同编号。', at: NOW - DAY_MS,
    })
    seedApprovedMemory(identity, {
      id: 'dept-memory', scope: 'department', departmentId: 'dept-ops', kind: 'process', summary: '运营审批保留版本记录。', at: NOW - DAY_MS,
    })
    const agentMemory = seedPrivateMemory(identity, {
      scope: 'agent', summary: '偏好简短回答。', agentEmployeeId: 'employee-1',
    })
    seedPrivateMemory(identity, { scope: 'agent', summary: '其他员工的笔记。', agentEmployeeId: 'employee-2' })
    const pairMemory = seedPrivateMemory(identity, { scope: 'pair', summary: '偏好中文回复。', pairUserId: 'user-1' })
    seedPrivateMemory(identity, { scope: 'pair', summary: '其他用户的偏好。', pairUserId: 'user-2' })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true })
    ctx.provide('enterprisePostgres' as never, { identity } as never)
    provideEmployeeAccounts(ctx, 'session-1')
    apply(ctx, { maxEntries: 20, maxChars: 8_000 })
    const rendered = await assembleMemory(ctx, '/managed/alice', 'session-1')

    expect(rendered).toContain('[Organization memory]')
    expect(rendered).toContain('[Department memory]')
    expect(rendered).toContain('[My notes]')
    expect(rendered).toContain(`[${agentMemory.id}]`)
    expect(rendered).toContain('[Collaboration preference]')
    expect(rendered).toContain(`[${pairMemory.id}]`)
    // Isolation holds on content, not just on the injected ids above.
    expect(rendered).not.toContain('其他员工的笔记')
    expect(rendered).not.toContain('其他用户的偏好')

    // Every injected id is touched; private rows outside the session's compartments are not.
    for (const entry of sharedMemories(identity)) {
      expect(entry.lastAccessAt).toBeGreaterThanOrEqual(NOW)
    }
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['agent'], agentEmployeeId: 'employee-1' })[0]?.lastAccessAt)
      .toBeGreaterThanOrEqual(NOW)
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['pair'], pairUserId: 'user-1' })[0]?.lastAccessAt)
      .toBeGreaterThanOrEqual(NOW)
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['agent'], agentEmployeeId: 'employee-2' })[0]?.lastAccessAt)
      .toBeUndefined()
    expect(identity.listMemories({ orgId: 'org-a', scopes: ['pair'], pairUserId: 'user-2' })[0]?.lastAccessAt)
      .toBeUndefined()
    identity.close()
  })

  it('injects no private memory when the session resolves to no anchored employee', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-memory-context-'))
    const identity = makeIdentity(root)
    seedWorkspace(identity)
    seedApprovedMemory(identity, {
      id: 'org-memory', scope: 'organization', kind: 'business-fact', summary: '公司使用统一合同编号。', at: NOW - DAY_MS,
    })
    seedPrivateMemory(identity, { scope: 'agent', summary: '偏好简短回答。', agentEmployeeId: 'employee-1' })
    seedPrivateMemory(identity, { scope: 'pair', summary: '偏好中文回复。', pairUserId: 'user-1' })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true })
    ctx.provide('enterprisePostgres' as never, { identity } as never)
    provideEmployeeAccounts(ctx, 'session-1')
    apply(ctx, { maxEntries: 20, maxChars: 8_000 })
    const rendered = await assembleMemory(ctx, '/managed/alice', 'session-unanchored')

    expect(rendered).toContain('[org-memory]')
    expect(rendered).not.toContain('[My notes]')
    expect(rendered).not.toContain('[Collaboration preference]')
    expect(rendered).not.toContain('偏好')
    identity.close()
  })

  it('respects maxEntries after merging and ranking the compartments', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-memory-context-'))
    const identity = makeIdentity(root)
    seedWorkspace(identity)
    seedApprovedMemory(identity, {
      id: 'org-oldest', scope: 'organization', kind: 'business-fact', summary: '最旧。', at: NOW - 3 * DAY_MS,
    })
    seedApprovedMemory(identity, {
      id: 'org-middle', scope: 'organization', kind: 'business-fact', summary: '居中。', at: NOW - 2 * DAY_MS,
    })
    seedApprovedMemory(identity, {
      id: 'org-newest', scope: 'organization', kind: 'business-fact', summary: '最新。', at: NOW - DAY_MS,
    })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true })
    ctx.provide('enterprisePostgres' as never, { identity } as never)
    apply(ctx, { maxEntries: 2, maxChars: 8_000 })
    const rendered = await assembleMemory(ctx, '/managed/alice')

    // Equal scores keep fetch order, so the entry budget keeps the newest two store rows.
    expect(rendered).toContain('[org-newest]')
    expect(rendered).toContain('[org-middle]')
    expect(rendered).not.toContain('[org-oldest]')
    identity.close()
  })

  it('truncates by dropping the lowest-ranked entries and marks the block', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-memory-context-'))
    const identity = makeIdentity(root)
    seedWorkspace(identity)
    seedApprovedMemory(identity, {
      id: 'org-memory', scope: 'organization', kind: 'business-fact', summary: '公司使用统一合同编号。', at: NOW - DAY_MS,
    })
    seedApprovedMemory(identity, {
      id: 'dept-recent', scope: 'department', departmentId: 'dept-ops', kind: 'process', summary: '最近更新。', at: NOW - 10 * DAY_MS,
    })
    seedApprovedMemory(identity, {
      id: 'dept-old', scope: 'department', departmentId: 'dept-ops', kind: 'process', summary: '久未更新。', at: NOW - 40 * DAY_MS,
    })
    const rankedHead = rankEnterpriseMemories(sharedMemories(identity), { now: NOW }).slice(0, 2)
    expect(rankedHead.map(entry => entry.id)).toEqual(['org-memory', 'dept-recent'])
    const maxChars = renderEnterpriseMemory(rankedHead, Number.MAX_SAFE_INTEGER).length + 1
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true })
    ctx.provide('enterprisePostgres' as never, { identity } as never)
    apply(ctx, { maxEntries: 20, maxChars })
    const rendered = await assembleMemory(ctx, '/managed/alice', undefined)

    expect(rendered).toContain('[org-memory]')
    expect(rendered).toContain('[dept-recent]')
    expect(rendered).toContain('[context truncated]')
    expect(rendered).not.toContain('[dept-old]')
    // The dropped entry is never touched: only injected ids are.
    expect(sharedMemories(identity).find(entry => entry.id === 'dept-old')?.lastAccessAt).toBeUndefined()
    identity.close()
  })
})

describe('enterprise memory recall ranking', () => {
  const now = 1_000_000_000_000

  /** Build one synthetic approved memory with recall-relevant defaults. */
  function memoryEntry(id: string, overrides: Partial<EnterpriseMemoryEntry> = {}): EnterpriseMemoryEntry {
    return {
      id, orgId: 'org-a', scope: 'organization', kind: 'business-fact', status: 'approved',
      summary: `summary of ${id}`, sourceDigest: id, privacyFindings: [], importance: 0,
      createdBy: 'user-1', revision: 1, createdAt: now, updatedAt: now, ...overrides,
    }
  }

  it('scores two points per keyword hit plus importance plus the recency weight', () => {
    const fresh = memoryEntry('fresh', { summary: '统一合同编号规则。' })
    expect(memoryRecallScore(fresh, now, [])).toBe(1)
    expect(memoryRecallScore(fresh, now, ['合同'])).toBe(3)
    expect(memoryRecallScore(fresh, now, ['合同', '编号', '合同'])).toBe(5)
    // Blank terms never match, and importance adds one for one.
    expect(memoryRecallScore(fresh, now, ['  ', ''])).toBe(1)
    expect(memoryRecallScore({ ...fresh, importance: 4 }, now, [])).toBe(5)
  })

  it('weights recency one within 7 days, one half within 30 days, and zero older', () => {
    const entry = memoryEntry('timed')
    expect(memoryRecallScore({ ...entry, updatedAt: now - 7 * DAY_MS }, now, [])).toBe(1)
    expect(memoryRecallScore({ ...entry, updatedAt: now - 7 * DAY_MS - 1 }, now, [])).toBe(0.5)
    expect(memoryRecallScore({ ...entry, updatedAt: now - 30 * DAY_MS }, now, [])).toBe(0.5)
    expect(memoryRecallScore({ ...entry, updatedAt: now - 30 * DAY_MS - 1 }, now, [])).toBe(0)
    // lastAccessAt supersedes updatedAt, and a future timestamp stays in the freshest bucket.
    expect(memoryRecallScore({
      ...entry, updatedAt: now - 40 * DAY_MS, lastAccessAt: now - 3 * DAY_MS,
    }, now, [])).toBe(1)
    expect(memoryRecallScore({ ...entry, updatedAt: now + DAY_MS }, now, [])).toBe(1)
  })

  it('orders by score and keeps fetch order on exact ties', () => {
    const stale = memoryEntry('stale', { updatedAt: now - 40 * DAY_MS })
    const fresh = memoryEntry('fresh')
    const important = memoryEntry('important', { importance: 3, updatedAt: now - 40 * DAY_MS })
    // importance 3 (stale) beats one keyword hit (2); the hit beats freshness (1); freshness
    // beats staleness (0).
    const doubleHit = memoryEntry('double-hit', { summary: '合同编号规则。', updatedAt: now - 40 * DAY_MS })
    expect(rankEnterpriseMemories([stale, important, doubleHit, fresh], { now, queryTerms: ['合同'] })
      .map(entry => entry.id)).toEqual(['important', 'double-hit', 'fresh', 'stale'])
    // Exact ties (all fresh, no importance, no hits) keep the input order.
    const first = memoryEntry('first')
    const second = memoryEntry('second')
    expect(rankEnterpriseMemories([first, second], { now }).map(entry => entry.id)).toEqual(['first', 'second'])
  })

  it('limits the ranked list by dropping the tail and keeps the labeled sections intact', () => {
    const keep = memoryEntry('keep', { summary: '保留。' })
    const drop = memoryEntry('drop', { summary: '舍弃。', updatedAt: now - 40 * DAY_MS })
    const budget = renderEnterpriseMemory([keep], Number.MAX_SAFE_INTEGER).length
    expect(budget).toBeGreaterThan(512)

    const truncated = renderEnterpriseMemory([keep, drop], budget)
    expect(truncated).toContain('[keep]')
    expect(truncated).toContain('[context truncated]')
    expect(truncated).not.toContain('[drop]')
    expect(truncated).toBe(`${renderEnterpriseMemory([keep], Number.MAX_SAFE_INTEGER)}\n[context truncated]\n`)

    // Empty compartments contribute no labels, and nothing fitting renders as no block.
    expect(renderEnterpriseMemory([keep], Number.MAX_SAFE_INTEGER)).not.toContain('[Department memory]')
    expect(renderEnterpriseMemory([drop], 10)).toBe('')
    expect(limitEnterpriseMemories([keep, drop], budget)).toEqual([keep])
  })
})
