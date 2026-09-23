import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  InMemoryEnterpriseCordisRepository,
  EnterpriseCordisService,
  type CordisPackageDraft,
} from '@deepseek-ai/dsh-enterprise-cordis'
import type { EnterpriseCordisWorkspaceView } from '@deepseek-ai/dsh-enterprise-cordis'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import {
  CordisGovernanceController,
  CordisReviewController,
  CordisWorkspaceController,
} from '../src/index.ts'

const draft: CordisPackageDraft = {
  pluginId: 'orders-1', dynamicPackageId: 'runtime-package-1', name: 'Orders',
  purpose: 'Validate orders.', hostCode: 'return { apply(ctx) { void ctx } }',
  manifest: {
    apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm',
    provides: ['tool:validate_order'], capabilities: ['workspace.read'],
    license: 'LicenseRef-Proprietary', dependencies: [],
  },
  artifactRef: 'artifact://orders/1', validationReportRef: 'report://orders/1',
}

async function setup() {
  const ctx = new Context()
  const cordis = new InMemoryEnterpriseCordisRepository()
  const identity = {
    workspaceGrant: async (id: string): Promise<EnterpriseCordisWorkspaceView | undefined> => id === 'personal-1'
      ? { workspaceId: id, orgId: 'org-a', kind: 'personal', ownerUserId: 'member-1' }
      : id === 'department-1'
        ? { workspaceId: id, orgId: 'org-a', kind: 'department', departmentId: 'dept-a' }
        : undefined,
    listUsers: async () => [
      { id: 'member-1', departmentIds: ['dept-a'] },
      { id: 'member-2', departmentIds: ['dept-a'] },
      { id: 'manager-1', departmentIds: ['dept-a'] },
    ],
  }
  const authorizeApiAsync = vi.fn(async () => ({ allowed: true, reason: 'role' }))
  const auditApiAsync = vi.fn(async () => undefined)
  const requestContext = new EnterpriseRequestContext()
  const service = new EnterpriseCordisService(cordis, {
    directory: {
      workspace: identity.workspaceGrant,
      userDepartments: async (_orgId, userId) =>
        (await identity.listUsers()).find(user => user.id === userId)?.departmentIds ?? [],
      isDepartmentManager: async (orgId, departmentId, userId) =>
        (await cordis.departmentManagers(orgId, departmentId))?.managerUserIds.includes(userId) ?? false,
    },
  })
  ctx.provide('enterprisePostgres' as never, { cordis, identity } as never)
  ctx.provide('enterpriseCordis' as never, service as never)
  ctx.provide('enterpriseSecurity' as never, { authorizeApiAsync, auditApiAsync } as never)
  ctx.provide('enterpriseRequestContext' as never, requestContext as never)
  return {
    workspace: new CordisWorkspaceController(ctx),
    review: new CordisReviewController(ctx),
    governance: new CordisGovernanceController(ctx),
    requestContext,
    authorizeApiAsync,
    auditApiAsync,
  }
}

const member = { orgId: 'org-a', userId: 'member-1', roles: ['member'] as const }
const colleague = { orgId: 'org-a', userId: 'member-2', roles: ['member'] as const }
const manager = { orgId: 'org-a', userId: 'manager-1', roles: ['member'] as const }
const admin = { orgId: 'org-a', userId: 'admin-1', roles: ['administrator'] as const }

