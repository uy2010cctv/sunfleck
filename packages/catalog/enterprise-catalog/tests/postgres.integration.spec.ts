import { randomUUID } from 'node:crypto'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Pool, type PoolClient, type QueryResult } from 'pg'
import { EnterpriseCatalogRepository } from '../src/index.ts'
import type { PostgresDatabase, PostgresQueryResult } from '../src/types.ts'

const url = process.env.DSH_TEST_POSTGRES_URL

class PgSchemaDatabase implements PostgresDatabase {
  constructor(private readonly client: PoolClient, private readonly schema: string) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    const result: QueryResult<Row> = await this.client.query<Row>(text, [...values])
    return { rows: result.rows, rowCount: result.rowCount }
  }

  async transaction<T>(operation: (database: PostgresDatabase) => Promise<T>): Promise<T> {
    await this.client.query('BEGIN')
    try {
      const result = await operation(this)
      await this.client.query('COMMIT')
      return result
    } catch (error) {
      await this.client.query('ROLLBACK')
      throw error
    }
  }

  async setSchema(): Promise<void> {
    await this.client.query(`CREATE SCHEMA "${this.schema}"`)
    await this.client.query(`SET search_path TO "${this.schema}"`)
  }
}

describe.skipIf(url === undefined)('enterprise catalog PostgreSQL integration', () => {
  let pool: Pool
  let client: PoolClient
  let database: PgSchemaDatabase
  let repository: EnterpriseCatalogRepository
  let schema: string

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 })
    client = await pool.connect()
    schema = `dsh_catalog_test_${randomUUID().replaceAll('-', '')}`
    database = new PgSchemaDatabase(client, schema)
    await database.setSchema()
    repository = new EnterpriseCatalogRepository(database, { now: () => 1_700_000_000_000 })
  })

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    client.release()
    await pool.end()
  })

  it('preserves JSONB release digests and idempotent publish retries', async () => {
    await repository.saveDraft({
      presetId: 'preset-pg', orgId: 'org-pg', ownerUserId: 'user-pg', expectedRevision: 0,
      idempotencyKey: 'draft-pg', visibility: 'organization',
      profile: { prompt: 'hello', model: 'deepseek' }, bindings: [],
    })
    const input = {
      orgId: 'org-pg', presetId: 'preset-pg', expectedRevision: 1,
      idempotencyKey: 'publish-pg', publishedBy: 'user-pg',
    }
    const release = await repository.publishDraft(input)
    await expect(repository.publishDraft(input)).resolves.toEqual(release)
    expect((await repository.listReleases('preset-pg', 'org-pg'))[0]?.digest).toBe(release.digest)
  })

  it('serializes concurrent first draft creation with a deterministic revision conflict', async () => {
    const clients = await Promise.all([pool.connect(), pool.connect()])
    const databases = clients.map(candidate => new PgSchemaDatabase(candidate, schema))
    await Promise.all(databases.map(candidate => candidate.query(`SET search_path TO "${schema}"`)))
    const writes = await Promise.allSettled(databases.map((candidate, index) =>
      new EnterpriseCatalogRepository(candidate).saveDraft({
        presetId: 'preset-race', orgId: 'org-pg', ownerUserId: 'user-pg', expectedRevision: 0,
        idempotencyKey: `race-${String(index)}`, visibility: 'organization', profile: { index }, bindings: [],
      })))
    clients.forEach((candidate) => { candidate.release() })
    expect(writes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    const rejected = writes.find(item => item.status === 'rejected')
    const reason: unknown = rejected?.status === 'rejected' ? (rejected.reason as unknown) : undefined
    expect(reason instanceof Error ? reason.message : String(reason)).toMatch(/revision conflict|duplicate key/i)
  })
})
