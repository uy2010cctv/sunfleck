/** Managed-directory provisioning that binds enterprise grants to real DSH Workspaces. */

import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type {
  EnterpriseDepartment,
  EnterpriseIdentityStore,
  EnterpriseUserView,
  EnterpriseWorkspaceGrant,
} from '@deepseek-ai/dsh-enterprise-identity'

interface WorkspaceLike {
  readonly id: unknown
  readonly path: string
  readonly title: string
}

export interface EnterpriseWorkspaceRegistry {
  create(path: string, title?: string): Promise<WorkspaceLike>
}

export interface EnterpriseWorkspaceProvisionerOptions {
  readonly root: string
  readonly registry: EnterpriseWorkspaceRegistry
}

function compartmentId(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24)
}

/** Creates only deployment-managed roots; callers never supply filesystem paths. */
export class EnterpriseWorkspaceProvisioner {
  private readonly root: string

  constructor(
    private readonly repository: EnterpriseIdentityStore,
    private readonly options: EnterpriseWorkspaceProvisionerOptions,
  ) {
    if (!isAbsolute(options.root)) throw new Error('enterprise workspace root must be absolute')
    this.root = resolve(options.root)
  }

  async ensurePersonal(user: EnterpriseUserView): Promise<EnterpriseWorkspaceGrant> {
    const existing = (await this.repository.listOrganizationWorkspaceGrants(user.orgId))
      .find(grant => grant.kind === 'personal' && grant.ownerUserId === user.id)
    if (existing !== undefined) return existing
    return this.provision({
      orgId: user.orgId,
      rootPath: join(this.root, 'users', compartmentId(user.id)),
      name: `${user.displayName} · 个人工作区`,
      kind: 'personal',
      ownerUserId: user.id,
      sandboxMode: 'workspace-write',
    })
  }

  async createPersonal(
    user: EnterpriseUserView,
    name: string,
    idempotencyKey: string,
  ): Promise<EnterpriseWorkspaceGrant> {
    if (!name.trim() || !idempotencyKey.trim()) throw new Error('workspace name and idempotency key are required')
    const rootPath = join(this.root, 'users', compartmentId(user.id), compartmentId(idempotencyKey))
    const existing = (await this.repository.listOrganizationWorkspaceGrants(user.orgId))
      .find(grant => grant.rootPath === rootPath)
    if (existing !== undefined) return existing
    return this.provision({
      orgId: user.orgId, rootPath, name: name.trim(), kind: 'personal', ownerUserId: user.id,
      sandboxMode: 'workspace-write',
    })
  }

  async ensureDepartment(department: EnterpriseDepartment): Promise<EnterpriseWorkspaceGrant> {
    const existing = (await this.repository.listOrganizationWorkspaceGrants(department.orgId))
      .find(grant => grant.kind === 'department' && grant.departmentId === department.id)
    if (existing !== undefined) return existing
    return this.provision({
      orgId: department.orgId,
      rootPath: join(this.root, 'departments', compartmentId(department.id)),
      name: `${department.name} · 共享工作区`,
      kind: 'department',
      departmentId: department.id,
      sandboxMode: 'read-only',
    })
  }

  private async provision(input: Omit<EnterpriseWorkspaceGrant, 'workspaceId' | 'revision' | 'createdAt' | 'updatedAt'>): Promise<EnterpriseWorkspaceGrant> {
    await mkdir(input.rootPath, { recursive: true, mode: 0o700 })
    const workspace = await this.options.registry.create(input.rootPath, input.name)
    try {
      return await this.repository.saveWorkspaceGrant({
        ...input, workspaceId: String(workspace.id), rootPath: workspace.path, expectedRevision: 0,
      })
    } catch (error) {
      const raced = await this.repository.workspaceGrant(String(workspace.id))
      if (raced !== undefined) return raced
      throw error
    }
  }
}
