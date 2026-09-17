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
  readonly sessionIds?: readonly string[]
  setTitle?(title: string): Promise<void>
}

/** Data used by `EnterpriseWorkspaceRegistry`. */
export interface EnterpriseWorkspaceRegistry {
  create(path: string, title?: string): Promise<WorkspaceLike>
  ensure?(id: string, path: string, title: string): Promise<WorkspaceLike>
  get?(id: string): WorkspaceLike | undefined
}

/** Executes `backfillSessionWorkspaceBindings`.
 * @param orgId - Input value used by this API.
 * @param registry - Input value used by this API.
 * @param repository - Input value used by this API.
 */
export async function backfillSessionWorkspaceBindings(
  repository: EnterpriseIdentityStore,
  registry: EnterpriseWorkspaceRegistry,
  orgId: string,
): Promise<void> {
  for (const grant of await repository.listOrganizationWorkspaceGrants(orgId)) {
    const workspace = registry.get?.(grant.workspaceId)
    if (workspace === undefined) continue
    for (const sessionId of workspace.sessionIds ?? []) {
      if (grant.ownerUserId !== undefined) {
        await repository.bindSessionWorkspace({
          sessionId, workspaceId: grant.workspaceId, orgId, ownerUserId: grant.ownerUserId,
        })
      }
    }
  }
}

/** Data used by `EnterpriseWorkspaceProvisionerOptions`. */
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

  /** Executes `EnterpriseWorkspaceProvisioner.ensurePersonal` for this instance.
   * @param user - Input value used by this API.
   * @returns Result produced by this API.
   */
  async ensurePersonal(user: EnterpriseUserView): Promise<EnterpriseWorkspaceGrant> {
    const existing = (await this.repository.listOrganizationWorkspaceGrants(user.orgId))
      .find(grant => grant.kind === 'personal' && grant.ownerUserId === user.id)
    if (existing !== undefined) {
      await this.ensureWorkspace(existing)
      return existing
    }
    return this.provision({
      orgId: user.orgId,
      rootPath: join(this.organizationRoot(user.orgId), 'users', compartmentId(user.id)),
      name: `${user.displayName} · 个人工作区`,
      kind: 'personal',
      ownerUserId: user.id,
      sandboxMode: 'workspace-write',
    })
  }

  /** Executes `EnterpriseWorkspaceProvisioner.createPersonal` for this instance.
   * @param idempotencyKey - Input value used by this API.
   * @param name - Input value used by this API.
   * @param user - Input value used by this API.
   * @returns Result produced by this API.
   */
  async createPersonal(
    user: EnterpriseUserView,
    name: string,
    idempotencyKey: string,
  ): Promise<EnterpriseWorkspaceGrant> {
    if (!name.trim() || !idempotencyKey.trim()) throw new Error('workspace name and idempotency key are required')
    const rootPath = join(
      this.organizationRoot(user.orgId), 'users', compartmentId(user.id), compartmentId(idempotencyKey),
    )
    const existing = (await this.repository.listOrganizationWorkspaceGrants(user.orgId))
      .find(grant => grant.rootPath === rootPath)
    if (existing !== undefined) return existing
    return this.provision({
      orgId: user.orgId, rootPath, name: name.trim(), kind: 'personal', ownerUserId: user.id,
      sandboxMode: 'workspace-write',
    })
  }

  /** Executes `EnterpriseWorkspaceProvisioner.ensureDepartment` for this instance.
   * @param department - Input value used by this API.
   * @param previousDepartmentName - Input value used by this API.
   * @returns Result produced by this API.
   */
  async ensureDepartment(
    department: EnterpriseDepartment,
    previousDepartmentName?: string,
  ): Promise<EnterpriseWorkspaceGrant> {
    const existing = (await this.repository.listOrganizationWorkspaceGrants(department.orgId))
      .find(grant => grant.kind === 'department' && grant.departmentId === department.id)
    if (existing !== undefined) {
      const previousManagedName = previousDepartmentName === undefined
        ? undefined
        : `${previousDepartmentName} · 共享工作区`
      const nextManagedName = `${department.name} · 共享工作区`
      const resolved = previousManagedName !== undefined
        && existing.name === previousManagedName
        && existing.name !== nextManagedName
        ? await this.repository.saveWorkspaceGrant({
          ...existing, name: nextManagedName, expectedRevision: existing.revision,
        })
        : existing
      await this.ensureWorkspace(resolved)
      return resolved
    }
    return this.provision({
      orgId: department.orgId,
      rootPath: join(this.organizationRoot(department.orgId), 'departments', compartmentId(department.id)),
      name: `${department.name} · 共享工作区`,
      kind: 'department',
      departmentId: department.id,
      sandboxMode: 'read-only',
    })
  }

  /** Executes `EnterpriseWorkspaceProvisioner.ensureWorkspace` for this instance.
   * @param grant - Input value used by this API.
   */
  async ensureWorkspace(grant: EnterpriseWorkspaceGrant): Promise<void> {
    const workspace = await this.options.registry.ensure?.(grant.workspaceId, grant.rootPath, grant.name)
    if (workspace !== undefined && workspace.title !== grant.name) await workspace.setTitle?.(grant.name)
  }

  private organizationRoot(orgId: string): string {
    return join(this.root, 'organizations', compartmentId(orgId))
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
