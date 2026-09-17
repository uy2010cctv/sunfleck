import { access, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnterpriseIdentityRepository } from '@deepseek-ai/dsh-enterprise-identity'
import {
  EnterpriseWorkspaceProvisioner, backfillSessionWorkspaceBindings,
} from '../src/workspace-provisioner.ts'

describe('EnterpriseWorkspaceProvisioner', () => {
  let root: string
  let repository: EnterpriseIdentityRepository
  const created: Array<{ path: string; title?: string }> = []

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-workspaces-'))
    repository = new EnterpriseIdentityRepository(join(root, 'identity.sqlite'))
    repository.createOrganization({ id: 'org-a', name: 'Org A' })
    repository.createUser({ id: '../alice', orgId: 'org-a', username: 'alice', displayName: 'Alice', disabled: false })
    created.length = 0
  })

  afterEach(async () => {
    repository.close()
    await rm(root, { recursive: true, force: true })
  })

  it('creates one traversal-safe personal DSH workspace and reuses it', async () => {
    const provisioner = new EnterpriseWorkspaceProvisioner(repository, {
      root: join(root, 'managed'),
      registry: {
        create: async (path, title) => {
          created.push({ path, ...(title === undefined ? {} : { title }) })
          return { id: `workspace-${created.length}`, path, title: title ?? 'workspace' }
        },
      },
    })
    const user = repository.listUsers('org-a')[0]!
    const first = await provisioner.ensurePersonal(user)
    const second = await provisioner.ensurePersonal(user)

    expect(first).toEqual(second)
    expect(created).toHaveLength(1)
    expect(first.rootPath).toMatch(/\/managed\/organizations\/[a-f0-9]{24}\/users\/[a-f0-9]{24}$/u)
    expect(first.rootPath).not.toContain('alice')
    await expect(access(first.rootPath)).resolves.toBeUndefined()
  })

  it('places separate organizations in distinct filesystem compartments', async () => {
    repository.createOrganization({ id: 'org-b', name: 'Org B' })
    repository.createUser({ id: 'org-b-alice', orgId: 'org-b', username: 'alice', displayName: 'Alice', disabled: false })
    const provisioner = new EnterpriseWorkspaceProvisioner(repository, {
      root: join(root, 'managed'),
      registry: {
        create: async (path, title) => ({ id: `workspace-${created.push({ path, title })}`, path, title: title ?? 'workspace' }),
      },
    })

    const first = await provisioner.ensurePersonal(repository.listUsers('org-a')[0]!)
    const second = await provisioner.ensurePersonal(repository.listUsers('org-b')[0]!)

    expect(first.rootPath).not.toBe(second.rootPath)
    expect(first.rootPath.split('/organizations/')[1]?.split('/')[0])
      .not.toBe(second.rootPath.split('/organizations/')[1]?.split('/')[0])
  })

  it('creates a department shared workspace with read-only default sandbox', async () => {
    repository.saveDepartment({ id: 'dept-ops', orgId: 'org-a', name: '运营部', parentId: null, sortOrder: 0, expectedRevision: 0 })
    const provisioner = new EnterpriseWorkspaceProvisioner(repository, {
      root: join(root, 'managed'),
      registry: {
        create: async (path, title) => ({ id: 'workspace-ops', path, title: title ?? 'workspace' }),
      },
    })
    const grant = await provisioner.ensureDepartment(repository.listDepartments('org-a')[0]!)
    expect(grant).toMatchObject({
      workspaceId: 'workspace-ops', kind: 'department', departmentId: 'dept-ops', sandboxMode: 'read-only',
    })
  })

  it('renames an automatically named shared workspace when its department is renamed', async () => {
    repository.saveDepartment({ id: 'dept-ops', orgId: 'org-a', name: '运营部', parentId: null, sortOrder: 0, expectedRevision: 0 })
    const provisioner = new EnterpriseWorkspaceProvisioner(repository, {
      root: join(root, 'managed'),
      registry: {
        create: async (path, title) => ({ id: 'workspace-ops', path, title: title ?? 'workspace' }),
        ensure: async (id, path, title) => ({ id, path, title }),
      },
    })
    await provisioner.ensureDepartment(repository.listDepartments('org-a')[0]!)
    repository.saveDepartment({ id: 'dept-ops', orgId: 'org-a', name: '客户运营部', parentId: null, sortOrder: 0, expectedRevision: 1 })

    const renamed = await provisioner.ensureDepartment(repository.listDepartments('org-a')[0]!, '运营部')

    expect(renamed).toMatchObject({ name: '客户运营部 · 共享工作区', revision: 2 })
  })

  it('preserves an administrator-defined shared workspace name when its department is renamed', async () => {
    repository.saveDepartment({ id: 'dept-ops', orgId: 'org-a', name: '运营部', parentId: null, sortOrder: 0, expectedRevision: 0 })
    const provisioner = new EnterpriseWorkspaceProvisioner(repository, {
      root: join(root, 'managed'),
      registry: {
        create: async (path, title) => ({ id: 'workspace-ops', path, title: title ?? 'workspace' }),
        ensure: async (id, path, title) => ({ id, path, title }),
      },
    })
    const grant = await provisioner.ensureDepartment(repository.listDepartments('org-a')[0]!)
    repository.saveWorkspaceGrant({ ...grant, name: '华东运营协作空间', expectedRevision: grant.revision })
    repository.saveDepartment({ id: 'dept-ops', orgId: 'org-a', name: '客户运营部', parentId: null, sortOrder: 0, expectedRevision: 1 })

    const preserved = await provisioner.ensureDepartment(repository.listDepartments('org-a')[0]!, '运营部')

    expect(preserved).toMatchObject({ name: '华东运营协作空间', revision: 2 })
  })

  it('propagates an administrator-defined grant name to the native DSH Workspace', async () => {
    const renamed: string[] = []
    const provisioner = new EnterpriseWorkspaceProvisioner(repository, {
      root: join(root, 'managed'),
      registry: {
        create: async (path, title) => ({ id: 'workspace-alice', path, title: title ?? 'workspace' }),
        ensure: async (id, path, _title) => ({
          id, path, title: 'Old title', setTitle: async (next: string) => { renamed.push(next) },
        }),
      },
    })
    const grant = await provisioner.ensurePersonal(repository.listUsers('org-a')[0]!)
    const updated = repository.saveWorkspaceGrant({
      ...grant, name: '管理员指定工作区', expectedRevision: grant.revision,
    })

    await provisioner.ensureWorkspace(updated)

    expect(renamed).toEqual(['管理员指定工作区'])
  })

  it('repairs the native Workspace registration when an enterprise grant already exists', async () => {
    const ensured: Array<{ id: string; path: string; title: string }> = []
    const registry = {
      create: async (path: string, title?: string) => ({ id: 'workspace-alice', path, title: title ?? 'workspace' }),
      ensure: async (id: string, path: string, title: string) => {
        ensured.push({ id, path, title })
        return { id, path, title }
      },
    }
    const provisioner = new EnterpriseWorkspaceProvisioner(repository, {
      root: join(root, 'managed'), registry,
    })
    const user = repository.listUsers('org-a')[0]!
    const grant = await provisioner.ensurePersonal(user)

    await provisioner.ensurePersonal(user)

    expect(ensured).toEqual([{ id: grant.workspaceId, path: grant.rootPath, title: grant.name }])
  })

  it('does not guess an owner for legacy department Workspace Sessions', async () => {
    repository.saveDepartment({ id: 'dept-ops', orgId: 'org-a', name: '运营部', parentId: null, sortOrder: 0, expectedRevision: 0 })
    repository.saveWorkspaceGrant({
      workspaceId: 'workspace-ops', orgId: 'org-a', name: '运营部 · 共享工作区', kind: 'department',
      departmentId: 'dept-ops', rootPath: join(root, 'managed', 'ops'), sandboxMode: 'read-only', expectedRevision: 0,
    })

    await backfillSessionWorkspaceBindings(repository, {
      create: async (path, title) => ({ id: 'workspace-ops', path, title: title ?? 'workspace' }),
      get: () => ({
        id: 'workspace-ops', path: join(root, 'managed', 'ops'), title: '运营部 · 共享工作区',
        sessionIds: ['session-existing'],
      }),
    }, 'org-a')

    expect(repository.sessionWorkspaceGrant('session-existing')).toBeUndefined()
  })
})
