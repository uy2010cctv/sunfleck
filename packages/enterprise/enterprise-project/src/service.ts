/**
 * Host-facing project governance service.
 *
 * Driver-neutral: Host code depends on the `EnterpriseProjects` contract and
 * the `EnterpriseProjectStore` structural subset, not on the PostgreSQL
 * repository. The service owns input validation, the explicit visibility
 * resolve, listing filters, and the no-existence-leak member gate; every SQL
 * statement and state guard stays in the repository.
 *
 * @module @deepseek-ai/dsh-enterprise-project/service
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { EnterpriseProjectError } from './repository.ts'
import type { EnterpriseProjectRepository } from './repository.ts'
import { projectId } from './ids.ts'
import type { ProjectId } from './ids.ts'
import type {
  AddProjectMemberInput,
  CreateProjectInput,
  EnterpriseProjectMemberPrincipal,
  EnterpriseProjectViewer,
  EnterpriseProjects,
  Project,
  ProjectMember,
  ProjectPrincipalType,
  ProjectVisibility,
} from './types.ts'

/** Structural repository contract the service consumes, suitable for Host composition and tests. */
export interface EnterpriseProjectStore {
  readonly createProject: EnterpriseProjectRepository['createProject']
  readonly getProject: EnterpriseProjectRepository['getProject']
  readonly listProjects: EnterpriseProjectRepository['listProjects']
  readonly archiveProject: EnterpriseProjectRepository['archiveProject']
  readonly insertMember: EnterpriseProjectRepository['insertMember']
  readonly removeMember: EnterpriseProjectRepository['removeMember']
  readonly listMembers: EnterpriseProjectRepository['listMembers']
}

/** Resolved creation specification: defaults are applied here, never hidden inside `create`. */
export interface ResolvedCreateProjectSpec {
  readonly orgId: string
  readonly name: string
  readonly goal: string
  readonly workspacePath: string
  readonly teamDefinitionId?: string
  readonly visibility: ProjectVisibility
  readonly allowedUserIds: readonly string[]
  readonly createdBy: string
}

/**
 * Validate one creation request and resolve its defaults: visibility falls to
 * 'organization' and the allowed list is deduplicated with non-empty ids only.
 * @param input - caller-supplied creation request.
 * @returns the resolved specification the store receives.
 */
export function resolveCreateProjectSpec(input: CreateProjectInput): ResolvedCreateProjectSpec {
  const name = input.name.trim()
  const goal = input.goal.trim()
  const createdBy = input.createdBy.trim()
  if (name === '') throw new TypeError('enterprise project name must not be empty')
  if (goal === '') throw new TypeError('enterprise project goal must not be empty')
  if (createdBy === '') throw new TypeError('enterprise project createdBy must not be empty')
  if (!isAbsolute(input.workspacePath)) {
    throw new TypeError(`enterprise project workspacePath must be an absolute path, received ${input.workspacePath}`)
  }
  const allowed = input.allowedUserIds ?? []
  for (const id of allowed) {
    if (id.trim() === '') throw new TypeError('enterprise project allowedUserIds must not contain empty ids')
  }
  return {
    orgId: input.orgId,
    name,
    goal,
    workspacePath: input.workspacePath,
    ...(input.teamDefinitionId === undefined ? {} : { teamDefinitionId: input.teamDefinitionId }),
    visibility: input.visibility ?? 'organization',
    allowedUserIds: [...new Set(allowed)],
    createdBy,
  }
}

/**
 * Evaluate one project's listing visibility for one user. 'organization' is
 * visible to everyone in the organization, 'private' only to its creator, and
 * 'restricted' to `allowedUserIds` plus the creator. This is the self-contained
 * simplification of the governance `EnterpriseResourcePolicy` semantics: the
 * administrator bypass is applied by `list` before this predicate runs.
 * @param project - project being listed.
 * @param userId - viewer the visibility rules evaluate against.
 * @returns whether the viewer may see the project in a listing.
 */
export function visibleToListing(project: Project, userId: string): boolean {
  if (project.visibility === 'organization') return true
  if (project.createdBy === userId) return true
  return project.visibility === 'restricted' && project.allowedUserIds.includes(userId)
}

/** Validates, resolves, and gates project governance writes and reads over one store. */
export class EnterpriseProjectService implements EnterpriseProjects {
  /**
   * @param store - project store, normally an `EnterpriseProjectRepository`.
   */
  constructor(private readonly store: EnterpriseProjectStore) {}

  async create(input: CreateProjectInput): Promise<Project> {
    const spec = resolveCreateProjectSpec(input)
    return this.store.createProject({ ...spec, projectId: input.projectId ?? projectId(randomUUID()) })
  }

  async get(projectId: ProjectId): Promise<Project | undefined> {
    return this.store.getProject(projectId)
  }

  async list(orgId: string, viewer?: EnterpriseProjectViewer): Promise<readonly Project[]> {
    const projects = await this.store.listProjects(orgId)
    if (viewer === undefined || viewer.roles?.includes('administrator') === true) return projects
    return projects.filter(project => visibleToListing(project, viewer.userId))
  }

  async addMember(orgId: string, projectId: ProjectId, input: AddProjectMemberInput): Promise<ProjectMember> {
    await this.requireOwnProject(orgId, projectId)
    return this.store.insertMember(projectId, input)
  }

  async removeMember(orgId: string, projectId: ProjectId, principalType: ProjectPrincipalType, principalId: string): Promise<void> {
    await this.requireOwnProject(orgId, projectId)
    await this.store.removeMember(projectId, principalType, principalId)
  }

  async listMembers(projectId: ProjectId): Promise<readonly ProjectMember[]> {
    return this.store.listMembers(projectId)
  }

  async archive(orgId: string, projectId: ProjectId, byUserId: string): Promise<Project> {
    if (byUserId.trim() === '') throw new TypeError('enterprise project archive byUserId must not be empty')
    await this.requireOwnProject(orgId, projectId)
    return this.store.archiveProject(projectId)
  }

  /** Fold unknown and foreign-organization ids into one `not-found` before a mutation. */
  private async requireOwnProject(orgId: string, projectId: ProjectId): Promise<void> {
    const project = await this.store.getProject(projectId)
    if (project === undefined || project.orgId !== orgId) {
      throw new EnterpriseProjectError('not-found', 'project', projectId)
    }
  }

  async requireMember(
    orgId: string,
    projectId: ProjectId,
    principal: EnterpriseProjectMemberPrincipal,
  ): Promise<Project | undefined> {
    const project = await this.store.getProject(projectId)
    if (project === undefined || project.orgId !== orgId) return undefined
    const members = await this.store.listMembers(projectId)
    const member = members.some(row => row.principalType === 'user'
      ? row.principalId === principal.userId
      : principal.employeeId !== undefined && row.principalId === principal.employeeId)
    return member ? project : undefined
  }
}
