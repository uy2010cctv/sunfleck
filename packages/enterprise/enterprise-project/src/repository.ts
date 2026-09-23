/**
 * PostgreSQL implementation of the project governance store: all SQL for the
 * `projects` and `project_members` tables, state guards, and row parsing with
 * closed-value validation. The schema migrates lazily on first use, so the
 * composing plugin only supplies a `PostgresDatabase` handle.
 *
 * @module @deepseek-ai/dsh-enterprise-project/repository
 */

import { projectId } from './ids.ts'
import type { ProjectId } from './ids.ts'
import { migrateEnterpriseProject } from './schema.ts'
import type {
  AddProjectMemberInput,
  EnterpriseProjectRepositoryOptions,
  PostgresDatabase,
  Project,
  ProjectMember,
  ProjectPrincipalType,
  ProjectState,
  ProjectVisibility,
} from './types.ts'

/** Stable project governance failure for Host adapters. */
export class EnterpriseProjectError extends Error {
  constructor(
    readonly code: 'conflict' | 'invalid-state' | 'not-found',
    readonly resourceType: 'project' | 'project-member',
    readonly resourceId?: string,
  ) {
    super(`enterprise project ${code}`)
    this.name = 'EnterpriseProjectError'
  }
}

const PROJECT_STATES: readonly ProjectState[] = ['active', 'archived']
const PROJECT_VISIBILITIES: readonly ProjectVisibility[] = ['organization', 'private', 'restricted']
const PRINCIPAL_TYPES: readonly ProjectPrincipalType[] = ['user', 'employee']

/**
 * Validate one closed-value column read from a stored row.
 * @param value - raw column value.
 * @param column - qualified column name for the error.
 * @param allowed - the closed value set.
 * @returns the validated value.
 */
function enumColumn<T extends string>(value: unknown, column: string, allowed: readonly T[]): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T
  throw new Error(`enterprise project database column ${column} carries ${JSON.stringify(value)}; expected one of ${allowed.join('/')}`)
}

/**
 * Parse the `allowed_user_ids` JSON string array column.
 * @param value - raw stored JSON text.
 * @returns the validated id list.
 */
function stringArray(value: unknown): readonly string[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error('enterprise project database column allowed_user_ids is not a JSON string array')
  }
  return parsed as readonly string[]
}

interface ProjectRow extends Record<string, unknown> {
  readonly project_id: string
  readonly org_id: string
  readonly name: string
  readonly goal: string
  readonly workspace_path: string
  readonly team_definition_id: string | null
  readonly state: unknown
  readonly visibility: unknown
  readonly allowed_user_ids: string
  readonly created_by: string
  readonly created_at: number | string
  readonly archived_at: number | string | null
}

interface MemberRow extends Record<string, unknown> {
  readonly project_id: string
  readonly principal_type: unknown
  readonly principal_id: string
  readonly added_by: string
  readonly added_at: number | string
}

/** PostgreSQL-backed project and project-membership store. */
export class EnterpriseProjectRepository {
  private initialized: Promise<void> | undefined

  /**
   * @param database - PostgreSQL handle the composition owns; the `organizations` FK target must already exist.
   * @param options - clock override for tests.
   */
  constructor(
    private readonly database: PostgresDatabase,
    private readonly options: EnterpriseProjectRepositoryOptions = {},
  ) {}

