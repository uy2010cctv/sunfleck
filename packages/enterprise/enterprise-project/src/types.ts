/**
 * Domain types, the `EnterpriseProjects` service interface, and the minimal
 * PostgreSQL surface for the project governance entity. SQL row shapes stay
 * internal to this package's repository; consumers see only these types.
 *
 * @module @deepseek-ai/dsh-enterprise-project/types
 */

import type { ProjectId } from './ids.ts'

/** Lifecycle of one enterprise project; archived is terminal. */
export type ProjectState = 'active' | 'archived'

/**
 * Who can see one project in `list`. Unlike the governance
 * `EnterpriseResourcePolicy` table this visibility is stored on the project
 * row itself, and 'restricted' readers come from `allowedUserIds` plus the
 * creator — a deliberate self-contained simplification documented in the
 * package README.
 */
export type ProjectVisibility = 'organization' | 'private' | 'restricted'

/** Kind of principal holding one project membership. */
export type ProjectPrincipalType = 'user' | 'employee'

/** One enterprise project: a member-gated workspace space inside one organization. */
export interface Project {
  /** Durable project identifier. */
  readonly projectId: ProjectId
  /** Owning organization identifier. */
  readonly orgId: string
  /** Human-readable project name. */
  readonly name: string
  /** Project goal statement. */
  readonly goal: string
  /** Absolute filesystem path of the workspace the project runs in; stored as a plain string, resolved by the consuming side. */
  readonly workspacePath: string
  /** Team definition owning the project's execution, when one is bound. */
  readonly teamDefinitionId?: string
  /** Current lifecycle state; archived is terminal. */
  readonly state: ProjectState
  /** Listing visibility inside the organization. */
  readonly visibility: ProjectVisibility
  /** Extra user ids allowed to see a 'restricted' project; the creator is allowed implicitly. */
  readonly allowedUserIds: readonly string[]
  /** Actor id that created the project; also its first 'user' member. */
  readonly createdBy: string
  /** Creation time in epoch milliseconds. */
  readonly createdAt: number
  /** Archival time in epoch milliseconds, set exactly when state is 'archived'. */
  readonly archivedAt?: number
}

/** One explicit project membership. Projects are member-gated: visibility never grants access. */
export interface ProjectMember {
  /** Project the membership belongs to. */
  readonly projectId: ProjectId
  /** Whether the member is a human user or an employee account. */
  readonly principalType: ProjectPrincipalType
  /** Identifier of the user or employee. */
  readonly principalId: string
  /** Actor id that added the member. */
  readonly addedBy: string
  /** Addition time in epoch milliseconds. */
  readonly addedAt: number
}

/** Inputs for creating one project. */
export interface CreateProjectInput {
  /** Owning organization identifier; the organization row must already exist. */
  readonly orgId: string
  /** Human-readable project name; must not be empty. */
  readonly name: string
  /** Project goal statement; must not be empty. */
  readonly goal: string
  /** Absolute filesystem path of the workspace the project runs in. */
  readonly workspacePath: string
  /** Actor id creating the project; becomes the first 'user' member. */
  readonly createdBy: string
  /** Team definition owning the project's execution, when one is bound at creation. */
  readonly teamDefinitionId?: string
  /** Listing visibility; resolved to 'organization' when omitted. */
  readonly visibility?: ProjectVisibility
  /** Extra user ids allowed to see a 'restricted' project. */
  readonly allowedUserIds?: readonly string[]
}

/** Inputs for adding one member to an active project. */
export interface AddProjectMemberInput {
  /** Whether the member is a human user or an employee account. */
  readonly principalType: ProjectPrincipalType
  /** Identifier of the user or employee. */
  readonly principalId: string
  /** Actor id that adds the member. */
  readonly addedBy: string
}

/** Viewer constraining `list`; omitted means the unfiltered organization view. */
export interface EnterpriseProjectViewer {
  /** User id the visibility rules evaluate against. */
  readonly userId: string
  /** Viewer roles; the 'administrator' role sees every project in the organization. */
  readonly roles?: readonly string[]
}

/** Principal whose project membership `requireMember` resolves. Both identities are optional:
 * group session actors carry an employee without a user, and a missing identity simply never
 * matches its member rows. */
export interface EnterpriseProjectMemberPrincipal {
  /** User id matched against 'user' member rows; absent when the caller has no user identity. */
  readonly userId?: string
  /** Employee id matched against 'employee' member rows, when the principal is an employee. */
  readonly employeeId?: string
}

