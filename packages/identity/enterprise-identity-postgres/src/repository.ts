/** Async PostgreSQL implementation of the enterprise identity repository contract. */

import type {
  AuditQuery,
  EnterpriseAuditRecord,
  EnterpriseManagedAsset,
  EnterpriseOrganization,
  EnterprisePrincipalView,
  EnterpriseResourcePolicy,
  EnterpriseUserInput,
  EnterpriseUserView,
  ExternalIdentityBinding,
  RepositoryOptions,
} from '@deepseek-ai/dsh-enterprise-identity'
import { sessionTokenHash } from '@deepseek-ai/dsh-enterprise-identity'
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

  async close(): Promise<void> {
    await this.database.end?.()
  }

  async createOrganization(organization: EnterpriseOrganization): Promise<void> {
    await this.database.query('INSERT INTO organizations(id, name) VALUES ($1, $2)', [organization.id, organization.name])
  }

  async listOrganizations(): Promise<EnterpriseOrganization[]> {
    const result = await this.database.query<{ id: string; name: string }>(
      'SELECT id, name FROM organizations ORDER BY name, id',
    )
    return result.rows.map(row => ({ id: row.id, name: row.name }))
  }

  async createUser(user: EnterpriseUserInput): Promise<void> {
    await this.database.query(
      'INSERT INTO users(id, org_id, username, display_name, disabled) VALUES ($1, $2, $3, $4, $5)',
      [user.id, user.orgId, user.username, user.displayName, user.disabled],
    )
  }

  async listUsers(orgId: string): Promise<EnterpriseUserView[]> {
    const users = await this.database.query<UserRow>(
      'SELECT id, org_id, username, display_name, disabled FROM users WHERE org_id = $1 ORDER BY username, id',
      [orgId],
    )
    return await Promise.all(users.rows.map(async row => ({
      id: row.id, orgId: row.org_id, username: row.username, displayName: row.display_name,
      disabled: row.disabled, roles: await this.roles(row.id),
    })))
  }

  async findUser(orgId: string, username: string): Promise<EnterpriseUserView | undefined> {
    const result = await this.database.query<UserRow>(
      'SELECT id, org_id, username, display_name, disabled FROM users WHERE org_id = $1 AND username = $2',
      [orgId, username],
    )
    return result.rows[0] === undefined ? undefined : this.userFromRow(result.rows[0])
  }

  private async userFromRow(row: UserRow): Promise<EnterpriseUserView> {
    return {
      id: row.id, orgId: row.org_id, username: row.username, displayName: row.display_name,
      disabled: row.disabled, roles: await this.roles(row.id),
    }
  }

  private async user(userId: string): Promise<EnterpriseUserView | undefined> {
    const result = await this.database.query<UserRow>(
      'SELECT id, org_id, username, display_name, disabled FROM users WHERE id = $1', [userId],
    )
    return result.rows[0] === undefined ? undefined : this.userFromRow(result.rows[0])
  }

  private async roles(userId: string): Promise<EnterpriseRole[]> {
    const result = await this.database.query<{ role: EnterpriseRole }>(
      'SELECT role FROM user_roles WHERE user_id = $1 ORDER BY role', [userId],
    )
    return result.rows.map(row => row.role)
  }

  async setRoles(userId: string, roles: readonly EnterpriseRole[]): Promise<void> {
    await this.transaction(async (database) => {
      await database.query('DELETE FROM user_roles WHERE user_id = $1', [userId])
      for (const role of [...new Set(roles)]) {
        await database.query('INSERT INTO user_roles(user_id, role) VALUES ($1, $2)', [userId, role])
      }
    })
  }

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

  async setPasswordVerifier(userId: string, verifier: string): Promise<void> {
    await this.database.query('UPDATE users SET password_verifier = $1 WHERE id = $2', [verifier, userId])
  }

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

  async bindExternalIdentity(binding: ExternalIdentityBinding): Promise<void> {
    await this.database.query(
      'INSERT INTO external_identities(provider_id, subject, user_id) VALUES ($1, $2, $3)',
      [binding.providerId, binding.subject, binding.userId],
    )
  }

  async resolveExternalIdentity(providerId: string, subject: string): Promise<EnterpriseUserView | undefined> {
    const result = await this.database.query<{ user_id: string }>(
      'SELECT user_id FROM external_identities WHERE provider_id = $1 AND subject = $2', [providerId, subject],
    )
    return result.rows[0] === undefined ? undefined : this.user(result.rows[0].user_id)
  }

  async createSession(input: { token: string; userId: string; expiresAt: number }): Promise<void> {
    const at = this.now()
    await this.database.query(
      `INSERT INTO auth_sessions(token_hash, user_id, created_at, expires_at, last_seen_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, NULL)`,
      [sessionTokenHash(input.token), input.userId, at, input.expiresAt, at],
    )
  }

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
      userId: row.id, orgId: row.org_id, username: row.username,
      displayName: row.display_name, roles: await this.roles(row.id),
    }
  }

  async revokeSession(token: string): Promise<void> {
    await this.database.query(
      'UPDATE auth_sessions SET revoked_at = $1 WHERE token_hash = $2 AND revoked_at IS NULL',
      [this.now(), sessionTokenHash(token)],
    )
  }

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

  async resourcePolicy(resourceType: string, resourceId: string): Promise<EnterpriseResourcePolicy | undefined> {
    const result = await this.database.query<PolicyRow>(
      `SELECT resource_type, resource_id, org_id, creator_user_id, visibility, allowed_user_ids
       FROM resource_policies WHERE resource_type = $1 AND resource_id = $2`,
      [resourceType, resourceId],
    )
    return result.rows[0] === undefined ? undefined : this.policyFromRow(result.rows[0])
  }

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

  async putManagedAsset(asset: EnterpriseManagedAsset): Promise<void> {
    assertNoSecretFields(asset.config)
    await this.database.query(
      `INSERT INTO managed_assets(org_id, type, id, name, config_json) VALUES ($1, $2, $3, $4, $5::jsonb)
       ON CONFLICT(org_id, type, id) DO UPDATE SET name = EXCLUDED.name, config_json = EXCLUDED.config_json`,
      [asset.orgId, asset.type, asset.id, asset.name, JSON.stringify(asset.config)],
    )
  }

  async listManagedAssets(orgId: string): Promise<EnterpriseManagedAsset[]> {
    const result = await this.database.query<AssetRow>(
      'SELECT org_id, type, id, name, config_json FROM managed_assets WHERE org_id = $1 ORDER BY type, id', [orgId],
    )
    return result.rows.map(row => ({
      orgId: row.org_id, type: row.type, id: row.id, name: row.name, config: safeObject(row.config_json),
    }))
  }

  async appendAudit(event: EnterpriseAuditRecord): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_events(id, org_id, actor_user_id, action, resource_type, resource_id,
        decision, reason, correlation_id, created_at, details_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [event.id, event.orgId, event.actorUserId, event.action, event.resourceType, event.resourceId,
        event.decision, event.reason, event.correlationId, event.at, JSON.stringify(event.details)],
    )
  }

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
