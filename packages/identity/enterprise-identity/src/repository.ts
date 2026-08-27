/** Durable enterprise identity and audit repository over node:sqlite. */

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type {
  EnterpriseAction, EnterpriseResource, EnterpriseRole,
} from '@deepseek-ai/dsh-enterprise-governance'
import { migrateEnterpriseIdentity } from './schema.ts'

export interface EnterpriseOrganization {
  readonly id: string
  readonly name: string
}

export interface EnterpriseUserInput {
  readonly id: string
  readonly orgId: string
  readonly username: string
  readonly displayName: string
  readonly disabled: boolean
}

export interface EnterpriseUserView extends EnterpriseUserInput {
  readonly roles: readonly EnterpriseRole[]
}

export interface EnterprisePrincipalView {
  readonly userId: string
  readonly orgId: string
  readonly username: string
  readonly displayName: string
  readonly roles: readonly EnterpriseRole[]
}

export interface ExternalIdentityBinding {
  readonly providerId: string
  readonly subject: string
  readonly userId: string
}

export interface EnterpriseResourcePolicy extends EnterpriseResource {
  readonly resourceType: string
  readonly resourceId: string
  readonly allowedUserIds: readonly string[]
}

export interface EnterpriseManagedAsset {
  readonly orgId: string
  readonly type: 'channel' | 'model' | 'capability'
  readonly id: string
  readonly name: string
  readonly config: Readonly<Record<string, unknown>>
}

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

export interface AuditQuery {
  readonly orgId: string
  readonly actorUserId?: string
  readonly action?: EnterpriseAction
  readonly limit: number
}

export interface RepositoryOptions {
  readonly now?: () => number
}

/**
 * Persistence surface consumed by the synchronous authentication and governance
 * services. Implementations may be backed by SQLite, an in-process cache, or an
 * adapter owned by the deployment; callers must not depend on SQLite internals.
 */
export type IdentityAwaitable<T> = T | Promise<T>
export interface EnterpriseIdentityStore {
  close(): IdentityAwaitable<void>
  createOrganization(organization: EnterpriseOrganization): IdentityAwaitable<void>
  listOrganizations(): IdentityAwaitable<EnterpriseOrganization[]>
  createUser(user: EnterpriseUserInput): IdentityAwaitable<void>
  listUsers(orgId: string): IdentityAwaitable<EnterpriseUserView[]>
  findUser(orgId: string, username: string): IdentityAwaitable<EnterpriseUserView | undefined>
  setRoles(userId: string, roles: readonly EnterpriseRole[]): IdentityAwaitable<void>
  setUserDisabled(userId: string, disabled: boolean): IdentityAwaitable<void>
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

/** One-way bearer-token representation stored in the database. */
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

  createUser(user: EnterpriseUserInput): void {
    this.database.prepare(
      'INSERT INTO users(id, org_id, username, display_name, disabled) VALUES (?, ?, ?, ?, ?)',
    ).run(user.id, user.orgId, user.username, user.displayName, user.disabled ? 1 : 0)
  }

  listUsers(orgId: string): EnterpriseUserView[] {
    const users = this.database.prepare(
      'SELECT id, org_id, username, display_name, disabled FROM users WHERE org_id = ? ORDER BY username, id',
    ).all(orgId) as Array<{
      id: string
      org_id: string
      username: string
      display_name: string
      disabled: number
    }>
    return users.map(user => ({
      id: user.id,
      orgId: user.org_id,
      username: user.username,
      displayName: user.display_name,
      disabled: user.disabled === 1,
      roles: this.roles(user.id),
    }))
  }

  findUser(orgId: string, username: string): EnterpriseUserView | undefined {
    return this.listUsers(orgId).find(user => user.username === username)
  }

  private user(userId: string): EnterpriseUserView | undefined {
    const row = this.database.prepare(
      'SELECT id, org_id, username, display_name, disabled FROM users WHERE id = ?',
    ).get(userId) as {
      id: string
      org_id: string
      username: string
      display_name: string
      disabled: number
    } | undefined
    return row === undefined ? undefined : {
      id: row.id, orgId: row.org_id, username: row.username, displayName: row.display_name,
      disabled: row.disabled === 1, roles: this.roles(row.id),
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
      userId: row.id, orgId: row.org_id, username: row.username,
      displayName: row.display_name, roles: this.roles(row.id),
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