/** Enterprise project governance service. */
export interface EnterpriseProjects {
  /**
   * Create one active project and add its creator as the first 'user' member.
   * @param input - organization, name, goal, workspace, creator, and optional visibility fields.
   * @returns the created project.
   */
  create(input: CreateProjectInput): Promise<Project>
  /**
   * Read one project by id, regardless of state or visibility.
   * @param projectId - project identifier.
   * @returns the stored project, or undefined when the id is unknown.
   */
  get(projectId: ProjectId): Promise<Project | undefined>
  /**
   * List one organization's projects in creation order. With a viewer, projects are filtered:
   * 'organization' is visible to everyone, 'private' only to its creator, 'restricted' to
   * `allowedUserIds` plus the creator; the 'administrator' role sees everything.
   * @param orgId - organization whose projects are listed.
   * @param viewer - viewer the visibility rules evaluate against; omitted returns all projects.
   * @returns the visible projects in creation order.
   */
  list(orgId: string, viewer?: EnterpriseProjectViewer): Promise<readonly Project[]>
  /**
   * Add one member to an active project. A project of another organization is
   * indistinguishable from an unknown id.
   * @param orgId - organization the caller acts within.
   * @param projectId - project identifier; must be active and belong to `orgId`.
   * @param input - member principal and the actor adding it.
   * @returns the created membership.
   */
  addMember(orgId: string, projectId: ProjectId, input: AddProjectMemberInput): Promise<ProjectMember>
  /**
   * Remove one member from an active project. Removing the last member is allowed; archiving,
   * not membership, ends a project's life. A project of another organization is
   * indistinguishable from an unknown id.
   * @param orgId - organization the caller acts within.
   * @param projectId - project identifier; must be active and belong to `orgId`.
   * @param principalType - whether the member is a user or an employee.
   * @param principalId - identifier of the member to remove.
   */
  removeMember(orgId: string, projectId: ProjectId, principalType: ProjectPrincipalType, principalId: string): Promise<void>
  /**
   * List one project's members in addition order.
   * @param projectId - project identifier.
   * @returns the members in addition order.
   */
  listMembers(projectId: ProjectId): Promise<readonly ProjectMember[]>
  /**
   * Move one active project to archived; archived is terminal and every mutation except reads
   * rejects afterwards. The actor is recorded by the caller's audit trail; the store keeps only
   * the archival time. A project of another organization is indistinguishable from an unknown id.
   * @param orgId - organization the caller acts within.
   * @param projectId - project identifier; must be active and belong to `orgId`.
   * @param byUserId - actor id requesting the archival; must not be empty.
   * @returns the archived project.
   */
  archive(orgId: string, projectId: ProjectId, byUserId: string): Promise<Project>
  /**
   * Resolve the project one principal may work in, or undefined without leaking existence:
   * unknown ids, other organizations' projects, and non-members all return undefined. Projects
   * are member-gated spaces, so visibility never substitutes for a member row: 'user' members
   * match `principal.userId` and 'employee' members match `principal.employeeId`. Archived
   * projects stay readable for their members.
   * @param orgId - organization the caller claims the project belongs to.
   * @param projectId - project identifier.
   * @param principal - user and optional employee identity of the caller.
   * @returns the project when the principal is an explicit member, otherwise undefined.
   */
  requireMember(orgId: string, projectId: ProjectId, principal: EnterpriseProjectMemberPrincipal): Promise<Project | undefined>
}

/* jscpd:ignore-start -- the minimal driver-neutral PostgreSQL surface mirrors
   operations/enterprise-operations/src/types.ts (as catalog and identity-postgres each do);
   the packages stay decoupled, so each self-contains its own copy. */
/** Data used by `PostgresQueryResult`. */
export interface PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[]
  readonly rowCount: number | null
}

/** Minimal driver-neutral PostgreSQL surface used by the project repository. */
export interface PostgresDatabase {
  query<Row extends Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<PostgresQueryResult<Row>>
  transaction<T>(operation: (database: PostgresDatabase) => Promise<T>): Promise<T>
}
/* jscpd:ignore-end */

/** Data used by `EnterpriseProjectRepositoryOptions`. */
export interface EnterpriseProjectRepositoryOptions {
  /** Clock for `created_at`, `added_at`, and `archived_at`; defaults to `Date.now`. */
  readonly now?: () => number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Project governance service used by enterprise composition and Agent tools. */
    enterpriseProjects: EnterpriseProjects
  }
}
