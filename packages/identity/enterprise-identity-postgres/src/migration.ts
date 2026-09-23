/** One-shot, transaction-safe SQLite to PostgreSQL identity migration. */

import { createHash } from 'node:crypto'
import { copyFileSync, existsSync } from 'node:fs'
import { constants } from 'node:fs'
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
  | 'departments'
  | 'userDepartments'
  | 'workspaceGrants'
  | 'memories'
  | 'sessionWorkspaces'

type MigrationRow = Record<string, unknown>

/** Data used by `MigrationTableSummary`. */
export interface MigrationTableSummary {
  readonly count: number
  readonly checksum: string
}

/** Allowed values for `EnterpriseIdentityMigrationSummary`. */
export type EnterpriseIdentityMigrationSummary = Readonly<Record<TableName, MigrationTableSummary>>

/** Data used by `EnterpriseIdentityMigrationReport`. */
export interface EnterpriseIdentityMigrationReport {
  readonly dryRun: boolean
  readonly source: EnterpriseIdentityMigrationSummary
  readonly destination: EnterpriseIdentityMigrationSummary | undefined
}

/** Data used by `SqliteToPostgresMigrationOptions`. */
export interface SqliteToPostgresMigrationOptions {
  readonly sqliteFilename: string
  readonly target: PostgresDatabase
  readonly dryRun?: boolean
  /** Destination for the source SQLite snapshot; defaults beside the source file. */
  readonly backupFilename?: string
  /** Explicit acknowledgement that the operator backed up the PostgreSQL target. */
  readonly targetBackupConfirmed?: boolean
  /** Set only after all processes that can write the source SQLite database are stopped. */
  readonly sourceQuiesced?: boolean
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
  readonly departments: readonly MigrationRow[]
  readonly userDepartments: readonly MigrationRow[]
  readonly workspaceGrants: readonly MigrationRow[]
  readonly memories: readonly MigrationRow[]
  readonly sessionWorkspaces: readonly MigrationRow[]
}

function rows(database: DatabaseSync, statement: string): MigrationRow[] {
  return database.prepare(statement).all()
}

function verifySqliteIntegrity(sqliteFilename: string): void {
  const database = new DatabaseSync(sqliteFilename, { readOnly: true })
  try {
    const result = database.prepare('PRAGMA integrity_check').get() as { integrity_check: string } | undefined
    if (result?.integrity_check !== 'ok') throw new Error('source SQLite integrity_check did not return ok')
  } finally {
    database.close()
  }
}

function backupSqlite(sqliteFilename: string, backupFilename: string): void {
  if (sqliteFilename === backupFilename) throw new Error('SQLite backup filename must differ from the source filename')
  if (existsSync(backupFilename)) throw new Error('SQLite backup destination already exists')
  try {
    copyFileSync(sqliteFilename, backupFilename, constants.COPYFILE_EXCL)
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${sqliteFilename}${suffix}`
      if (existsSync(sidecar)) copyFileSync(sidecar, `${backupFilename}${suffix}`, constants.COPYFILE_EXCL)
    }
  } catch (cause) {
    throw new Error(`SQLite backup failed: ${cause instanceof Error ? cause.message : 'unknown failure'}`)
  }
}

function readSnapshot(sqliteFilename: string): MigrationSnapshot {
  const database = new DatabaseSync(sqliteFilename, { readOnly: true })
  try {
    return {
      organizations: rows(database, 'SELECT id, name FROM organizations ORDER BY id'),
      users: rows(database, `SELECT id, org_id, username, display_name, disabled, password_verifier, department_revision
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
      departments: rows(database, `WITH RECURSIVE tree(id, org_id, parent_id, name, sort_order, revision,
        created_at, updated_at, depth) AS (
          SELECT id, org_id, parent_id, name, sort_order, revision, created_at, updated_at, 0
          FROM departments WHERE parent_id IS NULL
          UNION ALL
          SELECT child.id, child.org_id, child.parent_id, child.name, child.sort_order, child.revision,
            child.created_at, child.updated_at, tree.depth + 1
          FROM departments child JOIN tree ON child.parent_id = tree.id
        ) SELECT id, org_id, parent_id, name, sort_order, revision, created_at, updated_at
        FROM tree ORDER BY depth, id`),
      userDepartments: rows(database, `SELECT user_id, department_id, is_primary
        FROM user_departments ORDER BY user_id, department_id`),
      workspaceGrants: rows(database, `SELECT workspace_id, org_id, name, kind, owner_user_id, department_id,
        root_path, sandbox_mode, revision, created_at, updated_at
        FROM enterprise_workspace_grants ORDER BY workspace_id`),
      memories: rows(database, `SELECT id, org_id, scope_type, department_id, agent_employee_id, pair_user_id,
        project_id, kind, status, summary, source_digest, privacy_findings, importance, last_access_at, created_by,
        reviewed_by, review_reason, revision, created_at, updated_at
        FROM enterprise_memories ORDER BY id`),
      sessionWorkspaces: rows(database, `SELECT session_id, workspace_id, org_id, owner_user_id
        FROM enterprise_session_workspaces ORDER BY session_id`),
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
  const normalized = normalizeSnapshot(snapshot)
  return {
    organizations: tableSummary(normalized.organizations),
    users: tableSummary(normalized.users),
    userRoles: tableSummary(normalized.userRoles),
    externalIdentities: tableSummary(normalized.externalIdentities),
    authSessions: tableSummary(normalized.authSessions),
    resourcePolicies: tableSummary(normalized.resourcePolicies),
    managedAssets: tableSummary(normalized.managedAssets),
    auditEvents: tableSummary(normalized.auditEvents),
    departments: tableSummary(normalized.departments),
    userDepartments: tableSummary(normalized.userDepartments),
    workspaceGrants: tableSummary(normalized.workspaceGrants),
    memories: tableSummary(normalized.memories),
    sessionWorkspaces: tableSummary(normalized.sessionWorkspaces),
  }
}

function parseJson(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}

function normalizeRow(row: MigrationRow, jsonKeys: readonly string[] = []): MigrationRow {
  const normalized: MigrationRow = { ...row }
  if (normalized['disabled'] === 0 || normalized['disabled'] === 1) normalized['disabled'] = normalized['disabled'] === 1
  for (const key of jsonKeys) normalized[key] = parseJson(normalized[key])
  return normalized
}

function canonicalTimestamp(value: unknown, field: string): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error(`migration timestamp ${field} is not a safe integer`)
    return String(value)
  }
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'string' && /^-?(?:0|[1-9]\d*)$/u.test(value)) return BigInt(value).toString()
  throw new Error(`migration timestamp ${field} is not an integer`)
}

