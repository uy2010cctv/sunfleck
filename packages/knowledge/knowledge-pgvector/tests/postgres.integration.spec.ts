import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient, type QueryResult } from 'pg'
import { EnterpriseKnowledgeRepository, type PostgresDatabase, type PostgresQueryResult } from '../src/index.ts'

const url = process.env.DSH_TEST_POSTGRES_URL
if (url === undefined && process.env.CI === 'true') {
  throw new Error('DSH_TEST_POSTGRES_URL is required for knowledge PostgreSQL integration tests in CI')
}

class PgDatabase implements PostgresDatabase {
  constructor(private readonly client: PoolClient) {}
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    const result: QueryResult<Row> = await this.client.query<Row>(text, [...values])
    return { rows: result.rows, rowCount: result.rowCount }
  }
  async transaction<T>(operation: (database: PostgresDatabase) => Promise<T>): Promise<T> {
    await this.client.query('BEGIN')
    try { const result = await operation(this); await this.client.query('COMMIT'); return result }
    catch (error) { await this.client.query('ROLLBACK'); throw error }
  }
}

describe.skipIf(url === undefined)('knowledge PostgreSQL/pgvector integration', () => {
  let pool: Pool
  let client: PoolClient
  let repository: EnterpriseKnowledgeRepository
  let schema: string

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 })
    client = await pool.connect()
    schema = `dsh_knowledge_test_${Date.now().toString(36)}`
    await client.query(`CREATE SCHEMA "${schema}"`)
    // Keep the test tables isolated while retaining access to extension-owned
    // types such as public.vector.
    await client.query(`SET search_path TO "${schema}", public`)
    repository = new EnterpriseKnowledgeRepository(new PgDatabase(client), { now: () => 1_700_000_000_000 })
  })

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    client.release()
    await pool.end()
  })

  it('retrieves only the caller organization ACL and returns version evidence', async () => {
    await repository.saveDocument({ documentId: 'doc-pg', orgId: 'org-pg', title: 'Handbook', createdBy: 'owner', visibility: 'restricted', expectedRevision: 0, idempotencyKey: 'doc' })
    await repository.createVersion({ documentId: 'doc-pg', orgId: 'org-pg', contentHash: 'sha-v1', metadata: { source: 'test' }, createdBy: 'owner', idempotencyKey: 'version' })
    await repository.writeChunks({ documentId: 'doc-pg', orgId: 'org-pg', version: 1, idempotencyKey: 'chunks', chunks: [
      { chunkId: 'c1', documentId: 'doc-pg', orgId: 'org-pg', version: 1, ordinal: 0, text: 'internal rule', embedding: [1, 0] },
    ] })
    await repository.setAcl({ documentId: 'doc-pg', orgId: 'org-pg', expectedRevision: 1, idempotencyKey: 'acl', entries: [{ principalType: 'user', principalId: 'reader', read: true }] })
    await expect(repository.search({ orgId: 'other-org', userId: 'reader', embedding: [1, 0] })).resolves.toHaveLength(0)
    const results = await repository.search({ orgId: 'org-pg', userId: 'reader', embedding: [1, 0] })
    expect(results[0]).toMatchObject({ documentId: 'doc-pg', version: 1, chunkId: 'c1', contentHash: 'sha-v1', permissionEvidence: { kind: 'acl', principalType: 'user', principalId: 'reader' } })
  })
})
