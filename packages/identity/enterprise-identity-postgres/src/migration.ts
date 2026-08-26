/** One-shot, transaction-safe SQLite to PostgreSQL identity migration. */

import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { migrateEnterpriseIdentityPostgres } from './schema.ts'
import type { PostgresDatabase } from './types.ts'

type TableName =
  | 'organizations'
  | 'users'
  | 'userRoles'
  | 'externalIdentities'
  | 'authSessions'
  | 'resourcePolicies'
  | 'managedAssets'
  | 'auditEvents'

type MigrationRow = Record<string, unknown>

export interface MigrationTableSummary {
  readonly count: number
  readonly checksum: string
}

export type EnterpriseIdentityMigrationSummary = Readonly<Record<TableName, MigrationTableSummary>>

export interface EnterpriseIdentityMigrationReport {
  readonly dryRun: boolean
  readonly source: EnterpriseIdentityMigrationSummary
  readonly destination: EnterpriseIdentityMigrationSummary | undefined
}

export interface SqliteToPostgresMigrationOptions {
  readonly sqliteFilename: string
  readonly target: PostgresDatabase
  readonly dryRun?: boolean
}

interface MigrationSnapshot {
  readonly organizations: readonly MigrationRow[]
  readonly users: readonly MigrationRow[]
  readonly userRoles: readonly MigrationRow[]
  readonly externalIdentities: readonly MigrationRow[]
  readonly authSessions: readonly MigrationRow[]
  readonly resourcePolicies: readonly MigrationRow[]
  readonly managedAssets: readonly MigrationRow[]
  readonly auditEvents: readonly MigrationRow[]
}

function rows(database: DatabaseSync, statement: string): MigrationRow[] {
  return database.prepare(statement).all() as MigrationRow[]
}

