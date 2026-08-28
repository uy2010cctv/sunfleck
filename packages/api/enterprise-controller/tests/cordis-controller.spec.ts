import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  InMemoryEnterpriseCordisRepository,
  EnterpriseCordisService,
  type CordisPackageDraft,
} from '@deepseek-ai/dsh-enterprise-cordis'
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
  },
  artifactRef: 'artifact://orders/1', validationReportRef: 'report://orders/1',
}

async function setup() {
  const ctx = new Context()
  const cordis = new InMemoryEnterpriseCordisRepository()
  const identity = {
    workspaceGrant: async (id: string) => id === 'personal-1'
      ? { workspaceId: id, orgId: 'org-a', kind: 'personal', ownerUserId: 'member-1' }
      : id === 'department-1'
        ? { workspaceId: id, orgId: 'org-a', kind: 'department', departmentId: 'dept-a' }
        : undefined,
    listUsers: async () => [
      { id: 'member-1', departmentIds: ['dept-a'] },
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
const manager = { orgId: 'org-a', userId: 'manager-1', roles: ['member'] as const }
const admin = { orgId: 'org-a', userId: 'admin-1', roles: ['administrator'] as const }

describe('enterprise Cordis Remote controllers', () => {
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
})
