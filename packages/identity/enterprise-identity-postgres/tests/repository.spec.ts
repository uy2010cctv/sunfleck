import { DatabaseSync } from 'node:sqlite'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnterpriseIdentityRepository, sessionTokenHash } from '@deepseek-ai/dsh-enterprise-identity'
import {
  PgEnterpriseIdentityRepository,
  migrateEnterpriseIdentityPostgres,
  migrateSqliteEnterpriseIdentityToPostgres,
  type PostgresDatabase,
  type PostgresQueryResult,
} from '../src/index.ts'

interface RecordedQuery {
  readonly text: string
  readonly values: readonly unknown[]
}

class RecordingDatabase implements PostgresDatabase {
  readonly queries: RecordedQuery[] = []

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    this.queries.push({ text, values })
    if (text.includes('pg_try_advisory_xact_lock')) return { rows: [{ acquired: true }] as Row[], rowCount: 1 }
    if (text.includes('to_regclass')) return { rows: [{ table_name: null }] as Row[], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  }
}

describe('PgEnterpriseIdentityRepository', () => {
  it('upgrades v4 Session bindings with an explicit owner column', async () => {
    class VersionFourDatabase extends RecordingDatabase {
      override async query<Row extends Record<string, unknown> = Record<string, unknown>>(
        text: string, values: readonly unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> {
        if (text.includes("SELECT value FROM enterprise_meta WHERE key = 'schema-version'")) {
          this.queries.push({ text, values })
          return { rows: [{ value: '4' }] as Row[], rowCount: 1 }
        }
        return super.query(text, values)
      }
    }
    const database = new VersionFourDatabase()

    await migrateEnterpriseIdentityPostgres(database)

    expect(database.queries.map(query => query.text)).toEqual(expect.arrayContaining([
      expect.stringContaining('ALTER TABLE enterprise_session_workspaces ADD COLUMN IF NOT EXISTS owner_user_id'),
      expect.stringContaining('SET owner_user_id = workspace.owner_user_id'),
    ]))
    expect(database.queries.at(-1)?.values).toEqual(['5'])
  })

  it('uses parameterized PostgreSQL writes for enterprise users', async () => {
    const database = new RecordingDatabase()
    const repository = new PgEnterpriseIdentityRepository(database)

    await repository.createUser({
      id: 'user-1', orgId: 'org-a', username: "alice'); DROP TABLE users; --",
      displayName: 'Alice', disabled: false,
    })

    expect(database.queries).toHaveLength(1)
    expect(database.queries[0]?.text).toContain('VALUES ($1, $2, $3, $4, $5)')
    expect(database.queries[0]?.values).toEqual([
      'user-1', 'org-a', "alice'); DROP TABLE users; --", 'Alice', false,
    ])
    expect(database.queries[0]?.text).not.toContain("alice');")
  })

  it('creates an organization and initial administrator in one transaction', async () => {
    const database = new RecordingDatabase()
    const repository = new PgEnterpriseIdentityRepository(database)

    await repository.createOrganizationWithAdministrator({
      organization: { id: 'org-b', name: 'Second enterprise' },
      administrator: {
        id: 'org-b-admin', orgId: 'org-b', username: 'admin', displayName: 'Second Admin', disabled: false,
      },
      passwordVerifier: 'scrypt$second-verifier',
    })

    expect(database.queries.map(query => query.text.trim())).toEqual([
      'BEGIN',
      expect.stringContaining('INSERT INTO organizations'),
      expect.stringContaining('INSERT INTO users'),
      expect.stringContaining('INSERT INTO user_roles'),
      'COMMIT',
    ])
    expect(database.queries[2]?.values).toEqual([
      'org-b-admin', 'org-b', 'admin', 'Second Admin', false, 'scrypt$second-verifier',
    ])
    expect(database.queries[3]?.values).toEqual(['org-b-admin', 'administrator'])
  })

  it('scopes profile and password updates by organization', async () => {
    const database = new RecordingDatabase()
    const repository = new PgEnterpriseIdentityRepository(database)

    await repository.updateUserProfile({
      orgId: 'org-a', userId: 'user-1', username: 'alice.renamed', displayName: 'Alice Renamed',
      passwordVerifier: 'scrypt$redacted-verifier',
    })

    expect(database.queries).toHaveLength(1)
    expect(database.queries[0]?.text).toContain('WHERE id = $5 AND org_id = $6')
    expect(database.queries[0]?.values).toEqual([
      'alice.renamed', 'Alice Renamed', 'scrypt$redacted-verifier', 'scrypt$redacted-verifier', 'user-1', 'org-a',
    ])
  })
})

describe('migrateSqliteEnterpriseIdentityToPostgres', () => {
  let root: string
  let sqlitePath: string
  let source: EnterpriseIdentityRepository

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-identity-postgres-'))
    sqlitePath = join(root, 'identity.sqlite')
    source = new EnterpriseIdentityRepository(sqlitePath, { now: () => 1_700_000_000_000 })
    source.createOrganization({ id: 'org-a', name: '深度求索' })
    source.createUser({ id: 'user-1', orgId: 'org-a', username: 'alice', displayName: 'Alice', disabled: false })
    source.setRoles('user-1', ['administrator'])
    source.createSession({ token: 'never-store-this-token', userId: 'user-1', expiresAt: 1_800_000_000_000 })
    source.appendAudit({
      id: 'audit-1', orgId: 'org-a', actorUserId: 'user-1', action: 'user.manage',
      resourceType: 'user', resourceId: 'user-1', decision: 'allowed', reason: 'administrator',
      correlationId: 'migration-test', at: 1_700_000_000_001, details: {},
    })
  })

  afterEach(async () => {
    source.close()
    await rm(root, { recursive: true, force: true })
  })

  it('reports stable source counts and checksums without mutating PostgreSQL in dry-run mode', async () => {
    const target = new RecordingDatabase()

    const report = await migrateSqliteEnterpriseIdentityToPostgres({
      sqliteFilename: sqlitePath,
      target,
      dryRun: true,
    })

    expect(report.dryRun).toBe(true)
    expect(report.source.organizations.count).toBe(1)
    expect(report.source.users.count).toBe(1)
    expect(report.source.authSessions.count).toBe(1)
    expect(report.source.authSessions.checksum).toMatch(/^[a-f0-9]{64}$/)
    expect(target.queries).toEqual([])
  })

  it('normalizes pg BIGINT result strings without timestamp precision loss', async () => {
    class VerifiedDatabase extends RecordingDatabase {
      override async query<Row extends Record<string, unknown> = Record<string, unknown>>(
        text: string, values: readonly unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> {
        const rows = text.includes('FROM organizations ORDER BY id') ? [{ id: 'org-a', name: '深度求索' }]
          : text.includes('FROM users ORDER BY id') ? [{
            id: 'user-1', org_id: 'org-a', username: 'alice', display_name: 'Alice', disabled: false,
            password_verifier: null, department_revision: '0',
          }]
            : text.includes('FROM user_roles ORDER BY user_id, role') ? [{ user_id: 'user-1', role: 'administrator' }]
              : text.includes('FROM auth_sessions ORDER BY token_hash') ? [{
                token_hash: sessionTokenHash('never-store-this-token'), user_id: 'user-1', created_at: '1700000000000',
                expires_at: '1800000000000', last_seen_at: '1700000000000', revoked_at: null,
              }]
                : text.includes('FROM audit_events ORDER BY id') ? [{
                  id: 'audit-1', org_id: 'org-a', actor_user_id: 'user-1', action: 'user.manage',
                  resource_type: 'user', resource_id: 'user-1', decision: 'allowed', reason: 'administrator',
                  correlation_id: 'migration-test', created_at: '1700000000001', details_json: {},
                }]
                  : undefined
        if (rows !== undefined) return { rows: rows as Row[], rowCount: rows.length }
        return super.query(text, values)
      }
    }
    const target = new VerifiedDatabase()

    const report = await migrateSqliteEnterpriseIdentityToPostgres({
      sqliteFilename: sqlitePath, target, sourceQuiesced: true, targetBackupConfirmed: true,
    })

    expect(report.dryRun).toBe(false)
    expect(report.destination).toEqual(report.source)
    expect(target.queries.map(query => query.text)).toContain('BEGIN')
    expect(target.queries.map(query => query.text)).toContain('COMMIT')
    const sessionWrite = target.queries.find(query => query.text.includes('INSERT INTO auth_sessions'))
    expect(sessionWrite?.values).toContain('user-1')
    expect(JSON.stringify(sessionWrite)).not.toContain('never-store-this-token')
    expect(sessionWrite?.values[0]).toMatch(/^[a-f0-9]{64}$/)
  })

  it('creates a native consistent source backup after SQLite integrity validation before importing', async () => {
    const backupFilename = join(root, 'identity.before-postgres.sqlite')
    const target = new RecordingDatabase()

    await expect(migrateSqliteEnterpriseIdentityToPostgres({
      sqliteFilename: sqlitePath, backupFilename, target, sourceQuiesced: true, targetBackupConfirmed: true,
    })).rejects.toThrow(/checksum mismatch/i)

    await expect(access(backupFilename)).resolves.toBeUndefined()
  })

  it('fails closed before PostgreSQL access when a requested source snapshot path already exists', async () => {
    const backupFilename = join(root, 'already-exists.sqlite')
    await writeFile(backupFilename, 'reserved snapshot path')
    const target = new RecordingDatabase()

    await expect(migrateSqliteEnterpriseIdentityToPostgres({
      sqliteFilename: sqlitePath, backupFilename, target, sourceQuiesced: true, targetBackupConfirmed: true,
    })).rejects.toThrow(/backup/i)
    expect(target.queries).toEqual([])
  })

  it('does not touch PostgreSQL when the source SQLite integrity check cannot pass', async () => {
    const corruptFilename = join(root, 'corrupt.sqlite')
    await writeFile(corruptFilename, 'not a SQLite database')
    const target = new RecordingDatabase()

    await expect(migrateSqliteEnterpriseIdentityToPostgres({
      sqliteFilename: corruptFilename, target, sourceQuiesced: true, targetBackupConfirmed: true,
    })).rejects.toThrow()
    expect(target.queries).toEqual([])
  })

  it('fails closed when target backup was not explicitly confirmed', async () => {
    const target = new RecordingDatabase()

    await expect(migrateSqliteEnterpriseIdentityToPostgres({
      sqliteFilename: sqlitePath, target, sourceQuiesced: true,
    }))
      .rejects.toThrow(/target backup confirmation/i)
    expect(target.queries).toEqual([])
  })

  it('fails closed before PostgreSQL access until the source SQLite writers are stopped', async () => {
    const target = new RecordingDatabase()

    await expect(migrateSqliteEnterpriseIdentityToPostgres({
      sqliteFilename: sqlitePath, target, targetBackupConfirmed: true,
    })).rejects.toThrow(/quiesced/i)
    expect(target.queries).toEqual([])
  })

  it('rejects a non-empty target before issuing schema or row writes', async () => {
    class NonEmptyDatabase extends RecordingDatabase {
      override async query<Row extends Record<string, unknown> = Record<string, unknown>>(
        text: string, values: readonly unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> {
        if (text.includes('to_regclass')) return { rows: [{ table_name: 'organizations' }] as Row[], rowCount: 1 }
        if (text.includes('EXISTS')) return { rows: [{ has_rows: true }] as Row[], rowCount: 1 }
        return super.query(text, values)
      }
    }
    const target = new NonEmptyDatabase()

    await expect(migrateSqliteEnterpriseIdentityToPostgres({
      sqliteFilename: sqlitePath, target, sourceQuiesced: true, targetBackupConfirmed: true,
    })).rejects.toThrow(/not empty/i)
    expect(target.queries.map(query => query.text)).toContain('BEGIN')
    expect(target.queries.map(query => query.text)).toContain('ROLLBACK')
    expect(target.queries.some(query => query.text.startsWith('CREATE TABLE'))).toBe(false)
  })

  it('rolls back the target after an injected mid-import write failure', async () => {
    class FailingDatabase extends RecordingDatabase {
      override async query<Row extends Record<string, unknown> = Record<string, unknown>>(
        text: string, values: readonly unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> {
        if (text.includes('INSERT INTO users')) throw new Error('injected user write failure')
        return super.query(text, values)
      }
    }
    const target = new FailingDatabase()

    await expect(migrateSqliteEnterpriseIdentityToPostgres({
      sqliteFilename: sqlitePath, target, sourceQuiesced: true, targetBackupConfirmed: true,
    })).rejects.toThrow(/injected user write failure/)
    expect(target.queries.map(query => query.text)).toContain('ROLLBACK')
    expect(target.queries.map(query => query.text)).not.toContain('COMMIT')
  })

  it('rolls back when destination checksums do not match the source snapshot', async () => {
    class MismatchDatabase extends RecordingDatabase {
      override async query<Row extends Record<string, unknown> = Record<string, unknown>>(
        text: string, values: readonly unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> {
        if (text.includes('FROM organizations ORDER BY id')) return { rows: [] as Row[], rowCount: 0 }
        return super.query(text, values)
      }
    }
    const target = new MismatchDatabase()

    await expect(migrateSqliteEnterpriseIdentityToPostgres({
      sqliteFilename: sqlitePath, target, sourceQuiesced: true, targetBackupConfirmed: true,
    })).rejects.toThrow(/checksum mismatch/i)
    expect(target.queries.map(query => query.text)).toContain('ROLLBACK')
  })

  it('rejects migrated managed asset secret fields without disclosing their values', async () => {
    const raw = new DatabaseSync(sqlitePath)
    raw.prepare(`INSERT INTO managed_assets(org_id, type, id, name, config_json)
      VALUES (?, ?, ?, ?, ?)`).run('org-a', 'channel', 'unsafe', 'Unsafe', '{"settings":{"token":"do-not-log"}}')
    raw.close()
    const target = new RecordingDatabase()

    let error: unknown
    try {
      await migrateSqliteEnterpriseIdentityToPostgres({
        sqliteFilename: sqlitePath, target, sourceQuiesced: true, targetBackupConfirmed: true,
      })
    } catch (cause: unknown) {
      error = cause
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/config\.settings\.token/)
    expect((error as Error).message).not.toContain('do-not-log')
    expect(target.queries).toEqual([])
  })

  it('uses one connected pg client for transaction lock, preflight, import, readback, and release', async () => {
    class PoolLikeDatabase implements PostgresDatabase {
      readonly rootQueries: RecordedQuery[] = []
      readonly client = new RecordingDatabase()

      async connect(): Promise<PostgresDatabase> {
        return this.client
      }

      async query<Row extends Record<string, unknown> = Record<string, unknown>>(
        text: string, values: readonly unknown[] = [],
      ): Promise<PostgresQueryResult<Row>> {
        this.rootQueries.push({ text, values })
        throw new Error('root pool query must not be used once a migration client is acquired')
      }
    }
    const target = new PoolLikeDatabase()

    await expect(migrateSqliteEnterpriseIdentityToPostgres({
      sqliteFilename: sqlitePath, target, sourceQuiesced: true, targetBackupConfirmed: true,
    })).rejects.toThrow(/checksum mismatch/i)
    expect(target.rootQueries).toEqual([])
    expect(target.client.queries.map(query => query.text)).toContain('BEGIN')
    expect(target.client.queries.some(query => query.text.includes('pg_try_advisory_xact_lock'))).toBe(true)
    expect(target.client.queries.some(query => query.text.includes('INSERT INTO organizations'))).toBe(true)
    expect(target.client.queries.some(query => query.text.includes('FROM organizations ORDER BY id'))).toBe(true)
  })
})
