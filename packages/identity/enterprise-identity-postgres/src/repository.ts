/** Async PostgreSQL implementation of the enterprise identity repository contract. */

import type {
  AuditQuery,
  EnterpriseAuditRecord,
  EnterpriseDepartment,
  EnterpriseMemoryEntry,
  EnterpriseMemoryPrivacyFinding,
  EnterpriseManagedAsset,
  EnterpriseOrganization,
  EnterprisePrincipalView,
  EnterpriseResourcePolicy,
  EnterpriseUserInput,
  EnterpriseUserView,
  CreateEnterpriseUserOptions,
  CreateEnterpriseOrganizationInput,
  UpdateEnterpriseUserProfileInput,
  EnterpriseWorkspaceGrant,
  ExternalIdentityBinding,
  MemoryScope,
  MemoryKind,
  MemoryImportanceUpdate,
  RepositoryOptions,
  ProposeEnterpriseMemoryInput,
  ReviewEnterpriseMemoryInput,
  SaveEnterpriseDepartmentInput,
  SaveEnterpriseWorkspaceGrantInput,
  SetUserDepartmentsInput,
  WritePrivateMemoryInput,
} from '@deepseek-ai/dsh-enterprise-identity'
import {
  enumColumn,
  inspectEnterpriseMemory,
  MEMORY_KINDS,
  MEMORY_SCOPES,
  planMemoryListFilters,
  sessionTokenHash,
  validateMemoryImportanceUpdates,
  validatePrivateMemoryInput,
} from '@deepseek-ai/dsh-enterprise-identity'
import type { EnterpriseRole } from '@deepseek-ai/dsh-enterprise-governance'
import type { PostgresDatabase } from './types.ts'

function safeStringArray(value: unknown): string[] {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error('enterprise identity database contains an invalid string array')
  }
  return parsed as string[]
}

function safeObject(value: unknown): Record<string, unknown> {
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('enterprise identity database contains invalid JSON object')
  }
  return parsed as Record<string, unknown>
}

function assertNoSecretFields(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertNoSecretFields(item)
    return
  }
  if (typeof value !== 'object' || value === null) return
  for (const [key, child] of Object.entries(value)) {
    if (!key.endsWith('Ref') && /(token|secret|password|apiKey|privateKey|credential)/iu.test(key)) {
      throw new Error(`managed asset config contains secret-bearing field ${key}`)
    }
    assertNoSecretFields(child)
  }
}

interface UserRow extends Record<string, unknown> {
  readonly id: string
  readonly org_id: string
  readonly username: string
  readonly display_name: string
  readonly disabled: boolean
  readonly department_revision: number | string
}

interface DepartmentRow extends Record<string, unknown> {
  readonly id: string
  readonly org_id: string
  readonly parent_id: string | null
  readonly name: string
  readonly sort_order: number | string
  readonly revision: number | string
  readonly created_at: number | string
  readonly updated_at: number | string
}

interface WorkspaceGrantRow extends Record<string, unknown> {
  readonly workspace_id: string
  readonly org_id: string
  readonly name: string
  readonly kind: 'personal' | 'department'
  readonly owner_user_id: string | null
  readonly department_id: string | null
  readonly root_path: string
  readonly sandbox_mode: 'read-only' | 'workspace-write'
  readonly revision: number | string
  readonly created_at: number | string
  readonly updated_at: number | string
}

interface MemoryRow extends Record<string, unknown> {
  readonly id: string
  readonly org_id: string
  readonly scope_type: unknown
  readonly department_id: string | null
  readonly agent_employee_id: string | null
  readonly pair_user_id: string | null
  readonly project_id: string | null
  readonly kind: unknown
  readonly status: EnterpriseMemoryEntry['status']
  readonly summary: string
  readonly source_digest: string
  readonly privacy_findings: unknown
  readonly importance: number | string | null
  readonly last_access_at: number | string | null
  readonly valid_from: number | string | null
  readonly invalidated_by: string | null
  readonly created_by: string
  readonly reviewed_by: string | null
  readonly review_reason: string | null
  readonly revision: number | string
  readonly created_at: number | string
  readonly updated_at: number | string
}

interface PolicyRow extends Record<string, unknown> {
  readonly resource_type: string
  readonly resource_id: string
  readonly org_id: string
  readonly creator_user_id: string | null
  readonly visibility: EnterpriseResourcePolicy['visibility']
  readonly allowed_user_ids: unknown
}

interface AssetRow extends Record<string, unknown> {
  readonly org_id: string
  readonly type: EnterpriseManagedAsset['type']
  readonly id: string
  readonly name: string
  readonly config_json: unknown
}

interface AuditRow extends Record<string, unknown> {
  readonly id: string
  readonly org_id: string
  readonly actor_user_id: string
  readonly action: EnterpriseAuditRecord['action']
  readonly resource_type: string
  readonly resource_id: string
  readonly decision: 'allowed' | 'denied'
  readonly reason: string
  readonly correlation_id: string
  readonly created_at: number | string
  readonly details_json: unknown
}

/** PostgreSQL-backed identity, session, policy, managed-asset, and audit repository. */
export class PgEnterpriseIdentityRepository {
  private readonly now: () => number

  constructor(readonly database: PostgresDatabase, options: RepositoryOptions = {}) {
    this.now = options.now ?? Date.now
  }

  /** Executes `PgEnterpriseIdentityRepository.close` for this instance. */
  async close(): Promise<void> {
    await this.database.end?.()
  }

  /** Executes `PgEnterpriseIdentityRepository.createOrganization` for this instance.
   * @param organization - Input value used by this API.
   */
  async createOrganization(organization: EnterpriseOrganization): Promise<void> {
    await this.database.query('INSERT INTO organizations(id, name) VALUES ($1, $2)', [organization.id, organization.name])
  }

  /** Create one organization and its enabled administrator as one PostgreSQL transaction. */
  async createOrganizationWithAdministrator(input: CreateEnterpriseOrganizationInput): Promise<void> {
    if (input.administrator.orgId !== input.organization.id || input.administrator.disabled) {
      throw new Error('enterprise organization administrator must be enabled and belong to the new organization')
    }
    await this.transaction(async (database) => {
      await database.query('INSERT INTO organizations(id, name) VALUES ($1, $2)', [
        input.organization.id, input.organization.name,
      ])
      await database.query(`INSERT INTO users(id, org_id, username, display_name, disabled, password_verifier)
        VALUES ($1, $2, $3, $4, $5, $6)`, [
        input.administrator.id, input.administrator.orgId, input.administrator.username,
        input.administrator.displayName, false, input.passwordVerifier,
      ])
      await database.query('INSERT INTO user_roles(user_id, role) VALUES ($1, $2)', [
        input.administrator.id, 'administrator',
      ])
    })
  }

