import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnterpriseIdentityRepository } from '@deepseek-ai/dsh-enterprise-identity'
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
    expect(classifyApiEndpoint('enterpriseEmployee.getDraft', { presetId: 'employee-1' })).toEqual({ action: 'employee.read', resourceType: 'employee', resourceId: 'employee-1' })
    expect(classifyApiEndpoint('enterpriseEmployee.publish', { presetId: 'employee-1' })).toEqual({ action: 'employee.update', resourceType: 'employee', resourceId: 'employee-1' })
    expect(classifyApiEndpoint('enterpriseAsset.get', { assetId: 'asset-1' })).toEqual({ action: 'capability.read', resourceType: 'enterprise-asset', resourceId: 'asset-1' })
    expect(classifyApiEndpoint('enterpriseAsset.archive', { assetId: 'asset-1' })).toEqual({ action: 'capability.manage', resourceType: 'enterprise-asset', resourceId: 'asset-1' })
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
