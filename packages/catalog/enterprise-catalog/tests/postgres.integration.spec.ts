import { randomUUID } from 'node:crypto'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { Pool, type PoolClient, type QueryResult } from 'pg'
import { EnterpriseCatalogRepository, migrateEnterpriseCatalog } from '../src/index.ts'
import type { PostgresDatabase, PostgresQueryResult } from '../src/types.ts'

const url = process.env.DSH_TEST_POSTGRES_URL
const CURSOR_SIGNING_KEY = Buffer.from('0123456789abcdef0123456789abcdef')
if (url === undefined && process.env.CI === 'true') {
  throw new Error('DSH_TEST_POSTGRES_URL is required for enterprise catalog PostgreSQL integration tests in CI')
}

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
    repository = new EnterpriseCatalogRepository(database, {
      now: () => 1_700_000_000_000, cursorSigningKey: CURSOR_SIGNING_KEY,
    })
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
    expect((await repository.listLatestReleases()).find(item => item.presetId === 'preset-pg')).toEqual(release)
  })

  it('serializes concurrent first draft creation with a deterministic revision conflict', async () => {
    const clients = await Promise.all([pool.connect(), pool.connect()])
    const databases = clients.map(candidate => new PgSchemaDatabase(candidate, schema))
    await Promise.all(databases.map(candidate => candidate.query(`SET search_path TO "${schema}"`)))
    const writes = await Promise.allSettled(databases.map((candidate, index) =>
      new EnterpriseCatalogRepository(candidate, { cursorSigningKey: CURSOR_SIGNING_KEY }).saveDraft({
        presetId: 'preset-race', orgId: 'org-pg', ownerUserId: 'user-pg', expectedRevision: 0,
        idempotencyKey: `race-${String(index)}`, visibility: 'organization', profile: { index }, bindings: [],
      })))
    clients.forEach((candidate) => { candidate.release() })
    expect(writes.filter(item => item.status === 'fulfilled')).toHaveLength(1)
    const rejected = writes.find(item => item.status === 'rejected')
    const reason: unknown = rejected?.status === 'rejected' ? (rejected.reason as unknown) : undefined
    expect(reason instanceof Error ? reason.message : String(reason)).toMatch(/revision conflict/i)
  })

  it('queries and archives organization-scoped catalog records with stable cursors', async () => {
    await repository.saveDraft({
      presetId: 'preset-list-a', orgId: 'org-list', ownerUserId: 'owner-a', expectedRevision: 0,
      idempotencyKey: 'draft-list-a', visibility: 'organization', profile: { name: 'Sales Alpha' }, bindings: [],
    })
    await repository.saveDraft({
      presetId: 'preset-list-b', orgId: 'org-list', ownerUserId: 'owner-b', expectedRevision: 0,
      idempotencyKey: 'draft-list-b', visibility: 'private', profile: { name: 'Sales Beta' }, bindings: [],
    })
    await repository.saveDraft({
      presetId: 'preset-list-other', orgId: 'org-other', ownerUserId: 'owner-other', expectedRevision: 0,
      idempotencyKey: 'draft-list-other', visibility: 'organization', profile: { name: 'Sales Other' }, bindings: [],
    })

    const draftPage = await repository.listDrafts({ orgId: 'org-list', limit: 1, search: 'Sales' })
    const nextDraftPage = await repository.listDrafts({
      orgId: 'org-list', limit: 1, search: 'Sales', cursor: draftPage.nextCursor,
    })
    expect([...draftPage.items, ...nextDraftPage.items].map(item => item.presetId))
      .toEqual(['preset-list-b', 'preset-list-a'])

    await repository.saveAssetVersion({
      assetId: 'sop-list-a', orgId: 'org-list', kind: 'sop', name: 'Sales SOP', expectedRevision: 0,
      idempotencyKey: 'asset-list-a-v1', content: { version: 1 }, createdBy: 'owner-a',
    })
    await repository.saveAssetVersion({
      assetId: 'sop-list-a', orgId: 'org-list', kind: 'sop', name: 'Sales SOP', expectedRevision: 1,
      idempotencyKey: 'asset-list-a-v2', content: { version: 2 }, createdBy: 'owner-a',
    })
    await repository.saveAssetVersion({
      assetId: 'sop-list-other', orgId: 'org-other', kind: 'sop', name: 'Other SOP', expectedRevision: 0,
      idempotencyKey: 'asset-list-other', content: { version: 1 }, createdBy: 'owner-other',
    })

    await expect(repository.getAsset('org-list', 'sop-list-other')).resolves.toBeUndefined()
    await expect(repository.listAssetVersions('org-other', 'sop-list-a'))
      .rejects.toMatchObject({ code: 'not-found', resourceType: 'asset', resourceId: 'sop-list-a' })
    await expect(repository.listAssetVersions('org-list', 'sop-list-a'))
      .resolves.toMatchObject([{ version: 1 }, { version: 2 }])
    await expect(repository.listAssets({ orgId: 'org-list', kind: 'sop', archived: false, search: 'Sales' }))
      .resolves.toMatchObject({ items: [{ assetId: 'sop-list-a' }] })

    const archived = await repository.archiveAsset('org-list', 'sop-list-a', 2, 'archive-list-a')
    await expect(repository.archiveAsset('org-list', 'sop-list-a', 2, 'archive-list-a')).resolves.toEqual(archived)
    await expect(repository.archiveAsset('org-list', 'sop-list-a', 3, 'archive-list-a'))
      .rejects.toMatchObject({ code: 'idempotency-conflict', resourceType: 'asset' })
    await expect(repository.listAssets({ orgId: 'org-list', archived: true }))
      .resolves.toMatchObject({ items: [{ assetId: 'sop-list-a', revision: 3, archived: true }] })
  })

  it('migrates result-only idempotency rows for request-digest protected writes', async () => {
    const legacyClient = await pool.connect()
    const legacySchema = `dsh_catalog_legacy_${randomUUID().replaceAll('-', '')}`
    try {
      await legacyClient.query(`CREATE SCHEMA "${legacySchema}"`)
      await legacyClient.query(`SET search_path TO "${legacySchema}"`)
      await legacyClient.query('CREATE TABLE dsh_enterprise_catalog_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      await legacyClient.query("INSERT INTO dsh_enterprise_catalog_meta(key, value) VALUES ('schema-version', '1')")
      await legacyClient.query(`CREATE TABLE dsh_enterprise_catalog_idempotency (
        org_id TEXT NOT NULL, key TEXT NOT NULL, result_json JSONB NOT NULL, PRIMARY KEY(org_id, key))`)
      await migrateEnterpriseCatalog(new PgSchemaDatabase(legacyClient, legacySchema))

      const version = await legacyClient.query<{ value: string }>(
        "SELECT value FROM dsh_enterprise_catalog_meta WHERE key = 'schema-version'",
      )
      const column = await legacyClient.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'dsh_enterprise_catalog_idempotency' AND column_name = 'request_digest'`,
        [legacySchema],
      )
      expect(version.rows[0]?.value).toBe('5')
      expect(column.rows[0]?.column_name).toBe('request_digest')
    } finally {
      await legacyClient.query(`DROP SCHEMA IF EXISTS "${legacySchema}" CASCADE`)
      legacyClient.release()
    }
  })

  it('creates pagination and pg_trgm indexes that match literal-search expressions', async () => {
    await repository.listDrafts({ orgId: 'index-initialize' })
    const indexes = await database.query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1
       AND (indexname LIKE 'dsh_enterprise_%_query_idx' OR indexname LIKE 'dsh_enterprise_%_trgm_idx')
       ORDER BY indexname`,
      [schema],
    )
    expect(indexes.rows.map(row => row.indexname)).toEqual([
      'dsh_enterprise_asset_catalog_query_idx',
      'dsh_enterprise_asset_id_search_trgm_idx',
      'dsh_enterprise_asset_name_search_trgm_idx',
      'dsh_enterprise_employee_drafts_query_idx',
      'dsh_enterprise_employee_preset_search_trgm_idx',
      'dsh_enterprise_employee_profile_search_trgm_idx',
    ])
    expect(indexes.rows.filter(row => row.indexname.includes('trgm')).every(row => row.indexdef.includes('gin_trgm_ops'))).toBe(true)

    await database.query('SET enable_seqscan = off')
    const plans: Array<PostgresQueryResult<{ 'QUERY PLAN': string }>> = []
    for (const text of [
      `EXPLAIN SELECT * FROM dsh_enterprise_employee_drafts
       WHERE lower(preset_id) LIKE lower($1) ESCAPE '\\'`,
      `EXPLAIN SELECT * FROM dsh_enterprise_employee_drafts
       WHERE lower(profile_json::text) LIKE lower($1) ESCAPE '\\'`,
      `EXPLAIN SELECT * FROM dsh_enterprise_asset_catalog
       WHERE lower(asset_id) LIKE lower($1) ESCAPE '\\'`,
      `EXPLAIN SELECT * FROM dsh_enterprise_asset_catalog
       WHERE lower(name) LIKE lower($1) ESCAPE '\\'`,
    ]) plans.push(await database.query<{ 'QUERY PLAN': string }>(text, ['%Sales%']))
    expect(plans.every(plan => plan.rows.some(row => row['QUERY PLAN'].includes('trgm_idx')))).toBe(true)
  })
})
