import { describe, expect, it, vi } from 'vitest'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import {
  EnterpriseOperationsAuthorizationError,
  EnterpriseOperationsService,
  type EnterpriseTeamDefinition,
  type EnterpriseOperationsDriver,
} from '../src/index.ts'

const principal: EnterprisePrincipal = { userId: 'user-a', orgId: 'org-a', roles: ['operator'] }

function definition(overrides: Partial<EnterpriseTeamDefinition> = {}): EnterpriseTeamDefinition {
  return {
    teamId: 'team-a', orgId: 'org-a', name: 'Finance', northStar: 'Verified close.', ownerUserId: 'owner-a',
    visibility: 'organization', leaderEmployeeReleaseId: 'release-a',
    roles: [{ roleId: 'owner', name: 'Owner', responsibility: 'Own.' }],
    roster: [
      { actor: { kind: 'human', userId: 'owner-a' }, roleId: 'owner' },
      { actor: { kind: 'agent', employeeReleaseId: 'release-a' }, roleId: 'owner' },
    ],
    verificationPolicy: { verifierRequired: true, rubricRefs: [], highRiskHumanReviewRequired: true },
    attentionPolicy: { decisionQueue: 'centralized' }, approvalPolicy: {}, state: 'active',
    revision: 1, createdAt: 1, updatedAt: 1, ...overrides,
  }
}

function driver(overrides: Partial<EnterpriseOperationsDriver> = {}): EnterpriseOperationsDriver {
  return {
    upsertWorkRecord: vi.fn(),
    getWorkRecord: vi.fn(),
    listWorkRecords: vi.fn().mockResolvedValue({ items: [] }),
    createApprovalRequest: vi.fn(),
    getApproval: vi.fn(),
    listApprovals: vi.fn().mockResolvedValue({ items: [] }),
    transitionApproval: vi.fn(),
    createSchedule: vi.fn(),
    saveSchedule: vi.fn(),
    getSchedule: vi.fn(),
    listSchedules: vi.fn().mockResolvedValue([]),
    transitionSchedule: vi.fn(),
    fireSchedule: vi.fn(),
    claimOutbox: vi.fn().mockResolvedValue([]),
    completeOutbox: vi.fn(),
    failOutbox: vi.fn(),
    createFixedTeam: vi.fn(),
    saveFixedTeam: vi.fn(),
    getFixedTeam: vi.fn(),
    listFixedTeams: vi.fn().mockResolvedValue({ items: [] }),
    createTeamDefinition: vi.fn(),
    saveTeamDefinition: vi.fn(),
    getTeamDefinition: vi.fn(),
    listTeamDefinitions: vi.fn().mockResolvedValue({ items: [] }),
    archiveTeamDefinition: vi.fn(),
    ...overrides,
  }
}