  /* jscpd:ignore-start -- repository plumbing parallels enterprise-operations' team-control
     repository; the packages stay decoupled, so the advisory-lock stanza repeats. */
  private initialize(): Promise<void> { return this.initialized ??= migrateEnterpriseProject(this.database) }
  private now(): number { return this.options.now?.() ?? Date.now() }
  private async lock(database: PostgresDatabase, key: string): Promise<void> {
    await database.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key])
  }
  /* jscpd:ignore-end */

  /**
   * Lock one project row until the transaction ends and reject anything a mutation
   * cannot target: unknown ids with `not-found`, non-active states with `invalid-state`.
   */
  private async lockActiveProject(database: PostgresDatabase, projectId: ProjectId): Promise<ProjectRow> {
    await this.lock(database, `project:${projectId}`)
    const current = await database.query<ProjectRow>(
      'SELECT * FROM projects WHERE project_id=$1 FOR UPDATE', [projectId],
    )
    const row = current.rows[0]
    if (row === undefined) throw new EnterpriseProjectError('not-found', 'project', projectId)
    if (row.state !== 'active') throw new EnterpriseProjectError('invalid-state', 'project', projectId)
    return row
  }

  /**
   * Insert one active project and its creator as the first 'user' member.
   * @param input - full project specification; the id must be fresh.
   * @returns the created project.
   */
  async createProject(input: {
    readonly projectId: ProjectId
    readonly orgId: string
    readonly name: string
    readonly goal: string
    readonly workspacePath: string
    readonly teamDefinitionId?: string
    readonly visibility: ProjectVisibility
    readonly allowedUserIds: readonly string[]
    readonly createdBy: string
  }): Promise<Project> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `project:${input.projectId}`)
      const existing = await database.query<{ project_id: string }>(
        'SELECT project_id FROM projects WHERE project_id=$1 FOR UPDATE', [input.projectId],
      )
      if (existing.rows[0] !== undefined) throw new EnterpriseProjectError('conflict', 'project', input.projectId)
      const at = this.now()
      const inserted = await database.query<ProjectRow>(
        `INSERT INTO projects(project_id,org_id,name,goal,workspace_path,team_definition_id,state,visibility,
          allowed_user_ids,created_by,created_at,archived_at)
         VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,NULL) RETURNING *`,
        [input.projectId, input.orgId, input.name, input.goal, input.workspacePath,
          input.teamDefinitionId ?? null, input.visibility, JSON.stringify(input.allowedUserIds),
          input.createdBy, at],
      )
      const row = inserted.rows[0]
      if (row === undefined) throw new Error('enterprise project insert returned no row')
      await database.query(
        `INSERT INTO project_members(project_id,principal_type,principal_id,added_by,added_at)
         VALUES($1,'user',$2,$2,$3)`,
        [input.projectId, input.createdBy, at],
      )
      return this.project(row)
    })
  }

  /**
   * Read one project by id.
   * @param projectId - project identifier.
   * @returns the stored project, or undefined when the id is unknown.
   */
  async getProject(projectId: ProjectId): Promise<Project | undefined> {
    await this.initialize()
    const result = await this.database.query<ProjectRow>('SELECT * FROM projects WHERE project_id=$1', [projectId])
    return result.rows[0] === undefined ? undefined : this.project(result.rows[0])
  }

  /**
   * List one organization's projects in creation order.
   * @param orgId - organization whose projects are listed.
   * @returns the projects in creation order.
   */
  async listProjects(orgId: string): Promise<readonly Project[]> {
    await this.initialize()
    const result = await this.database.query<ProjectRow>(
      'SELECT * FROM projects WHERE org_id=$1 ORDER BY created_at, project_id', [orgId],
    )
    return result.rows.map(row => this.project(row))
  }

  /**
   * Move one active project to archived; archived is terminal.
   * @param projectId - project identifier.
   * @returns the archived project.
   */
  async archiveProject(projectId: ProjectId): Promise<Project> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lockActiveProject(database, projectId)
      const archived = await database.query<ProjectRow>(
        "UPDATE projects SET state='archived', archived_at=$2 WHERE project_id=$1 RETURNING *",
        [projectId, this.now()],
      )
      const updated = archived.rows[0]
      if (updated === undefined) throw new Error('enterprise project archive returned no row')
      return this.project(updated)
    })
  }

  /**
   * Add one member to an active project.
   * @param projectId - project identifier; must be active.
   * @param input - member principal and the actor adding it.
   * @returns the created membership.
   */
  async insertMember(projectId: ProjectId, input: AddProjectMemberInput): Promise<ProjectMember> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lockActiveProject(database, projectId)
      const inserted = await database.query<MemberRow>(
        `INSERT INTO project_members(project_id,principal_type,principal_id,added_by,added_at)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT (project_id, principal_type, principal_id) DO NOTHING RETURNING *`,
        [projectId, input.principalType, input.principalId, input.addedBy, this.now()],
      )
      const member = inserted.rows[0]
      if (member === undefined) {
        throw new EnterpriseProjectError('conflict', 'project-member', `${projectId}:${input.principalType}:${input.principalId}`)
      }
      return this.member(member)
    })
  }

  /**
   * Remove one member from an active project; removing the last member is allowed.
   * @param projectId - project identifier; must be active.
   * @param principalType - whether the member is a user or an employee.
   * @param principalId - identifier of the member to remove.
   */
  async removeMember(projectId: ProjectId, principalType: ProjectPrincipalType, principalId: string): Promise<void> {
    await this.initialize()
    await this.database.transaction(async (database) => {
      await this.lockActiveProject(database, projectId)
      const deleted = await database.query(
        'DELETE FROM project_members WHERE project_id=$1 AND principal_type=$2 AND principal_id=$3',
        [projectId, principalType, principalId],
      )
      if (deleted.rowCount === 0) {
        throw new EnterpriseProjectError('not-found', 'project-member', `${projectId}:${principalType}:${principalId}`)
      }
    })
  }

  /**
   * List one project's members in addition order.
   * @param projectId - project identifier.
   * @returns the members in addition order.
   */
  async listMembers(projectId: ProjectId): Promise<readonly ProjectMember[]> {
    await this.initialize()
    const existing = await this.database.query<{ project_id: string }>(
      'SELECT project_id FROM projects WHERE project_id=$1', [projectId],
    )
    if (existing.rows[0] === undefined) throw new EnterpriseProjectError('not-found', 'project', projectId)
    const result = await this.database.query<MemberRow>(
      'SELECT * FROM project_members WHERE project_id=$1 ORDER BY added_at, principal_type, principal_id', [projectId],
    )
    return result.rows.map(row => this.member(row))
  }

  private project(row: ProjectRow): Project {
    return {
      projectId: projectId(row.project_id),
      orgId: row.org_id,
      name: row.name,
      goal: row.goal,
      workspacePath: row.workspace_path,
      ...(row.team_definition_id === null ? {} : { teamDefinitionId: row.team_definition_id }),
      state: enumColumn(row.state, 'projects.state', PROJECT_STATES),
      visibility: enumColumn(row.visibility, 'projects.visibility', PROJECT_VISIBILITIES),
      allowedUserIds: stringArray(row.allowed_user_ids),
      createdBy: row.created_by,
      createdAt: Number(row.created_at),
      ...(row.archived_at === null ? {} : { archivedAt: Number(row.archived_at) }),
    }
  }

  private member(row: MemberRow): ProjectMember {
    return {
      projectId: projectId(row.project_id),
      principalType: enumColumn(row.principal_type, 'project_members.principal_type', PRINCIPAL_TYPES),
      principalId: row.principal_id,
      addedBy: row.added_by,
      addedAt: Number(row.added_at),
    }
  }
}