  /** Update only the human-readable organization name; the durable id remains unchanged. */
  async updateOrganization(id: string, name: string): Promise<void> {
    const result = await this.database.query('UPDATE organizations SET name = $2 WHERE id = $1', [id, name])
    if (result.rowCount === 0) throw new Error('enterprise organization is missing')
  }

  /** Executes `PgEnterpriseIdentityRepository.listOrganizations` for this instance.
   * @returns Result produced by this API.
   */
  async listOrganizations(): Promise<EnterpriseOrganization[]> {
    const result = await this.database.query<{ id: string; name: string }>(
      'SELECT id, name FROM organizations ORDER BY name, id',
    )
    return result.rows.map(row => ({ id: row.id, name: row.name }))
  }

  /** Executes `PgEnterpriseIdentityRepository.createUser` for this instance.
   * @param options - Input value used by this API.
   * @param user - Input value used by this API.
   */
  async createUser(user: EnterpriseUserInput, options: CreateEnterpriseUserOptions = {}): Promise<void> {
    if (options.passwordVerifier === undefined) {
      await this.database.query(
        'INSERT INTO users(id, org_id, username, display_name, disabled) VALUES ($1, $2, $3, $4, $5)',
        [user.id, user.orgId, user.username, user.displayName, user.disabled],
      )
      return
    }
    await this.database.query(
      `INSERT INTO users(id, org_id, username, display_name, disabled, password_verifier)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.id, user.orgId, user.username, user.displayName, user.disabled, options.passwordVerifier],
    )
  }

  /** Executes `PgEnterpriseIdentityRepository.listUsers` for this instance.
   * @param orgId - Input value used by this API.
   * @returns Result produced by this API.
   */
  async listUsers(orgId: string): Promise<EnterpriseUserView[]> {
    const users = await this.database.query<UserRow>(
      'SELECT id, org_id, username, display_name, disabled, department_revision FROM users WHERE org_id = $1 ORDER BY username, id',
      [orgId],
    )
    return await Promise.all(users.rows.map(async row => ({
      id: row.id, orgId: row.org_id, username: row.username, displayName: row.display_name,
      disabled: row.disabled, roles: await this.roles(row.id),
      ...await this.departmentsForUser(row.id), departmentRevision: Number(row.department_revision),
    })))
  }

  /** Executes `PgEnterpriseIdentityRepository.findUser` for this instance.
   * @param orgId - Input value used by this API.
   * @param username - Input value used by this API.
   * @returns Result produced by this API.
   */
  async findUser(orgId: string, username: string): Promise<EnterpriseUserView | undefined> {
    const result = await this.database.query<UserRow>(
      'SELECT id, org_id, username, display_name, disabled, department_revision FROM users WHERE org_id = $1 AND username = $2',
      [orgId, username],
    )
    return result.rows[0] === undefined ? undefined : this.userFromRow(result.rows[0])
  }

  /** Executes `PgEnterpriseIdentityRepository.updateUserProfile` for this instance.
   * @param input - Input value used by this API.
   */
  async updateUserProfile(input: UpdateEnterpriseUserProfileInput): Promise<void> {
    const username = input.username.trim()
    const displayName = input.displayName.trim()
    if (username === '' || displayName === '') throw new Error('enterprise username and display name are required')
    const verifier = input.passwordVerifier ?? null
    const result = await this.database.query(`UPDATE users SET username = $1, display_name = $2,
      password_verifier = CASE WHEN $3::text IS NULL THEN password_verifier ELSE $4 END
      WHERE id = $5 AND org_id = $6`, [username, displayName, verifier, verifier, input.userId, input.orgId])
    if (result.rowCount !== 1) throw new Error('enterprise user is outside organization or missing')
  }

  private async userFromRow(row: UserRow): Promise<EnterpriseUserView> {
    return {
      id: row.id, orgId: row.org_id, username: row.username, displayName: row.display_name,
      disabled: row.disabled, roles: await this.roles(row.id),
      ...await this.departmentsForUser(row.id), departmentRevision: Number(row.department_revision),
    }
  }

  private async user(userId: string): Promise<EnterpriseUserView | undefined> {
    const result = await this.database.query<UserRow>(
      'SELECT id, org_id, username, display_name, disabled, department_revision FROM users WHERE id = $1', [userId],
    )
    return result.rows[0] === undefined ? undefined : this.userFromRow(result.rows[0])
  }

  private async roles(userId: string): Promise<EnterpriseRole[]> {
    const result = await this.database.query<{ role: EnterpriseRole }>(
      'SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role', [userId],
    )
    return result.rows.map(row => row.role)
  }

  private async departmentsForUser(userId: string, database: PostgresDatabase = this.database): Promise<{
    departmentIds: string[]
    primaryDepartmentId?: string
  }> {
    const result = await database.query<{ department_id: string; is_primary: boolean }>(
      'SELECT department_id, is_primary FROM user_departments WHERE user_id = $1 ORDER BY department_id', [userId],
    )
    const primary = result.rows.find(row => row.is_primary)?.department_id
    return {
      departmentIds: result.rows.map(row => row.department_id),
      ...(primary === undefined ? {} : { primaryDepartmentId: primary }),
    }
  }

  /** Executes `PgEnterpriseIdentityRepository.setRoles` for this instance.
   * @param roles - Input value used by this API.
   * @param userId - Input value used by this API.
   */
  async setRoles(userId: string, roles: readonly EnterpriseRole[]): Promise<void> {
    await this.transaction(async (database) => {
      await database.query('DELETE FROM user_roles WHERE user_id = $1', [userId])
      for (const role of [...new Set(roles)]) {
        await database.query('INSERT INTO user_roles(user_id, role) VALUES ($1, $2)', [userId, role])
      }
    })
  }

  /** Executes `PgEnterpriseIdentityRepository.setUserDisabled` for this instance.
   * @param disabled - Input value used by this API.
   * @param userId - Input value used by this API.
   */
  async setUserDisabled(userId: string, disabled: boolean): Promise<void> {
    await this.transaction(async (database) => {
      await database.query('UPDATE users SET disabled = $1 WHERE id = $2', [disabled, userId])
      if (disabled) {
        await database.query(
          'UPDATE auth_sessions SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL',
          [this.now(), userId],
        )
      }
    })
  }

  /** Executes `PgEnterpriseIdentityRepository.saveDepartment` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async saveDepartment(input: SaveEnterpriseDepartmentInput): Promise<EnterpriseDepartment> {
    if (!input.id.trim() || !input.name.trim() || !Number.isSafeInteger(input.sortOrder)) {
      throw new Error('enterprise department id, name, and integer sort order are required')
    }
    return this.transaction(async (database) => {
      await database.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`department:${input.orgId}:${input.id}`])
      const result = await database.query<{ org_id: string; revision: number | string }>(
        'SELECT org_id, revision FROM departments WHERE id = $1 FOR UPDATE', [input.id],
      )
      const current = result.rows[0]
      const actual = current === undefined ? 0 : Number(current.revision)
      if (current !== undefined && current.org_id !== input.orgId) throw new Error('enterprise department is outside organization')
      if (actual !== input.expectedRevision) throw new Error(`enterprise department revision conflict: expected ${input.expectedRevision}, actual ${actual}`)
      await this.assertDepartmentParent(database, input.orgId, input.id, input.parentId)
      const at = this.now()
      const written = current === undefined
        ? await database.query<DepartmentRow>(`INSERT INTO departments(id, org_id, parent_id, name, sort_order, revision, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, 1, $6, $6) RETURNING *`,
        [input.id, input.orgId, input.parentId, input.name.trim(), input.sortOrder, at])
        : await database.query<DepartmentRow>(`UPDATE departments SET parent_id = $1, name = $2, sort_order = $3,
          revision = revision + 1, updated_at = $4 WHERE id = $5 RETURNING *`,
        [input.parentId, input.name.trim(), input.sortOrder, at, input.id])
      const row = written.rows[0]
      if (row === undefined) throw new Error('enterprise department write returned no row')
      return this.departmentFromRow(row)
    })
  }

  private async assertDepartmentParent(
    database: PostgresDatabase,
    orgId: string,
    departmentId: string,
    parentId: string | null,
  ): Promise<void> {
    let cursor = parentId
    const seen = new Set<string>()
    while (cursor !== null) {
      if (cursor === departmentId || seen.has(cursor)) throw new Error('enterprise department tree cycle detected')
      seen.add(cursor)
      const result = await database.query<{ org_id: string; parent_id: string | null }>(
        'SELECT org_id, parent_id FROM departments WHERE id = $1', [cursor],
      )
      const row = result.rows[0]
      if (row === undefined || row.org_id !== orgId) throw new Error('enterprise department parent is outside organization or missing')
      cursor = row.parent_id
    }
  }

  /** Executes `PgEnterpriseIdentityRepository.listDepartments` for this instance.
   * @param orgId - Input value used by this API.
   * @returns Result produced by this API.
   */
  async listDepartments(orgId: string): Promise<EnterpriseDepartment[]> {
    const result = await this.database.query<DepartmentRow>(`SELECT * FROM departments WHERE org_id = $1
      ORDER BY parent_id NULLS FIRST, sort_order, name, id`, [orgId])
    return result.rows.map(row => this.departmentFromRow(row))
  }

  private departmentFromRow(row: DepartmentRow): EnterpriseDepartment {
    return {
      id: row.id, orgId: row.org_id, parentId: row.parent_id, name: row.name, sortOrder: Number(row.sort_order),
      revision: Number(row.revision), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    }
  }

  /** Executes `PgEnterpriseIdentityRepository.setUserDepartments` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async setUserDepartments(input: SetUserDepartmentsInput): Promise<EnterpriseUserView> {
    const departmentIds = [...new Set(input.departmentIds)].sort()
    if (input.primaryDepartmentId !== undefined && !departmentIds.includes(input.primaryDepartmentId)) {
      throw new Error('primary enterprise department must be included in departmentIds')
    }
    return this.transaction(async (database) => {
      const users = await database.query<UserRow>('SELECT id, org_id, username, display_name, disabled, department_revision FROM users WHERE id = $1 FOR UPDATE', [input.userId])
      const user = users.rows[0]
      if (user === undefined || user.org_id !== input.orgId) throw new Error('enterprise user is outside organization or missing')
      const actual = Number(user.department_revision)
      if (actual !== input.expectedRevision) throw new Error(`enterprise user department revision conflict: expected ${input.expectedRevision}, actual ${actual}`)
      if (departmentIds.length > 0) {
        const departments = await database.query<{ id: string }>(
          'SELECT id FROM departments WHERE org_id = $1 AND id = ANY($2::text[])', [input.orgId, departmentIds],
        )
        if (departments.rows.length !== departmentIds.length) throw new Error('enterprise user department is outside organization or missing')
      }
      await database.query('DELETE FROM user_departments WHERE user_id = $1', [input.userId])
      for (const departmentId of departmentIds) {
        await database.query('INSERT INTO user_departments(user_id, department_id, is_primary) VALUES ($1, $2, $3)',
          [input.userId, departmentId, departmentId === input.primaryDepartmentId])
      }
      const updated = await database.query<UserRow>(`UPDATE users SET department_revision = department_revision + 1
        WHERE id = $1 RETURNING id, org_id, username, display_name, disabled, department_revision`, [input.userId])
      const row = updated.rows[0]
      if (row === undefined) throw new Error('enterprise user department update returned no user')
      return {
        id: row.id, orgId: row.org_id, username: row.username, displayName: row.display_name,
        disabled: row.disabled, roles: await this.rolesFrom(database, row.id),
        ...await this.departmentsForUser(row.id, database), departmentRevision: Number(row.department_revision),
      }
    })
  }

  private async rolesFrom(database: PostgresDatabase, userId: string): Promise<EnterpriseRole[]> {
    const result = await database.query<{ role: EnterpriseRole }>('SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role', [userId])
    return result.rows.map(row => row.role)
  }

  /** Executes `PgEnterpriseIdentityRepository.saveWorkspaceGrant` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async saveWorkspaceGrant(input: SaveEnterpriseWorkspaceGrantInput): Promise<EnterpriseWorkspaceGrant> {
    this.assertWorkspaceGrantShape(input)
    return this.transaction(async (database) => {
      await this.assertWorkspaceGrantReferences(database, input)
      const currentResult = await database.query<{ org_id: string; revision: number | string }>(
        'SELECT org_id, revision FROM enterprise_workspace_grants WHERE workspace_id = $1 FOR UPDATE', [input.workspaceId],
      )
      const current = currentResult.rows[0]
      const actual = current === undefined ? 0 : Number(current.revision)
      if (current !== undefined && current.org_id !== input.orgId) throw new Error('enterprise workspace is outside organization')
      if (actual !== input.expectedRevision) throw new Error(`enterprise workspace revision conflict: expected ${input.expectedRevision}, actual ${actual}`)
      const at = this.now()
      const written = current === undefined
        ? await database.query<WorkspaceGrantRow>(`INSERT INTO enterprise_workspace_grants(workspace_id, org_id, name, kind,
          owner_user_id, department_id, root_path, sandbox_mode, revision, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $9) RETURNING *`,
        [input.workspaceId, input.orgId, input.name.trim(), input.kind, input.ownerUserId ?? null,
          input.departmentId ?? null, input.rootPath, input.sandboxMode, at])
        : await database.query<WorkspaceGrantRow>(`UPDATE enterprise_workspace_grants SET name = $1, kind = $2,
          owner_user_id = $3, department_id = $4, root_path = $5, sandbox_mode = $6,
          revision = revision + 1, updated_at = $7 WHERE workspace_id = $8 RETURNING *`,
        [input.name.trim(), input.kind, input.ownerUserId ?? null, input.departmentId ?? null,
          input.rootPath, input.sandboxMode, at, input.workspaceId])
      const row = written.rows[0]
      if (row === undefined) throw new Error('enterprise workspace write returned no row')
      return this.workspaceGrantFromRow(row)
    })
  }

  private assertWorkspaceGrantShape(input: SaveEnterpriseWorkspaceGrantInput): void {
    if (!input.workspaceId.trim() || !input.name.trim() || !input.rootPath.trim()) throw new Error('enterprise workspace identity, name, and root path are required')
    if (input.kind === 'personal' && (input.ownerUserId === undefined || input.departmentId !== undefined)) throw new Error('personal enterprise workspace requires one owner and no department')
    if (input.kind === 'department' && (input.departmentId === undefined || input.ownerUserId !== undefined)) throw new Error('department enterprise workspace requires one department and no owner')
  }

  private async assertWorkspaceGrantReferences(database: PostgresDatabase, input: SaveEnterpriseWorkspaceGrantInput): Promise<void> {
    if (input.ownerUserId !== undefined) {
      const result = await database.query<{ org_id: string }>('SELECT org_id FROM users WHERE id = $1', [input.ownerUserId])
      if (result.rows[0]?.org_id !== input.orgId) throw new Error('enterprise workspace owner is outside organization or missing')
    }
    if (input.departmentId !== undefined) {
      const result = await database.query<{ org_id: string }>('SELECT org_id FROM departments WHERE id = $1', [input.departmentId])
      if (result.rows[0]?.org_id !== input.orgId) throw new Error('enterprise workspace department is outside organization or missing')
    }
  }

  /** Executes `PgEnterpriseIdentityRepository.workspaceGrant` for this instance.
   * @param workspaceId - Input value used by this API.
   * @returns Result produced by this API.
   */
  async workspaceGrant(workspaceId: string): Promise<EnterpriseWorkspaceGrant | undefined> {
    const result = await this.database.query<WorkspaceGrantRow>('SELECT * FROM enterprise_workspace_grants WHERE workspace_id = $1', [workspaceId])
    return result.rows[0] === undefined ? undefined : this.workspaceGrantFromRow(result.rows[0])
  }

  /** Executes `PgEnterpriseIdentityRepository.workspaceGrantByRootPath` for this instance.
   * @param rootPath - Input value used by this API.
   * @returns Result produced by this API.
   */
  async workspaceGrantByRootPath(rootPath: string): Promise<EnterpriseWorkspaceGrant | undefined> {
    const result = await this.database.query<WorkspaceGrantRow>(
      'SELECT * FROM enterprise_workspace_grants WHERE root_path = $1', [rootPath],
    )
    return result.rows[0] === undefined ? undefined : this.workspaceGrantFromRow(result.rows[0])
  }

  /** Executes `PgEnterpriseIdentityRepository.listWorkspaceGrants` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async listWorkspaceGrants(input: { orgId: string; userId: string }): Promise<EnterpriseWorkspaceGrant[]> {
    const result = await this.database.query<WorkspaceGrantRow>(`SELECT workspace.* FROM enterprise_workspace_grants workspace
      LEFT JOIN user_departments membership ON membership.department_id = workspace.department_id AND membership.user_id = $1
      WHERE workspace.org_id = $2 AND (workspace.owner_user_id = $1 OR membership.user_id IS NOT NULL)
      ORDER BY CASE workspace.kind WHEN 'personal' THEN 0 ELSE 1 END, workspace.name, workspace.workspace_id`,
    [input.userId, input.orgId])
    return result.rows.map(row => this.workspaceGrantFromRow(row))
  }

  /** Executes `PgEnterpriseIdentityRepository.listOrganizationWorkspaceGrants` for this instance.
   * @param orgId - Input value used by this API.
   * @returns Result produced by this API.
   */
  async listOrganizationWorkspaceGrants(orgId: string): Promise<EnterpriseWorkspaceGrant[]> {
    const result = await this.database.query<WorkspaceGrantRow>(`SELECT * FROM enterprise_workspace_grants WHERE org_id = $1
      ORDER BY kind, name, workspace_id`, [orgId])
    return result.rows.map(row => this.workspaceGrantFromRow(row))
  }

  private workspaceGrantFromRow(row: WorkspaceGrantRow): EnterpriseWorkspaceGrant {
    return {
      workspaceId: row.workspace_id, orgId: row.org_id, name: row.name, kind: row.kind,
      ...(row.owner_user_id === null ? {} : { ownerUserId: row.owner_user_id }),
      ...(row.department_id === null ? {} : { departmentId: row.department_id }),
      rootPath: row.root_path, sandboxMode: row.sandbox_mode, revision: Number(row.revision),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    }
  }

  /** Executes `PgEnterpriseIdentityRepository.bindSessionWorkspace` for this instance.
   * @param input - Input value used by this API.
   */
  async bindSessionWorkspace(input: {
    sessionId: string
    workspaceId: string
    orgId: string
    ownerUserId: string
  }): Promise<void> {
    await this.transaction(async (database) => {
      const grant = await database.query<{ org_id: string }>(
        'SELECT org_id FROM enterprise_workspace_grants WHERE workspace_id = $1', [input.workspaceId],
      )
      if (grant.rows[0]?.org_id !== input.orgId) {
        throw new Error('enterprise session workspace is outside organization or missing')
      }
      const owner = await database.query<{ org_id: string }>('SELECT org_id FROM users WHERE id = $1', [input.ownerUserId])
      if (owner.rows[0]?.org_id !== input.orgId) {
        throw new Error('enterprise session owner is outside organization or missing')
      }
      const existing = await database.query<{ workspace_id: string; org_id: string; owner_user_id: string | null }>(
        'SELECT workspace_id, org_id, owner_user_id FROM enterprise_session_workspaces WHERE session_id = $1 FOR UPDATE',
        [input.sessionId],
      )
      const row = existing.rows[0]
      if (row !== undefined) {
        if (row.workspace_id !== input.workspaceId || row.org_id !== input.orgId
          || row.owner_user_id !== input.ownerUserId) {
          throw new Error('enterprise session is already bound to another workspace or owner')
        }
        return
      }
      await database.query(
        `INSERT INTO enterprise_session_workspaces(session_id, workspace_id, org_id, owner_user_id)
          VALUES ($1, $2, $3, $4)`,
        [input.sessionId, input.workspaceId, input.orgId, input.ownerUserId],
      )
    })
  }

  /** Executes `PgEnterpriseIdentityRepository.sessionWorkspaceGrant` for this instance.
   * @param sessionId - Input value used by this API.
   * @returns Result produced by this API.
   */
  async sessionWorkspaceGrant(sessionId: string): Promise<EnterpriseWorkspaceGrant | undefined> {
    const result = await this.database.query<WorkspaceGrantRow>(`SELECT workspace.*
      FROM enterprise_session_workspaces binding
      JOIN enterprise_workspace_grants workspace ON workspace.workspace_id = binding.workspace_id
      WHERE binding.session_id = $1`, [sessionId])
    return result.rows[0] === undefined ? undefined : this.workspaceGrantFromRow(result.rows[0])
  }

  /** Executes `PgEnterpriseIdentityRepository.sessionOwnerUserId` for this instance.
   * @param sessionId - Input value used by this API.
   * @returns Result produced by this API.
   */
  async sessionOwnerUserId(sessionId: string): Promise<string | undefined> {
    const result = await this.database.query<{ owner_user_id: string | null }>(
      'SELECT owner_user_id FROM enterprise_session_workspaces WHERE session_id = $1', [sessionId],
    )
    return result.rows[0]?.owner_user_id ?? undefined
  }

  /** Executes `PgEnterpriseIdentityRepository.proposeMemory` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async proposeMemory(input: ProposeEnterpriseMemoryInput): Promise<EnterpriseMemoryEntry> {
    const summary = input.summary.trim()
    const inspection = inspectEnterpriseMemory(summary)
    if (!inspection.allowed) {
      throw new Error(`enterprise memory privacy check failed: ${inspection.findings.join(',')}`)
    }
    if (!input.id.trim() || !summary || !/^[a-f0-9]{64}$/u.test(input.sourceDigest)) {
      throw new Error('enterprise memory id, summary, and SHA-256 source digest are required')
    }
    if ((input.scope === 'organization' && input.departmentId !== undefined)
      || (input.scope === 'department' && input.departmentId === undefined)) {
      throw new Error('enterprise memory scope and department do not match')
    }
    if ((input.scope === 'project' && input.projectId === undefined)
      || (input.scope !== 'project' && input.projectId !== undefined)) {
      throw new Error('enterprise memory scope and project do not match')
    }
    return this.transaction(async (database) => {
      await this.assertMemoryReferences(database, input.orgId, input.createdBy, input.departmentId)
      const at = this.now()
      const result = await database.query<MemoryRow>(`INSERT INTO enterprise_memories(id, org_id, scope_type,
        department_id, project_id, kind, status, summary, source_digest, privacy_findings, created_by,
        reviewed_by, review_reason, revision, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, 'proposed', $7, $8, $9::jsonb, $10, NULL, NULL, 1, $11, $11) RETURNING *`,
      [input.id, input.orgId, input.scope, input.departmentId ?? null, input.projectId ?? null, input.kind,
        summary, input.sourceDigest, JSON.stringify(inspection.findings), input.createdBy, at])
      const row = result.rows[0]
      if (row === undefined) throw new Error('enterprise memory proposal returned no row')
      return this.memoryFromRow(row)
    })
  }

  /** Writes one approved memory straight into a private compartment, bypassing review. The row id
   * derives deterministically from the write tuple (`private-memory-<digest>`), so repeat and
   * concurrent duplicate writes converge on one row.
   * @param input - Input value used by this API.
   * @returns The stored memory; the existing row when this exact source was written before.
   */
  async writePrivateMemory(input: WritePrivateMemoryInput): Promise<EnterpriseMemoryEntry> {
    const { summary, findings, sourceDigest } = validatePrivateMemoryInput(input)
    return this.transaction(async (database) => {
      await this.assertMemoryReferences(database, input.orgId, input.createdBy)
      // The scope predicate keeps a hypothetical digest collision in a shared compartment from
      // satisfying a private write.
      const existing = await database.query<MemoryRow>(`SELECT * FROM enterprise_memories
        WHERE org_id = $1 AND source_digest = $2 AND scope_type IN ('agent', 'pair')`,
      [input.orgId, sourceDigest])
      const found = existing.rows[0]
      if (found !== undefined) return this.memoryFromRow(found)
      const at = this.now()
      const result = await database.query<MemoryRow>(`INSERT INTO enterprise_memories(id, org_id, scope_type,
        department_id, agent_employee_id, pair_user_id, project_id, kind, status, summary, source_digest,
        privacy_findings, importance, last_access_at, created_by, reviewed_by, review_reason, revision,
        created_at, updated_at)
        VALUES ($1, $2, $3, NULL, $4, $5, $6, $7, 'approved', $8, $9, $10::jsonb, 0, NULL, $11, NULL, NULL, 1, $12, $12)
        ON CONFLICT (id) DO NOTHING RETURNING *`,
      [`private-memory-${sourceDigest}`, input.orgId, input.scope, input.agentEmployeeId ?? null,
        input.pairUserId ?? null, input.projectId ?? null, input.kind, summary, sourceDigest,
        JSON.stringify(findings), input.createdBy, at])
      const row = result.rows[0]
      if (row !== undefined) return this.memoryFromRow(row)
      // A concurrent writer committed the same deterministic id between the lookup and the insert;
      // the unique-index wait guarantees its row is committed and visible to the re-select.
      const raced = await database.query<MemoryRow>(`SELECT * FROM enterprise_memories
        WHERE org_id = $1 AND source_digest = $2 AND scope_type IN ('agent', 'pair')`,
      [input.orgId, sourceDigest])
      const winner = raced.rows[0]
      if (winner === undefined) throw new Error('enterprise private memory write returned no row')
      return this.memoryFromRow(winner)
    })
  }

  /** Executes `PgEnterpriseIdentityRepository.reviewMemory` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async reviewMemory(input: ReviewEnterpriseMemoryInput): Promise<EnterpriseMemoryEntry> {
    if (!input.reason.trim()) throw new Error('enterprise memory review reason is required')
    return this.transaction(async (database) => {
      const result = await database.query<MemoryRow>(
        'SELECT * FROM enterprise_memories WHERE id = $1 FOR UPDATE', [input.id],
      )
      const current = result.rows[0]
      if (current === undefined || current.org_id !== input.orgId) {
        throw new Error('enterprise memory is outside organization or missing')
      }
      const actual = Number(current.revision)
      if (actual !== input.expectedRevision) {
        throw new Error(`enterprise memory revision conflict: expected ${input.expectedRevision}, actual ${actual}`)
      }
      if (current.status !== 'proposed' && input.decision !== 'retired') {
        throw new Error('enterprise memory is not pending review')
      }
      if (input.decision === 'retired' && current.status !== 'approved') {
        throw new Error('only approved enterprise memory can be retired')
      }
      await this.assertMemoryReferences(database, input.orgId, input.reviewedBy)
      const updated = await database.query<MemoryRow>(`UPDATE enterprise_memories SET status = $1,
        reviewed_by = $2, review_reason = $3, revision = revision + 1, updated_at = $4 WHERE id = $5 RETURNING *`,
      [input.decision, input.reviewedBy, input.reason.trim(), this.now(), input.id])
      const row = updated.rows[0]
      if (row === undefined) throw new Error('enterprise memory review returned no row')
      return this.memoryFromRow(row)
    })
  }

  /** Retires one approved memory for consolidation; see `EnterpriseIdentityStore.supersedeMemory`. */
  async supersedeMemory(oldId: string, newId: string, at: number): Promise<void> {
    if (oldId === newId) throw new Error('enterprise memory cannot supersede itself')
    await this.transaction(async (database) => {
      const current = await database.query<{ status: EnterpriseMemoryEntry['status'] }>(
        'SELECT status FROM enterprise_memories WHERE id = $1 FOR UPDATE', [oldId],
      )
      const row = current.rows[0]
      if (row === undefined) throw new Error('enterprise memory is missing')
      // A retired old row fails here too, so a second supersede of the same chain never rewrites it.
      if (row.status !== 'approved') throw new Error('enterprise memory supersede requires the approved status')
      const replacement = await database.query('SELECT id FROM enterprise_memories WHERE id = $1', [newId])
      if (replacement.rows[0] === undefined) throw new Error('superseding enterprise memory is missing')
      await database.query(`UPDATE enterprise_memories SET status = 'retired', invalidated_by = $1, updated_at = $2
        WHERE id = $3`, [newId, at, oldId])
    })
  }

  /** Applies one consolidation importance batch; see `EnterpriseIdentityStore.batchUpdateImportance`. */
  async batchUpdateImportance(updates: readonly MemoryImportanceUpdate[]): Promise<number> {
    validateMemoryImportanceUpdates(updates)
    if (updates.length === 0) return 0
    return this.transaction(async (database) => {
      let changed = 0
      for (const update of updates) {
        const result = await database.query(`UPDATE enterprise_memories
          SET importance = $1, last_access_at = COALESCE($2, last_access_at) WHERE id = $3`,
        [update.importance, update.lastAccessAt ?? null, update.id])
        changed += result.rowCount ?? 0
      }
      return changed
    })
  }

  /** Executes `PgEnterpriseIdentityRepository.listMemories` for this instance.
   * @param input - Input value used by this API.
   * @returns Result produced by this API.
   */
  async listMemories(input: {
    orgId: string
    departmentIds?: readonly string[]
    statuses?: readonly EnterpriseMemoryEntry['status'][]
    kinds?: readonly MemoryKind[]
    scopes?: readonly MemoryScope[]
    agentEmployeeId?: string
    pairUserId?: string
    projectId?: string
    staleBefore?: number
  }): Promise<EnterpriseMemoryEntry[]> {
    const plan = planMemoryListFilters(input)
    if (plan === undefined) return []
    const values: unknown[] = [input.orgId]
    let index = 2
    const scopeAlternatives: string[] = ["scope_type = 'organization'"]
    if (plan.scopes === undefined) {
      if (plan.departmentIds.length > 0) {
        scopeAlternatives.push(`department_id = ANY($${index}::text[])`)
        values.push([...plan.departmentIds])
        index += 1
      }
    } else {
      scopeAlternatives.length = 0
      scopeAlternatives.push(`scope_type = ANY($${index}::text[])`)
      values.push([...plan.scopes])
      index += 1
    }
    if (plan.includeAgentScope) scopeAlternatives.push("scope_type = 'agent'")
    if (plan.includePairScope) scopeAlternatives.push("scope_type = 'pair'")
    if (plan.includeProjectScope) scopeAlternatives.push("scope_type = 'project'")
    const scopeClause = scopeAlternatives.length === 1 ? scopeAlternatives[0] : `(${scopeAlternatives.join(' OR ')})`
    const ownerClauses: string[] = []
    if (input.agentEmployeeId !== undefined) {
      ownerClauses.push(`agent_employee_id = $${index}`)
      values.push(input.agentEmployeeId)
      index += 1
    }
    if (input.pairUserId !== undefined) {
      ownerClauses.push(`pair_user_id = $${index}`)
      values.push(input.pairUserId)
      index += 1
    }
    if (input.projectId !== undefined) {
      ownerClauses.push(`project_id = $${index}`)
      values.push(input.projectId)
      index += 1
    }
    const statusIndex = index
    values.push([...plan.statuses])
    index += 1
    const kindClause = plan.kinds === undefined ? '' : ` AND kind = ANY($${index}::text[])`
    if (plan.kinds !== undefined) {
      values.push([...plan.kinds])
      index += 1
    }
    // staleBefore keeps its own approved predicate: the consolidation clock only ever applies to
    // approved rows, and COALESCE lets a never-touched row age on its updated_at instead.
    const staleClause = input.staleBefore === undefined
      ? ''
      : ` AND status = 'approved' AND COALESCE(last_access_at, updated_at) < $${index}`
    if (input.staleBefore !== undefined) values.push(input.staleBefore)
    const result = await this.database.query<MemoryRow>(`SELECT * FROM enterprise_memories
      WHERE org_id = $1 AND ${scopeClause}
        AND status = ANY($${statusIndex}::text[])${kindClause}${ownerClauses.length === 0 ? '' : ` AND ${ownerClauses.join(' AND ')}`}${staleClause}
      ORDER BY updated_at DESC, id`, values)
    return result.rows.map(row => this.memoryFromRow(row))
  }

  /** Records the last access time on one memory.
   * @param id - Memory id whose access is recorded.
   * @param at - Access time in epoch milliseconds.
   */
  async touchMemoryAccess(id: string, at: number): Promise<void> {
    const result = await this.database.query(
      'UPDATE enterprise_memories SET last_access_at = $1 WHERE id = $2', [at, id],
    )
    if (result.rowCount === 0) throw new Error('enterprise memory is missing')
  }

  private async assertMemoryReferences(
    database: PostgresDatabase,
    orgId: string,
    userId: string,
    departmentId?: string,
  ): Promise<void> {
    const user = await database.query<{ org_id: string }>('SELECT org_id FROM users WHERE id = $1', [userId])
    if (user.rows[0]?.org_id !== orgId) throw new Error('enterprise memory user is outside organization or missing')
    if (departmentId !== undefined) {
      const department = await database.query<{ org_id: string }>(
        'SELECT org_id FROM departments WHERE id = $1', [departmentId],
      )
      if (department.rows[0]?.org_id !== orgId) {
        throw new Error('enterprise memory department is outside organization or missing')
      }
    }
  }

  /* jscpd:ignore-start */
  // The row mapping mirrors the SQLite store on purpose: both implementations keep the same
  // memory columns and semantics so the two stores stay interchangeable.
  private memoryFromRow(row: MemoryRow): EnterpriseMemoryEntry {
    return {
      id: row.id, orgId: row.org_id, scope: enumColumn(row, 'scope_type', MEMORY_SCOPES),
      ...(row.department_id === null ? {} : { departmentId: row.department_id }),
      ...(row.agent_employee_id === null ? {} : { agentEmployeeId: row.agent_employee_id }),
      ...(row.pair_user_id === null ? {} : { pairUserId: row.pair_user_id }),
      ...(row.project_id === null ? {} : { projectId: row.project_id }),
      kind: enumColumn(row, 'kind', MEMORY_KINDS),
      status: row.status, summary: row.summary, sourceDigest: row.source_digest,
      privacyFindings: safeStringArray(row.privacy_findings) as EnterpriseMemoryPrivacyFinding[],
      importance: row.importance === null ? 0 : Number(row.importance),
      ...(row.last_access_at === null ? {} : { lastAccessAt: Number(row.last_access_at) }),
      ...(row.valid_from === null ? {} : { validFrom: Number(row.valid_from) }),
      ...(row.invalidated_by === null ? {} : { invalidatedBy: row.invalidated_by }),
      createdBy: row.created_by,
      ...(row.reviewed_by === null ? {} : { reviewedBy: row.reviewed_by }),
      ...(row.review_reason === null ? {} : { reviewReason: row.review_reason }),
      revision: Number(row.revision), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
    }
  }
  /* jscpd:ignore-end */

  /** Executes `PgEnterpriseIdentityRepository.setPasswordVerifier` for this instance.
   * @param userId - Input value used by this API.
   * @param verifier - Input value used by this API.
   */
  async setPasswordVerifier(userId: string, verifier: string): Promise<void> {
    await this.database.query('UPDATE users SET password_verifier = $1 WHERE id = $2', [verifier, userId])
  }

  /** Executes `PgEnterpriseIdentityRepository.passwordLoginRecord` for this instance.
   * @param orgId - Input value used by this API.
   * @param username - Input value used by this API.
   * @returns Result produced by this API.
   */
  async passwordLoginRecord(orgId: string, username: string): Promise<{
    userId: string
    disabled: boolean
    verifier: string
  } | undefined> {
    const result = await this.database.query<{
      id: string
      disabled: boolean
      password_verifier: string
    }>(
      `SELECT id, disabled, password_verifier FROM users
       WHERE org_id = $1 AND username = $2 AND password_verifier IS NOT NULL`,
      [orgId, username],
    )
    const row = result.rows[0]
    return row === undefined ? undefined : { userId: row.id, disabled: row.disabled, verifier: row.password_verifier }
  }

  /** Executes `PgEnterpriseIdentityRepository.bindExternalIdentity` for this instance.
   * @param binding - Input value used by this API.
   */
  async bindExternalIdentity(binding: ExternalIdentityBinding): Promise<void> {
    await this.database.query(
      'INSERT INTO external_identities(provider_id, subject, user_id) VALUES ($1, $2, $3)',
      [binding.providerId, binding.subject, binding.userId],
    )
  }

  /** Executes `PgEnterpriseIdentityRepository.resolveExternalIdentity` for this instance.
   * @param providerId - Input value used by this API.
   * @param subject - Input value used by this API.
   * @returns Result produced by this API.
   */
  async resolveExternalIdentity(providerId: string, subject: string): Promise<EnterpriseUserView | undefined> {
    const result = await this.database.query<{ user_id: string }>(
      'SELECT user_id FROM external_identities WHERE provider_id = $1 AND subject = $2', [providerId, subject],
    )
    return result.rows[0] === undefined ? undefined : this.user(result.rows[0].user_id)
  }

  /** Executes `PgEnterpriseIdentityRepository.createSession` for this instance.
   * @param input - Input value used by this API.
   */
  async createSession(input: { token: string; userId: string; expiresAt: number }): Promise<void> {
    const at = this.now()
    await this.database.query(
      `INSERT INTO auth_sessions(token_hash, user_id, created_at, expires_at, last_seen_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, NULL)`,
      [sessionTokenHash(input.token), input.userId, at, input.expiresAt, at],
    )
  }

  /** Executes `PgEnterpriseIdentityRepository.authenticateSession` for this instance.
   * @param token - Input value used by this API.
   * @returns Result produced by this API.
   */
  async authenticateSession(token: string): Promise<EnterprisePrincipalView | undefined> {
    const at = this.now()
    const tokenHash = sessionTokenHash(token)
    const result = await this.database.query<{
      id: string
      org_id: string
      username: string
      display_name: string
    }>(
      `SELECT u.id, u.org_id, u.username, u.display_name
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > $2 AND u.disabled = FALSE`,
      [tokenHash, at],
    )
    const row = result.rows[0]
    if (row === undefined) return undefined
    await this.database.query('UPDATE auth_sessions SET last_seen_at = $1 WHERE token_hash = $2', [at, tokenHash])
    return {
      actorType: 'human',
      userId: row.id, orgId: row.org_id, username: row.username,
      displayName: row.display_name, roles: await this.roles(row.id),
      ...await this.departmentsForUser(row.id),
    }
  }

  /** Executes `PgEnterpriseIdentityRepository.revokeSession` for this instance.
   * @param token - Input value used by this API.
   */
  async revokeSession(token: string): Promise<void> {
    await this.database.query(
      'UPDATE auth_sessions SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL',
      [this.now(), sessionTokenHash(token)],
    )
  }

  /** Executes `PgEnterpriseIdentityRepository.putResourcePolicy` for this instance.
   * @param policy - Input value used by this API.
   */
  async putResourcePolicy(policy: EnterpriseResourcePolicy): Promise<void> {
    await this.database.query(
      `INSERT INTO resource_policies(resource_type, resource_id, org_id, creator_user_id, visibility, allowed_user_ids)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT(resource_type, resource_id) DO UPDATE SET
         org_id = EXCLUDED.org_id, creator_user_id = EXCLUDED.creator_user_id,
         visibility = EXCLUDED.visibility, allowed_user_ids = EXCLUDED.allowed_user_ids`,
      [policy.resourceType, policy.resourceId, policy.orgId, policy.creatorUserId ?? null,
        policy.visibility, JSON.stringify([...policy.allowedUserIds].sort())],
    )
  }

  /** Executes `PgEnterpriseIdentityRepository.resourcePolicy` for this instance.
   * @param resourceId - Input value used by this API.
   * @param resourceType - Input value used by this API.
   * @returns Result produced by this API.
   */
  async resourcePolicy(resourceType: string, resourceId: string): Promise<EnterpriseResourcePolicy | undefined> {
    const result = await this.database.query<PolicyRow>(
      `SELECT resource_type, resource_id, org_id, creator_user_id, visibility, allowed_user_ids
       FROM resource_policies WHERE resource_type = $1 AND resource_id = $2`,
      [resourceType, resourceId],
    )
    return result.rows[0] === undefined ? undefined : this.policyFromRow(result.rows[0])
  }

  /** Executes `PgEnterpriseIdentityRepository.listResourcePolicies` for this instance.
   * @param orgId - Input value used by this API.
   * @returns Result produced by this API.
   */
  async listResourcePolicies(orgId: string): Promise<EnterpriseResourcePolicy[]> {
    const result = await this.database.query<PolicyRow>(
      `SELECT resource_type, resource_id, org_id, creator_user_id, visibility, allowed_user_ids
       FROM resource_policies WHERE org_id = $1 ORDER BY resource_type, resource_id`, [orgId],
    )
    return result.rows.map(row => this.policyFromRow(row))
  }

  private policyFromRow(row: PolicyRow): EnterpriseResourcePolicy {
    return {
      resourceType: row.resource_type, resourceId: row.resource_id, orgId: row.org_id,
      ...(row.creator_user_id === null ? {} : { creatorUserId: row.creator_user_id }),
      visibility: row.visibility, allowedUserIds: safeStringArray(row.allowed_user_ids),
    }
  }

  /** Executes `PgEnterpriseIdentityRepository.putManagedAsset` for this instance.
   * @param asset - Input value used by this API.
   */
  async putManagedAsset(asset: EnterpriseManagedAsset): Promise<void> {
    assertNoSecretFields(asset.config)
    await this.database.query(
      `INSERT INTO managed_assets(org_id, type, id, name, config_json) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT(org_id, type, id) DO UPDATE SET name = EXCLUDED.name, config_json = EXCLUDED.config_json`,
      [asset.orgId, asset.type, asset.id, asset.name, JSON.stringify(asset.config)],
    )
  }

  /** Executes `PgEnterpriseIdentityRepository.listManagedAssets` for this instance.
   * @param orgId - Input value used by this API.
   * @returns Result produced by this API.
   */
  async listManagedAssets(orgId: string): Promise<EnterpriseManagedAsset[]> {
    const result = await this.database.query<AssetRow>(
      'SELECT org_id, type, id, name, config_json FROM managed_assets WHERE org_id = $1 ORDER BY type, id', [orgId],
    )
    return result.rows.map(row => ({
      orgId: row.org_id, type: row.type, id: row.id, name: row.name, config: safeObject(row.config_json),
    }))
  }

  /** Executes `PgEnterpriseIdentityRepository.appendAudit` for this instance.
   * @param event - Input value used by this API.
   */
  async appendAudit(event: EnterpriseAuditRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_events(id, org_id, actor_user_id, action, resource_type, resource_id,
        decision, reason, correlation_id, created_at, details_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [event.id, event.orgId, event.actorUserId, event.action, event.resourceType, event.resourceId,
        event.decision, event.reason, event.correlationId, event.at, JSON.stringify(event.details)],
    )
  }

  /** Executes `PgEnterpriseIdentityRepository.listAudit` for this instance.
   * @param query - Input value used by this API.
   * @returns Result produced by this API.
   */
  async listAudit(query: AuditQuery): Promise<EnterpriseAuditRecord[]> {
    const clauses = ['org_id = $1']
    const values: unknown[] = [query.orgId]
    if (query.actorUserId !== undefined) {
      values.push(query.actorUserId)
      clauses.push(`actor_user_id = $${String(values.length)}`)
    }
    if (query.action !== undefined) {
      values.push(query.action)
      clauses.push(`action = $${String(values.length)}`)
    }
    values.push(query.limit)
    const result = await this.database.query<AuditRow>(
      `SELECT * FROM audit_events WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC, id DESC LIMIT $${String(values.length)}`,
      values,
    )
    return result.rows.map(row => ({
      id: row.id, orgId: row.org_id, actorUserId: row.actor_user_id, action: row.action,
      resourceType: row.resource_type, resourceId: row.resource_id, decision: row.decision,
      reason: row.reason, correlationId: row.correlation_id, at: Number(row.created_at),
      details: safeObject(row.details_json),
    }))
  }

  private async transaction<T>(operation: (database: PostgresDatabase) => Promise<T>): Promise<T> {
    const database = this.database.connect === undefined ? this.database : await this.database.connect()
    await database.query('BEGIN')
    try {
      const result = await operation(database)
      await database.query('COMMIT')
      return result
    } catch (error) {
      await database.query('ROLLBACK')
      throw error
    } finally {
      database.release?.()
    }
  }
}
