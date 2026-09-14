/** Durable enterprise identity and audit repository over node:sqlite. */

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  EnterpriseAction, EnterpriseResource, EnterpriseRole,
} from '@deepseek-ai/dsh-enterprise-governance'
import { inspectEnterpriseMemory, type EnterpriseMemoryPrivacyFinding } from './memory-policy.ts'
import { migrateEnterpriseIdentity } from './schema.ts'

/** Data used by `EnterpriseOrganization`. */
export interface EnterpriseOrganization {
  readonly id: string
  readonly name: string
}

/** Data used by `EnterpriseUserInput`. */
export interface EnterpriseUserInput {
  readonly id: string
  readonly orgId: string
  readonly username: string
  readonly displayName: string
  readonly disabled: boolean
}

/** Data used by `EnterpriseUserView`. */
export interface EnterpriseUserView extends EnterpriseUserInput {
  readonly roles: readonly EnterpriseRole[]
  readonly departmentIds: readonly string[]
  readonly primaryDepartmentId?: string
  readonly departmentRevision: number
}

/** Data used by `CreateEnterpriseUserOptions`. */
export interface CreateEnterpriseUserOptions {
  /** One-way verifier only; plaintext passwords never cross the repository seam. */
  readonly passwordVerifier?: string
}

/** Data used by `UpdateEnterpriseUserProfileInput`. */
export interface UpdateEnterpriseUserProfileInput {
  readonly orgId: string
  readonly userId: string
  readonly username: string
  readonly displayName: string
  /** Omit to preserve the current verifier. */
  readonly passwordVerifier?: string
}

