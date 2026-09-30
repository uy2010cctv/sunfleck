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
    license: 'LicenseRef-Proprietary',
    dependencies: [],
  },
  artifactRef: 'artifact://orders/pkg-runtime-1',
  validationReportRef: 'report://orders/pkg-runtime-1',
}

function directory(): EnterpriseCordisDirectory {
  return {
    workspace: async workspaceId => workspaceId === 'personal-1'
      ? { workspaceId, orgId: 'org-a', kind: 'personal', ownerUserId: 'member-1' }
      : workspaceId === 'personal-2'
        ? { workspaceId, orgId: 'org-a', kind: 'personal', ownerUserId: 'outsider-1' }
        : workspaceId === 'department-1'
          ? { workspaceId, orgId: 'org-a', kind: 'department', departmentId: 'dept-a' }
          : undefined,
    userDepartments: async (_orgId, userId) =>
      ['member-1', 'manager-1', 'manager-2'].includes(userId) ? ['dept-a'] : [],
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
  it('archives a private plugin for its owner and restores its immutable versions', async () => {
    const cordis = service()
    const saved = await cordis.savePersonal({
      principal: member, workspaceId: 'department-1', draft, idempotencyKey: 'save-archive',
    })
    const binding = await cordis.activatePersonal({
      principal: member, workspaceId: 'department-1', pluginId: saved.pluginId,
      packageId: saved.packageId, expectedRevision: 0, idempotencyKey: 'activate-archive',
    })

    await cordis.archivePersonal({
      principal: member, workspaceId: 'department-1', pluginId: saved.pluginId,
      idempotencyKey: 'archive-1',
    })
    const archived = await cordis.listWorkspace({ principal: member, workspaceId: 'department-1' })
    expect(archived.packages.map(pkg => pkg.packageId)).not.toContain(saved.packageId)
    expect(archived.bindings.map(row => row.bindingId)).not.toContain(binding.bindingId)
    expect(archived.archivedPackages.map(pkg => pkg.packageId)).toContain(saved.packageId)
    expect((await cordis.pinSessionGeneration({
      principal: member, workspaceId: 'department-1', sessionId: 'session-after-archive',
    })).entries).toEqual([])
    await expect(cordis.activatePersonal({
      principal: member, workspaceId: 'department-1', pluginId: saved.pluginId,
      packageId: saved.packageId, expectedRevision: binding.revision, idempotencyKey: 'archived-activate',
    })).rejects.toMatchObject({ code: 'plugin-archived' })

    await cordis.restorePersonal({
      principal: member, workspaceId: 'department-1', pluginId: saved.pluginId,
      idempotencyKey: 'restore-1',
    })
    const restored = await cordis.listWorkspace({ principal: member, workspaceId: 'department-1' })
    expect(restored.packages.map(pkg => pkg.packageId)).toContain(saved.packageId)
    expect(restored.archivedPackages).toEqual([])
    expect(restored.bindings).toEqual([expect.objectContaining({ bindingId: binding.bindingId, disabled: true })])
  })

  it('does not expose or allow deleting another member private plugin in a shared Workspace', async () => {
    const cordis = service()
    const saved = await cordis.savePersonal({
      principal: member, workspaceId: 'department-1', draft, idempotencyKey: 'save-private',
    })
    const colleague = await cordis.listWorkspace({ principal: otherManager, workspaceId: 'department-1' })
    expect(colleague.packages.map(pkg => pkg.packageId)).not.toContain(saved.packageId)
    expect(colleague.archivedPackages).toEqual([])
    await expect(cordis.archivePersonal({
      principal: otherManager, workspaceId: 'department-1', pluginId: saved.pluginId,
      idempotencyKey: 'delete-other',
    })).rejects.toMatchObject({ code: 'package-not-found' })
    await cordis.archivePersonal({
      principal: member, workspaceId: 'department-1', pluginId: saved.pluginId,
      idempotencyKey: 'delete-own',
    })
    expect((await cordis.listWorkspace({ principal: otherManager, workspaceId: 'department-1' })).archivedPackages)
      .toEqual([])
  })

  it('keeps restoration inactive if an activation races the archive', async () => {
    const repository = new InMemoryEnterpriseCordisRepository()
    const cordis = new EnterpriseCordisService(repository, { directory: directory() })
    const saved = await cordis.savePersonal({
      principal: member, workspaceId: 'personal-1', draft, idempotencyKey: 'race-save',
    })
    const active = await cordis.activatePersonal({
      principal: member, workspaceId: 'personal-1', pluginId: saved.pluginId,
      packageId: saved.packageId, expectedRevision: 0, idempotencyKey: 'race-activate',
    })
    await cordis.archivePersonal({
      principal: member, workspaceId: 'personal-1', pluginId: saved.pluginId, idempotencyKey: 'race-archive',
    })
    const stopped = await repository.binding(active.bindingId)
    if (stopped === undefined) throw new Error('binding missing')
    await repository.putBinding({ ...stopped, disabled: false, revision: stopped.revision + 1 }, stopped.revision)

    await cordis.restorePersonal({
      principal: member, workspaceId: 'personal-1', pluginId: saved.pluginId, idempotencyKey: 'race-restore',
    })

    expect((await repository.binding(active.bindingId))?.disabled).toBe(true)
  })

  it('keeps a member-created package private inside a department Workspace', async () => {
    const cordis = service()
    const saved = await cordis.savePersonal({
      principal: member, workspaceId: 'department-1', draft, idempotencyKey: 'department-private',
    })
    const own = await cordis.listWorkspace({ principal: member, workspaceId: 'department-1' })
    const colleague = await cordis.listWorkspace({ principal: manager, workspaceId: 'department-1' })
    expect(saved.scope).toEqual({ type: 'personal-workspace', workspaceId: 'department-1', ownerUserId: 'member-1' })
    expect(own.packages.map(row => row.packageId)).toContain(saved.packageId)
    expect(colleague.packages.map(row => row.packageId)).not.toContain(saved.packageId)
    expect(own.packages.find(row => row.packageId === saved.packageId)?.canSubmitDepartment).toBe(true)
  })

  it('submits an existing owner-private department Workspace version without publishing it', async () => {
    const cordis = service()
    const saved = await cordis.savePersonal({ principal: member, workspaceId: 'department-1', draft,
      idempotencyKey: 'saved-for-department' })
    await expect(cordis.submitSavedDepartment({ principal: otherManager, workspaceId: 'department-1',
      packageId: saved.packageId, idempotencyKey: 'other-owner' }))
      .rejects.toMatchObject({ code: 'package-not-found' })
    const review = await cordis.submitSavedDepartment({ principal: member, workspaceId: 'department-1',
      packageId: saved.packageId, idempotencyKey: 'submit-saved' })
    expect(review).toMatchObject({ departmentId: 'dept-a', status: 'pending', submittedBy: 'member-1' })
    expect((await cordis.listWorkspace({ principal: member, workspaceId: 'department-1' })).packages)
      .toContainEqual(expect.objectContaining({ packageId: review.packageId,
        scope: { type: 'department', departmentId: 'dept-a' } }))
    expect((await cordis.listWorkspace({ principal: otherManager, workspaceId: 'department-1' })).packages)
      .not.toContainEqual(expect.objectContaining({ packageId: review.packageId }))
    await cordis.archivePersonal({ principal: member, workspaceId: 'department-1',
      pluginId: saved.pluginId, idempotencyKey: 'archive-before-resubmit' })
    await expect(cordis.submitSavedDepartment({ principal: member, workspaceId: 'department-1',
      packageId: saved.packageId, idempotencyKey: 'resubmit-archived' }))
      .rejects.toMatchObject({ code: 'plugin-archived' })
  })

  it('does not return a pinned private generation to another member of the shared Workspace', async () => {
    const cordis = service()
    const saved = await cordis.savePersonal({ principal: member, workspaceId: 'department-1', draft,
      idempotencyKey: 'private-generation' })
    await cordis.activatePersonal({ principal: member, workspaceId: 'department-1',
      pluginId: saved.pluginId, packageId: saved.packageId, expectedRevision: 0,
      idempotencyKey: 'activate-private-generation' })
    await cordis.pinSessionGeneration({ principal: member, workspaceId: 'department-1', sessionId: 'session-shared' })
    await expect(cordis.pinSessionGeneration({ principal: otherManager, workspaceId: 'department-1',
      sessionId: 'session-shared' })).rejects.toMatchObject({ code: 'personal-owner-required' })
  })

  it('refuses to activate or roll back a package from another private scope', async () => {
    const cordis = service()
    const personal = await cordis.savePersonal({ principal: member, workspaceId: 'personal-1', draft, idempotencyKey: 'private-personal' })
    await expect(cordis.activatePersonal({
      principal: member, workspaceId: 'department-1', pluginId: personal.pluginId,
      packageId: personal.packageId, expectedRevision: 0, idempotencyKey: 'cross-scope',
    })).rejects.toMatchObject({ code: 'package-not-found' })
    const department = await cordis.savePersonal({ principal: member, workspaceId: 'department-1', draft, idempotencyKey: 'private-department' })
    const binding = await cordis.activatePersonal({
      principal: member, workspaceId: 'department-1', pluginId: department.pluginId,
      packageId: department.packageId, expectedRevision: 0, idempotencyKey: 'activate-department',
    })
    await expect(cordis.rollbackBinding({
      principal: member, bindingId: binding.bindingId, packageId: personal.packageId,
      expectedRevision: binding.revision, reason: 'restore', idempotencyKey: 'rollback-cross-scope',
    })).rejects.toMatchObject({ code: 'package-not-found' })
  })

  it('accepts an equivalent private scope after JSONB reorders its fields', async () => {
    class ReorderedRepository extends InMemoryEnterpriseCordisRepository {
      override async package(packageId: string) {
        const saved = await super.package(packageId)
        return saved?.scope.type === 'personal-workspace' ? {
          ...saved, scope: {
            ownerUserId: saved.scope.ownerUserId, workspaceId: saved.scope.workspaceId,
            type: 'personal-workspace' as const,
          },
        } : saved
      }
    }
    const repository = new ReorderedRepository()
    const cordis = new EnterpriseCordisService(repository, { directory: directory() })
    const saved = await cordis.savePersonal({
      principal: member, workspaceId: 'personal-1', draft, idempotencyKey: 'jsonb-scope',
    })
    await expect(cordis.activatePersonal({
      principal: member, workspaceId: 'personal-1', pluginId: saved.pluginId,
      packageId: saved.packageId, expectedRevision: 0, idempotencyKey: 'jsonb-activate',
    })).resolves.toMatchObject({ activePackageId: saved.packageId })
  })

  it('does not expose a pending department submission to other members', async () => {
    const cordis = service()
    const review = await cordis.submitDepartment({
      principal: member, workspaceId: 'department-1', draft, sourceSessionId: 'session-1',
      idempotencyKey: 'pending-private',
    })
    expect((await cordis.listWorkspace({ principal: member, workspaceId: 'department-1' })).packages
      .map(pkg => pkg.packageId)).toContain(review.packageId)
    expect((await cordis.listWorkspace({ principal: otherManager, workspaceId: 'department-1' })).packages
      .map(pkg => pkg.packageId)).not.toContain(review.packageId)
    expect((await cordis.listWorkspace({ principal: manager, workspaceId: 'department-1' })).packages
      .map(pkg => pkg.packageId)).toContain(review.packageId)
  })

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
      authoredBy: 'member-1',
    })
    expect(saved.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
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
    expect((await cordis.listWorkspace({ principal: member, workspaceId: 'department-1' })).bindings)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        scope: { type: 'department', departmentId: 'dept-a' }, activePackageId: derived.packageId,
        canManage: false,
      })]))
    expect((await cordis.listWorkspace({ principal: manager, workspaceId: 'department-1' })).bindings)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        activePackageId: derived.packageId, canManage: true,
      })]))
    expect(published).toMatchObject({
      status: 'published-organization', publishedBy: 'manager-1',
      organizationBinding: { scope: { type: 'organization', organizationId: 'org-a' }, generation: 1 },
    })
    expect((await cordis.listWorkspace({ principal: member, workspaceId: 'personal-1' })).packages
      .map(pkg => pkg.packageId)).toContain(derived.packageId)
    expect((await cordis.listWorkspace({ principal: member, workspaceId: 'personal-1' })).bindings)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        scope: { type: 'organization', organizationId: 'org-a' }, canManage: false,
      })]))
    expect((await cordis.listWorkspace({ principal: admin, workspaceId: 'personal-1' })).bindings)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        scope: { type: 'organization', organizationId: 'org-a' }, canManage: true,
      })]))
    const outsider = { ...member, userId: 'outsider-1' }
    await expect(cordis.listWorkspace({ principal: outsider, workspaceId: 'department-1' }))
      .rejects.toMatchObject({ code: 'department-member-required' })
    expect((await cordis.listWorkspace({ principal: outsider, workspaceId: 'personal-2' })).packages
      .map(pkg => pkg.packageId)).toContain(derived.packageId)
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

  it('does not let governed rollback select a private or pending Package', async () => {
    const cordis = service()
    const personal = await cordis.savePersonal({
      principal: member, workspaceId: 'department-1', draft, idempotencyKey: 'rollback-private',
    })
    const submitted = await cordis.submitDepartment({
      principal: member, workspaceId: 'department-1', draft, sourceSessionId: 'session-1',
      idempotencyKey: 'rollback-submit',
    })
    const approved = await cordis.reviewDepartment({
      principal: manager, reviewId: submitted.reviewId, packageId: submitted.packageId,
      action: 'approve_department', reason: 'Reviewed.', expectedRevision: submitted.revision,
      idempotencyKey: 'rollback-approve',
    })
    const departmentBinding = (await cordis.listWorkspace({ principal: manager, workspaceId: 'department-1' }))
      .bindings.find(binding => binding.scope.type === 'department')
    if (departmentBinding === undefined) throw new Error('department binding missing')
    const pending = await cordis.submitDepartment({
      principal: member, workspaceId: 'department-1',
      draft: { ...draft, dynamicPackageId: 'pkg-pending' }, sourceSessionId: 'session-2',
      idempotencyKey: 'rollback-pending',
    })
    for (const packageId of [personal.packageId, pending.packageId]) {
      await expect(cordis.rollbackBinding({
        principal: manager, bindingId: departmentBinding.bindingId, packageId,
        expectedRevision: departmentBinding.revision, reason: 'Unreviewed.',
        idempotencyKey: `rollback-invalid-${packageId}`,
      })).rejects.toMatchObject({ code: 'package-not-found' })
    }
    const published = await cordis.publishOrganization({
      principal: manager, reviewId: submitted.reviewId, packageId: submitted.packageId,
      expectedRevision: approved.revision, idempotencyKey: 'rollback-publish',
    })
    await expect(cordis.rollbackBinding({
      principal: admin, bindingId: published.organizationBinding.bindingId, packageId: personal.packageId,
      expectedRevision: published.organizationBinding.revision, reason: 'Private target.',
      idempotencyKey: 'rollback-private-organization',
    })).rejects.toMatchObject({ code: 'package-not-found' })
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

  it('persists automatic gate evidence and rejects forbidden Host APIs', async () => {
    const repository = new InMemoryEnterpriseCordisRepository()
    const events: string[] = []
    let next = 0
    const cordis = new EnterpriseCordisService(repository, {
      directory: directory(), now: () => 1_700_000_000_000 + next,
      randomId: prefix => `${prefix}-${++next}`,
      emit: (name) => { events.push(name) },
    })
    const saved = await cordis.savePersonal({
      principal: member, workspaceId: 'personal-1', draft, idempotencyKey: 'gated-save',
    })
    const report = await repository.validationReport(saved.validationReportRef)
    expect(report).toMatchObject({ packageId: saved.packageId, status: 'passed' })
    expect(report?.checks).toContainEqual({
      id: 'isolation', status: 'passed', message: 'User package uses an isolated runtime.',
    })
    expect(await repository.package(saved.packageId)).not.toHaveProperty('hostCode')
    const artifact = await repository.artifact(saved.artifactRef)
    expect(artifact).toMatchObject({ artifactRef: saved.artifactRef, orgId: 'org-a' })
    expect(artifact?.digest).toMatch(/^[a-f0-9]{64}$/)
    expect((await cordis.listWorkspace({ principal: member, workspaceId: 'personal-1' })).packages)
      .toEqual([expect.objectContaining({ packageId: saved.packageId, hostCode: draft.hostCode })])
    expect(events).toEqual(['enterprise/cordis-package-saved'])

    await expect(cordis.savePersonal({
      principal: member, workspaceId: 'personal-1',
      draft: { ...draft, dynamicPackageId: 'unsafe-runtime', hostCode: 'return process.env.API_KEY' },
      idempotencyKey: 'gated-unsafe',
    })).rejects.toMatchObject({ code: 'validation-failed' })
    await expect(cordis.savePersonal({
      principal: member, workspaceId: 'personal-1',
      draft: {
        ...draft, dynamicPackageId: 'unsafe-dependency',
        manifest: { ...draft.manifest, dependencies: [{
          name: 'left-pad', version: '^1.3.0', integrity: '', license: 'MIT',
        }] },
      },
      idempotencyKey: 'gated-dependency',
    })).rejects.toMatchObject({ code: 'validation-failed' })
    await expect(cordis.savePersonal({
      principal: member, workspaceId: 'personal-1',
      draft: {
        ...draft, dynamicPackageId: 'unsafe-license',
        manifest: { ...draft.manifest, license: 'AGPL-3.0-only' },
      },
      idempotencyKey: 'gated-license',
    })).rejects.toMatchObject({ code: 'validation-failed' })
    await expect(cordis.savePersonal({
      principal: member, workspaceId: 'personal-1',
      draft: { ...draft, dynamicPackageId: 'unsafe-eval', hostCode: 'return eval("({ apply() {} })")' },
      idempotencyKey: 'gated-malware',
    })).rejects.toMatchObject({ code: 'validation-failed' })
  })

  it('allows an administrator to emergency-disable an organization binding', async () => {
    const cordis = service()
    const submitted = await cordis.submitDepartment({
      principal: member, workspaceId: 'department-1', draft, sourceSessionId: 'session-1',
      idempotencyKey: 'submit-1',
    })
    const approved = await cordis.reviewDepartment({
      principal: manager, reviewId: submitted.reviewId, packageId: submitted.packageId,
      action: 'approve_department', reason: 'Validated.', expectedRevision: submitted.revision,
      idempotencyKey: 'disable-approve',
    })
    const published = await cordis.publishOrganization({
      principal: manager, reviewId: approved.reviewId, packageId: approved.packageId,
      expectedRevision: approved.revision, idempotencyKey: 'publish-1',
    })
    const disabled = await cordis.emergencyDisable({
      principal: admin, bindingId: published.organizationBinding.bindingId,
      expectedRevision: published.organizationBinding.revision, reason: 'Security incident.',
      idempotencyKey: 'disable-1',
    })
    expect(disabled).toMatchObject({ disabled: true, revision: 2 })
  })

  it('stops and rolls back a personal extension without deleting immutable versions', async () => {
    const cordis = service()
    const first = await cordis.savePersonal({
      principal: member, workspaceId: 'personal-1', draft, idempotencyKey: 'save-first',
    })
    const firstBinding = await cordis.activatePersonal({
      principal: member, workspaceId: 'personal-1', pluginId: first.pluginId,
      packageId: first.packageId, expectedRevision: 0, idempotencyKey: 'activate-first',
    })
    const second = await cordis.savePersonal({
      principal: member, workspaceId: 'personal-1',
      draft: { ...draft, dynamicPackageId: 'pkg-runtime-2', purpose: 'Validate order totals.' },
      idempotencyKey: 'save-second',
    })
    const secondBinding = await cordis.activatePersonal({
      principal: member, workspaceId: 'personal-1', pluginId: second.pluginId,
      packageId: second.packageId, expectedRevision: firstBinding.revision, idempotencyKey: 'activate-second',
    })
    const stopped = await cordis.stopBinding({
      principal: member, bindingId: secondBinding.bindingId, expectedRevision: secondBinding.revision,
      reason: 'Paused by owner.', idempotencyKey: 'stop-personal',
    })
    const rolledBack = await cordis.rollbackBinding({
      principal: member, bindingId: stopped.bindingId, packageId: first.packageId,
      expectedRevision: stopped.revision, reason: 'Restore known-good version.', idempotencyKey: 'rollback-personal',
    })

    expect(stopped).toMatchObject({ disabled: true, revision: 3 })
    expect(rolledBack).toMatchObject({
      activePackageId: first.packageId, disabled: false, generation: 3, revision: 4,
    })
    expect((await cordis.listWorkspace({ principal: member, workspaceId: 'personal-1' })).packages)
      .toHaveLength(2)
  })

  it('pins one immutable plugin generation per Session', async () => {
    const cordis = service()
    const first = await cordis.savePersonal({
      principal: member, workspaceId: 'personal-1', draft, idempotencyKey: 'pin-save-first',
    })
    const firstBinding = await cordis.activatePersonal({
      principal: member, workspaceId: 'personal-1', pluginId: first.pluginId,
      packageId: first.packageId, expectedRevision: 0, idempotencyKey: 'pin-activate-first',
    })
    const pinned = await cordis.pinSessionGeneration({
      principal: member, workspaceId: 'personal-1', sessionId: 'session-a',
    })
    const second = await cordis.savePersonal({
      principal: member, workspaceId: 'personal-1',
      draft: { ...draft, dynamicPackageId: 'pkg-runtime-2', purpose: 'Version two.' },
      idempotencyKey: 'pin-save-second',
    })
    await cordis.activatePersonal({
      principal: member, workspaceId: 'personal-1', pluginId: second.pluginId,
      packageId: second.packageId, expectedRevision: firstBinding.revision, idempotencyKey: 'pin-activate-second',
    })
    const repeated = await cordis.pinSessionGeneration({
      principal: member, workspaceId: 'personal-1', sessionId: 'session-a',
    })
    const nextSession = await cordis.pinSessionGeneration({
      principal: member, workspaceId: 'personal-1', sessionId: 'session-b',
    })

    expect(repeated).toEqual(pinned)
    expect(pinned.entries).toEqual([expect.objectContaining({ packageId: first.packageId, generation: 1 })])
    expect(nextSession.entries).toEqual([expect.objectContaining({ packageId: second.packageId, generation: 2 })])
  })

  it('pins one effective binding when private and department versions share a plugin identity', async () => {
    const cordis = service()
    const saved = await cordis.savePersonal({
      principal: member, workspaceId: 'department-1', draft, idempotencyKey: 'overlap-private',
    })
    const privateBinding = await cordis.activatePersonal({
      principal: member, workspaceId: 'department-1', pluginId: saved.pluginId,
      packageId: saved.packageId, expectedRevision: 0, idempotencyKey: 'overlap-activate',
    })
    const review = await cordis.submitSavedDepartment({
      principal: member, workspaceId: 'department-1', packageId: saved.packageId,
      idempotencyKey: 'overlap-submit',
    })
    const approved = await cordis.reviewDepartment({
      principal: manager, reviewId: review.reviewId, packageId: review.packageId,
      action: 'approve_department', reason: 'Shared after review.',
      expectedRevision: review.revision, idempotencyKey: 'overlap-review',
    })
    expect(approved.status).toBe('approved-department')

    const pinned = await cordis.pinSessionGeneration({
      principal: member, workspaceId: 'department-1', sessionId: 'overlap-session',
    })
    expect(pinned.entries).toEqual([expect.objectContaining({
      pluginId: saved.pluginId, packageId: privateBinding.activePackageId,
      scope: { type: 'personal-workspace', workspaceId: 'department-1', ownerUserId: 'member-1' },
    })])
  })

  it('returns the same department review when one saved version is submitted again', async () => {
    const cordis = service()
    const saved = await cordis.savePersonal({
      principal: member, workspaceId: 'department-1', draft, idempotencyKey: 'repeat-save',
    })
    const first = await cordis.submitSavedDepartment({
      principal: member, workspaceId: 'department-1', packageId: saved.packageId,
      idempotencyKey: 'repeat-submit-first',
    })
    const repeated = await cordis.submitSavedDepartment({
      principal: member, workspaceId: 'department-1', packageId: saved.packageId,
      idempotencyKey: 'repeat-submit-second',
    })

    expect(repeated.reviewId).toBe(first.reviewId)
    expect(await cordis.listReviews({ principal: member })).toHaveLength(1)
    expect((await cordis.listWorkspace({ principal: member, workspaceId: 'department-1' })).packages)
      .toHaveLength(2)
  })

  it('does not advance binding revisions for an already selected state', async () => {
    const cordis = service()
    const saved = await cordis.savePersonal({
      principal: member, workspaceId: 'personal-1', draft, idempotencyKey: 'state-save',
    })
    const active = await cordis.activatePersonal({
      principal: member, workspaceId: 'personal-1', pluginId: saved.pluginId,
      packageId: saved.packageId, expectedRevision: 0, idempotencyKey: 'state-active',
    })
    const activeAgain = await cordis.activatePersonal({
      principal: member, workspaceId: 'personal-1', pluginId: saved.pluginId,
      packageId: saved.packageId, expectedRevision: active.revision, idempotencyKey: 'state-active-again',
    })
    const stopped = await cordis.stopBinding({
      principal: member, bindingId: active.bindingId, expectedRevision: activeAgain.revision,
      reason: 'Paused.', idempotencyKey: 'state-stop',
    })
    const stoppedAgain = await cordis.stopBinding({
      principal: member, bindingId: active.bindingId, expectedRevision: stopped.revision,
      reason: 'Paused again.', idempotencyKey: 'state-stop-again',
    })
    const resumed = await cordis.rollbackBinding({
      principal: member, bindingId: active.bindingId, packageId: saved.packageId,
      expectedRevision: stoppedAgain.revision, reason: 'Resume.', idempotencyKey: 'state-resume',
    })
    const resumedAgain = await cordis.rollbackBinding({
      principal: member, bindingId: active.bindingId, packageId: saved.packageId,
      expectedRevision: resumed.revision, reason: 'Resume again.', idempotencyKey: 'state-resume-again',
    })

    expect([active.revision, activeAgain.revision, stopped.revision,
      stoppedAgain.revision, resumed.revision, resumedAgain.revision]).toEqual([1, 1, 2, 2, 3, 3])
  })

  it('publishes only an approved review once', async () => {
    const cordis = service()
    const submitted = await cordis.submitDepartment({
      principal: member, workspaceId: 'department-1', draft,
      sourceSessionId: 'source-session', idempotencyKey: 'publish-state-submit',
    })
    await expect(cordis.publishOrganization({
      principal: manager, reviewId: submitted.reviewId, packageId: submitted.packageId,
      expectedRevision: submitted.revision, idempotencyKey: 'publish-while-pending',
    })).rejects.toMatchObject({ code: 'review-state-invalid' })
    const approved = await cordis.reviewDepartment({
      principal: manager, reviewId: submitted.reviewId, packageId: submitted.packageId,
      action: 'approve_department', reason: 'Reviewed.', expectedRevision: submitted.revision,
      idempotencyKey: 'publish-state-approve',
    })
    const published = await cordis.publishOrganization({
      principal: manager, reviewId: approved.reviewId, packageId: approved.packageId,
      expectedRevision: approved.revision, idempotencyKey: 'publish-state-first',
    })
    await expect(cordis.publishOrganization({
      principal: manager, reviewId: published.reviewId, packageId: published.packageId,
      expectedRevision: published.revision, idempotencyKey: 'publish-state-repeat',
    })).rejects.toMatchObject({ code: 'review-state-invalid' })
  })

  it('only lets an administrator promote an organization binding trust level', async () => {
    const cordis = service()
    const submitted = await cordis.submitDepartment({
      principal: member, workspaceId: 'department-1', draft, sourceSessionId: 'session-1',
      idempotencyKey: 'trust-submit',
    })
    const approved = await cordis.reviewDepartment({
      principal: manager, reviewId: submitted.reviewId, packageId: submitted.packageId,
      action: 'approve_department', reason: 'Validated.', expectedRevision: submitted.revision,
      idempotencyKey: 'trust-approve',
    })
    const published = await cordis.publishOrganization({
      principal: manager, reviewId: approved.reviewId, packageId: approved.packageId,
      expectedRevision: approved.revision, idempotencyKey: 'trust-publish',
    })
    await expect(cordis.setTrust({
      principal: manager, bindingId: published.organizationBinding.bindingId, trustLevel: 'trusted-in-process',
      expectedRevision: published.organizationBinding.revision, reason: 'No.', idempotencyKey: 'trust-manager',
    })).rejects.toMatchObject({ code: 'administrator-required' })
    const trusted = await cordis.setTrust({
      principal: admin, bindingId: published.organizationBinding.bindingId, trustLevel: 'trusted-in-process',
      expectedRevision: published.organizationBinding.revision, reason: 'Reviewed enterprise package.',
      idempotencyKey: 'trust-admin',
    })
    expect(trusted).toMatchObject({ trustLevel: 'trusted-in-process', revision: 2 })
    const generation = await cordis.pinSessionGeneration({
      principal: member, workspaceId: 'personal-1', sessionId: 'trusted-session',
    })
    expect(generation.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        packageId: submitted.packageId, scope: { type: 'organization', organizationId: 'org-a' },
        trustLevel: 'trusted-in-process',
      }),
    ]))
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
    await expect(cordis.setDepartmentManagers({
      principal: admin, departmentId: 'dept-a', managerUserIds: ['outsider'],
      expectedRevision: 1, idempotencyKey: 'managers-outsider',
    })).rejects.toMatchObject({ code: 'department-member-required' })
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
