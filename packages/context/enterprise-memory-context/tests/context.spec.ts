import { mkdtemp, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  attachGroupSurfaceSession,
  attachSurfaceSession,
  EnterpriseIdentityRepository,
  ensureGroupSurface,
  ensureSurface,
  memorySourceDigest,
  migrateEnterpriseIdentity,
} from '@deepseek-ai/dsh-enterprise-identity'
import type { EnterpriseMemoryEntry } from '@deepseek-ai/dsh-enterprise-identity'
import { EmployeeAccountService } from '@deepseek-ai/dsh-employee-account'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
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

/** Propose one approved project-compartment memory on project-1 at the given clock time. */
function seedApprovedProjectMemory(
  identity: EnterpriseIdentityRepository,
  input: { id: string; kind: EnterpriseMemoryEntry['kind']; summary: string; at: number },
): void {
  fixtureClock = input.at
  const proposed = identity.proposeMemory({
    id: input.id, orgId: 'org-a', scope: 'project', projectId: 'project-1',
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

/** Seed the identity database behind one real `EmployeeAccountService` and expose its actor
 * resolution through the service itself, so the tests exercise the production anchor mapping. */
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
  database.prepare(`INSERT INTO employee_accounts(
      id, org_id, display_name, role_card, active_release_id, state,
      home_workspace_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('employee-2', 'org-a', 'Billing', '账务助理', null, 'active', '/managed/employees/billing', 1, 1)
  ensureSurface(database, {
    id: 'surface-1', orgId: 'org-a', kind: 'dm', userId: 'user-1', employeeId: 'employee-1',
    sessionId: null, createdAt: 1,
  })
  attachSurfaceSession(database, 'surface-1', sessionId)
  ctx.provide('employeeAccounts' as never, new EmployeeAccountService(database) as never)
  return database
}

/** Anchor one project-bound group surface whose member sessions are `session-member` (employee-1)
 * and `session-outsider` (employee-2). */
function anchorProjectGroupSessions(database: DatabaseSync): void {
  ensureGroupSurface(database, {
    id: 'surface-project', orgId: 'org-a', name: '项目群', projectId: 'project-1', createdAt: 1,
  })
  attachGroupSurfaceSession(database, 'surface-project', 'employee-1', 'session-member')
  attachGroupSurfaceSession(database, 'surface-project', 'employee-2', 'session-outsider')
}

/** Provide the lazily resolved project service that admits employee-1 to project-1 only. */
function provideProjectMembership(ctx: Context): { readonly asked: unknown[] } {
  const asked: unknown[] = []
  ctx.provide('enterpriseProjects' as never, {
    requireMember: async (orgId: string, projectId: string, principal: unknown) => {
      asked.push({ orgId, projectId, principal })
      const employeeId = (principal as { employeeId?: string }).employeeId
      return orgId === 'org-a' && projectId === 'project-1' && employeeId === 'employee-1'
        ? { projectId }
        : undefined
    },
  } as never)
  return { asked }
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
    await ctx.plugin(ToolRuntime)
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
    await ctx.plugin(ToolRuntime)
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

  it('injects project memory under [Project memory] only for the project member session', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-memory-context-'))
    const identity = makeIdentity(root)
    seedWorkspace(identity)
    seedApprovedMemory(identity, {
      id: 'org-memory', scope: 'organization', kind: 'business-fact', summary: '公司使用统一合同编号。', at: NOW - DAY_MS,
    })
    seedApprovedProjectMemory(identity, {
      id: 'proj-memory', kind: 'decision', summary: '项目采用统一发布流程。', at: NOW - DAY_MS,
    })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true })
    await ctx.plugin(ToolRuntime)
    ctx.provide('enterprisePostgres' as never, { identity } as never)
    const database = provideEmployeeAccounts(ctx, 'session-1')
    anchorProjectGroupSessions(database)
    const { asked } = provideProjectMembership(ctx)
    apply(ctx, { maxEntries: 20, maxChars: 8_000 })

    const member = await assembleMemory(ctx, '/managed/alice', 'session-member')
    // Equal scores keep fetch order: the shared listing precedes the project listing.
    expect(member).toContain('[Project memory]')
    expect(member.indexOf('[org-memory]')).toBeLessThan(member.indexOf('[proj-memory]'))
    expect(member).toContain('[proj-memory]')

    // The same surface's non-member session resolves the same project but no membership, so the
    // compartment never enters, and its rows stay untouched by that assembly.
    const outsider = await assembleMemory(ctx, '/managed/alice', 'session-outsider')
    expect(outsider).toContain('[org-memory]')
    expect(outsider).not.toContain('[Project memory]')
    expect(outsider).not.toContain('[proj-memory]')

    // The member gate ran per session actor with the resolved scope and principal.
    expect(asked).toEqual([
      { orgId: 'org-a', projectId: 'project-1', principal: { employeeId: 'employee-1' } },
      { orgId: 'org-a', projectId: 'project-1', principal: { employeeId: 'employee-2' } },
    ])

    // Injected project rows are touched like every other compartment.
    const project = identity.listMemories({
      orgId: 'org-a', scopes: ['project'], projectId: 'project-1', statuses: ['approved'],
    })[0]
    expect(project?.lastAccessAt).toBeGreaterThanOrEqual(NOW)
    identity.close()
  })

  it('injects no project compartment when the project service is unmounted', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-memory-context-'))
    const identity = makeIdentity(root)
    seedWorkspace(identity)
    seedApprovedProjectMemory(identity, {
      id: 'proj-memory', kind: 'decision', summary: '项目采用统一发布流程。', at: NOW - DAY_MS,
    })
    const ctx = new Context()
    await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false, includeRuntimeContext: true })
    await ctx.plugin(ToolRuntime)
    ctx.provide('enterprisePostgres' as never, { identity } as never)
    const database = provideEmployeeAccounts(ctx, 'session-1')
    anchorProjectGroupSessions(database)
    apply(ctx, { maxEntries: 20, maxChars: 8_000 })
    const rendered = await assembleMemory(ctx, '/managed/alice', 'session-member')

    expect(rendered).not.toContain('[Project memory]')
    expect(rendered).not.toContain('[proj-memory]')
    expect(identity.listMemories({
      orgId: 'org-a', scopes: ['project'], projectId: 'project-1', statuses: ['approved'],
    })[0]?.lastAccessAt).toBeUndefined()
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
    await ctx.plugin(ToolRuntime)
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
    await ctx.plugin(ToolRuntime)
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
    await ctx.plugin(ToolRuntime)
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

  it('renders the project compartment last and keeps fetch order on cross-compartment ties', () => {
    const org = memoryEntry('org')
    const project = memoryEntry('project', { scope: 'project', projectId: 'project-1' })
    const rendered = renderEnterpriseMemory([org, project], Number.MAX_SAFE_INTEGER)
    expect(rendered).toContain('[Project memory]')
    expect(rendered.indexOf('[Organization memory]')).toBeLessThan(rendered.indexOf('[Project memory]'))
    // Fetch order is the listener's merge order (shared first, project last), and exact ties
    // between compartments keep it instead of re-sorting by scope.
    expect(rankEnterpriseMemories([project, org], { now }).map(entry => entry.id))
      .toEqual(['project', 'org'])
    expect(renderEnterpriseMemory([project], Number.MAX_SAFE_INTEGER)).not.toContain('[Organization memory]')
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