/** Data used by `EnterpriseDepartment`. */
export interface EnterpriseDepartment {
  readonly id: string
  readonly orgId: string
  readonly parentId: string | null
  readonly name: string
  readonly sortOrder: number
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** Data used by `SaveEnterpriseDepartmentInput`. */
export interface SaveEnterpriseDepartmentInput {
  readonly id: string
  readonly orgId: string
  readonly parentId: string | null
  readonly name: string
  readonly sortOrder: number
  readonly expectedRevision: number
}

/** Data used by `SetUserDepartmentsInput`. */
export interface SetUserDepartmentsInput {
  readonly orgId: string
  readonly userId: string
  readonly departmentIds: readonly string[]
  readonly primaryDepartmentId?: string
  readonly expectedRevision: number
}

/** Data used by `EnterpriseWorkspaceGrant`. */
export interface EnterpriseWorkspaceGrant {
  readonly workspaceId: string
  readonly orgId: string
  readonly name: string
  readonly kind: 'personal' | 'department'
  readonly ownerUserId?: string
  readonly departmentId?: string
  readonly rootPath: string
  readonly sandboxMode: 'read-only' | 'workspace-write'
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** Data used by `SaveEnterpriseWorkspaceGrantInput`. */
export interface SaveEnterpriseWorkspaceGrantInput extends Omit<EnterpriseWorkspaceGrant, 'revision' | 'createdAt' | 'updatedAt'> {
  readonly expectedRevision: number
}

/** Data used by `EnterpriseMemoryEntry`. */
export interface EnterpriseMemoryEntry {
  readonly id: string
  readonly orgId: string
  readonly scope: 'organization' | 'department'
  readonly departmentId?: string
  readonly kind: 'business-fact' | 'process' | 'terminology' | 'decision'
  readonly status: 'proposed' | 'approved' | 'rejected' | 'retired'
  readonly summary: string
  readonly sourceDigest: string
  readonly privacyFindings: readonly EnterpriseMemoryPrivacyFinding[]
  readonly createdBy: string
  readonly reviewedBy?: string
  readonly reviewReason?: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** Data used by `ProposeEnterpriseMemoryInput`. */
export interface ProposeEnterpriseMemoryInput {
  readonly id: string
  readonly orgId: string
  readonly scope: EnterpriseMemoryEntry['scope']
  readonly departmentId?: string
  readonly kind: EnterpriseMemoryEntry['kind']
  readonly summary: string
  readonly sourceDigest: string
  readonly createdBy: string
}

/** Data used by `ReviewEnterpriseMemoryInput`. */
export interface ReviewEnterpriseMemoryInput {
  readonly id: string
  readonly orgId: string
  readonly decision: 'approved' | 'rejected' | 'retired'
  readonly reviewedBy: string
  readonly reason: string
  readonly expectedRevision: number
}

/** Data used by `EnterprisePrincipalView`. */
export interface EnterprisePrincipalView {
  readonly actorType: 'human'
  readonly userId: string
  readonly orgId: string
  readonly username: string
  readonly displayName: string
  readonly roles: readonly EnterpriseRole[]
  readonly departmentIds: readonly string[]
  readonly primaryDepartmentId?: string
}

/** Data used by `ExternalIdentityBinding`. */
export interface ExternalIdentityBinding {
  readonly providerId: string
  readonly subject: string
  readonly userId: string
}

/** Data used by `EnterpriseResourcePolicy`. */
export interface EnterpriseResourcePolicy extends EnterpriseResource {
  readonly resourceType: string
  readonly resourceId: string
  readonly allowedUserIds: readonly string[]
}

/** Data used by `EnterpriseManagedAsset`. */
export interface EnterpriseManagedAsset {
  readonly orgId: string
  readonly type: 'channel' | 'model' | 'capability'
  readonly id: string
  readonly name: string
  readonly config: Readonly<Record<string, unknown>>
}

/** Data used by `EnterpriseAuditRecord`. */
export interface EnterpriseAuditRecord {
  readonly id: string
  readonly orgId: string
  readonly actorUserId: string
  readonly action: EnterpriseAction
  readonly resourceType: string
  readonly resourceId: string
  readonly decision: 'allowed' | 'denied'
  readonly reason: string
  readonly correlationId: string
  readonly at: number
  readonly details: Readonly<Record<string, unknown>>
}

/** Data used by `AuditQuery`. */
export interface AuditQuery {
  readonly orgId: string
  readonly actorUserId?: string
  readonly action?: EnterpriseAction
  readonly limit: number
}

/** Data used by `RepositoryOptions`. */
export interface RepositoryOptions {
  readonly now?: () => number
}

interface SqliteDepartmentRow {
  id: string
  org_id: string
  parent_id: string | null
  name: string
  sort_order: number
  revision: number
  created_at: number
  updated_at: number
}

interface SqliteWorkspaceGrantRow {
  workspace_id: string
  org_id: string
  name: string
  kind: 'personal' | 'department'
  owner_user_id: string | null
  department_id: string | null
  root_path: string
  sandbox_mode: 'read-only' | 'workspace-write'
  revision: number
  created_at: number
  updated_at: number
}

interface SqliteMemoryRow {
  id: string
  org_id: string
  scope_type: 'organization' | 'department'
  department_id: string | null
  kind: EnterpriseMemoryEntry['kind']
  status: EnterpriseMemoryEntry['status']
  summary: string
  source_digest: string
  privacy_findings: string
  created_by: string
  reviewed_by: string | null
  review_reason: string | null
  revision: number
  created_at: number
  updated_at: number
}

/**
 * Persistence surface consumed by the synchronous authentication and governance
 * services. Implementations may be backed by SQLite, an in-process cache, or an
 * adapter owned by the deployment; callers must not depend on SQLite internals.
 */
export type IdentityAwaitable<T> = T | Promise<T>
/** Data used by `EnterpriseIdentityStore`. */
export interface EnterpriseIdentityStore {
  close(): IdentityAwaitable<void>
  createOrganization(organization: EnterpriseOrganization): IdentityAwaitable<void>
  listOrganizations(): IdentityAwaitable<EnterpriseOrganization[]>
  createUser(user: EnterpriseUserInput, options?: CreateEnterpriseUserOptions): IdentityAwaitable<void>
  listUsers(orgId: string): IdentityAwaitable<EnterpriseUserView[]>
  findUser(orgId: string, username: string): IdentityAwaitable<EnterpriseUserView | undefined>
  updateUserProfile(input: UpdateEnterpriseUserProfileInput): IdentityAwaitable<void>
  setRoles(userId: string, roles: readonly EnterpriseRole[]): IdentityAwaitable<void>
  setUserDisabled(userId: string, disabled: boolean): IdentityAwaitable<void>
  saveDepartment(input: SaveEnterpriseDepartmentInput): IdentityAwaitable<EnterpriseDepartment>
  listDepartments(orgId: string): IdentityAwaitable<EnterpriseDepartment[]>
  setUserDepartments(input: SetUserDepartmentsInput): IdentityAwaitable<EnterpriseUserView>
  saveWorkspaceGrant(input: SaveEnterpriseWorkspaceGrantInput): IdentityAwaitable<EnterpriseWorkspaceGrant>
  workspaceGrant(workspaceId: string): IdentityAwaitable<EnterpriseWorkspaceGrant | undefined>
  workspaceGrantByRootPath(rootPath: string): IdentityAwaitable<EnterpriseWorkspaceGrant | undefined>
  listWorkspaceGrants(input: { orgId: string; userId: string }): IdentityAwaitable<EnterpriseWorkspaceGrant[]>
  listOrganizationWorkspaceGrants(orgId: string): IdentityAwaitable<EnterpriseWorkspaceGrant[]>
  bindSessionWorkspace(input: {
    sessionId: string
    workspaceId: string
    orgId: string
    ownerUserId: string
  }): IdentityAwaitable<void>
  sessionWorkspaceGrant(sessionId: string): IdentityAwaitable<EnterpriseWorkspaceGrant | undefined>
  sessionOwnerUserId(sessionId: string): IdentityAwaitable<string | undefined>
  proposeMemory(input: ProposeEnterpriseMemoryInput): IdentityAwaitable<EnterpriseMemoryEntry>
  reviewMemory(input: ReviewEnterpriseMemoryInput): IdentityAwaitable<EnterpriseMemoryEntry>
  listMemories(input: {
    orgId: string
    departmentIds?: readonly string[]
    statuses?: readonly EnterpriseMemoryEntry['status'][]
  }): IdentityAwaitable<EnterpriseMemoryEntry[]>
  setPasswordVerifier(userId: string, verifier: string): IdentityAwaitable<void>
  passwordLoginRecord(orgId: string, username: string): IdentityAwaitable<{
    userId: string
    disabled: boolean
    verifier: string
  } | undefined>
  bindExternalIdentity(binding: ExternalIdentityBinding): IdentityAwaitable<void>
  resolveExternalIdentity(providerId: string, subject: string): IdentityAwaitable<EnterpriseUserView | undefined>
  createSession(input: { token: string; userId: string; expiresAt: number }): IdentityAwaitable<void>
  authenticateSession(token: string): IdentityAwaitable<EnterprisePrincipalView | undefined>
  revokeSession(token: string): IdentityAwaitable<void>
  putResourcePolicy(policy: EnterpriseResourcePolicy): IdentityAwaitable<void>
  resourcePolicy(resourceType: string, resourceId: string): IdentityAwaitable<EnterpriseResourcePolicy | undefined>
  listResourcePolicies(orgId: string): IdentityAwaitable<EnterpriseResourcePolicy[]>
  putManagedAsset(asset: EnterpriseManagedAsset): IdentityAwaitable<void>
  listManagedAssets(orgId: string): IdentityAwaitable<EnterpriseManagedAsset[]>
  appendAudit(event: EnterpriseAuditRecord): IdentityAwaitable<void>
  listAudit(query: AuditQuery): IdentityAwaitable<EnterpriseAuditRecord[]>
}

/** One-way bearer-token representation stored in the database.
 * @param token - Input value used by this API.
 * @returns Result produced by this API.
 */
export function sessionTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function safeJsonArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error('enterprise identity database contains an invalid string array')
  }
  return parsed as string[]
}

function safeJsonObject(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('enterprise identity database contains invalid audit details')
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

/** SQLite-backed repository used by authentication, governance, and administration services. */
export class EnterpriseIdentityRepository implements EnterpriseIdentityStore {
  private readonly database: DatabaseSync
  private readonly now: () => number
  private closed = false

  constructor(filename: string, options: RepositoryOptions = {}) {
    mkdirSync(dirname(filename), { recursive: true })
    this.database = new DatabaseSync(filename)
    this.now = options.now ?? Date.now
    migrateEnterpriseIdentity(this.database)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.database.close()
  }

  createOrganization(organization: EnterpriseOrganization): void {
    this.database.prepare('INSERT INTO organizations(id, name) VALUES (?, ?)')
      .run(organization.id, organization.name)
  }

  listOrganizations(): EnterpriseOrganization[] {
    return (this.database.prepare('SELECT id, name FROM organizations ORDER BY name, id').all() as Array<{
      id: string
      name: string
    }>).map(row => ({ id: row.id, name: row.name }))
  }

  createUser(user: EnterpriseUserInput, options: CreateEnterpriseUserOptions = {}): void {
    this.database.prepare(
      `INSERT INTO users(id, org_id, username, display_name, disabled, password_verifier)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(user.id, user.orgId, user.username, user.displayName, user.disabled ? 1 : 0, options.passwordVerifier ?? null)
  }

  listUsers(orgId: string): EnterpriseUserView[] {
    const users = this.database.prepare(
      'SELECT id, org_id, username, display_name, disabled, department_revision FROM users WHERE org_id = ? ORDER BY username, id',
    ).all(orgId) as Array<{
      id: string
      org_id: string
      username: string
      display_name: string
      disabled: number
      department_revision: number
    }>
    return users.map(user => ({
      id: user.id,
      orgId: user.org_id,
      username: user.username,
      displayName: user.display_name,
      disabled: user.disabled === 1,
      roles: this.roles(user.id),
      ...this.departmentsForUser(user.id),
      departmentRevision: user.department_revision,
    }))
  }

  findUser(orgId: string, username: string): EnterpriseUserView | undefined {
    return this.listUsers(orgId).find(user => user.username === username)
  }

  updateUserProfile(input: UpdateEnterpriseUserProfileInput): void {
    const username = input.username.trim()
    const displayName = input.displayName.trim()
    if (username === '' || displayName === '') throw new Error('enterprise username and display name are required')
    const verifier = input.passwordVerifier ?? null
    const result = this.database.prepare(`UPDATE users SET username = ?, display_name = ?,
      password_verifier = CASE WHEN ? IS NULL THEN password_verifier ELSE ? END
      WHERE id = ? AND org_id = ?`).run(
      username, displayName, verifier, verifier, input.userId, input.orgId,
    )
    if (result.changes !== 1) throw new Error('enterprise user is outside organization or missing')
  }

  private user(userId: string): EnterpriseUserView | undefined {
    const row = this.database.prepare(
      'SELECT id, org_id, username, display_name, disabled, department_revision FROM users WHERE id = ?',
    ).get(userId) as {
      id: string
      org_id: string
      username: string
      display_name: string
      disabled: number
      department_revision: number
    } | undefined
    return row === undefined ? undefined : {
      id: row.id, orgId: row.org_id, username: row.username, displayName: row.display_name,
      disabled: row.disabled === 1, roles: this.roles(row.id),
      ...this.departmentsForUser(row.id), departmentRevision: row.department_revision,
    }
  }

  private departmentsForUser(userId: string): { departmentIds: string[]; primaryDepartmentId?: string } {
    const rows = this.database.prepare(
      'SELECT department_id, is_primary FROM user_departments WHERE user_id = ? ORDER BY department_id',
    ).all(userId) as Array<{ department_id: string; is_primary: number }>
    const primary = rows.find(row => row.is_primary === 1)?.department_id
    return {
      departmentIds: rows.map(row => row.department_id),
      ...(primary === undefined ? {} : { primaryDepartmentId: primary }),
    }
  }

  private roles(userId: string): EnterpriseRole[] {
    return (this.database.prepare('SELECT role FROM user_roles WHERE user_id = ? ORDER BY role').all(userId) as Array<{
      role: EnterpriseRole
    }>).map(row => row.role)
  }

  setRoles(userId: string, roles: readonly EnterpriseRole[]): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('DELETE FROM user_roles WHERE user_id = ?').run(userId)
      const insert = this.database.prepare('INSERT INTO user_roles(user_id, role) VALUES (?, ?)')
      for (const role of [...new Set(roles)]) insert.run(userId, role)
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  setUserDisabled(userId: string, disabled: boolean): void {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, userId)
      if (disabled) {
        this.database.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
          .run(this.now(), userId)
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  saveDepartment(input: SaveEnterpriseDepartmentInput): EnterpriseDepartment {
    if (!input.id.trim() || !input.name.trim() || !Number.isSafeInteger(input.sortOrder)) {
      throw new Error('enterprise department id, name, and integer sort order are required')
    }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const current = this.database.prepare('SELECT org_id, revision FROM departments WHERE id = ?')
        .get(input.id) as { org_id: string; revision: number } | undefined
      const actual = current?.revision ?? 0
      if (current !== undefined && current.org_id !== input.orgId) throw new Error('enterprise department is outside organization')
      if (actual !== input.expectedRevision) throw new Error(`enterprise department revision conflict: expected ${input.expectedRevision}, actual ${actual}`)
      this.assertDepartmentParent(input.orgId, input.id, input.parentId)
      const at = this.now()
      if (current === undefined) {
        this.database.prepare(`INSERT INTO departments(id, org_id, parent_id, name, sort_order, revision, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?)`).run(input.id, input.orgId, input.parentId, input.name.trim(), input.sortOrder, at, at)
      } else {
        this.database.prepare(`UPDATE departments SET parent_id = ?, name = ?, sort_order = ?, revision = revision + 1,
          updated_at = ? WHERE id = ?`).run(input.parentId, input.name.trim(), input.sortOrder, at, input.id)
      }
      const value = this.department(input.id)
      this.database.exec('COMMIT')
      if (value === undefined) throw new Error('enterprise department write returned no row')
      return value
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private assertDepartmentParent(orgId: string, departmentId: string, parentId: string | null): void {
    let cursor = parentId
    const seen = new Set<string>()
    while (cursor !== null) {
      if (cursor === departmentId || seen.has(cursor)) throw new Error('enterprise department tree cycle detected')
      seen.add(cursor)
      const row = this.database.prepare('SELECT org_id, parent_id FROM departments WHERE id = ?')
        .get(cursor) as { org_id: string; parent_id: string | null } | undefined
      if (row === undefined || row.org_id !== orgId) throw new Error('enterprise department parent is outside organization or missing')
      cursor = row.parent_id
    }
  }

  private department(id: string): EnterpriseDepartment | undefined {
    const row = this.database.prepare('SELECT * FROM departments WHERE id = ?').get(id) as
      | SqliteDepartmentRow
      | undefined
    return row === undefined ? undefined : {
      id: row.id, orgId: row.org_id, parentId: row.parent_id, name: row.name, sortOrder: row.sort_order,
      revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    }
  }

  listDepartments(orgId: string): EnterpriseDepartment[] {
    return (this.database.prepare(`SELECT * FROM departments WHERE org_id = ?
      ORDER BY parent_id IS NOT NULL, parent_id, sort_order, name, id`).all(orgId) as unknown as SqliteDepartmentRow[]).map(row => ({
      id: row.id, orgId: row.org_id, parentId: row.parent_id, name: row.name, sortOrder: row.sort_order,
      revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    }))
  }

  setUserDepartments(input: SetUserDepartmentsInput): EnterpriseUserView {
    const departmentIds = [...new Set(input.departmentIds)].sort()
    if (input.primaryDepartmentId !== undefined && !departmentIds.includes(input.primaryDepartmentId)) {
      throw new Error('primary enterprise department must be included in departmentIds')
    }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const user = this.database.prepare('SELECT org_id, department_revision FROM users WHERE id = ?').get(input.userId) as
        | { org_id: string; department_revision: number }
        | undefined
      if (user === undefined || user.org_id !== input.orgId) throw new Error('enterprise user is outside organization or missing')
      if (user.department_revision !== input.expectedRevision) throw new Error(`enterprise user department revision conflict: expected ${input.expectedRevision}, actual ${user.department_revision}`)
      for (const departmentId of departmentIds) {
        const department = this.database.prepare('SELECT org_id FROM departments WHERE id = ?').get(departmentId) as { org_id: string } | undefined
        if (department === undefined || department.org_id !== input.orgId) throw new Error('enterprise user department is outside organization or missing')
      }
      this.database.prepare('DELETE FROM user_departments WHERE user_id = ?').run(input.userId)
      const insert = this.database.prepare('INSERT INTO user_departments(user_id, department_id, is_primary) VALUES (?, ?, ?)')
      for (const departmentId of departmentIds) insert.run(input.userId, departmentId, departmentId === input.primaryDepartmentId ? 1 : 0)
      this.database.prepare('UPDATE users SET department_revision = department_revision + 1 WHERE id = ?').run(input.userId)
      const value = this.user(input.userId)
      this.database.exec('COMMIT')
      if (value === undefined) throw new Error('enterprise user department update returned no user')
      return value
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  saveWorkspaceGrant(input: SaveEnterpriseWorkspaceGrantInput): EnterpriseWorkspaceGrant {
    this.assertWorkspaceGrantShape(input)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.assertWorkspaceGrantReferences(input)
      const current = this.database.prepare('SELECT org_id, revision FROM enterprise_workspace_grants WHERE workspace_id = ?')
        .get(input.workspaceId) as { org_id: string; revision: number } | undefined
      const actual = current?.revision ?? 0
      if (current !== undefined && current.org_id !== input.orgId) throw new Error('enterprise workspace is outside organization')
      if (actual !== input.expectedRevision) throw new Error(`enterprise workspace revision conflict: expected ${input.expectedRevision}, actual ${actual}`)
      const at = this.now()
      if (current === undefined) {
        this.database.prepare(`INSERT INTO enterprise_workspace_grants(workspace_id, org_id, name, kind, owner_user_id,
          department_id, root_path, sandbox_mode, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`)
          .run(input.workspaceId, input.orgId, input.name.trim(), input.kind, input.ownerUserId ?? null,
            input.departmentId ?? null, input.rootPath, input.sandboxMode, at, at)
      } else {
        this.database.prepare(`UPDATE enterprise_workspace_grants SET name = ?, kind = ?, owner_user_id = ?,
          department_id = ?, root_path = ?, sandbox_mode = ?, revision = revision + 1, updated_at = ? WHERE workspace_id = ?`)
          .run(input.name.trim(), input.kind, input.ownerUserId ?? null, input.departmentId ?? null,
            input.rootPath, input.sandboxMode, at, input.workspaceId)
      }
      const value = this.workspaceGrant(input.workspaceId)
      this.database.exec('COMMIT')
      if (value === undefined) throw new Error('enterprise workspace write returned no row')
      return value
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  private assertWorkspaceGrantShape(input: SaveEnterpriseWorkspaceGrantInput): void {
    if (!input.workspaceId.trim() || !input.name.trim() || !input.rootPath.trim()) throw new Error('enterprise workspace identity, name, and root path are required')
    if (input.kind === 'personal' && (input.ownerUserId === undefined || input.departmentId !== undefined)) {
      throw new Error('personal enterprise workspace requires one owner and no department')
    }
    if (input.kind === 'department' && (input.departmentId === undefined || input.ownerUserId !== undefined)) {
      throw new Error('department enterprise workspace requires one department and no owner')
    }
  }

  private assertWorkspaceGrantReferences(input: SaveEnterpriseWorkspaceGrantInput): void {
    if (input.ownerUserId !== undefined) {
      const user = this.database.prepare('SELECT org_id FROM users WHERE id = ?').get(input.ownerUserId) as { org_id: string } | undefined
      if (user === undefined || user.org_id !== input.orgId) throw new Error('enterprise workspace owner is outside organization or missing')
    }
    if (input.departmentId !== undefined) {
      const department = this.database.prepare('SELECT org_id FROM departments WHERE id = ?').get(input.departmentId) as { org_id: string } | undefined
      if (department === undefined || department.org_id !== input.orgId) throw new Error('enterprise workspace department is outside organization or missing')
    }
  }

  workspaceGrant(workspaceId: string): EnterpriseWorkspaceGrant | undefined {
    const row = this.database.prepare('SELECT * FROM enterprise_workspace_grants WHERE workspace_id = ?').get(workspaceId) as
      | SqliteWorkspaceGrantRow
      | undefined
    return row === undefined ? undefined : this.workspaceGrantFromRow(row)
  }

  workspaceGrantByRootPath(rootPath: string): EnterpriseWorkspaceGrant | undefined {
    const row = this.database.prepare('SELECT * FROM enterprise_workspace_grants WHERE root_path = ?')
      .get(rootPath) as SqliteWorkspaceGrantRow | undefined
    return row === undefined ? undefined : this.workspaceGrantFromRow(row)
  }

  listWorkspaceGrants(input: { orgId: string; userId: string }): EnterpriseWorkspaceGrant[] {
    const rows = this.database.prepare(`SELECT workspace.* FROM enterprise_workspace_grants workspace
      LEFT JOIN user_departments membership ON membership.department_id = workspace.department_id AND membership.user_id = ?
      WHERE workspace.org_id = ? AND (workspace.owner_user_id = ? OR membership.user_id IS NOT NULL)
      ORDER BY CASE workspace.kind WHEN 'personal' THEN 0 ELSE 1 END, workspace.name, workspace.workspace_id`)
      .all(input.userId, input.orgId, input.userId) as unknown as SqliteWorkspaceGrantRow[]
    return rows.map(row => this.workspaceGrantFromRow(row))
  }

  listOrganizationWorkspaceGrants(orgId: string): EnterpriseWorkspaceGrant[] {
    return (this.database.prepare(`SELECT * FROM enterprise_workspace_grants WHERE org_id = ?
      ORDER BY kind, name, workspace_id`).all(orgId) as unknown as SqliteWorkspaceGrantRow[])
      .map(row => this.workspaceGrantFromRow(row))
  }

  private workspaceGrantFromRow(row: SqliteWorkspaceGrantRow): EnterpriseWorkspaceGrant {
    return {
      workspaceId: row.workspace_id, orgId: row.org_id, name: row.name, kind: row.kind,
      ...(row.owner_user_id === null ? {} : { ownerUserId: row.owner_user_id }),
      ...(row.department_id === null ? {} : { departmentId: row.department_id }),
      rootPath: row.root_path, sandboxMode: row.sandbox_mode, revision: row.revision,
      createdAt: row.created_at, updatedAt: row.updated_at,
    }
  }

  bindSessionWorkspace(input: { sessionId: string; workspaceId: string; orgId: string; ownerUserId: string }): void {
    const grant = this.workspaceGrant(input.workspaceId)
    if (grant === undefined || grant.orgId !== input.orgId) {
      throw new Error('enterprise session workspace is outside organization or missing')
    }
    const owner = this.database.prepare('SELECT org_id FROM users WHERE id = ?').get(input.ownerUserId) as { org_id: string } | undefined
    if (owner?.org_id !== input.orgId) throw new Error('enterprise session owner is outside organization or missing')
    const existing = this.database.prepare(
      'SELECT workspace_id, org_id, owner_user_id FROM enterprise_session_workspaces WHERE session_id = ?',
    ).get(input.sessionId) as { workspace_id: string; org_id: string; owner_user_id: string | null } | undefined
    if (existing !== undefined) {
      if (existing.workspace_id !== input.workspaceId || existing.org_id !== input.orgId
        || existing.owner_user_id !== input.ownerUserId) {
        throw new Error('enterprise session is already bound to another workspace or owner')
      }
      return
    }
    this.database.prepare(
      'INSERT INTO enterprise_session_workspaces(session_id, workspace_id, org_id, owner_user_id) VALUES (?, ?, ?, ?)',
    ).run(input.sessionId, input.workspaceId, input.orgId, input.ownerUserId)
  }

  sessionWorkspaceGrant(sessionId: string): EnterpriseWorkspaceGrant | undefined {
    const row = this.database.prepare(`SELECT workspace.* FROM enterprise_session_workspaces binding
      JOIN enterprise_workspace_grants workspace ON workspace.workspace_id = binding.workspace_id
      WHERE binding.session_id = ?`).get(sessionId) as SqliteWorkspaceGrantRow | undefined
    return row === undefined ? undefined : this.workspaceGrantFromRow(row)
  }

  sessionOwnerUserId(sessionId: string): string | undefined {
    const row = this.database.prepare('SELECT owner_user_id FROM enterprise_session_workspaces WHERE session_id = ?')
      .get(sessionId) as { owner_user_id: string | null } | undefined
    return row?.owner_user_id ?? undefined
  }

  proposeMemory(input: ProposeEnterpriseMemoryInput): EnterpriseMemoryEntry {
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
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.assertMemoryReferences(input.orgId, input.createdBy, input.departmentId)
      const at = this.now()
      this.database.prepare(`INSERT INTO enterprise_memories(id, org_id, scope_type, department_id, kind, status,
        summary, source_digest, privacy_findings, created_by, reviewed_by, review_reason, revision, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?, ?, ?, NULL, NULL, 1, ?, ?)`)
        .run(input.id, input.orgId, input.scope, input.departmentId ?? null, input.kind, summary,
          input.sourceDigest, JSON.stringify(inspection.findings), input.createdBy, at, at)
      const value = this.memory(input.id)
      this.database.exec('COMMIT')
      if (value === undefined) throw new Error('enterprise memory proposal returned no row')
      return value
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  reviewMemory(input: ReviewEnterpriseMemoryInput): EnterpriseMemoryEntry {
    if (!input.reason.trim()) throw new Error('enterprise memory review reason is required')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const current = this.database.prepare(
        'SELECT org_id, status, revision FROM enterprise_memories WHERE id = ?',
      ).get(input.id) as {
        org_id: string
        status: EnterpriseMemoryEntry['status']
        revision: number
      } | undefined
      if (current === undefined || current.org_id !== input.orgId) {
        throw new Error('enterprise memory is outside organization or missing')
      }
      if (current.revision !== input.expectedRevision) {
        throw new Error(
          `enterprise memory revision conflict: expected ${input.expectedRevision}, actual ${current.revision}`,
        )
      }
      if (current.status !== 'proposed' && input.decision !== 'retired') {
        throw new Error('enterprise memory is not pending review')
      }
      if (input.decision === 'retired' && current.status !== 'approved') {
        throw new Error('only approved enterprise memory can be retired')
      }
      this.assertMemoryReferences(input.orgId, input.reviewedBy)
      this.database.prepare(`UPDATE enterprise_memories SET status = ?, reviewed_by = ?, review_reason = ?,
        revision = revision + 1, updated_at = ? WHERE id = ?`)
        .run(input.decision, input.reviewedBy, input.reason.trim(), this.now(), input.id)
      const value = this.memory(input.id)
      this.database.exec('COMMIT')
      if (value === undefined) throw new Error('enterprise memory review returned no row')
      return value
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  listMemories(input: {
    orgId: string
    departmentIds?: readonly string[]
    statuses?: readonly EnterpriseMemoryEntry['status'][]
  }): EnterpriseMemoryEntry[] {
    const departmentIds = [...new Set(input.departmentIds ?? [])]
    const statuses = [...new Set(input.statuses ?? ['proposed', 'approved', 'rejected', 'retired'])]
    if (statuses.length === 0) return []
    const statusSlots = statuses.map(() => '?').join(',')
    const departmentSlots = departmentIds.map(() => '?').join(',')
    const scope = departmentIds.length === 0
      ? "scope_type = 'organization'"
      : `(scope_type = 'organization' OR department_id IN (${departmentSlots}))`
    const rows = this.database.prepare(`SELECT * FROM enterprise_memories WHERE org_id = ? AND ${scope}
      AND status IN (${statusSlots}) ORDER BY updated_at DESC, id`)
      .all(input.orgId, ...departmentIds, ...statuses) as unknown as SqliteMemoryRow[]
    return rows.map(row => this.memoryFromRow(row))
  }

  private assertMemoryReferences(orgId: string, userId: string, departmentId?: string): void {
    const user = this.database.prepare('SELECT org_id FROM users WHERE id = ?').get(userId) as
      | { org_id: string }
      | undefined
    if (user?.org_id !== orgId) throw new Error('enterprise memory user is outside organization or missing')
    if (departmentId !== undefined) {
      const department = this.database.prepare('SELECT org_id FROM departments WHERE id = ?').get(departmentId) as
        | { org_id: string }
        | undefined
      if (department?.org_id !== orgId) {
        throw new Error('enterprise memory department is outside organization or missing')
      }
    }
  }

  private memory(id: string): EnterpriseMemoryEntry | undefined {
    const row = this.database.prepare('SELECT * FROM enterprise_memories WHERE id = ?').get(id) as
      | SqliteMemoryRow
      | undefined
    return row === undefined ? undefined : this.memoryFromRow(row)
  }

  private memoryFromRow(row: SqliteMemoryRow): EnterpriseMemoryEntry {
    return {
      id: row.id, orgId: row.org_id, scope: row.scope_type,
      ...(row.department_id === null ? {} : { departmentId: row.department_id }),
      kind: row.kind, status: row.status, summary: row.summary, sourceDigest: row.source_digest,
      privacyFindings: safeJsonArray(row.privacy_findings) as EnterpriseMemoryPrivacyFinding[],
      createdBy: row.created_by,
      ...(row.reviewed_by === null ? {} : { reviewedBy: row.reviewed_by }),
      ...(row.review_reason === null ? {} : { reviewReason: row.review_reason }),
      revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at,
    }
  }

  setPasswordVerifier(userId: string, verifier: string): void {
    this.database.prepare('UPDATE users SET password_verifier = ? WHERE id = ?').run(verifier, userId)
  }

  passwordLoginRecord(orgId: string, username: string): {
    userId: string
    disabled: boolean
    verifier: string
  } | undefined {
    const row = this.database.prepare(
      `SELECT id, disabled, password_verifier FROM users
       WHERE org_id = ? AND username = ? AND password_verifier IS NOT NULL`,
    ).get(orgId, username) as { id: string; disabled: number; password_verifier: string } | undefined
    return row === undefined ? undefined : {
      userId: row.id, disabled: row.disabled === 1, verifier: row.password_verifier,
    }
  }

  bindExternalIdentity(binding: ExternalIdentityBinding): void {
    this.database.prepare(
      'INSERT INTO external_identities(provider_id, subject, user_id) VALUES (?, ?, ?)',
    ).run(binding.providerId, binding.subject, binding.userId)
  }

  resolveExternalIdentity(providerId: string, subject: string): EnterpriseUserView | undefined {
    const row = this.database.prepare(
      'SELECT user_id FROM external_identities WHERE provider_id = ? AND subject = ?',
    ).get(providerId, subject) as { user_id: string } | undefined
    return row === undefined ? undefined : this.user(row.user_id)
  }

  createSession(input: { token: string; userId: string; expiresAt: number }): void {
    const at = this.now()
    this.database.prepare(
      `INSERT INTO auth_sessions(token_hash, user_id, created_at, expires_at, last_seen_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(sessionTokenHash(input.token), input.userId, at, input.expiresAt, at)
  }

  authenticateSession(token: string): EnterprisePrincipalView | undefined {
    const at = this.now()
    const row = this.database.prepare(
      `SELECT u.id, u.org_id, u.username, u.display_name
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.disabled = 0`,
    ).get(sessionTokenHash(token), at) as {
      id: string
      org_id: string
      username: string
      display_name: string
    } | undefined
    if (row === undefined) return undefined
    this.database.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?')
      .run(at, sessionTokenHash(token))
    return {
      actorType: 'human',
      userId: row.id, orgId: row.org_id, username: row.username,
      displayName: row.display_name, roles: this.roles(row.id),
      ...this.departmentsForUser(row.id),
    }
  }

  revokeSession(token: string): void {
    this.database.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
      .run(this.now(), sessionTokenHash(token))
  }

  putResourcePolicy(policy: EnterpriseResourcePolicy): void {
    this.database.prepare(
      `INSERT INTO resource_policies(
        resource_type, resource_id, org_id, creator_user_id, visibility, allowed_user_ids
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(resource_type, resource_id) DO UPDATE SET
        org_id = excluded.org_id,
        creator_user_id = excluded.creator_user_id,
        visibility = excluded.visibility,
        allowed_user_ids = excluded.allowed_user_ids`,
    ).run(
      policy.resourceType, policy.resourceId, policy.orgId, policy.creatorUserId ?? null,
      policy.visibility, JSON.stringify([...policy.allowedUserIds].sort()),
    )
  }

  resourcePolicy(resourceType: string, resourceId: string): EnterpriseResourcePolicy | undefined {
    const row = this.database.prepare(
      `SELECT resource_type, resource_id, org_id, creator_user_id, visibility, allowed_user_ids
       FROM resource_policies WHERE resource_type = ? AND resource_id = ?`,
    ).get(resourceType, resourceId) as {
      resource_type: string
      resource_id: string
      org_id: string
      creator_user_id: string | null
      visibility: EnterpriseResourcePolicy['visibility']
      allowed_user_ids: string
    } | undefined
    return row === undefined ? undefined : {
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      orgId: row.org_id,
      ...row.creator_user_id === null ? {} : { creatorUserId: row.creator_user_id },
      visibility: row.visibility,
      allowedUserIds: safeJsonArray(row.allowed_user_ids),
    }
  }

  listResourcePolicies(orgId: string): EnterpriseResourcePolicy[] {
    const rows = this.database.prepare(
      `SELECT resource_type, resource_id, org_id, creator_user_id, visibility, allowed_user_ids
       FROM resource_policies WHERE org_id = ? ORDER BY resource_type, resource_id`,
    ).all(orgId) as Array<{
      resource_type: string
      resource_id: string
      org_id: string
      creator_user_id: string | null
      visibility: EnterpriseResourcePolicy['visibility']
      allowed_user_ids: string
    }>
    return rows.map(row => ({
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      orgId: row.org_id,
      ...row.creator_user_id === null ? {} : { creatorUserId: row.creator_user_id },
      visibility: row.visibility,
      allowedUserIds: safeJsonArray(row.allowed_user_ids),
    }))
  }

  putManagedAsset(asset: EnterpriseManagedAsset): void {
    assertNoSecretFields(asset.config)
    this.database.prepare(
      `INSERT INTO managed_assets(org_id, type, id, name, config_json) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(org_id, type, id) DO UPDATE SET name = excluded.name, config_json = excluded.config_json`,
    ).run(asset.orgId, asset.type, asset.id, asset.name, JSON.stringify(asset.config))
  }

  listManagedAssets(orgId: string): EnterpriseManagedAsset[] {
    const rows = this.database.prepare(
      'SELECT org_id, type, id, name, config_json FROM managed_assets WHERE org_id = ? ORDER BY type, id',
    ).all(orgId) as Array<{
      org_id: string
      type: EnterpriseManagedAsset['type']
      id: string
      name: string
      config_json: string
    }>
    return rows.map(row => ({
      orgId: row.org_id,
      type: row.type,
      id: row.id,
      name: row.name,
      config: safeJsonObject(row.config_json),
    }))
  }

  appendAudit(event: EnterpriseAuditRecord): void {
    this.database.prepare(
      `INSERT INTO audit_events(
        id, org_id, actor_user_id, action, resource_type, resource_id,
        decision, reason, correlation_id, created_at, details_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id, event.orgId, event.actorUserId, event.action, event.resourceType, event.resourceId,
      event.decision, event.reason, event.correlationId, event.at, JSON.stringify(event.details),
    )
  }

  listAudit(query: AuditQuery): EnterpriseAuditRecord[] {
    const clauses = ['org_id = ?']
    const params: Array<string | number> = [query.orgId]
    if (query.actorUserId !== undefined) {
      clauses.push('actor_user_id = ?')
      params.push(query.actorUserId)
    }
    if (query.action !== undefined) {
      clauses.push('action = ?')
      params.push(query.action)
    }
    params.push(query.limit)
    const rows = this.database.prepare(
      `SELECT * FROM audit_events WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).all(...params) as Array<{
      id: string
      org_id: string
      actor_user_id: string
      action: EnterpriseAction
      resource_type: string
      resource_id: string
      decision: 'allowed' | 'denied'
      reason: string
      correlation_id: string
      created_at: number
      details_json: string
    }>
    return rows.map(row => ({
      id: row.id, orgId: row.org_id, actorUserId: row.actor_user_id, action: row.action,
      resourceType: row.resource_type, resourceId: row.resource_id, decision: row.decision,
      reason: row.reason, correlationId: row.correlation_id, at: row.created_at,
      details: safeJsonObject(row.details_json),
    }))
  }
}
