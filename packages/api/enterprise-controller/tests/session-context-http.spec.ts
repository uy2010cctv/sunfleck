import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseIdentityRepository, memorySourceDigest } from '@deepseek-ai/dsh-enterprise-identity'
import { Context } from '@deepseek-ai/cordis'
import { projectId } from '@deepseek-ai/dsh-enterprise-project'
import { SessionContextHttpHandler, composeSessionContext, type SessionContextDependencies } from '../src/session-context-http.ts'

describe('authorized native session context', () => {
  let root: string
  let identity: EnterpriseIdentityRepository
  let deps: SessionContextDependencies
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-session-context-'))
    identity = new EnterpriseIdentityRepository(join(root, 'identity.sqlite'))
    identity.createOrganization({ id: 'org', name: 'Organization' })
    identity.createUser({ id: 'user', orgId: 'org', username: 'user', displayName: 'Member', disabled: false })
    identity.createUser({ id: 'other', orgId: 'org', username: 'other', displayName: 'Other', disabled: false })
    identity.saveWorkspaceGrant({ workspaceId: 'workspace', orgId: 'org', name: 'Work', kind: 'personal', ownerUserId: 'user', rootPath: '/work', sandboxMode: 'read-only', expectedRevision: 0 })
    identity.bindSessionWorkspace({ sessionId: 'session', workspaceId: 'workspace', orgId: 'org', ownerUserId: 'user' })
    deps = {
      identity,
      security: {
        authenticateCookieAsync: async () => ({ orgId: 'org', userId: 'user', username: 'user', displayName: 'Member', actorType: 'human', departmentIds: [], roles: ['member'] }),
        sessionAccessibleBy: async () => true,
        authorizeApiAsync: async () => ({ allowed: true, reason: 'creator-owner' }),
        authorizeResourceAsync: async () => ({ allowed: true, reason: 'creator-owner' }),
      },
      sessionEmployee: vi.fn(async () => ({ employeeId: 'preset', releaseId: 'release', releaseVersion: 2, orgId: 'org', ownerUserId: 'user' })),
      employee: async () => ({ id: 'preset', displayName: 'Employee', role: 'Research', releaseVersion: 2, capabilities: ['search'] }),
      privateActor: async () => ({ employeeId: 'employee', userId: 'user' }),
    }
  })
  afterEach(async () => { identity.close(); await rm(root, { recursive: true, force: true }) })
  const request = () => new Request('https://dsh/enterprise/session-context/session')
  const memory = (scope: 'agent' | 'pair' | 'project', summary: string, agentEmployeeId = 'employee', pairUserId = 'user') => identity.writePrivateMemory({
    orgId: 'org', scope, kind: 'business-fact', summary, createdBy: 'user',
    ...(scope === 'project' ? { projectId: 'project' } : scope === 'agent' ? { agentEmployeeId } : {}), ...(scope === 'pair' ? { pairUserId } : {}),
  })

  it('denies an outsider before resolving the preset or memory', async () => {
    deps.security.sessionAccessibleBy = async () => false
    expect((await new SessionContextHttpHandler(deps).fetch(request())).status).toBe(403)
    expect(deps.sessionEmployee).not.toHaveBeenCalled()
  })

  it('associates presented files with the closing reply of their own complete native turn', async () => {
    const ctx = new Context()
    const disposed = vi.fn()
    const observeSession = vi.fn(async () => ({ events: [
      { type: 'assistant/message', seq: 2, data: { turn: 1, message: { content: [{ type: 'text', text: 'Working' }] } } },
      { type: 'deliverables/presented', seq: 3, data: { turn: 1, files: [{ path: 'earlier.txt' }] } },
      { type: 'assistant/message', seq: 6, data: { turn: 1, message: { content: [{ type: 'text', text: 'Earlier report' }] } } },
      { type: 'turn/end', seq: 7, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'deliverables/presented', seq: 11, data: { turn: 2, files: [{ path: 'later.txt' }] } },
      { type: 'assistant/message', seq: 12, data: { turn: 2, message: { content: [{ type: 'text', text: 'Later report' }] } } },
      { type: 'turn/end', seq: 13, data: { turn: 2, reason: { kind: 'completed' } } },
      { type: 'deliverables/presented', seq: 15, data: { turn: 3, files: [{ path: 'failed.txt' }] } },
      { type: 'turn/end', seq: 16, data: { turn: 3, reason: { kind: 'error' } } },
      { type: 'deliverables/presented', seq: 18, data: { turn: 4, files: [{ path: 'pending.txt' }] } },
      { type: 'assistant/message', seq: 19, data: { turn: 4, message: { content: [{ type: 'text', text: 'Pending' }] } } },
      { type: 'deliverables/presented', seq: 21, data: { turn: 5, files: [{ path: 'silent.txt' }] } },
      { type: 'assistant/message', seq: 22, data: { turn: 5, message: { content: [{ type: 'text', text: '  ' }] } } },
      { type: 'turn/end', seq: 23, data: { turn: 5, reason: { kind: 'completed' } } },
    ], [Symbol.dispose]: disposed }))
    ctx.provide('enterprisePostgres' as never, { identity } as never)
    ctx.provide('enterpriseSecurity' as never, deps.security as never)
    ctx.provide('sessionQuery' as never, { observeSession } as never)
    try {
      const response = await composeSessionContext(ctx).fetch(new Request('https://dsh/enterprise/session-context/presented/session'))
      expect(await response.json()).toEqual({ sessionId: 'session', files: [
        { path: 'earlier.txt', seq: 3, index: 0, replySourceSeq: 6 },
        { path: 'later.txt', seq: 11, index: 0, replySourceSeq: 12 },
        { path: 'failed.txt', seq: 15, index: 0, replySourceSeq: 16 },
        { path: 'pending.txt', seq: 18, index: 0 },
        { path: 'silent.txt', seq: 21, index: 0 },
      ] })
      expect(observeSession).toHaveBeenCalledWith('session')
      expect(disposed).toHaveBeenCalledOnce()
    } finally { await ctx.fiber.dispose() }
  })
  it('denies revoked workspace access even when the session remains owned', async () => {
    deps.security.authorizeApiAsync = async () => ({ allowed: false, reason: 'resource-hidden' })
    expect((await new SessionContextHttpHandler(deps).fetch(request())).status).toBe(403)
    expect(deps.sessionEmployee).not.toHaveBeenCalled()
  })
  it('returns employee memory and excludes legacy pair rows without employee identity', async () => {
    memory('agent', 'Employee fact')
    memory('agent', 'Other employee fact', 'other-employee')
    memory('pair', 'Our pair fact')
    memory('pair', 'Other user pair fact', 'employee', 'other')
    memory('pair', 'Other employee pair fact', 'other-employee')
    const response = await new SessionContextHttpHandler(deps).fetch(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ employee: { id: 'preset', releaseVersion: 2 }, memoryAvailable: true,
      memories: [{ summary: 'Employee fact', scope: 'agent' }] })
  })
  it('omits private memory without a trusted account binding and requires explicit project membership', async () => {
    memory('agent', 'Employee fact')
    memory('pair', 'Our pair fact')
    memory('project', 'Project fact')
    deps.privateActor = async () => undefined
    const project = { projectId: projectId('project'), orgId: 'org', name: 'Launch', goal: 'Ship', state: 'active' as const, workspacePath: '/work', visibility: 'organization' as const, allowedUserIds: [], createdBy: 'other', createdAt: 1 }
    deps.projects = { list: async () => [project], requireMember: async () => undefined }
    expect(await (await new SessionContextHttpHandler(deps).fetch(request())).json())
      .toMatchObject({ memories: [], memoryAvailable: true })
    deps.projects.requireMember = async () => project
    expect(await (await new SessionContextHttpHandler(deps).fetch(request())).json())
      .toMatchObject({ project: { id: 'project', name: 'Launch' }, memories: [{ summary: 'Project fact' }] })
  })
  it('omits ambiguous same-workspace projects and follows the explicit collaboration project', async () => {
    const base = { orgId: 'org', goal: 'Ship', state: 'active' as const, workspacePath: '/work', visibility: 'organization' as const, allowedUserIds: [], createdBy: 'user', createdAt: 1 }
    const first = { ...base, projectId: projectId('first'), name: 'First' }
    const second = { ...base, projectId: projectId('second'), name: 'Second' }
    deps.projects = { list: async () => [first, second], requireMember: async (_org, id) => id === first.projectId ? first : second }
    const ambiguous = await (await new SessionContextHttpHandler(deps).fetch(request())).json()
    expect(ambiguous).not.toHaveProperty('project')
    deps.sessionProject = async () => ({ projectId: 'second' })
    expect(await (await new SessionContextHttpHandler(deps).fetch(request())).json())
      .toMatchObject({ project: { id: 'second', name: 'Second' } })
    deps.sessionProject = async () => ({})
    expect(await (await new SessionContextHttpHandler(deps).fetch(request())).json()).not.toHaveProperty('project')
  })

  it('never exposes a different user pair from a shared session actor', async () => {
    memory('pair', 'Other user pair fact', 'employee', 'other')
    deps.privateActor = async () => ({ employeeId: 'employee', userId: 'other' })
    expect(await (await new SessionContextHttpHandler(deps).fetch(request())).json())
      .toMatchObject({ memories: [] })
  })
  it('uses the exact pinned release independently of the current work mode and excludes shared private memory', async () => {
    memory('agent', 'Selected employee private fact', 'preset')
    const ctx = new Context()
    const disposed = vi.fn()
    let collaboration = false
    let cleared = false
    const release = { releaseId: 'release', presetId: 'preset', orgId: 'org', version: 2,
      snapshot: { profile: { name: 'Pinned Employee', prompt: 'Research responsibly', position: 'Researcher', description: 'Find facts', capabilities: ['search'] }, bindings: [] } }
    const getRelease = vi.fn(async () => release)
    const listReleases = vi.fn(async () => [{ ...release, releaseId: 'new-release', version: 3 }])
    ctx.provide('enterprisePostgres' as never, { identity, collaboration: {
      bySession: async () => collaboration ? { surfaceId: 'group' } : undefined,
      get: async () => ({ id: 'group' }),
    }, catalog: { getRelease, listReleases } } as never)
    ctx.provide('enterpriseSecurity' as never, deps.security as never)
    ctx.provide('sessionQuery' as never, { observeSession: async () => ({
      events: [{ type: 'enterprise-employee/selected', data: { employeeId: 'preset', releaseId: 'release', releaseVersion: 2, orgId: 'org', ownerUserId: 'user' } }, ...(cleared ? [{ type: 'enterprise-employee/cleared', data: {} }] : [])],
      projections: { values: { agentPreset: 'unrelated-work-mode' } }, [Symbol.dispose]: disposed,
    }) } as never)
    try {
      expect(await (await composeSessionContext(ctx).fetch(request())).json()).toMatchObject({ employee: { id: 'preset', displayName: 'Pinned Employee', role: 'Researcher\nFind facts', releaseVersion: 2, capabilities: ['search'] }, memories: [{ summary: 'Selected employee private fact' }] })
      expect(getRelease).toHaveBeenCalledWith('release', 'org')
      expect(listReleases).not.toHaveBeenCalled()
      collaboration = true
      expect(await (await composeSessionContext(ctx).fetch(request())).json()).toMatchObject({
        employee: { releaseVersion: 2 }, memories: [],
      })
      cleared = true
      collaboration = false
      const clearedContext = await (await composeSessionContext(ctx).fetch(request())).json()
      expect(clearedContext).not.toHaveProperty('employee')
      expect(clearedContext).toMatchObject({ memories: [] })
      expect(disposed).toHaveBeenCalledTimes(3)
    } finally { await ctx.fiber.dispose() }
  })

  it.each([{ orgId: 'foreign', ownerUserId: 'user' }, { orgId: 'org', ownerUserId: 'other' }])('rejects mismatched pinned selection organization or owner: %j', async (fields) => {
    deps.sessionEmployee = async () => ({ employeeId: 'preset', releaseId: 'release', ...fields })
    expect((await new SessionContextHttpHandler(deps).fetch(request())).status).toBe(403)
  })

  it('shows approved shared memory and excludes the proposed review queue', async () => {
    for (const [id, summary] of [['approved', 'Approved shared fact'], ['proposed', 'Pending shared fact']]) {
      identity.proposeMemory({ id: id!, orgId: 'org', scope: 'organization', kind: 'business-fact', summary: summary!, sourceDigest: memorySourceDigest(summary!), createdBy: 'user' })
    }
    identity.reviewMemory({ id: 'approved', orgId: 'org', decision: 'approved', reviewedBy: 'user', reason: 'Verified', expectedRevision: 1 })
    expect(await (await new SessionContextHttpHandler(deps).fetch(request())).json())
      .toMatchObject({ memories: [{ id: 'approved', scope: 'organization' }] })
  })

  it('reports unavailable memory without reading it when memory authorization is denied', async () => {
    deps.security.authorizeResourceAsync = async () => ({ allowed: false, reason: 'resource-hidden' })
    expect(await (await new SessionContextHttpHandler(deps).fetch(request())).json())
      .toMatchObject({ memoryAvailable: false, memories: [] })
  })
})