describe('EnterpriseOperationsService', () => {
  it('denies a cross-organization request before invoking authorization or the driver', async () => {
    const operations = driver()
    const authorize = vi.fn().mockResolvedValue(true)
    const audit = vi.fn()
    const service = new EnterpriseOperationsService(operations, { authorize, audit })

    await expect(service.listWorkRecords(principal, { orgId: 'org-b' })).rejects.toMatchObject<EnterpriseOperationsAuthorizationError>({
      code: 'organization-mismatch',
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(operations.listWorkRecords).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'enterpriseOperation.workRecords.list',
      decision: { allowed: false, reason: 'organization-mismatch' },
    }))
  })

  it('authorizes and audits an allowed operation, then scopes the driver to the principal organization', async () => {
    const operations = driver()
    const authorize = vi.fn().mockResolvedValue({ allowed: true, reason: 'role' })
    const audit = vi.fn()
    const service = new EnterpriseOperationsService(operations, { authorize, audit })

    await service.listWorkRecords(principal, { businessState: 'active' })

    expect(authorize).toHaveBeenCalledWith(principal, 'enterpriseOperation.workRecords.list', { businessState: 'active' })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      principal,
      endpoint: 'enterpriseOperation.workRecords.list',
      decision: { allowed: true, reason: 'role' },
    }))
    expect(operations.listWorkRecords).toHaveBeenCalledWith({ orgId: 'org-a', businessState: 'active' })
  })

  it('fails closed when the authorization callback denies a mutation', async () => {
    const operations = driver()
    const authorize = vi.fn().mockResolvedValue({ allowed: false, reason: 'insufficient-role' })
    const service = new EnterpriseOperationsService(operations, { authorize, audit: vi.fn() })

    await expect(service.transitionSchedule(principal, {
      scheduleId: 'schedule-a', expectedRevision: 1, state: 'paused', idempotencyKey: 'request-a',
    })).rejects.toMatchObject<EnterpriseOperationsAuthorizationError>({ code: 'insufficient-role' })
    expect(operations.transitionSchedule).not.toHaveBeenCalled()
  })

  it('allows approval cancellation only to its requester or an administrator', async () => {
    const operations = driver({
      getApproval: vi.fn().mockResolvedValue({ approvalId: 'approval-a', orgId: 'org-a', requestedBy: 'owner-a', state: 'pending' }),
    })
    const authorize = vi.fn().mockResolvedValue(true)
    const audit = vi.fn()
    const service = new EnterpriseOperationsService(operations, { authorize, audit })
    await expect(service.transitionApproval(principal, {
      approvalId: 'approval-a', expectedRevision: 1, idempotencyKey: 'cancel-a', state: 'cancelled', actorUserId: 'user-a',
    })).rejects.toMatchObject<EnterpriseOperationsAuthorizationError>({ code: 'insufficient-role' })
    expect(operations.transitionApproval).not.toHaveBeenCalled()
    expect(authorize).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'enterpriseOperation.approvals.transition',
      decision: { allowed: false, reason: 'insufficient-role' },
      resourceType: 'approval', resourceId: 'approval-a',
    }))
  })

  it('forwards schedule filters and cursor through the scoped page contract', async () => {
    const page = { items: [], nextCursor: 'next' }
    const operations = driver({ listSchedules: vi.fn().mockResolvedValue(page) })
    const service = new EnterpriseOperationsService(operations, { authorize: vi.fn().mockResolvedValue(true), audit: vi.fn() })

    await expect(service.listSchedules(principal, { state: 'paused', limit: 10, cursor: 'cursor' })).resolves.toEqual(page)
    expect(operations.listSchedules).toHaveBeenCalledWith({
      orgId: 'org-a', state: 'paused', limit: 10, cursor: 'cursor',
    })
  })

  it('does not read approval data when central authorization denies cancellation', async () => {
    const operations = driver()
    const audit = vi.fn()
    const service = new EnterpriseOperationsService(operations, {
      authorize: vi.fn().mockResolvedValue({ allowed: false, reason: 'insufficient-role' }), audit,
    })

    await expect(service.transitionApproval(principal, {
      approvalId: 'approval-a', expectedRevision: 1, idempotencyKey: 'cancel-denied',
      state: 'cancelled', actorUserId: 'user-a',
    })).rejects.toMatchObject<EnterpriseOperationsAuthorizationError>({ code: 'insufficient-role' })
    expect(operations.getApproval).not.toHaveBeenCalled()
    expect(operations.transitionApproval).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'enterpriseOperation.approvals.transition',
      decision: { allowed: false, reason: 'insufficient-role' },
    }))
  })

  it('injects the principal organization and audits team-definition operations', async () => {
    const operations = driver()
    const authorize = vi.fn().mockResolvedValue({ allowed: true, reason: 'role' })
    const audit = vi.fn()
    const service = new EnterpriseOperationsService(operations, { authorize, audit })
    const input = {
      teamId: 'team-a', name: 'Finance', northStar: 'Verified close.', ownerUserId: 'user-a',
      visibility: 'organization' as const, leaderEmployeeReleaseId: 'release-a',
      roles: [{ roleId: 'owner', name: 'Owner', responsibility: 'Own.' }],
      roster: [
        { actor: { kind: 'human' as const, userId: 'user-a' }, roleId: 'owner' },
        { actor: { kind: 'agent' as const, employeeReleaseId: 'release-a' }, roleId: 'owner' },
      ],
      verificationPolicy: { verifierRequired: true, rubricRefs: [], highRiskHumanReviewRequired: true },
      attentionPolicy: { decisionQueue: 'centralized' as const }, approvalPolicy: {}, state: 'active' as const,
      expectedRevision: 0, idempotencyKey: 'save-a',
    }

    await service.saveTeamDefinition(principal, input)
    await service.listTeamDefinitions(principal, { limit: 20 })
    await service.archiveTeamDefinition(principal, {
      teamId: 'team-a', expectedRevision: 1, idempotencyKey: 'archive-a',
    })

    expect(operations.saveTeamDefinition).toHaveBeenCalledWith({ ...input, orgId: 'org-a' })
    expect(operations.listTeamDefinitions).toHaveBeenCalledWith({ orgId: 'org-a', limit: 20 })
    expect(operations.archiveTeamDefinition).toHaveBeenCalledWith({
      orgId: 'org-a', teamId: 'team-a', expectedRevision: 1, idempotencyKey: 'archive-a',
    })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'enterpriseOperation.teamDefinitions.save', resourceType: 'team-definition', resourceId: 'team-a',
    }))
  })

  it('filters organization, private, and restricted definitions for the authenticated viewer', async () => {
    const visibleOrganization = definition({ teamId: 'organization' })
    const hiddenPrivate = definition({ teamId: 'private', visibility: 'private' })
    const visibleRestricted = definition({
      teamId: 'restricted-visible', visibility: 'restricted', allowedUserIds: ['viewer-a'],
    })
    const hiddenRestricted = definition({
      teamId: 'restricted-hidden', visibility: 'restricted', allowedUserIds: ['other-a'],
    })
    const page = { items: [visibleOrganization, hiddenPrivate, visibleRestricted, hiddenRestricted], nextCursor: 'next' }
    const operations = driver({ listTeamDefinitions: vi.fn().mockResolvedValue(page) })
    const service = new EnterpriseOperationsService(operations, {
      authorize: vi.fn().mockResolvedValue(true), audit: vi.fn(),
    })
    const viewer: EnterprisePrincipal = { userId: 'viewer-a', orgId: 'org-a', roles: ['member'] }

    await expect(service.listTeamDefinitions(viewer, {})).resolves.toEqual({
      items: [visibleOrganization, visibleRestricted], nextCursor: 'next',
    })
    await expect(service.listTeamDefinitions({
      userId: 'admin-a', orgId: 'org-a', roles: ['administrator'],
    }, {})).resolves.toEqual(page)
  })

  it('allows owners and administrators to read private definitions and hides them from other readers', async () => {
    const privateDefinition = definition({ visibility: 'private' })
    const operations = driver({ getTeamDefinition: vi.fn().mockResolvedValue(privateDefinition) })
    const service = new EnterpriseOperationsService(operations, {
      authorize: vi.fn().mockResolvedValue(true), audit: vi.fn(),
    })
    const owner: EnterprisePrincipal = { userId: 'owner-a', orgId: 'org-a', roles: ['member'] }
    const member: EnterprisePrincipal = { userId: 'member-a', orgId: 'org-a', roles: ['member'] }
    const administrator: EnterprisePrincipal = { userId: 'admin-a', orgId: 'org-a', roles: ['administrator'] }

    await expect(service.getTeamDefinition(owner, { teamId: 'team-a' })).resolves.toEqual(privateDefinition)
    await expect(service.getTeamDefinition(administrator, { teamId: 'team-a' })).resolves.toEqual(privateDefinition)
    await expect(service.getTeamDefinition(member, { teamId: 'team-a' })).resolves.toBeUndefined()
  })
})