function readSnapshot(sqliteFilename: string): MigrationSnapshot {
  const database = new DatabaseSync(sqliteFilename, { readOnly: true })
  try {
    return {
      organizations: rows(database, 'SELECT id, name FROM organizations ORDER BY id'),
      users: rows(database, `SELECT id, org_id, username, display_name, disabled, password_verifier
        FROM users ORDER BY id`),
      userRoles: rows(database, 'SELECT user_id, role FROM user_roles ORDER BY user_id, role'),
      externalIdentities: rows(database, `SELECT provider_id, subject, user_id
        FROM external_identities ORDER BY provider_id, subject`),
      authSessions: rows(database, `SELECT token_hash, user_id, created_at, expires_at, last_seen_at, revoked_at
        FROM auth_sessions ORDER BY token_hash`),
      resourcePolicies: rows(database, `SELECT resource_type, resource_id, org_id, creator_user_id, visibility, allowed_user_ids
        FROM resource_policies ORDER BY resource_type, resource_id`),
      managedAssets: rows(database, 'SELECT org_id, type, id, name, config_json FROM managed_assets ORDER BY org_id, type, id'),
      auditEvents: rows(database, `SELECT id, org_id, actor_user_id, action, resource_type, resource_id,
        decision, reason, correlation_id, created_at, details_json FROM audit_events ORDER BY id`),
    }
  } finally {
    database.close()
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function tableSummary(values: readonly MigrationRow[]): MigrationTableSummary {
  return {
    count: values.length,
    checksum: createHash('sha256').update(canonicalJson(values)).digest('hex'),
  }
}

function summarize(snapshot: MigrationSnapshot): EnterpriseIdentityMigrationSummary {
  return {
    organizations: tableSummary(snapshot.organizations),
    users: tableSummary(snapshot.users),
    userRoles: tableSummary(snapshot.userRoles),
    externalIdentities: tableSummary(snapshot.externalIdentities),
    authSessions: tableSummary(snapshot.authSessions),
    resourcePolicies: tableSummary(snapshot.resourcePolicies),
    managedAssets: tableSummary(snapshot.managedAssets),
    auditEvents: tableSummary(snapshot.auditEvents),
  }
}

function string(row: MigrationRow, key: string): string {
  const value = row[key]
  if (typeof value !== 'string') throw new Error(`SQLite migration row has invalid ${key}`)
  return value
}

function nullableString(row: MigrationRow, key: string): string | null {
  const value = row[key]
  if (value === null) return null
  return string(row, key)
}

function number(row: MigrationRow, key: string): number {
  const value = row[key]
  if (typeof value !== 'number') throw new Error(`SQLite migration row has invalid ${key}`)
  return value
}

function sqliteBoolean(row: MigrationRow, key: string): boolean {
  const value = row[key]
  if (value !== 0 && value !== 1) throw new Error(`SQLite migration row has invalid ${key}`)
  return value === 1
}

async function withTransaction<T>(target: PostgresDatabase, operation: (database: PostgresDatabase) => Promise<T>): Promise<T> {
  const database = target.connect === undefined ? target : await target.connect()
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

async function importSnapshot(target: PostgresDatabase, snapshot: MigrationSnapshot): Promise<void> {
  await migrateEnterpriseIdentityPostgres(target)
  for (const row of snapshot.organizations) {
    await target.query('INSERT INTO organizations(id, name) VALUES ($1, $2)', [string(row, 'id'), string(row, 'name')])
  }
  for (const row of snapshot.users) {
    await target.query(
      `INSERT INTO users(id, org_id, username, display_name, disabled, password_verifier)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [string(row, 'id'), string(row, 'org_id'), string(row, 'username'), string(row, 'display_name'),
        sqliteBoolean(row, 'disabled'), nullableString(row, 'password_verifier')],
    )
  }
  for (const row of snapshot.userRoles) {
    await target.query('INSERT INTO user_roles(user_id, role) VALUES ($1, $2)', [string(row, 'user_id'), string(row, 'role')])
  }
  for (const row of snapshot.externalIdentities) {
    await target.query('INSERT INTO external_identities(provider_id, subject, user_id) VALUES ($1, $2, $3)',
      [string(row, 'provider_id'), string(row, 'subject'), string(row, 'user_id')])
  }
  for (const row of snapshot.authSessions) {
    await target.query(
      `INSERT INTO auth_sessions(token_hash, user_id, created_at, expires_at, last_seen_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [string(row, 'token_hash'), string(row, 'user_id'), number(row, 'created_at'), number(row, 'expires_at'),
        number(row, 'last_seen_at'), row['revoked_at'] === null ? null : number(row, 'revoked_at')],
    )
  }
  for (const row of snapshot.resourcePolicies) {
    await target.query(
      `INSERT INTO resource_policies(resource_type, resource_id, org_id, creator_user_id, visibility, allowed_user_ids)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [string(row, 'resource_type'), string(row, 'resource_id'), string(row, 'org_id'),
        nullableString(row, 'creator_user_id'), string(row, 'visibility'), string(row, 'allowed_user_ids')],
    )
  }
  for (const row of snapshot.managedAssets) {
    await target.query(
      'INSERT INTO managed_assets(org_id, type, id, name, config_json) VALUES ($1, $2, $3, $4, $5::jsonb)',
      [string(row, 'org_id'), string(row, 'type'), string(row, 'id'), string(row, 'name'), string(row, 'config_json')],
    )
  }
  for (const row of snapshot.auditEvents) {
    await target.query(
      `INSERT INTO audit_events(id, org_id, actor_user_id, action, resource_type, resource_id,
        decision, reason, correlation_id, created_at, details_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)`,
      [string(row, 'id'), string(row, 'org_id'), string(row, 'actor_user_id'), string(row, 'action'),
        string(row, 'resource_type'), string(row, 'resource_id'), string(row, 'decision'), string(row, 'reason'),
        string(row, 'correlation_id'), number(row, 'created_at'), string(row, 'details_json')],
    )
  }
}

/**
 * Imports a complete SQLite identity database into an empty PostgreSQL target.
 * Dry run opens SQLite only; the target is untouched. Import runs as one transaction,
 * so any failed row leaves no partial identity/control-plane state behind.
 */
export async function migrateSqliteEnterpriseIdentityToPostgres(
  options: SqliteToPostgresMigrationOptions,
): Promise<EnterpriseIdentityMigrationReport> {
  const snapshot = readSnapshot(options.sqliteFilename)
  const source = summarize(snapshot)
  if (options.dryRun === true) return { dryRun: true, source, destination: undefined }
  await withTransaction(options.target, target => importSnapshot(target, snapshot))
  return { dryRun: false, source, destination: source }
}