function normalizeIntegers(row: MigrationRow, fields: readonly string[]): MigrationRow {
  const normalized = { ...row }
  for (const field of fields) {
    if (normalized[field] !== null && normalized[field] !== undefined) {
      normalized[field] = canonicalTimestamp(normalized[field], field)
    }
  }
  return normalized
}

function normalizeSnapshot(snapshot: MigrationSnapshot): MigrationSnapshot {
  return {
    organizations: snapshot.organizations.map(row => normalizeRow(row)),
    users: snapshot.users.map(row => normalizeIntegers(normalizeRow(row), ['department_revision'])),
    userRoles: snapshot.userRoles.map(row => normalizeRow(row)),
    externalIdentities: snapshot.externalIdentities.map(row => normalizeRow(row)),
    authSessions: snapshot.authSessions.map(row => normalizeIntegers(normalizeRow(row), [
      'created_at', 'expires_at', 'last_seen_at', 'revoked_at',
    ])),
    resourcePolicies: snapshot.resourcePolicies.map(row => normalizeRow(row, ['allowed_user_ids'])),
    managedAssets: snapshot.managedAssets.map(row => normalizeRow(row, ['config_json'])),
    auditEvents: snapshot.auditEvents.map(row => normalizeIntegers(normalizeRow(row, ['details_json']), ['created_at'])),
    departments: snapshot.departments.map(row => normalizeIntegers(
      normalizeRow(row), ['sort_order', 'revision', 'created_at', 'updated_at'],
    )),
    userDepartments: snapshot.userDepartments.map(row => ({
      ...normalizeRow(row), is_primary: sqliteBoolean(row, 'is_primary'),
    })),
    workspaceGrants: snapshot.workspaceGrants.map(row => normalizeIntegers(
      normalizeRow(row), ['revision', 'created_at', 'updated_at'],
    )),
    memories: snapshot.memories.map(row => normalizeIntegers(
      normalizeRow(row, ['privacy_findings']), ['revision', 'created_at', 'updated_at', 'last_access_at'],
    )),
    sessionWorkspaces: snapshot.sessionWorkspaces.map(row => normalizeRow(row)),
  }
}

function assertNoSecretFields(value: unknown, path = 'config'): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) assertNoSecretFields(item, `${path}[${String(index)}]`)
    return
  }
  if (typeof value !== 'object' || value === null) return
  for (const [key, child] of Object.entries(value)) {
    const fieldPath = `${path}.${key}`
    if (!key.endsWith('Ref') && /(token|secret|password|apiKey|privateKey|credential)/iu.test(key)) {
      throw new Error(`managed asset config contains secret-bearing field ${fieldPath}`)
    }
    assertNoSecretFields(child, fieldPath)
  }
}

