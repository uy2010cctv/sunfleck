import { Context } from '@deepseek-ai/cordis'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import { EnterpriseOperationsError } from '@deepseek-ai/dsh-enterprise-operations'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { describe, expect, it, vi } from 'vitest'
import { EnterpriseTeamController, EnterpriseTeamDefinitionController, type EnterpriseTeamDefinition } from '../src/index.ts'

const saved: EnterpriseTeamDefinition = {
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

function setup(allowed = true, definition: EnterpriseTeamDefinition = saved) {
  const visible = (readScope: { userId: string; isAdministrator: boolean }) =>
    readScope.isAdministrator || definition.visibility === 'organization' || definition.ownerUserId === readScope.userId
      || (definition.visibility === 'restricted' && (definition.allowedUserIds?.includes(readScope.userId) ?? false))
  const driver = {
    saveTeamDefinition: vi.fn().mockResolvedValue(definition),
    getTeamDefinition: vi.fn().mockImplementation(async (_orgId, _teamId, readScope) =>
      visible(readScope) ? definition : undefined),
    getTeamDefinitionDraft: vi.fn().mockImplementation(async (_orgId, _teamId, readScope) =>
      readScope.isAdministrator || definition.ownerUserId === readScope.userId ? definition : undefined),
    listTeamDefinitions: vi.fn().mockImplementation(async ({ readScope }) => ({
      items: visible(readScope) ? [definition] : [],
    })),
    archiveTeamDefinition: vi.fn().mockResolvedValue({ ...definition, state: 'archived', revision: 2 }),
    saveTeamDefinitionDraft: vi.fn().mockResolvedValue(definition),
    publishTeamDefinitionDraft: vi.fn().mockResolvedValue(definition),
    discardTeamDefinitionDraft: vi.fn().mockResolvedValue(definition),
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
  it('injects the authenticated organization and exposes list, get, draft reads, save, and archive', async () => {
    const app = setup()
    await app.requestContext.run(principal, async () => {
      await expect(app.controller.save(request)).resolves.toEqual(saved)
      await expect(app.controller.get({ teamId: 'team-a' })).resolves.toEqual(saved)
      await expect(app.controller.getDraft({ teamId: 'team-a' })).resolves.toEqual(saved)
      await expect(app.controller.list({ limit: 20 })).resolves.toEqual({ items: [saved] })
      await expect(app.controller.archive({
        teamId: 'team-a', expectedRevision: 1, idempotencyKey: 'archive-a',
      })).resolves.toMatchObject({ state: 'archived', revision: 2 })
    })

    expect(app.driver.saveTeamDefinitionDraft).toHaveBeenCalledWith({ ...request, orgId: 'org-a', state: 'draft' })
    expect(request).not.toHaveProperty('orgId')
    expect(request).not.toHaveProperty('actorUserId')
    expect(app.authorizeApiAsync).toHaveBeenCalledWith(
      principal, 'enterpriseOperation.teamDefinitions.draft', { ...request, state: 'draft' },
    )
    expect(app.auditApiAsync).toHaveBeenCalledWith(
      principal, 'enterpriseOperation.teamDefinitions.draft', { teamId: 'team-a' },
      { allowed: true, reason: 'role' }, expect.any(String),
    )
  })

  it('exposes draft, publish, and discard as explicit revision operations', async () => {
    const app = setup()
    await app.requestContext.run(principal, async () => {
      await expect(app.controller.draft({ ...request, state: 'draft', expectedRevision: 1, idempotencyKey: 'draft-a' }))
        .resolves.toEqual(saved)
      await expect(app.controller.publish({ teamId: 'team-a', expectedRevision: 1, idempotencyKey: 'publish-a' }))
        .resolves.toEqual(saved)
      await expect(app.controller.discardDraft({ teamId: 'team-a', expectedRevision: 1, idempotencyKey: 'discard-a' }))
        .resolves.toEqual(saved)
    })
  })

  it('denies team management before invoking the repository and audits the denial', async () => {
    const app = setup(false)
    const failure = await app.requestContext.run(principal, () => app.controller.save(request)).catch(error => error)
    expect(failure).toBeInstanceOf(RemoteError)
    expect(failure).toMatchObject({ code: 'enterprise-forbidden' })
    expect(app.driver.saveTeamDefinitionDraft).not.toHaveBeenCalled()
    expect(app.auditApiAsync).toHaveBeenCalledWith(
      principal, 'enterpriseOperation.teamDefinitions.draft', { teamId: 'team-a' },
      { allowed: false, reason: 'insufficient-role' }, expect.any(String),
    )
  })

  it('denies every draft lifecycle mutation before invoking the repository', async () => {
    const app = setup(false)
    const failures = await app.requestContext.run(principal, () => Promise.all([
      app.controller.draft({ ...request, state: 'draft', expectedRevision: 1, idempotencyKey: 'draft-denied' }).catch(error => error),
      app.controller.publish({ teamId: 'team-a', expectedRevision: 1, idempotencyKey: 'publish-denied' }).catch(error => error),
      app.controller.discardDraft({ teamId: 'team-a', expectedRevision: 1, idempotencyKey: 'discard-denied' }).catch(error => error),
    ]))
    for (const failure of failures) expect(failure).toMatchObject({ code: 'enterprise-forbidden' })
    expect(app.driver.saveTeamDefinitionDraft).not.toHaveBeenCalled()
    expect(app.driver.publishTeamDefinitionDraft).not.toHaveBeenCalled()
    expect(app.driver.discardTeamDefinitionDraft).not.toHaveBeenCalled()
  })

  it('returns the stable conflict failure for a stale revision', async () => {
    const app = setup()
    app.driver.saveTeamDefinitionDraft.mockRejectedValueOnce(
      new EnterpriseOperationsError('conflict', 'team-definition', 'team-a'),
    )
    const failure = await app.requestContext.run(principal, () => app.controller.save({
      ...request, expectedRevision: 1, idempotencyKey: 'stale-a',
    })).catch(error => error)
    expect(failure).toBeInstanceOf(RemoteError)
    expect(failure).toMatchObject({
      code: 'enterprise-conflict', message: 'enterprise operations conflict',
      details: { endpoint: 'enterpriseTeamDefinition.save', resourceType: 'team-definition', resourceId: 'team-a' },
    })
  })

  it('denies list, get, and archive when team RBAC rejects the authenticated principal', async () => {
    const app = setup(false)
    const failures = await app.requestContext.run(principal, () => Promise.all([
      app.controller.list({}).catch(error => error),
      app.controller.get({ teamId: 'team-a' }).catch(error => error),
      app.controller.archive({ teamId: 'team-a', expectedRevision: 1, idempotencyKey: 'archive-denied' })
        .catch(error => error),
    ]))
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(RemoteError)
      expect(failure).toMatchObject({ code: 'enterprise-forbidden' })
    }
    expect(app.driver.listTeamDefinitions).not.toHaveBeenCalled()
    expect(app.driver.getTeamDefinition).not.toHaveBeenCalled()
    expect(app.driver.archiveTeamDefinition).not.toHaveBeenCalled()
  })

  it('does not reveal a private definition to another authorized team reader', async () => {
    const app = setup(true, { ...saved, ownerUserId: 'other-a', visibility: 'private' })
    const failure = await app.requestContext.run(principal, () => app.controller.get({ teamId: 'team-a' }))
      .catch(error => error)
    expect(failure).toBeInstanceOf(RemoteError)
    expect(failure).toMatchObject({ code: 'enterprise-not-found' })
  })

  it('fails closed without an authenticated request principal', async () => {
    const app = setup()
    const failure = await app.controller.list({}).catch(error => error)
    expect(failure).toBeInstanceOf(RemoteError)
    expect(failure).toMatchObject({ code: 'enterprise-forbidden' })
    expect(app.driver.listTeamDefinitions).not.toHaveBeenCalled()
  })
})

describe('legacy fixed-team Remote controller', () => {
  it('rejects browser attempts to create a new fixed team', async () => {
    const ctx = new Context()
    const requestContext = new EnterpriseRequestContext()
    const saveFixedTeam = vi.fn()
    ctx.provide('enterprisePostgres' as never, { operations: { saveFixedTeam } } as never)
    ctx.provide('enterpriseSecurity' as never, {
      authorizeApiAsync: vi.fn().mockResolvedValue({ allowed: true }), auditApiAsync: vi.fn(),
    } as never)
    ctx.provide('enterpriseRequestContext' as never, requestContext as never)
    const controller = new EnterpriseTeamController(ctx)
    const failure = await requestContext.run(principal, () => controller.save({
      teamId: 'legacy-a', leaderEmployeeReleaseId: 'release-a', members: [], workflowTemplate: {}, approvalPolicy: {},
      expectedRevision: 0, idempotencyKey: 'legacy-create-a',
    })).catch(error => error)
    expect(failure).toBeInstanceOf(RemoteError)
    expect(failure).toMatchObject({ code: 'enterprise-invalid-state' })
    expect(saveFixedTeam).not.toHaveBeenCalled()
  })
})
