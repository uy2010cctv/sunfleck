import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseIdentityRepository, type EnterpriseSessionAccessFacts } from '@deepseek-ai/dsh-enterprise-identity'
import { createPasswordVerifier } from '@deepseek-ai/dsh-enterprise-sso'
import {
  EnterpriseSecurity,
  classifyApiEndpoint,
  parseSessionCookie,
  type EnterpriseSecurityConfig,
} from '../src/index.ts'

describe('EnterpriseSecurity', () => {
  let root: string
  let repository: EnterpriseIdentityRepository
  let security: EnterpriseSecurity
  let now: number
  const config: EnterpriseSecurityConfig = {
    organizationId: 'org-a', sessionCookieName: 'dsh_enterprise_session', sessionTtlMs: 60_000,
    secureCookies: true, autoProvisionSsoUsers: true,
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-security-'))
    now = Date.UTC(2026, 7, 26, 12)
    repository = new EnterpriseIdentityRepository(join(root, 'identity.sqlite'), { now: () => now })
    repository.createOrganization({ id: 'org-a', name: 'Example' })
    repository.createUser({
      id: 'admin-1', orgId: 'org-a', username: 'admin', displayName: 'Admin', disabled: false,
    })
    repository.setRoles('admin-1', ['administrator'])
    repository.setPasswordVerifier('admin-1', createPasswordVerifier('enterprise-password'))
    repository.createUser({
      id: 'member-1', orgId: 'org-a', username: 'member', displayName: 'Member', disabled: false,
    })
    repository.setRoles('member-1', ['member'])
    repository.setPasswordVerifier('member-1', createPasswordVerifier('enterprise-password'))
    let token = 0
    security = new EnterpriseSecurity(repository, config, {
      now: () => now,
      randomToken: () => ++token === 1 ? 'issued-token' : `issued-token-${String(token)}`,
    })
  })

  afterEach(async () => {
    repository.close()
    await rm(root, { recursive: true, force: true })
  })

  it('reads only the current human user for each resource authorization', async () => {
    const principal = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    const listing = vi.spyOn(repository, 'listUsers')
    const lookup = vi.spyOn(repository, 'findUserById')
    await security.authorizeResourceAsync(principal, 'memory.read', { orgId: 'org-a', visibility: 'organization' })
    await security.authorizeResourceAsync(principal, 'memory.read', { orgId: 'org-a', visibility: 'organization' })
    expect(listing).not.toHaveBeenCalled()
    expect(lookup).toHaveBeenCalledTimes(2)
    expect(lookup).toHaveBeenLastCalledWith(principal.orgId, principal.userId)
  })

  it('applies current department revocation to an existing principal', async () => {
    repository.saveDepartment({ id: 'dept-a', orgId: 'org-a', parentId: null, name: 'Department', sortOrder: 0, expectedRevision: 0 })
    repository.setUserDepartments({ orgId: 'org-a', userId: 'member-1', departmentIds: ['dept-a'], expectedRevision: 0 })
    const principal = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    const resource = { orgId: 'org-a', visibility: 'organization' as const, scope: { type: 'department' as const, departmentId: 'dept-a' } }
    expect((await security.authorizeResourceAsync(principal, 'memory.read', resource)).allowed).toBe(true)
    repository.setUserDepartments({ orgId: 'org-a', userId: 'member-1', departmentIds: [], expectedRevision: 1 })
    expect((await security.authorizeResourceAsync(principal, 'memory.read', resource)).allowed).toBe(false)
  })

  it('filters a Session list with one fresh bulk read while preserving duplicate rows', async () => {
    const principal = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    let owner = principal.userId
    const bulk = vi.fn(async () => new Map([['owned', { ownerUserId: owner }]]))
    Object.assign(repository, { sessionAccessFacts: bulk })
    const single = vi.spyOn(repository, 'sessionOwnerUserId')
    const items = [{ sessionId: 'owned', title: 'first' }, { sessionId: 'hidden' }, { sessionId: 'owned', title: 'second' }]
    expect(await security.filterSessionList(principal, { items })).toEqual({ items: [items[0], items[2]] })
    expect(bulk).toHaveBeenCalledOnce()
    expect(bulk).toHaveBeenCalledWith({ orgId: 'org-a', userId: principal.userId, sessionIds: ['owned', 'hidden'] })
    expect(single).not.toHaveBeenCalled()
    owner = 'other'
    expect(await security.filterSessionList(principal, { items })).toEqual({ items: [] })
    expect(bulk).toHaveBeenCalledTimes(2)
  })

  it('avoids bulk reads for lists without valid Session ids', async () => {
    const principal = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    const bulk = vi.fn(async () => new Map())
    Object.assign(repository, { sessionAccessFacts: bulk })
    expect(await security.filterSessionList(principal, { items: [null, {}, { sessionId: 1 }] })).toEqual({ items: [] })
    expect(bulk).not.toHaveBeenCalled()
  })

  it('matches individual Session policy for bulk ownership, collaboration and project facts', async () => {
    const principal = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    const shared = repository.saveWorkspaceGrant({ workspaceId: 'shared', orgId: 'org-a', name: 'Shared', kind: 'personal', ownerUserId: principal.userId, rootPath: '/synthetic/shared', sandboxMode: 'read-only', expectedRevision: 0 })
    let member = true
    const projectAccess = vi.fn(async () => ({ member, active: true }))
    const policy = new EnterpriseSecurity(repository, config, { projectAccess })
    const facts = new Map<string, EnterpriseSessionAccessFacts>([
      ['owned', { ownerUserId: principal.userId }],
      ['other', { ownerUserId: 'other' }],
      ['shared', { workspace: shared, collaboration: { orgId: 'org-a', workspaceId: 'shared', member: true } }],
      ['revoked-owner', { ownerUserId: principal.userId, workspace: shared, collaboration: { orgId: 'org-a', workspaceId: 'shared', member: false } }],
      ['cross-org-owner', { ownerUserId: principal.userId, workspace: shared, collaboration: { orgId: 'org-b', workspaceId: 'shared', member: true } }],
      ['mismatch', { workspace: shared, collaboration: { orgId: 'org-a', workspaceId: 'different', member: true } }],
      ['project-a', { ownerUserId: principal.userId, workspace: { ...shared, kind: 'project', projectId: 'project-a' } }],
      ['project-b', { ownerUserId: principal.userId, workspace: { ...shared, kind: 'project', projectId: 'project-a' } }],
      ['project-missing', { ownerUserId: principal.userId, workspace: { ...shared, kind: 'project' } }],
      ['project-cross-org', { ownerUserId: principal.userId, workspace: { ...shared, orgId: 'org-b', kind: 'project', projectId: 'project-a' } }],
    ])
    Object.assign(repository, {
      collaborationSessionAccess: async ({ sessionId }: { sessionId: string }) => facts.get(sessionId)?.collaboration,
      sessionOwnerUserId: async (sessionId: string) => facts.get(sessionId)?.ownerUserId,
      sessionWorkspaceGrant: async (sessionId: string) => facts.get(sessionId)?.workspace,
    })
    const ids = [...facts.keys(), 'missing']
    const expected: string[] = []
    for (const id of ids) if (await policy.sessionAccessibleBy(principal, id)) expected.push(id)
    expect(expected).toEqual(['owned', 'shared', 'project-a', 'project-b'])
    projectAccess.mockClear()
    const grants = vi.spyOn(repository, 'listWorkspaceGrants')
    Object.assign(repository, { sessionAccessFacts: async () => facts })
    const list = { items: ids.map(sessionId => ({ sessionId })) }
    expect(await policy.filterSessionList(principal, list)).toEqual({ items: expected.map(sessionId => ({ sessionId })) })
    expect(projectAccess).toHaveBeenCalledOnce()
    expect(grants).toHaveBeenCalledOnce()
    member = false
    facts.set('shared', { workspace: shared, collaboration: { orgId: 'org-a', workspaceId: 'shared', member: false } })
    expect(await policy.filterSessionList(principal, list)).toEqual({ items: [{ sessionId: 'owned' }] })
    expect(projectAccess).toHaveBeenCalledTimes(2)
    facts.set('shared', { workspace: shared, collaboration: { orgId: 'org-a', workspaceId: 'shared', member: true } })
    expect(await policy.filterSessionList({ ...principal, actorType: 'employee' }, { items: [{ sessionId: 'shared' }] })).toEqual({ items: [] })
  })

  it('issues an HttpOnly session for local login and authenticates its cookie', () => {
    expect(security.loginLocal('org-a', 'admin', 'wrong')).toBeUndefined()
    const login = security.loginLocal('org-a', 'admin', 'enterprise-password')
    expect(login?.cookie).toContain('HttpOnly')
    expect(login?.cookie).toContain('Secure')
    expect(parseSessionCookie(login?.cookie ?? '', config.sessionCookieName)).toBe('issued-token')
    expect(security.authenticateCookie(login?.cookie ?? '')).toMatchObject({
      userId: 'admin-1', roles: ['administrator'],
    })
  })

  it('issues local sessions inside the organization selected at login', () => {
    repository.createOrganizationWithAdministrator({
      organization: { id: 'org-b', name: 'Second enterprise' },
      administrator: {
        id: 'org-b-admin', orgId: 'org-b', username: 'admin', displayName: 'Second Admin', disabled: false,
      },
      passwordVerifier: createPasswordVerifier('second-password'),
    })

    const platform = security.loginLocal('org-a', 'admin', 'enterprise-password')
    const tenant = security.loginLocal('org-b', 'admin', 'second-password')

    expect(platform?.principal).toMatchObject({ userId: 'admin-1', orgId: 'org-a' })
    expect(tenant?.principal).toMatchObject({ userId: 'org-b-admin', orgId: 'org-b' })
    expect(security.authenticateCookie(tenant?.cookie ?? '')).toMatchObject({ orgId: 'org-b' })
  })

  it('projects department membership into authenticated principals', () => {
    repository.saveDepartment({
      id: 'dept-finance', orgId: 'org-a', parentId: null, name: 'Finance', sortOrder: 0, expectedRevision: 0,
    })
    repository.setUserDepartments({
      orgId: 'org-a', userId: 'member-1', departmentIds: ['dept-finance'],
      primaryDepartmentId: 'dept-finance', expectedRevision: 0,
    })

    const login = security.loginLocal('org-a', 'member', 'enterprise-password')

    expect(login?.principal).toMatchObject({
      actorType: 'human', userId: 'member-1', departmentIds: ['dept-finance'],
    })
  })
  it('shows a project Workspace only to current members and blocks work after archive', async () => {
    const grant = { workspaceId: 'project-workspace', orgId: 'org-a', name: 'Q4 Renewal',
      kind: 'project' as const, projectId: 'project-q4', rootPath: '/managed/projects/q4',
      sandboxMode: 'workspace-write' as const, revision: 1, createdAt: now, updatedAt: now }
    const workspaceGrant = repository.workspaceGrant.bind(repository)
    const organizationGrants = repository.listOrganizationWorkspaceGrants.bind(repository)
    Object.assign(repository, {
      workspaceGrant: (id: string) => id === grant.workspaceId ? grant : workspaceGrant(id),
      listOrganizationWorkspaceGrants: (orgId: string) => [...organizationGrants(orgId), grant],
      sessionWorkspaceGrant: (id: string) => id === 'project-session' ? grant : undefined,
    })
    let member = true, active = true
    security = new EnterpriseSecurity(repository, config, { projectAccess: async (_org, userId) => ({
      member: userId === 'member-1' && member, active,
    }) })
    const principal = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    const frames: unknown[] = []
    for await (const frame of security.filterWorkspaceFollow(principal, (async function* () {
      yield { type: 'baseline', value: { items: [{ workspaceId: grant.workspaceId, title: grant.name,
        path: grant.rootPath, sessionIds: [] }], archivedSessionIds: [] } }
    })())) frames.push(frame)
    expect(frames).toMatchObject([{ type: 'baseline', value: { items: [{
      workspaceId: grant.workspaceId, enterpriseKind: 'project', projectId: grant.projectId, deletable: false,
    }] } }])
    expect(await security.authorizeApiAsync(principal, 'session.create', { workspaceId: grant.workspaceId }))
      .toMatchObject({ allowed: true })
    active = false
    expect(await security.authorizeApiAsync(principal, 'session.create', { workspaceId: grant.workspaceId }))
      .toMatchObject({ allowed: false })
    member = false
    expect(await security.authorizeApiAsync(principal, 'workspace.list', { workspaceId: grant.workspaceId }))
      .toMatchObject({ allowed: false })
    expect(await security.authorizeApiAsync(security.loginLocal('org-a', 'admin', 'enterprise-password')!.principal,
      'session.create', { workspaceId: grant.workspaceId })).toMatchObject({ allowed: false })
    member = true
    const updates: unknown[] = []
    for await (const frame of security.filterWorkspaceFollow(principal, (async function* () {
      yield { type: 'baseline', value: { items: [{ workspaceId: grant.workspaceId, title: grant.name,
        path: grant.rootPath, sessionIds: [] }], archivedSessionIds: [] } }
      member = false
      yield { type: 'upsert', workspace: { workspaceId: grant.workspaceId, title: grant.name,
        path: grant.rootPath, sessionIds: [] } }
    })())) updates.push(frame)
    expect(updates.at(-1)).toEqual({ type: 'remove', workspaceId: grant.workspaceId })
  })

  it('uses managed departments when authorizing department-scoped resources', async () => {
    const managerSecurity = new EnterpriseSecurity(repository, config, {
      managedDepartmentIds: async (_orgId, userId) => userId === 'member-1' ? ['dept-finance'] : [],
      resourcePolicyResolver: async (_type, resourceId) => ({
        orgId: 'org-a', visibility: 'organization',
        scope: { type: 'department', departmentId: resourceId === 'finance-channel' ? 'dept-finance' : 'dept-sales' },
      }),
    })
    const manager = { userId: 'member-1', orgId: 'org-a', roles: ['member'] as const }

    await expect(managerSecurity.authorizeApiAsync(
      manager, 'enterpriseChannel.save', { channelId: 'finance-channel' },
    )).resolves.toEqual({ allowed: true, reason: 'department-manager' })
    await expect(managerSecurity.authorizeApiAsync(
      manager, 'enterpriseChannel.save', { channelId: 'sales-channel' },
    )).resolves.toEqual({ allowed: false, reason: 'scope-mismatch' })
  })

  it('classifies every existing API family and fails closed for unknown endpoints', () => {
    expect(classifyApiEndpoint('sessions.history', { sessionId: 'session-1' }))
      .toMatchObject({ action: 'session.read', resourceType: 'session', resourceId: 'session-1' })
    expect(classifyApiEndpoint('credentials.set', {})).toMatchObject({ action: 'credential.manage' })
    expect(classifyApiEndpoint('settings.describe', {})).toEqual({ action: 'model.manage', resourceType: 'model-settings' })
    expect(classifyApiEndpoint('agentPreset.copy', {})).toMatchObject({ action: 'employee.create' })
    expect(classifyApiEndpoint('unknown.execute', {})).toBeUndefined()
    expect(classifyApiEndpoint('workspace.list', { workspaceId: 'workspace-1' })).toEqual({
      action: 'session.read', resourceType: 'workspace', resourceId: 'workspace-1',
    })
    expect(classifyApiEndpoint('session.create', { workspaceId: 'workspace-1' })).toEqual({
      action: 'session.create', resourceType: 'workspace', resourceId: 'workspace-1',
    })
    expect(classifyApiEndpoint('workspace.create', { path: '/tmp/outside' })).toEqual({
      action: 'session.create', resourceType: 'workspace-catalog',
    })
    expect(classifyApiEndpoint('enterpriseWorkspace.create', {})).toEqual({
      action: 'session.create', resourceType: 'workspace-catalog',
    })
    expect(classifyApiEndpoint('enterpriseWork.prepare', {})).toEqual({ action: 'operation.read', resourceType: 'work-record' })
    expect(classifyApiEndpoint('enterpriseWork.start', { idempotencyKey: 'start-1' })).toEqual({ action: 'operation.manage', resourceType: 'work-record' })
    for (const endpoint of [
      'enterpriseOperation.workStarts.reserve',
      'enterpriseOperation.workStarts.get',
      'enterpriseOperation.workStarts.complete',
    ]) {
      expect(classifyApiEndpoint(endpoint, { idempotencyKey: 'start-1' })).toEqual({
        action: 'operation.manage', resourceType: 'work-start-reservation', resourceId: 'start-1',
      })
    }
  })

  it('classifies enterprise ApiProxy resources without prefix fallthrough', () => {
    expect(classifyApiEndpoint('enterpriseDevice.pair', {})).toEqual({
      action: 'device.manage', resourceType: 'device',
    })
    expect(classifyApiEndpoint('enterpriseDevice.heartbeat', { deviceId: 'device-1' })).toEqual({
      action: 'device.manage', resourceType: 'device', resourceId: 'device-1',
    })
    expect(classifyApiEndpoint('enterpriseDevice.startRun', { deviceId: 'device-1' })).toEqual({
      action: 'device.execute', resourceType: 'device', resourceId: 'device-1',
    })
    expect(classifyApiEndpoint('enterpriseDevice.issuePermit', { deviceId: 'device-1' })).toEqual({
      action: 'device.execute', resourceType: 'device', resourceId: 'device-1',
    })
    for (const endpoint of [
      'enterpriseDevice.getRecorderRuntime',
      'enterpriseDevice.saveRecorderRuntime',
      'enterpriseDevice.startRecorderRuntime',
    ]) {
      expect(classifyApiEndpoint(endpoint, {})).toEqual({
        action: 'model.manage', resourceType: 'recorder-runtime',
      })
    }
    expect(classifyApiEndpoint('enterpriseEmployee.getDraft', { presetId: 'employee-1' })).toEqual({ action: 'employee.read', resourceType: 'employee', resourceId: 'employee-1' })
    expect(classifyApiEndpoint('enterpriseEmployee.publish', { presetId: 'employee-1' })).toEqual({ action: 'employee.update', resourceType: 'employee', resourceId: 'employee-1' })
    expect(classifyApiEndpoint('cordisReview.submitSaved', { packageId: 'package-1' })).toEqual({
      action: 'plugin.create', resourceType: 'cordis-plugin',
    })
    expect(classifyApiEndpoint('enterpriseAsset.get', { assetId: 'asset-1' })).toEqual({ action: 'capability.read', resourceType: 'enterprise-asset', resourceId: 'asset-1' })
    expect(classifyApiEndpoint('enterpriseAsset.archive', { assetId: 'asset-1' })).toEqual({ action: 'capability.manage', resourceType: 'enterprise-asset', resourceId: 'asset-1' })
    expect(classifyApiEndpoint('enterpriseKnowledge.read', { baseId: 'finance' })).toEqual({
      action: 'capability.read', resourceType: 'knowledge-base', resourceId: 'finance',
    })
    expect(classifyApiEndpoint('enterpriseKnowledge.manage', { baseId: 'finance' })).toEqual({
      action: 'capability.manage', resourceType: 'knowledge-base', resourceId: 'finance',
    })
    expect(classifyApiEndpoint('enterpriseTeam.get', { teamId: 'team-1' })).toEqual({ action: 'team.read', resourceType: 'fixed-team', resourceId: 'team-1' })
    expect(classifyApiEndpoint('enterpriseTeamDefinition.list', {})).toEqual({
      action: 'team.read', resourceType: 'team-definition',
    })
    for (const endpoint of ['enterpriseTeamDefinition.getDraft', 'enterpriseOperation.teamDefinitions.getDraft']) {
      expect(classifyApiEndpoint(endpoint, { teamId: 'team-1' })).toEqual({
        action: 'team.read', resourceType: 'team-definition', resourceId: 'team-1',
      })
    }
    expect(classifyApiEndpoint('enterpriseTeamDefinition.archive', { teamId: 'team-1' })).toEqual({
      action: 'team.manage', resourceType: 'team-definition', resourceId: 'team-1',
    })
    for (const endpoint of [
      'enterpriseTeamDefinition.draft',
      'enterpriseTeamDefinition.publish',
      'enterpriseTeamDefinition.discardDraft',
      'enterpriseOperation.teamDefinitions.draft',
      'enterpriseOperation.teamDefinitions.publish',
      'enterpriseOperation.teamDefinitions.discardDraft',
    ]) {
      expect(classifyApiEndpoint(endpoint, { teamId: 'team-1' })).toEqual({
        action: 'team.manage', resourceType: 'team-definition', resourceId: 'team-1',
      })
    }
    expect(classifyApiEndpoint('enterpriseOperation.teamDefinitions.save', { teamId: 'team-1' })).toEqual({
      action: 'team.manage', resourceType: 'team-definition', resourceId: 'team-1',
    })
    expect(classifyApiEndpoint('enterpriseTeamRun.start', { teamId: 'team-1' })).toEqual({
      action: 'team.execute', resourceType: 'team-definition', resourceId: 'team-1',
    })
    expect(classifyApiEndpoint('enterpriseTeamDecision.respond', { decisionId: 'decision-1' })).toEqual({
      action: 'team.decision.respond', resourceType: 'team-decision', resourceId: 'decision-1',
    })
    expect(classifyApiEndpoint('enterpriseTeamAutonomy.save', { teamId: 'team-1' })).toEqual({
      action: 'team.autonomy.manage', resourceType: 'team-definition', resourceId: 'team-1',
    })
    expect(classifyApiEndpoint('enterpriseChannel.save', { channelId: 'finance-wecom' })).toEqual({
      action: 'channel.manage', resourceType: 'channel', resourceId: 'finance-wecom',
    })
    expect(classifyApiEndpoint('enterpriseChannel.list', {})).toEqual({
      action: 'channel.read', resourceType: 'channel',
    })
    expect(classifyApiEndpoint('enterpriseChannel.get', { channelId: 'finance-wecom' })).toEqual({
      action: 'channel.read', resourceType: 'channel', resourceId: 'finance-wecom',
    })
    expect(classifyApiEndpoint('enterpriseChannel.beginBinding', { channelId: 'finance-wecom' })).toEqual({
      action: 'channel.manage', resourceType: 'channel', resourceId: 'finance-wecom',
    })
    expect(classifyApiEndpoint('enterpriseChannel.completeBinding', { state: 'opaque' })).toEqual({
      action: 'channel.manage', resourceType: 'channel',
    })
    expect(classifyApiEndpoint('enterpriseOperation.approvals.get', { approvalId: 'approval-1' })).toEqual({ action: 'approval.read', resourceType: 'approval', resourceId: 'approval-1' })
    expect(classifyApiEndpoint('enterpriseOperation.schedules.transition', { scheduleId: 'schedule-1' })).toEqual({ action: 'schedule.manage', resourceType: 'schedule', resourceId: 'schedule-1' })
    expect(classifyApiEndpoint('enterpriseEmployee.unknown', {})).toBeUndefined()
    expect(classifyApiEndpoint('cordisWorkspace.save', { pluginId: 'plugin-1' })).toEqual({
      action: 'plugin.create', resourceType: 'cordis-plugin', resourceId: 'plugin-1',
    })
    for (const endpoint of ['cordisWorkspace.archive', 'cordisWorkspace.restore']) {
      expect(classifyApiEndpoint(endpoint, { pluginId: 'plugin-1' })).toEqual({
        action: 'plugin.create', resourceType: 'cordis-plugin', resourceId: 'plugin-1',
      })
    }
    expect(classifyApiEndpoint('cordisReview.publishOrganization', { pluginId: 'plugin-1' })).toEqual({
      action: 'plugin.publish', resourceType: 'cordis-plugin', resourceId: 'plugin-1',
    })
    expect(classifyApiEndpoint('cordisGovernance.disable', { pluginId: 'plugin-1' })).toEqual({
      action: 'plugin.manage', resourceType: 'cordis-plugin', resourceId: 'plugin-1',
    })
    expect(classifyApiEndpoint('cordisGovernance.departmentManagers', { departmentId: 'dept-a' })).toEqual({
      action: 'plugin.read', resourceType: 'department', resourceId: 'dept-a',
    })
  })

  it('classifies developer inventory endpoints as administrator-only system inspection', () => {
    expect(classifyApiEndpoint('dynamicCordisRunner.inventory', {})).toEqual({
      action: 'system.inspect', resourceType: 'system-inspection',
    })
    expect(classifyApiEndpoint('dynamicCordisRunner.syncInspectManifest', {})).toEqual({
      action: 'system.inspect', resourceType: 'system-inspection',
    })
  })

  it('allows only an administrator to read the remote model settings directory', async () => {
    const administrator = { userId: 'admin-1', orgId: 'org-a', roles: ['administrator'] as const }
    const member = { userId: 'member-1', orgId: 'org-a', roles: ['member'] as const }

    await expect(security.authorizeApiAsync(administrator, 'settings.describe', {}))
      .resolves.toEqual({ allowed: true, reason: 'administrator' })
    await expect(security.authorizeApiAsync(member, 'settings.describe', {}))
      .resolves.toEqual({ allowed: false, reason: 'insufficient-role' })
  })

  it('reserves Host-global model, credential, and inspection operations for platform administrators', async () => {
    const platform = { userId: 'admin-1', orgId: 'org-a', roles: ['administrator'] as const }
    const tenant = { userId: 'org-b-admin', orgId: 'org-b', roles: ['administrator'] as const }
    repository.createOrganizationWithAdministrator({
      organization: { id: 'org-b', name: 'Second enterprise' },
      administrator: {
        id: tenant.userId, orgId: tenant.orgId, username: 'admin', displayName: 'Tenant Admin', disabled: false,
      },
      passwordVerifier: createPasswordVerifier('second-password'),
    })

    for (const [endpoint, input] of [
      ['settings.describe', {}], ['credentials.set', {}], ['dynamicCordisRunner.inventory', {}],
    ] as const) {
      await expect(security.authorizeApiAsync(platform, endpoint, input))
        .resolves.toMatchObject({ allowed: true })
      await expect(security.authorizeApiAsync(tenant, endpoint, input))
        .resolves.toEqual({ allowed: false, reason: 'organization-mismatch' })
    }
  })

  it('enforces endpoint roles and restricted resource visibility', () => {
    const admin = security.loginLocal('org-a', 'admin', 'enterprise-password')?.principal
    const member = security.loginLocal('org-a', 'member', 'enterprise-password')?.principal
    expect(admin).toBeDefined()
    expect(member).toBeDefined()
    expect(security.authorizeApi(admin!, 'credentials.set', {}).allowed).toBe(true)
    expect(security.authorizeApi(member!, 'credentials.set', {}).allowed).toBe(false)
    expect(security.authorizeApi(member!, 'sessions.list', {}).allowed).toBe(true)
    expect(security.authorizeApi(member!, 'session.list', {}).allowed).toBe(true)
    expect(security.authorizeApi(member!, 'session.create', {})).toEqual({
      allowed: false, reason: 'insufficient-role',
    })

    repository.putResourcePolicy({
      resourceType: 'session', resourceId: 'session-1', orgId: 'org-a', creatorUserId: 'admin-1',
      visibility: 'private', allowedUserIds: [],
    })
    expect(security.authorizeApi(member!, 'sessions.history', { sessionId: 'session-1' }))
      .toEqual({ allowed: false, reason: 'resource-hidden' })
  })

  it('shows only owned and department Workspaces and exposes safe delete affordances', async () => {
    repository.saveDepartment({
      id: 'dept-ops', orgId: 'org-a', parentId: null, name: 'Operations', sortOrder: 0, expectedRevision: 0,
    })
    repository.setUserDepartments({
      orgId: 'org-a', userId: 'member-1', departmentIds: ['dept-ops'],
      primaryDepartmentId: 'dept-ops', expectedRevision: 0,
    })
    repository.saveWorkspaceGrant({
      workspaceId: 'member-default', orgId: 'org-a', name: 'Member personal', kind: 'personal',
      ownerUserId: 'member-1', rootPath: '/managed/member', sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    now++
    repository.saveWorkspaceGrant({
      workspaceId: 'member-created', orgId: 'org-a', name: 'Member project', kind: 'personal',
      ownerUserId: 'member-1', rootPath: '/managed/member/project', sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    repository.saveWorkspaceGrant({
      workspaceId: 'admin-personal', orgId: 'org-a', name: 'Admin personal', kind: 'personal',
      ownerUserId: 'admin-1', rootPath: '/managed/admin', sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    repository.saveWorkspaceGrant({
      workspaceId: 'dept-ops-shared', orgId: 'org-a', name: 'Operations shared', kind: 'department',
      departmentId: 'dept-ops', rootPath: '/managed/departments/ops', sandboxMode: 'read-only', expectedRevision: 0,
    })
    const member = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    const source = (async function* () {
      yield {
        type: 'baseline',
        value: {
          items: ['member-default', 'member-created', 'admin-personal', 'dept-ops-shared']
            .map(workspaceId => ({ workspaceId, title: workspaceId, path: `/${workspaceId}`, sessionIds: [] })),
          archivedSessionIds: [],
        },
      }
      yield { type: 'order', workspaceIds: ['admin-personal', 'member-created', 'dept-ops-shared'] }
    })()
    const project = (security as unknown as {
      filterWorkspaceFollow(principal: typeof member, frames: AsyncIterable<unknown>): AsyncIterable<unknown>
    }).filterWorkspaceFollow(member, source)
    const frames: unknown[] = []
    for await (const frame of project) frames.push(frame)
    expect(frames).toEqual([
      {
        type: 'baseline',
        value: {
          items: [
            expect.objectContaining({ workspaceId: 'member-default', deletable: false }),
            expect.objectContaining({ workspaceId: 'member-created', deletable: true }),
            expect.objectContaining({ workspaceId: 'dept-ops-shared', deletable: false }),
          ],
          archivedSessionIds: [],
        },
      },
      { type: 'order', workspaceIds: ['member-created', 'dept-ops-shared'] },
    ])
  })

  it('shares recorded collaboration reads and prompts only with current workspace members', async () => {
    repository.saveDepartment({ id: 'collab-dept', orgId: 'org-a', parentId: null, name: 'Collaboration', sortOrder: 0, expectedRevision: 0 })
    repository.setUserDepartments({ orgId: 'org-a', userId: 'member-1', departmentIds: ['collab-dept'], primaryDepartmentId: 'collab-dept', expectedRevision: 0 })
    repository.saveWorkspaceGrant({ workspaceId: 'collab-workspace', orgId: 'org-a', name: 'Collaboration', kind: 'department', departmentId: 'collab-dept', rootPath: '/collab', sandboxMode: 'read-only', expectedRevision: 0 })
    repository.bindSessionWorkspace({ sessionId: 'shared-session', workspaceId: 'collab-workspace', orgId: 'org-a', ownerUserId: 'admin-1' })
    repository.bindSessionWorkspace({ sessionId: 'private-session', workspaceId: 'collab-workspace', orgId: 'org-a', ownerUserId: 'admin-1' })
    let membership = true
    Object.assign(repository, { collaborationSessionAccess: async (input: { orgId: string; userId: string; sessionId: string }) =>
      input.sessionId === 'shared-session' ? { orgId: 'org-a', workspaceId: 'collab-workspace', member: membership && input.orgId === 'org-a' && input.userId === 'member-1' } : undefined })
    const member = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    for (const endpoint of ['session.history', 'session.page', 'session.follow', 'session.projections', 'session.capabilities', 'session.prompt']) {
      expect(await security.authorizeApiAsync(member, endpoint, { sessionId: 'shared-session' })).toMatchObject({ allowed: true })
      expect(await security.authorizeApiAsync(member, endpoint, { sessionId: 'private-session' })).toMatchObject({ allowed: false })
      expect(await security.authorizeApiAsync({ ...member, orgId: 'org-b' }, endpoint, { sessionId: 'shared-session' })).toMatchObject({ allowed: false })
    }
    for (const endpoint of ['session.rename', 'session.cancel', 'session.fork', 'agentPreset.select', 'workspace.archiveSession']) {
      expect(await security.authorizeApiAsync(member, endpoint, { sessionId: 'shared-session', workspaceId: 'collab-workspace' })).toMatchObject({ allowed: false })
    }
    for (const address of [{ kind: 'session', sessionId: 'shared-session' }, { kind: 'subagent', parentSessionId: 'shared-session', childSessionId: 'child', mode: 'continuable' }]) {
      expect(await security.authorizeApiAsync(member, 'session.follow', { address })).toMatchObject({ allowed: true })
      expect(security.sessionAuthorizationId({ address })).toBe('shared-session')
    }
    expect(await security.sessionOwnedBy(member, 'shared-session')).toBe(false)
    expect(await security.filterSessionList(member, { items: [{ sessionId: 'shared-session' }, { sessionId: 'private-session' }] })).toEqual({ items: [{ sessionId: 'shared-session' }] })
    const workspaceFrames: unknown[] = []
    for await (const frame of security.filterWorkspaceFollow(member, (async function* () {
      yield { type: 'baseline', value: { items: [{ workspaceId: 'collab-workspace', sessionIds: ['shared-session', 'private-session'] }], archivedSessionIds: [] } }
    })())) workspaceFrames.push(frame)
    expect(workspaceFrames).toMatchObject([{ type: 'baseline', value: { items: [{ sessionIds: ['shared-session'] }] } }])
    const controlFrames: unknown[] = []
    for await (const frame of security.filterSessionControl(member, (async function* () {
      yield { type: 'queue', sessionId: 'shared-session', items: [] }
      membership = false
      yield { type: 'queue', sessionId: 'shared-session', items: [] }
    })())) controlFrames.push(frame)
    expect(controlFrames).toEqual([{ type: 'queue', sessionId: 'shared-session', items: [] }])
    membership = true
    const followFrames: unknown[] = []
    for await (const frame of security.filterSessionFollow(member, 'shared-session', (async function* () {
      yield { type: 'event', seq: 1 }
      membership = false
      yield { type: 'event', seq: 2 }
    })())) followFrames.push(frame)
    expect(followFrames).toEqual([{ type: 'event', seq: 1 }])
    membership = true
    const owner = security.loginLocal('org-a', 'admin', 'enterprise-password')!.principal
    expect(await security.authorizeApiAsync(owner, 'session.rename', { sessionId: 'shared-session' })).toMatchObject({ allowed: true })
    membership = false
    expect(await security.authorizeApiAsync(member, 'session.prompt', { sessionId: 'shared-session' })).toMatchObject({ allowed: false })
    membership = true
    repository.setUserDepartments({ orgId: 'org-a', userId: 'member-1', departmentIds: [], expectedRevision: 1 })
    expect(await security.authorizeApiAsync(member, 'session.history', { sessionId: 'shared-session' })).toMatchObject({ allowed: false })
    expect(await security.filterSessionList(member, { items: [{ sessionId: 'shared-session' }] })).toEqual({ items: [] })
  })

  it('projects a shared Session only after its committed binding is republished to workspace followers', async () => {
    repository.createUser({ id: 'outsider-1', orgId: 'org-a', username: 'outsider', displayName: 'Outsider', disabled: false })
    repository.saveDepartment({ id: 'publish-dept', orgId: 'org-a', parentId: null, name: 'Department', sortOrder: 0, expectedRevision: 0 })
    for (const userId of ['member-1', 'outsider-1']) {
      repository.setUserDepartments({ orgId: 'org-a', userId, departmentIds: ['publish-dept'], primaryDepartmentId: 'publish-dept', expectedRevision: 0 })
    }
    repository.saveWorkspaceGrant({ workspaceId: 'publish-workspace', orgId: 'org-a', name: 'Workspace', kind: 'department', departmentId: 'publish-dept', rootPath: '/publish-workspace', sandboxMode: 'read-only', expectedRevision: 0 })
    let committed = false
    Object.assign(repository, { collaborationSessionAccess: async (input: { orgId: string; userId: string; sessionId: string }) =>
      committed && input.sessionId === 'new-topic-session' ? { orgId: 'org-a', workspaceId: 'publish-workspace', member: input.userId === 'member-1' } : undefined })
    const member = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    const outsider = { ...member, userId: 'outsider-1' }
    const upsert = { type: 'upsert', workspace: { workspaceId: 'publish-workspace', sessionIds: ['new-topic-session'] } }
    const frames = async function* () { yield upsert; yield upsert }
    const memberStream = security.filterWorkspaceFollow(member, frames())[Symbol.asyncIterator]()
    const outsiderStream = security.filterWorkspaceFollow(outsider, frames())[Symbol.asyncIterator]()
    expect((await memberStream.next()).value).toMatchObject({ workspace: { sessionIds: [] } })
    expect((await outsiderStream.next()).value).toMatchObject({ workspace: { sessionIds: [] } })
    repository.bindSessionWorkspace({ sessionId: 'new-topic-session', workspaceId: 'publish-workspace', orgId: 'org-a', ownerUserId: 'admin-1' })
    committed = true
    expect((await memberStream.next()).value).toMatchObject({ workspace: { sessionIds: ['new-topic-session'] } })
    expect((await outsiderStream.next()).value).toMatchObject({ workspace: { sessionIds: [] } })
    expect((await memberStream.next()).done).toBe(true)
    expect((await outsiderStream.next()).done).toBe(true)
  })

  it('authorizes native history addresses against the session or validated child parent', async () => {
    const member = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    for (const address of [{ kind: 'session', sessionId: 'foreign' }, { kind: 'subagent', parentSessionId: 'foreign', childSessionId: 'child', mode: 'continuable' }]) {
      expect(classifyApiEndpoint('session.follow', { address })).toMatchObject({ resourceId: 'foreign' })
      expect(await security.authorizeApiAsync(member, 'session.follow', { address })).toMatchObject({ allowed: false })
    }
  })

  it('revokes collaboration owner reads when membership or workspace access is removed', async () => {
    repository.saveDepartment({ id: 'owner-dept', orgId: 'org-a', parentId: null, name: 'Department', sortOrder: 0, expectedRevision: 0 })
    repository.setUserDepartments({ orgId: 'org-a', userId: 'member-1', departmentIds: ['owner-dept'], primaryDepartmentId: 'owner-dept', expectedRevision: 0 })
    repository.saveWorkspaceGrant({ workspaceId: 'owner-workspace', orgId: 'org-a', name: 'Collaboration', kind: 'department', departmentId: 'owner-dept', rootPath: '/owner-collab', sandboxMode: 'read-only', expectedRevision: 0 })
    repository.bindSessionWorkspace({ sessionId: 'owner-session', workspaceId: 'owner-workspace', orgId: 'org-a', ownerUserId: 'member-1' })
    let membership = true
    Object.assign(repository, { collaborationSessionAccess: async () => ({ orgId: 'org-a', workspaceId: 'owner-workspace', member: membership }) })
    const owner = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    expect(await security.sessionAccessibleBy(owner, 'owner-session')).toBe(true)
    membership = false
    expect(await security.sessionAccessibleBy(owner, 'owner-session')).toBe(false)
    expect(await security.authorizeApiAsync(owner, 'session.history', { sessionId: 'owner-session' })).toMatchObject({ allowed: false })
    expect(await security.authorizeApiAsync(owner, 'session.prompt', { sessionId: 'owner-session' })).toMatchObject({ allowed: false })
    expect(await security.sessionOwnedBy(owner, 'owner-session')).toBe(true)
    membership = true
    repository.setUserDepartments({ orgId: 'org-a', userId: 'member-1', departmentIds: [], expectedRevision: 1 })
    expect(await security.sessionAccessibleBy(owner, 'owner-session')).toBe(false)
    expect(await security.filterSessionList(owner, { items: [{ sessionId: 'owner-session' }] })).toEqual({ items: [] })
  })

  it('keeps department Workspace Sessions private to their creating user', async () => {
    repository.saveDepartment({
      id: 'dept-ops', orgId: 'org-a', parentId: null, name: 'Operations', sortOrder: 0, expectedRevision: 0,
    })
    repository.setUserDepartments({
      orgId: 'org-a', userId: 'member-1', departmentIds: ['dept-ops'],
      primaryDepartmentId: 'dept-ops', expectedRevision: 0,
    })
    repository.setUserDepartments({
      orgId: 'org-a', userId: 'admin-1', departmentIds: ['dept-ops'],
      primaryDepartmentId: 'dept-ops', expectedRevision: 0,
    })
    repository.saveWorkspaceGrant({
      workspaceId: 'dept-ops-shared', orgId: 'org-a', name: 'Operations shared', kind: 'department',
      departmentId: 'dept-ops', rootPath: '/managed/departments/ops', sandboxMode: 'read-only', expectedRevision: 0,
    })
    repository.bindSessionWorkspace({
      sessionId: 'session-member', workspaceId: 'dept-ops-shared', orgId: 'org-a', ownerUserId: 'member-1',
    })
    repository.bindSessionWorkspace({
      sessionId: 'session-admin', workspaceId: 'dept-ops-shared', orgId: 'org-a', ownerUserId: 'admin-1',
    })

    const member = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    const source = (async function* () {
      yield {
        type: 'baseline',
        value: {
          items: [{
            workspaceId: 'dept-ops-shared', title: 'Operations shared', path: '/managed/departments/ops',
            sessionIds: ['session-member', 'session-admin'],
          }],
          archivedSessionIds: ['session-member', 'session-admin'],
        },
      }
    })()
    const frames: unknown[] = []
    for await (const frame of security.filterWorkspaceFollow(member, source)) frames.push(frame)

    expect(frames).toEqual([{
      type: 'baseline',
      value: {
        items: [expect.objectContaining({
          workspaceId: 'dept-ops-shared', sessionIds: ['session-member'], deletable: false,
        })],
        archivedSessionIds: ['session-member'],
      },
    }])

    const sessionSecurity = security as EnterpriseSecurity & {
      filterSessionList(principal: typeof member, value: unknown): Promise<unknown>
      filterSessionControl(principal: typeof member, frames: AsyncIterable<unknown>): AsyncIterable<unknown>
    }
    await expect(sessionSecurity.filterSessionList(member, {
      items: [{ sessionId: 'session-member' }, { sessionId: 'session-admin' }],
    })).resolves.toEqual({ items: [{ sessionId: 'session-member' }] })

    const controlFrames: unknown[] = []
    for await (const frame of sessionSecurity.filterSessionControl(member, (async function* () {
      yield {
        type: 'baseline', value: {
          queues: { 'session-member': [], 'session-admin': [] },
          jobs: { 'session-member': [], 'session-admin': [] },
          projections: { 'session-member': { asOfSeq: 0 }, 'session-admin': { asOfSeq: 0 } },
        },
      }
      yield { type: 'queue', sessionId: 'session-admin', items: [] }
      yield { type: 'queue', sessionId: 'session-member', items: [] }
    })())) controlFrames.push(frame)
    expect(controlFrames).toEqual([{
      type: 'baseline', value: {
        queues: { 'session-member': [] }, jobs: { 'session-member': [] },
        projections: { 'session-member': { asOfSeq: 0 } },
      },
    }, { type: 'queue', sessionId: 'session-member', items: [] }])
  })

  it('allows creation but deletes only a later personal Workspace owned by the caller', async () => {
    repository.saveWorkspaceGrant({
      workspaceId: 'member-default', orgId: 'org-a', name: 'Member personal', kind: 'personal',
      ownerUserId: 'member-1', rootPath: '/managed/member', sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    now++
    repository.saveWorkspaceGrant({
      workspaceId: 'member-created', orgId: 'org-a', name: 'Member project', kind: 'personal',
      ownerUserId: 'member-1', rootPath: '/managed/member/project', sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    repository.saveWorkspaceGrant({
      workspaceId: 'admin-personal', orgId: 'org-a', name: 'Admin personal', kind: 'personal',
      ownerUserId: 'admin-1', rootPath: '/managed/admin', sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    const member = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    await expect(security.authorizeApiAsync(member, 'workspace.create', { path: '/managed/member/new' }))
      .resolves.toMatchObject({ allowed: true })
    await expect(security.authorizeApiAsync(member, 'workspace.delete', { workspaceId: 'member-default' }))
      .resolves.toMatchObject({ allowed: false })
    await expect(security.authorizeApiAsync(member, 'workspace.delete', { workspaceId: 'member-created' }))
      .resolves.toMatchObject({ allowed: true })
    await expect(security.authorizeApiAsync(member, 'workspace.delete', { workspaceId: 'admin-personal' }))
      .resolves.toMatchObject({ allowed: false })
  })

  it('resolves catalog-owned employee policy after identity policy misses', async () => {
    repository.createUser({ id: 'creator-1', orgId: 'org-a', username: 'creator', displayName: 'Creator', disabled: false })
    repository.setRoles('creator-1', ['creator'])
    const creator = { userId: 'creator-1', orgId: 'org-a', roles: ['creator'] as const }
    const member = { userId: 'member-1', orgId: 'org-a', roles: ['member'] as const }
    const resolved = new EnterpriseSecurity(repository, config, {
      resourcePolicyResolver: async (_type, id) => id === 'owned'
        ? { orgId: 'org-a', creatorUserId: 'creator-1', visibility: 'private' }
        : id === 'other-org'
          ? { orgId: 'org-b', creatorUserId: 'creator-1', visibility: 'organization' }
          : id === 'restricted' ? { orgId: 'org-a', creatorUserId: 'creator-1', visibility: 'restricted' } : null,
    })
    await expect(resolved.authorizeApiAsync(creator, 'enterpriseEmployee.publish', { presetId: 'owned' }))
      .resolves.toMatchObject({ allowed: true })
    await expect(resolved.authorizeApiAsync(member, 'enterpriseEmployee.getDraft', { presetId: 'owned' }))
      .resolves.toEqual({ allowed: false, reason: 'resource-hidden' })
    await expect(resolved.authorizeApiAsync(creator, 'enterpriseEmployee.getDraft', { presetId: 'other-org' }))
      .resolves.toEqual({ allowed: false, reason: 'organization-mismatch' })
    await expect(resolved.authorizeApiAsync(member, 'enterpriseEmployee.getDraft', { presetId: 'restricted' }))
      .resolves.toEqual({ allowed: false, reason: 'resource-hidden' })
  })

  it('records every allowed and denied API decision with correlation evidence', () => {
    const member = security.loginLocal('org-a', 'member', 'enterprise-password')?.principal
    security.auditApi(member!, 'credentials.set', {}, { allowed: false, reason: 'insufficient-role' }, 'rpc-1')
    expect(repository.listAudit({ orgId: 'org-a', limit: 10 })).toEqual([
      expect.objectContaining({
        actorUserId: 'member-1', action: 'credential.manage', decision: 'denied', correlationId: 'rpc-1',
      }),
    ])
  })

  it('records a Host-resolved audit resource without reclassifying its type from the endpoint', async () => {
    const member = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    await security.auditApiResourceAsync(
      member, 'enterpriseTeamRun.start', { runId: 'run-a' },
      { allowed: false, reason: 'insufficient-role' }, 'run-a',
      { type: 'team-run', id: 'run-a', details: { teamId: 'team-a', teamDefinitionRevision: 4 } },
    )
    expect(repository.listAudit({ orgId: 'org-a', limit: 10 })).toEqual([
      expect.objectContaining({
        action: 'team.execute', resourceType: 'team-run', resourceId: 'run-a',
        decision: 'denied', correlationId: 'run-a',
        details: { endpoint: 'enterpriseTeamRun.start', teamId: 'team-a', teamDefinitionRevision: 4 },
      }),
    ])
  })

  it('preserves a Host-resolved admission reason instead of rewriting it as insufficient-role', async () => {
    const member = security.loginLocal('org-a', 'member', 'enterprise-password')!.principal
    await security.auditApiResourceAsync(
      member, 'enterpriseTeamRun.start', { teamId: 'team-a' },
      { allowed: false, reason: 'workspace-forbidden' }, 'team-run:start:key-a',
      { type: 'team-definition', id: 'team-a', details: { outcomeReason: 'workspace-forbidden' } },
    )
    expect(repository.listAudit({ orgId: 'org-a', limit: 10 })[0]).toMatchObject({
      decision: 'denied', reason: 'workspace-forbidden', correlationId: 'team-run:start:key-a',
    })
  })

  it('revokes logout sessions and expires them at the configured boundary', () => {
    const login = security.loginLocal('org-a', 'admin', 'enterprise-password')!
    security.logout(login.cookie)
    expect(security.authenticateCookie(login.cookie)).toBeUndefined()
    const next = security.loginLocal('org-a', 'admin', 'enterprise-password')!
    now += config.sessionTtlMs + 1
    expect(security.authenticateCookie(next.cookie)).toBeUndefined()
  })
})
