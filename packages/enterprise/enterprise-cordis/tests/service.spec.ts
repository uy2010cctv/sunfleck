import { describe, expect, it } from 'vitest'
import {
  EnterpriseCordisError,
  EnterpriseCordisService,
  InMemoryEnterpriseCordisRepository,
  type CordisPackageDraft,
  type EnterpriseCordisDirectory,
  type EnterpriseCordisPrincipal,
} from '../src/index.ts'

const member: EnterpriseCordisPrincipal = {
  orgId: 'org-a', userId: 'member-1', roles: ['member'],
}
const manager: EnterpriseCordisPrincipal = {
  orgId: 'org-a', userId: 'manager-1', roles: ['member'],
}
const otherManager: EnterpriseCordisPrincipal = {
  orgId: 'org-a', userId: 'manager-2', roles: ['member'],
}
const admin: EnterpriseCordisPrincipal = {
  orgId: 'org-a', userId: 'admin-1', roles: ['administrator'],
}

const draft: CordisPackageDraft = {
  pluginId: 'orders-1',
  dynamicPackageId: 'pkg-runtime-1',
  name: 'Order validator',
  purpose: 'Validate order fields before submission.',
  hostCode: 'return { apply(ctx) { void ctx } }',
  manifest: {
    apiVersion: 'dsh-plugin/v1',
    runtime: 'isolated-realm',
    provides: ['tool:validate_order'],
    capabilities: ['workspace.read'],
  },
  artifactRef: 'artifact://orders/pkg-runtime-1',
  validationReportRef: 'report://orders/pkg-runtime-1',
}

function directory(): EnterpriseCordisDirectory {
  return {
    workspace: async workspaceId => workspaceId === 'personal-1'
      ? { workspaceId, orgId: 'org-a', kind: 'personal', ownerUserId: 'member-1' }
      : workspaceId === 'department-1'
        ? { workspaceId, orgId: 'org-a', kind: 'department', departmentId: 'dept-a' }
        : undefined,
    userDepartments: async (_orgId, userId) => userId === 'member-1' ? ['dept-a'] : [],
    isDepartmentManager: async (_orgId, departmentId, userId) =>
      departmentId === 'dept-a' && userId === 'manager-1',
  }
}

function service() {
  let next = 0
  return new EnterpriseCordisService(new InMemoryEnterpriseCordisRepository(), {
    directory: directory(),
    now: () => 1_700_000_000_000 + next,
    randomId: prefix => `${prefix}-${++next}`,
  })
}