function validateSnapshot(snapshot: MigrationSnapshot): void {
  for (const asset of snapshot.managedAssets) assertNoSecretFields(parseJson(asset['config_json']))
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
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`SQLite migration row has invalid ${key}`)
  return value
}

/** REAL columns such as memory importance hold finite floats, so unlike the BIGINT columns they
 * are carried as numbers and never canonicalized to strings. */
function real(row: MigrationRow, key: string): number {
  const value = row[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`SQLite migration row has invalid ${key}`)
  return value
}

function sqliteBoolean(row: MigrationRow, key: string): boolean {
  const value = row[key]
  if (value !== 0 && value !== 1) throw new Error(`SQLite migration row has invalid ${key}`)
  return value === 1
}

async function withLockedTransaction<T>(target: PostgresDatabase, operation: (database: PostgresDatabase) => Promise<T>): Promise<T> {
  const database = target.connect === undefined ? target : await target.connect()
  await database.query('BEGIN')
  try {
    const lock = await database.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_xact_lock(hashtext('dsh-enterprise-identity-migrate-v1')) AS acquired",
    )
    if (lock.rows[0]?.acquired !== true) throw new Error('enterprise identity migration lock is unavailable')
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
      `INSERT INTO users(id, org_id, username, display_name, disabled, password_verifier, department_revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [string(row, 'id'), string(row, 'org_id'), string(row, 'username'), string(row, 'display_name'),
        sqliteBoolean(row, 'disabled'), nullableString(row, 'password_verifier'), number(row, 'department_revision')],
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
  for (const row of snapshot.departments) {
    await target.query(`INSERT INTO departments(id, org_id, parent_id, name, sort_order, revision, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
      string(row, 'id'), string(row, 'org_id'), nullableString(row, 'parent_id'), string(row, 'name'),
      number(row, 'sort_order'), number(row, 'revision'), number(row, 'created_at'), number(row, 'updated_at'),
    ])
  }
  for (const row of snapshot.userDepartments) {
    await target.query('INSERT INTO user_departments(user_id, department_id, is_primary) VALUES ($1, $2, $3)', [
      string(row, 'user_id'), string(row, 'department_id'), sqliteBoolean(row, 'is_primary'),
    ])
  }
  for (const row of snapshot.workspaceGrants) {
    await target.query(`INSERT INTO enterprise_workspace_grants(workspace_id, org_id, name, kind, owner_user_id,
      department_id, root_path, sandbox_mode, revision, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`, [
      string(row, 'workspace_id'), string(row, 'org_id'), string(row, 'name'), string(row, 'kind'),
      nullableString(row, 'owner_user_id'), nullableString(row, 'department_id'), string(row, 'root_path'),
      string(row, 'sandbox_mode'), number(row, 'revision'), number(row, 'created_at'), number(row, 'updated_at'),
    ])
  }
  for (const row of snapshot.memories) {
    await target.query(`INSERT INTO enterprise_memories(id, org_id, scope_type, department_id,
      agent_employee_id, pair_user_id, project_id, kind, status, summary, source_digest, privacy_findings, importance,
      last_access_at, created_by, reviewed_by, review_reason, revision, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15, $16, $17, $18, $19, $20)`, [
      string(row, 'id'), string(row, 'org_id'), string(row, 'scope_type'), nullableString(row, 'department_id'),
      nullableString(row, 'agent_employee_id'), nullableString(row, 'pair_user_id'), nullableString(row, 'project_id'),
      string(row, 'kind'), string(row, 'status'), string(row, 'summary'), string(row, 'source_digest'),
      string(row, 'privacy_findings'), real(row, 'importance'),
      row['last_access_at'] === null ? null : number(row, 'last_access_at'),
      string(row, 'created_by'), nullableString(row, 'reviewed_by'), nullableString(row, 'review_reason'),
      number(row, 'revision'), number(row, 'created_at'), number(row, 'updated_at'),
    ])
  }
  for (const row of snapshot.sessionWorkspaces) {
    await target.query(
      `INSERT INTO enterprise_session_workspaces(session_id, workspace_id, org_id, owner_user_id)
        VALUES ($1, $2, $3, $4)`,
      [string(row, 'session_id'), string(row, 'workspace_id'), string(row, 'org_id'), nullableString(row, 'owner_user_id')],
    )
  }
}

