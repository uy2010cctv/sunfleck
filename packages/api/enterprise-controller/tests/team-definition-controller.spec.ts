import { Context } from '@deepseek-ai/cordis'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import { EnterpriseOperationsError } from '@deepseek-ai/dsh-enterprise-operations'
import { TypertRemoteFailure } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import { EnterpriseTeamDefinitionController } from '../src/index.ts'

const saved = {
  teamId: 'team-a', orgId: 'org-a', name: 'Finance', northStar: 'Verified close.', ownerUserId: 'creator-a',
  visibility: 'organization' as const, leaderEmployeeReleaseId: 'release-a',
  roles: [{ roleId: 'owner', name: 'Owner', responsibility: 'Own.' }],
  roster: [
    { actor: { kind: 'human' as const, userId: 'creator-a' }, roleId: 'owner' },
    { actor: { kind: 'agent' as const, employeeReleaseId: 'release-a' }, roleId: 'owner' },
  ],
  verificationPolicy: { verifierRequired: true, rubricRefs: [], highRiskHumanReviewRequired: true },
  attentionPolicy: { decisionQueue: 'centralized' as const }, approvalPolicy: {}, state: 'active' as const,
  revision: 1, createdAt: 1, updatedAt: 1,
}

function setup(allowed = true) {
  const driver = {
    saveTeamDefinition: vi.fn().mockResolvedValue(saved),
    getTeamDefinition: vi.fn().mockResolvedValue(saved),
    listTeamDefinitions: vi.fn().mockResolvedValue({ items: [saved] }),
    archiveTeamDefinition: vi.fn().mockResolvedValue({ ...saved, state: 'archived', revision: 2 }),
  }
  const authorizeApiAsync = vi.fn().mockResolvedValue({
    allowed, reason: allowed ? 'role' : 'insufficient-role',
  })
  const auditApiAsync = vi.fn().mockResolvedValue(undefined)
  const requestContext = new EnterpriseRequestContext()
  const ctx = new Context()
  ctx.provide('enterprisePostgres' as never, { operations: driver } as never)
  ctx.provide('enterpriseSecurity' as never, { authorizeApiAsync, auditApiAsync } as never)
  ctx.provide('enterpriseRequestContext' as never, requestContext as never)
  return { controller: new EnterpriseTeamDefinitionController(ctx), driver, requestContext, authorizeApiAsync, auditApiAsync }
}

const principal = { orgId: 'org-a', userId: 'creator-a', roles: ['creator'] as const }
const request = {
  teamId: 'team-a', name: saved.name, northStar: saved.northStar, ownerUserId: saved.ownerUserId,
  visibility: saved.visibility, leaderEmployeeReleaseId: saved.leaderEmployeeReleaseId,
  roles: saved.roles, roster: saved.roster, verificationPolicy: saved.verificationPolicy,
  attentionPolicy: saved.attentionPolicy, approvalPolicy: {}, state: 'active' as const,
  expectedRevision: 0, idempotencyKey: 'save-a',
}

describe('enterprise team-definition Remote controller', () => {
  it('injects the authenticated organization and exposes list, get, save, and archive', async () => {
    const app = setup()
    await app.requestContext.run(principal, async () => {
      await expect(app.controller.save(request)).resolves.toEqual(saved)
      await expect(app.controller.get({ teamId: 'team-a' })).resolves.toEqual(saved)
      await expect(app.controller.list({ limit: 20 })).resolves.toEqual({ items: [saved] })
      await expect(app.controller.archive({
        teamId: 'team-a', expectedRevision: 1, idempotencyKey: 'archive-a',
      })).resolves.toMatchObject({ state: 'archived', revision: 2 })
    })

    expect(app.driver.saveTeamDefinition).toHaveBeenCalledWith({ ...request, orgId: 'org-a' })
    expect(request).not.toHaveProperty('orgId')
    expect(request).not.toHaveProperty('actorUserId')
    expect(app.authorizeApiAsync).toHaveBeenCalledWith(
      principal, 'enterpriseOperation.teamDefinitions.save', request,
    )
    expect(app.auditApiAsync).toHaveBeenCalledWith(
      principal, 'enterpriseOperation.teamDefinitions.save', { teamId: 'team-a' },
      { allowed: true, reason: 'role' }, expect.any(String),
    )
  })

  it('denies team management before invoking the repository and audits the denial', async () => {
    const app = setup(false)
    const failure = await app.requestContext.run(principal, () => app.controller.save(request)).catch(error => error)
    expect(failure).toBeInstanceOf(TypertRemoteFailure)
    expect((failure as TypertRemoteFailure).failure).toMatchObject({ code: 'enterprise-forbidden' })
    expect(app.driver.saveTeamDefinition).not.toHaveBeenCalled()
    expect(app.auditApiAsync).toHaveBeenCalledWith(
      principal, 'enterpriseOperation.teamDefinitions.save', { teamId: 'team-a' },
      { allowed: false, reason: 'insufficient-role' }, expect.any(String),
    )
  })

  it('returns the stable conflict failure for a stale revision', async () => {
    const app = setup()
    app.driver.saveTeamDefinition.mockRejectedValueOnce(
      new EnterpriseOperationsError('conflict', 'team-definition', 'team-a'),
    )
    const failure = await app.requestContext.run(principal, () => app.controller.save({
      ...request, expectedRevision: 1, idempotencyKey: 'stale-a',
    })).catch(error => error)
    expect(failure).toBeInstanceOf(TypertRemoteFailure)
    expect((failure as TypertRemoteFailure).failure).toEqual({
      code: 'enterprise-conflict', message: 'enterprise operations conflict',
      details: { endpoint: 'enterpriseTeamDefinition.save', resourceType: 'team-definition', resourceId: 'team-a' },
    })
  })
})
