import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnterpriseIdentityRepository } from '@deepseek-ai/dsh-enterprise-identity'
import {
  PgEnterpriseIdentityRepository,
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
    return { rows: [], rowCount: 1 }
  }
}

describe('PgEnterpriseIdentityRepository', () => {
  it('uses parameterized PostgreSQL writes for enterprise users', async () => {
    const database = new RecordingDatabase()
    const repository = new PgEnterpriseIdentityRepository(database)

    await repository.createUser({
      id: 'user-1', orgId: 'org-a', username: "alice'); DROP TABLE users; --",
      displayName: 'Alice', disabled: false,
    })

    expect(database.queries).toHaveLength(1)
    expect(database.queries[0]).toMatchObject({
      text: expect.stringContaining('VALUES ($1, $2, $3, $4, $5)'),
      values: ['user-1', 'org-a', "alice'); DROP TABLE users; --", 'Alice', false],
    })
    expect(database.queries[0]?.text).not.toContain("alice');")
  })
})

describe('migrateSqliteEnterpriseIdentityToPostgres', () => {
  let root: string
  let sqlitePath: string
  let source: EnterpriseIdentityRepository

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-identity-postgres-'))
    sqlitePath = join(root, 'identity.sqlite')
    source = new EnterpriseIdentityRepository(sqlitePath)
    source.createOrganization({ id: 'org-a', name: '深度求索' })
    source.createUser({ id: 'user-1', orgId: 'org-a', username: 'alice', displayName: 'Alice', disabled: false })
    source.setRoles('user-1', ['administrator'])
    source.createSession({ token: 'never-store-this-token', userId: 'user-1', expiresAt: 1_800_000_000_000 })
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

  it('imports hashed session values in one PostgreSQL transaction while preserving IDs', async () => {
    const target = new RecordingDatabase()

    const report = await migrateSqliteEnterpriseIdentityToPostgres({ sqliteFilename: sqlitePath, target })

    expect(report.dryRun).toBe(false)
    expect(report.destination).toEqual(report.source)
    expect(target.queries.map(query => query.text)).toContain('BEGIN')
    expect(target.queries.map(query => query.text)).toContain('COMMIT')
    const sessionWrite = target.queries.find(query => query.text.includes('INSERT INTO auth_sessions'))
    expect(sessionWrite?.values).toContain('user-1')
    expect(JSON.stringify(sessionWrite)).not.toContain('never-store-this-token')
    expect(sessionWrite?.values[0]).toMatch(/^[a-f0-9]{64}$/)
  })
})
