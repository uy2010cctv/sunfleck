/** Create one native Workspace and project with a member-gated identity link. */
import { randomUUID } from 'node:crypto'
import { mkdir, rmdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { projectId, type CreateProjectInput, type EnterpriseProjects, type Project } from '@deepseek-ai/dsh-enterprise-project'

/** Native Workspace registry operations used by project provisioning. */
export interface ProjectWorkspaceRegistry {
  create(path: string, title: string): Promise<{ readonly id: string }>
  delete(id: string): Promise<boolean>
  resolveByPath(path: string): Promise<{ readonly id: string } | undefined>
}

/** PostgreSQL identity operations that prepare and revoke an unpublished project grant. */
export interface ProjectWorkspaceIdentity {
  prepareProjectWorkspace(input: {
    orgId: string
    workspaceId: string
    projectId: string
    createdBy: string
    name: string
    rootPath: string
  }): Promise<unknown>
  discardPreparedProjectWorkspace(input: { orgId: string; workspaceId: string; projectId: string }): Promise<boolean>
  workspaceGrant(workspaceId: string): Promise<{
    readonly kind: string
    readonly orgId: string
    readonly projectId?: string
  } | undefined>
}

/** Project and native Workspace created in one recoverable request. */
export interface CreatedProjectWorkspace {
  readonly project: Project
  readonly workspaceId: string
}

/** Provision only below one configured absolute managed root. */
export class ProjectWorkspaceProvisioner {
  private readonly root: string

  /** @param root - Deployment-owned project Workspace root. */
  constructor(root: string, private readonly projects: Pick<EnterpriseProjects, 'create' | 'get'>,
    private readonly registry: ProjectWorkspaceRegistry, private readonly identity: ProjectWorkspaceIdentity,
    private readonly publish?: (workspaceId: string) => void) {
    if (!isAbsolute(root) || root.trim() === '') throw new Error('project Workspace root must be absolute')
    this.root = resolve(root)
  }

  /** Create a project whose grant is invisible until its project row commits.
   * @param input - Authorized project fields; the Host chooses its id and directory.
   * @returns Committed project and registered Workspace id.
   */
  async create(input: Omit<CreateProjectInput, 'projectId' | 'workspacePath'>): Promise<CreatedProjectWorkspace> {
    const id = projectId(randomUUID())
    const workspacePath = join(this.root, `project-${id}`)
    await mkdir(this.root, { recursive: true })
    await mkdir(workspacePath)
    let workspaceId: string | undefined
    let prepared = false
    try {
      const workspace = await this.registry.create(workspacePath, input.name)
      workspaceId = String(workspace.id)
      await this.identity.prepareProjectWorkspace({ orgId: input.orgId, workspaceId,
        projectId: id, createdBy: input.createdBy, name: input.name, rootPath: workspacePath })
      prepared = true
      const project = await this.projects.create({ ...input, projectId: id, workspacePath })
      this.publish?.(workspaceId)
      return { project, workspaceId }
    } catch (error) {
      // A lost database response may follow a committed insert. Preserve its Workspace and return that project.
      let committed: Project | undefined
      try { committed = await this.projects.get(id) }
      catch (_lookupError) { throw error }
      if (committed !== undefined && workspaceId !== undefined) {
        this.publish?.(workspaceId)
        return { project: committed, workspaceId }
      }
      if (workspaceId !== undefined && !prepared) {
        try {
          const grant = await this.identity.workspaceGrant(workspaceId)
          prepared = grant?.kind === 'project' && grant.orgId === input.orgId && grant.projectId === id
        } catch (_lookupError) {
          // A committed grant cannot be distinguished from a failed prepare until the database recovers.
          throw error
        }
      }
      const failures: unknown[] = []
      if (prepared && workspaceId !== undefined) {
        try {
          if (!await this.identity.discardPreparedProjectWorkspace({ orgId: input.orgId, workspaceId, projectId: id })) {
            throw new Error('prepared project Workspace grant could not be removed')
          }
        } catch (cleanupError) { failures.push(cleanupError) }
      }
      if (workspaceId !== undefined && failures.length === 0) {
        try {
          if (!await this.registry.delete(workspaceId)) throw new Error('project Workspace registration could not be removed')
        } catch (cleanupError) { failures.push(cleanupError) }
      }
      if (failures.length === 0) {
        try { await rmdir(workspacePath) } catch (cleanupError) { failures.push(cleanupError) }
      }
      if (failures.length > 0) throw new AggregateError([error, ...failures], 'project Workspace creation and cleanup failed')
      throw error
    }
  }

  /** Read the native Workspace registered for one stored project path.
   * @param project - Member-visible project.
   * @returns Registered Workspace id, if provisioning has completed.
   */
  async workspaceId(project: Project): Promise<string | undefined> {
    return (await this.registry.resolveByPath(project.workspacePath))?.id
  }

  /** Republish a registered Workspace after a project membership change.
   * @param project - Project whose member permissions changed.
   */
  async notify(project: Project): Promise<void> {
    const id = await this.workspaceId(project)
    if (id !== undefined) this.publish?.(id)
  }
}
