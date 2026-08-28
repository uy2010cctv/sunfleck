import { access, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnterpriseIdentityRepository } from '@deepseek-ai/dsh-enterprise-identity'
import { EnterpriseWorkspaceProvisioner } from '../src/workspace-provisioner.ts'

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
    expect(first.rootPath).toMatch(/\/managed\/users\/[a-f0-9]{24}$/u)
    expect(first.rootPath).not.toContain('alice')
    await expect(access(first.rootPath)).resolves.toBeUndefined()
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
})