describe('EnterpriseCordisService', () => {
  it('saves and activates an immutable personal Workspace package for its owner', async () => {
    const cordis = service()
    const saved = await cordis.savePersonal({
      principal: member, workspaceId: 'personal-1', draft, idempotencyKey: 'save-1',
    })
    const repeated = await cordis.savePersonal({
      principal: member, workspaceId: 'personal-1', draft, idempotencyKey: 'save-1',
    })
    const binding = await cordis.activatePersonal({
      principal: member, workspaceId: 'personal-1', pluginId: saved.pluginId,
      packageId: saved.packageId, expectedRevision: 0, idempotencyKey: 'activate-1',
    })

    expect(repeated).toEqual(saved)
    expect(saved).toMatchObject({
      pluginId: 'orders-1', version: 1, scope: { type: 'personal-workspace', workspaceId: 'personal-1', ownerUserId: 'member-1' },
      authoredBy: 'member-1', sourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(binding).toMatchObject({
      scope: { type: 'personal-workspace', workspaceId: 'personal-1', ownerUserId: 'member-1' },
      pluginId: 'orders-1', activePackageId: saved.packageId, generation: 1, revision: 1,
    })
  })

  it('rejects another user activating a personal Workspace package', async () => {
    const cordis = service()
    const saved = await cordis.savePersonal({
      principal: member, workspaceId: 'personal-1', draft, idempotencyKey: 'save-1',
    })
    await expect(cordis.activatePersonal({
      principal: { ...member, userId: 'other-1' }, workspaceId: 'personal-1', pluginId: saved.pluginId,
      packageId: saved.packageId, expectedRevision: 0, idempotencyKey: 'activate-other',
    })).rejects.toMatchObject({ code: 'personal-owner-required' })
  })

  it('lets a department manager derive, approve, and publish its department submission', async () => {
    const cordis = service()
    const submitted = await cordis.submitDepartment({
      principal: member, workspaceId: 'department-1', draft, sourceSessionId: 'session-1',
      idempotencyKey: 'submit-1',
    })
    const derived = await cordis.deriveReview({
      principal: manager, reviewId: submitted.reviewId, expectedRevision: submitted.revision,
      draft: { ...draft, dynamicPackageId: 'pkg-runtime-2', purpose: 'Validate required order fields.' },
      idempotencyKey: 'derive-1',
    })
    const approved = await cordis.reviewDepartment({
      principal: manager, reviewId: submitted.reviewId, packageId: derived.packageId,
      action: 'approve_department', reason: 'Validated in department workflow.',
      expectedRevision: derived.reviewRevision, idempotencyKey: 'approve-1',
    })
    const published = await cordis.publishOrganization({
      principal: manager, reviewId: submitted.reviewId, packageId: derived.packageId,
      expectedRevision: approved.revision, idempotencyKey: 'publish-1',
    })

    expect(derived).toMatchObject({
      version: 2, derivedFromPackageId: submitted.packageId, authoredBy: 'member-1', modifiedBy: 'manager-1',
    })
    expect(approved.status).toBe('approved-department')
    expect(published).toMatchObject({
      status: 'published-organization', publishedBy: 'manager-1',
      organizationBinding: { scope: { type: 'organization', organizationId: 'org-a' }, generation: 1 },
    })
  })

  it('prevents a manager from another department publishing the submission', async () => {
    const cordis = service()
    const submitted = await cordis.submitDepartment({
      principal: member, workspaceId: 'department-1', draft, sourceSessionId: 'session-1',
      idempotencyKey: 'submit-1',
    })
    await expect(cordis.publishOrganization({
      principal: otherManager, reviewId: submitted.reviewId, packageId: submitted.packageId,
      expectedRevision: submitted.revision, idempotencyKey: 'publish-other',
    })).rejects.toMatchObject({ code: 'department-manager-required' })
  })

  it('blocks user packages from providing protected enterprise contracts', async () => {
    const cordis = service()
    const protectedDraft: CordisPackageDraft = {
      ...draft,
      manifest: { ...draft.manifest, provides: ['identity.provider'] },
    }
    await expect(cordis.savePersonal({
      principal: member, workspaceId: 'personal-1', draft: protectedDraft, idempotencyKey: 'protected-1',
    })).rejects.toBeInstanceOf(EnterpriseCordisError)
    await expect(cordis.savePersonal({
      principal: member, workspaceId: 'personal-1', draft: protectedDraft, idempotencyKey: 'protected-2',
    })).rejects.toMatchObject({ code: 'protected-contract' })
  })

  it('allows an administrator to emergency-disable an organization binding', async () => {
    const cordis = service()
    const submitted = await cordis.submitDepartment({
      principal: member, workspaceId: 'department-1', draft, sourceSessionId: 'session-1',
      idempotencyKey: 'submit-1',
    })
    const published = await cordis.publishOrganization({
      principal: manager, reviewId: submitted.reviewId, packageId: submitted.packageId,
      expectedRevision: submitted.revision, idempotencyKey: 'publish-1',
    })
    const disabled = await cordis.emergencyDisable({
      principal: admin, bindingId: published.organizationBinding.bindingId,
      expectedRevision: published.organizationBinding.revision, reason: 'Security incident.',
      idempotencyKey: 'disable-1',
    })
    expect(disabled).toMatchObject({ disabled: true, revision: 2 })
  })

  it('lets an administrator maintain multiple department managers with revision checks', async () => {
    const cordis = service()
    const saved = await cordis.setDepartmentManagers({
      principal: admin, departmentId: 'dept-a', managerUserIds: ['manager-2', 'manager-1', 'manager-1'],
      expectedRevision: 0, idempotencyKey: 'managers-1',
    })
    expect(saved).toEqual({
      orgId: 'org-a', departmentId: 'dept-a', managerUserIds: ['manager-1', 'manager-2'],
      revision: 1, updatedBy: 'admin-1', updatedAt: 1_700_000_000_001,
    })
    await expect(cordis.setDepartmentManagers({
      principal: member, departmentId: 'dept-a', managerUserIds: ['member-1'],
      expectedRevision: 1, idempotencyKey: 'managers-member',
    })).rejects.toMatchObject({ code: 'administrator-required' })
  })

  it('projects only the caller-visible Workspace extensions and reviews', async () => {
    const cordis = service()
    const personal = await cordis.savePersonal({
      principal: member, workspaceId: 'personal-1', draft, idempotencyKey: 'personal-list',
    })
    await cordis.activatePersonal({
      principal: member, workspaceId: 'personal-1', pluginId: personal.pluginId,
      packageId: personal.packageId, expectedRevision: 0, idempotencyKey: 'personal-active-list',
    })
    const review = await cordis.submitDepartment({
      principal: member, workspaceId: 'department-1', draft: { ...draft, pluginId: 'dept-plugin' },
      sourceSessionId: 'session-2', idempotencyKey: 'review-list',
    })

    const personalView = await cordis.listWorkspace({ principal: member, workspaceId: 'personal-1' })
    const memberReviews = await cordis.listReviews({ principal: member })
    const managerReviews = await cordis.listReviews({ principal: manager })
    const outsiderReviews = await cordis.listReviews({ principal: { ...member, userId: 'outsider' } })

    expect(personalView.packages.map(row => row.packageId)).toContain(personal.packageId)
    expect(personalView.bindings).toEqual([expect.objectContaining({ activePackageId: personal.packageId })])
    expect(memberReviews.map(row => row.reviewId)).toContain(review.reviewId)
    expect(managerReviews.map(row => row.reviewId)).toContain(review.reviewId)
    expect(outsiderReviews).toEqual([])
  })
})