async function readPostgresSnapshot(target: PostgresDatabase): Promise<MigrationSnapshot> {
  const select = async (statement: string): Promise<MigrationRow[]> => (await target.query(statement)).rows as MigrationRow[]
  return {
    organizations: await select('SELECT id, name FROM organizations ORDER BY id'),
    users: await select(`SELECT id, org_id, username, display_name, disabled, password_verifier, department_revision
      FROM users ORDER BY id`),
    userRoles: await select('SELECT user_id, role FROM user_roles ORDER BY user_id, role'),
    externalIdentities: await select('SELECT provider_id, subject, user_id FROM external_identities ORDER BY provider_id, subject'),
    authSessions: await select(`SELECT token_hash, user_id, created_at, expires_at, last_seen_at, revoked_at
      FROM auth_sessions ORDER BY token_hash`),
    resourcePolicies: await select(`SELECT resource_type, resource_id, org_id, creator_user_id, visibility, allowed_user_ids
      FROM resource_policies ORDER BY resource_type, resource_id`),
    managedAssets: await select('SELECT org_id, type, id, name, config_json FROM managed_assets ORDER BY org_id, type, id'),
    auditEvents: await select(`SELECT id, org_id, actor_user_id, action, resource_type, resource_id,
      decision, reason, correlation_id, created_at, details_json FROM audit_events ORDER BY id`),
    departments: await select(`WITH RECURSIVE tree(id, org_id, parent_id, name, sort_order, revision,
      created_at, updated_at, depth) AS (
        SELECT id, org_id, parent_id, name, sort_order, revision, created_at, updated_at, 0
        FROM departments WHERE parent_id IS NULL
        UNION ALL
        SELECT child.id, child.org_id, child.parent_id, child.name, child.sort_order, child.revision,
          child.created_at, child.updated_at, tree.depth + 1
        FROM departments child JOIN tree ON child.parent_id = tree.id
      ) SELECT id, org_id, parent_id, name, sort_order, revision, created_at, updated_at
      FROM tree ORDER BY depth, id`),
    userDepartments: await select(`SELECT user_id, department_id, is_primary
      FROM user_departments ORDER BY user_id, department_id`),
    workspaceGrants: await select(`SELECT workspace_id, org_id, name, kind, owner_user_id, department_id,
      root_path, sandbox_mode, revision, created_at, updated_at
      FROM enterprise_workspace_grants ORDER BY workspace_id`),
    memories: await select(`SELECT id, org_id, scope_type, department_id, agent_employee_id, pair_user_id,
      project_id, kind, status, summary, source_digest, privacy_findings, importance, last_access_at, created_by,
      reviewed_by, review_reason, revision, created_at, updated_at
      FROM enterprise_memories ORDER BY id`),
    sessionWorkspaces: await select(`SELECT session_id, workspace_id, org_id, owner_user_id
      FROM enterprise_session_workspaces ORDER BY session_id`),
  }
}

async function assertEmptyTarget(target: PostgresDatabase): Promise<void> {
  const table = await target.query<{ table_name: string | null }>("SELECT to_regclass('public.organizations') AS table_name")
  if (table.rows[0]?.table_name === null || table.rows[0] === undefined) return
  const content = await target.query<{ has_rows: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM organizations LIMIT 1) AS has_rows',
  )
  if (content.rows[0]?.has_rows === true) throw new Error('PostgreSQL enterprise identity target is not empty')
}

/**
 * Imports a complete SQLite identity database into an empty PostgreSQL target.
 * Dry run opens SQLite only; the target is untouched. Import runs as one transaction,
 * so any failed row leaves no partial identity/control-plane state behind.

 * @param options - Input value used by this API.
 * @returns Result produced by this API.
 */
export async function migrateSqliteEnterpriseIdentityToPostgres(
  options: SqliteToPostgresMigrationOptions,
): Promise<EnterpriseIdentityMigrationReport> {
  verifySqliteIntegrity(options.sqliteFilename)
  if (options.dryRun === true) {
    const snapshot = readSnapshot(options.sqliteFilename)
    validateSnapshot(snapshot)
    return { dryRun: true, source: summarize(snapshot), destination: undefined }
  }
  if (options.sourceQuiesced !== true) {
    throw new Error('source SQLite must be quiesced before migration; pass sourceQuiesced only after stopping all writers')
  }
  if (options.targetBackupConfirmed !== true) {
    throw new Error('PostgreSQL target backup confirmation is required before migration')
  }
  const backupFilename = options.backupFilename ?? `${options.sqliteFilename}.pre-postgres-migration.bak`
  backupSqlite(options.sqliteFilename, backupFilename)
  verifySqliteIntegrity(backupFilename)
  const snapshot = readSnapshot(backupFilename)
  validateSnapshot(snapshot)
  const source = summarize(snapshot)
  const destination = await withLockedTransaction(options.target, async (target) => {
    await assertEmptyTarget(target)
    await importSnapshot(target, snapshot)
    const imported = summarize(await readPostgresSnapshot(target))
    if (canonicalJson(imported) !== canonicalJson(source)) {
      throw new Error('PostgreSQL destination count or checksum mismatch after import')
    }
    return imported
  })
  return { dryRun: false, source, destination }
}