describe('enterprise Cordis Remote controllers', () => {
  it('keeps My extensions private between authenticated members and restores archived versions', async () => {
    const app = await setup()
    const saved = await app.requestContext.run(member, () => app.workspace.save({
      workspaceId: 'department-1', draft, idempotencyKey: 'private-save',
    }))
    expect((await app.requestContext.run(colleague, () => app.workspace.list({ workspaceId: 'department-1' }))).packages)
      .toEqual([])
    await expect(app.requestContext.run(colleague, () => app.workspace.archive({
      workspaceId: 'department-1', pluginId: saved.pluginId, idempotencyKey: 'other-delete',
    }))).rejects.toMatchObject({ code: 'enterprise-not-found' })
    await app.requestContext.run(member, () => app.workspace.archive({
      workspaceId: 'department-1', pluginId: saved.pluginId, idempotencyKey: 'own-delete',
    }))
    const archived = await app.requestContext.run(member, () => app.workspace.list({ workspaceId: 'department-1' }))
    expect(archived.packages).toEqual([])
    expect(archived.archivedPackages.map(pkg => pkg.packageId)).toContain(saved.packageId)
    await app.requestContext.run(member, () => app.workspace.restore({
      workspaceId: 'department-1', pluginId: saved.pluginId, idempotencyKey: 'own-restore',
    }))
    expect((await app.requestContext.run(member, () => app.workspace.list({ workspaceId: 'department-1' }))).packages
      .map(pkg => pkg.packageId)).toContain(saved.packageId)
  })
  it('saves, activates, and lists personal Workspace extensions through the authenticated principal', async () => {
    const app = await setup()
    const saved = await app.requestContext.run(member, () => app.workspace.save({
      workspaceId: 'personal-1', draft, idempotencyKey: 'save-1',
    }))
    await app.requestContext.run(member, () => app.workspace.activate({
      workspaceId: 'personal-1', pluginId: saved.pluginId, packageId: saved.packageId,
      expectedRevision: 0, idempotencyKey: 'activate-1',
    }))
    const view = await app.requestContext.run(member, () => app.workspace.list({ workspaceId: 'personal-1' }))

    expect(view.packages).toEqual([expect.objectContaining({ packageId: saved.packageId })])
    expect(view.bindings).toEqual([expect.objectContaining({ activePackageId: saved.packageId })])
    expect(app.authorizeApiAsync).toHaveBeenCalled()
    expect(app.auditApiAsync).toHaveBeenCalled()
  })

  it('supports manager assignment, department review, and direct organization publication', async () => {
    const app = await setup()
    await app.requestContext.run(admin, () => app.governance.setDepartmentManagers({
      departmentId: 'dept-a', managerUserIds: ['manager-1'], expectedRevision: 0,
      idempotencyKey: 'managers-1',
    }))
    const submitted = await app.requestContext.run(member, () => app.review.submit({
      workspaceId: 'department-1', sourceSessionId: 'session-1', draft,
      idempotencyKey: 'submit-1',
    }))
    const published = await app.requestContext.run(manager, () => app.review.publishOrganization({
      reviewId: submitted.reviewId, pluginId: submitted.pluginId, packageId: submitted.packageId,
      expectedRevision: submitted.revision, idempotencyKey: 'publish-1',
    }))

    expect(published.status).toBe('published-organization')
    expect(published.organizationBinding.scope).toEqual({ type: 'organization', organizationId: 'org-a' })
  })

  it('exposes Session generation, stop, rollback, and administrator trust controls', async () => {
    const app = await setup()
    const saved = await app.requestContext.run(member, () => app.workspace.save({
      workspaceId: 'personal-1', draft, idempotencyKey: 'lifecycle-save',
    }))
    const active = await app.requestContext.run(member, () => app.workspace.activate({
      workspaceId: 'personal-1', pluginId: saved.pluginId, packageId: saved.packageId,
      expectedRevision: 0, idempotencyKey: 'lifecycle-active',
    }))
    const generation = await app.requestContext.run(member, () => app.workspace.pinGeneration({
      workspaceId: 'personal-1', sessionId: 'session-1',
    }))
    const stopped = await app.requestContext.run(member, () => app.workspace.stop({
      bindingId: active.bindingId, pluginId: active.pluginId, expectedRevision: active.revision,
      reason: 'Pause.', idempotencyKey: 'lifecycle-stop',
    }))
    const restored = await app.requestContext.run(member, () => app.workspace.rollback({
      bindingId: stopped.bindingId, pluginId: stopped.pluginId, packageId: saved.packageId,
      expectedRevision: stopped.revision, reason: 'Restore.', idempotencyKey: 'lifecycle-rollback',
    }))

    expect(generation.entries).toEqual([expect.objectContaining({ packageId: saved.packageId })])
    expect(stopped.disabled).toBe(true)
    expect(restored).toMatchObject({ disabled: false, activePackageId: saved.packageId })
  })
})
