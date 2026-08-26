import { describe, expect, it } from 'vitest'
import {
  EnterpriseCatalogRepository,
  EmployeeDraftRevisionConflictError,
  type PostgresDatabase,
  type PostgresQueryResult,
} from '../src/index.ts'

interface DraftRow {
  preset_id: string
  org_id: string
  owner_user_id: string
  visibility: string
  profile_json: unknown
  bindings_json: unknown
  status: string
  revision: number
  updated_at: number
}

interface ReleaseRow {
  release_id: string
  preset_id: string
  org_id: string
  version: number
  digest: string
  snapshot_json: unknown
  published_by: string
  published_at: number
  source_release_id: string | null
}

interface AssetRow {
  asset_id: string
  org_id: string
  kind: string
  name: string
  revision: number
  archived: boolean
  updated_at: number
}

interface AssetVersionRow {
  asset_id: string
  version: number
  content_json: unknown
  created_by: string
  created_at: number
}

/** Minimal transactional PostgreSQL double for the catalog repository's parameterized SQL. */
class MemoryPostgresDatabase implements PostgresDatabase {
  readonly queries: string[] = []
  private readonly meta = new Map<string, string>()
  private readonly drafts = new Map<string, DraftRow>()
  private readonly releases = new Map<string, ReleaseRow>()
  private readonly assets = new Map<string, AssetRow>()
  private readonly versions = new Map<string, AssetVersionRow>()
  private readonly bindings = new Map<string, { release_id: string; kind: string; asset_id: string; asset_version: number }>()
  private readonly idempotency = new Map<string, unknown>()
  failNextReleaseBinding = false

  async transaction<T>(action: (transaction: MemoryPostgresDatabase) => Promise<T>): Promise<T> {
    const checkpoint = structuredClone({
      meta: this.meta, drafts: this.drafts, releases: this.releases, assets: this.assets,
      versions: this.versions, bindings: this.bindings, idempotency: this.idempotency,
    })
    try {
      return await action(this)
    } catch (error: unknown) {
      this.restore(checkpoint)
      throw error
    }
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    this.queries.push(text)
    const rows = this.rows(text, values)
    return { rows: rows as Row[], rowCount: rows.length }
  }

  private rows(text: string, values: readonly unknown[]): Record<string, unknown>[] {
    if (text.startsWith('CREATE ') || text.startsWith('SELECT pg_advisory_xact_lock')) return []
    if (text.startsWith('SELECT value FROM dsh_enterprise_catalog_meta')) {
      const value = this.meta.get('schema-version')
      return value === undefined ? [] : [{ value }]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_catalog_meta')) {
      this.meta.set('schema-version', String(values[0]))
      return []
    }
    if (text.startsWith('SELECT result_json FROM dsh_enterprise_catalog_idempotency')) {
      const result = this.idempotency.get(`${String(values[0])}:${String(values[1])}`)
      return result === undefined ? [] : [{ result_json: structuredClone(result) }]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_catalog_idempotency')) {
      this.idempotency.set(`${String(values[0])}:${String(values[1])}`, parse(values[2]))
      return []
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_employee_drafts')) {
      const row = this.drafts.get(String(values[0]))
      return row === undefined ? [] : [clone(row)]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_employee_drafts')) {
      const row: DraftRow = {
        preset_id: String(values[0]), org_id: String(values[1]), owner_user_id: String(values[2]),
        visibility: String(values[3]), profile_json: parse(values[4]), bindings_json: parse(values[5]),
        status: 'draft', revision: 1, updated_at: Number(values[6]),
      }
      this.drafts.set(row.preset_id, row)
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_employee_drafts')) {
      const row = this.drafts.get(String(values.at(-1)))
      if (row === undefined) return []
      if (text.includes('profile_json')) {
        row.org_id = String(values[0]); row.owner_user_id = String(values[1]); row.visibility = String(values[2])
        row.profile_json = parse(values[3]); row.bindings_json = parse(values[4]); row.updated_at = Number(values[5])
      }
      if (text.includes("status = 'published'")) row.status = 'published'
      row.revision += 1
      return [clone(row)]
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_asset_catalog')) {
      const row = this.assets.get(String(values[0]))
      return row === undefined ? [] : [clone(row)]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_asset_catalog')) {
      const row: AssetRow = {
        asset_id: String(values[0]), org_id: String(values[1]), kind: String(values[2]), name: String(values[3]),
        revision: 1, archived: false, updated_at: Number(values[4]),
      }
      this.assets.set(row.asset_id, row)
      return [clone(row)]
    }
    if (text.startsWith('UPDATE dsh_enterprise_asset_catalog')) {
      const row = this.assets.get(String(values.at(-1)))
      if (row === undefined) return []
      if (text.includes('archived = TRUE')) row.archived = true
      else { row.name = String(values[0]); row.updated_at = Number(values[1]); row.revision += 1 }
      return [clone(row)]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_asset_versions')) {
      const row: AssetVersionRow = {
        asset_id: String(values[0]), version: Number(values[1]), content_json: parse(values[2]),
        created_by: String(values[3]), created_at: Number(values[4]),
      }
      this.versions.set(`${row.asset_id}:${row.version}`, row)
      return [clone(row)]
    }
    if (text.startsWith('SELECT MAX(version) AS version FROM dsh_enterprise_asset_versions')) {
      const assetId = String(values[0])
      const result = [...this.versions.values()].filter(row => row.asset_id === assetId)
      return [{ version: result.length === 0 ? 0 : Math.max(...result.map(row => row.version)) }]
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_asset_versions')) {
      const row = this.versions.get(`${String(values[0])}:${Number(values[1])}`)
      return row === undefined ? [] : [clone(row)]
    }
    if (text.startsWith('SELECT MAX(version) AS version FROM dsh_enterprise_employee_releases')) {
      const presetId = String(values[0])
      const found = [...this.releases.values()].filter(row => row.preset_id === presetId)
      return [{ version: found.length === 0 ? 0 : Math.max(...found.map(row => row.version)) }]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_employee_releases')) {
      const row: ReleaseRow = {
        release_id: String(values[0]), preset_id: String(values[1]), org_id: String(values[2]), version: Number(values[3]),
        digest: String(values[4]), snapshot_json: parse(values[5]), published_by: String(values[6]), published_at: Number(values[7]),
        source_release_id: values[8] === null || values[8] === undefined
          ? null
          : typeof values[8] === 'string' ? values[8] : JSON.stringify(values[8]),
      }
      this.releases.set(row.release_id, row)
      return [clone(row)]
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_employee_releases WHERE release_id')) {
      const row = this.releases.get(String(values[0]))
      return row === undefined ? [] : [clone(row)]
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_employee_releases WHERE preset_id')) {
      return [...this.releases.values()].filter(row => row.preset_id === String(values[0]))
        .sort((left, right) => left.version - right.version).map(clone)
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_employee_release_assets')) {
      if (this.failNextReleaseBinding) { this.failNextReleaseBinding = false; throw new Error('injected release binding failure') }
      const row = { release_id: String(values[0]), kind: String(values[1]), asset_id: String(values[2]), asset_version: Number(values[3]) }
      this.bindings.set(`${row.release_id}:${row.kind}:${row.asset_id}`, row)
      return []
    }
    throw new Error(`unhandled catalog PostgreSQL test query: ${text}`)
  }

  private restore(snapshot: {
    meta: Map<string, string>
    drafts: Map<string, DraftRow>
    releases: Map<string, ReleaseRow>
    assets: Map<string, AssetRow>
    versions: Map<string, AssetVersionRow>
    bindings: Map<string, { release_id: string; kind: string; asset_id: string; asset_version: number }>
    idempotency: Map<string, unknown>
  }): void {
    this.meta.clear()
    this.drafts.clear()
    this.releases.clear()
    this.assets.clear()
    this.versions.clear()
    this.bindings.clear()
    this.idempotency.clear()
    for (const [key, value] of snapshot.meta) this.meta.set(key, value)
    for (const [key, value] of snapshot.drafts) this.drafts.set(key, value)
    for (const [key, value] of snapshot.releases) this.releases.set(key, value)
    for (const [key, value] of snapshot.assets) this.assets.set(key, value)
    for (const [key, value] of snapshot.versions) this.versions.set(key, value)
    for (const [key, value] of snapshot.bindings) this.bindings.set(key, value)
    for (const [key, value] of snapshot.idempotency) this.idempotency.set(key, value)
  }
}

function parse(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value }
function clone<T>(value: T): T { return structuredClone(value) }

const firstDraft = {
  presetId: 'preset-sales', orgId: 'org-a', ownerUserId: 'user-a', expectedRevision: 0,
  idempotencyKey: 'draft-1', visibility: 'organization' as const,
  profile: { name: 'Sales assistant', prompt: 'Help the sales team.' },
  bindings: [],
}

describe('EnterpriseCatalogRepository', () => {
  it('creates a versioned employee draft', async () => {
    const repository = new EnterpriseCatalogRepository(new MemoryPostgresDatabase(), { now: () => 100 })

    await expect(repository.saveDraft(firstDraft)).resolves.toMatchObject({ presetId: 'preset-sales', revision: 1, status: 'draft' })
  })

  it('rejects stale employee draft saves without overwriting the durable revision', async () => {
    const repository = new EnterpriseCatalogRepository(new MemoryPostgresDatabase())
    await repository.saveDraft(firstDraft)

    await expect(repository.saveDraft({ ...firstDraft, idempotencyKey: 'draft-stale', profile: { ...firstDraft.profile, name: 'Stale' } }))
      .rejects.toBeInstanceOf(EmployeeDraftRevisionConflictError)
    await expect(repository.getDraft('preset-sales')).resolves.toMatchObject({ profile: { name: 'Sales assistant' }, revision: 1 })
  })

  it('returns the original result for an idempotent draft save', async () => {
    const repository = new EnterpriseCatalogRepository(new MemoryPostgresDatabase())
    const first = await repository.saveDraft(firstDraft)
    const retried = await repository.saveDraft({ ...firstDraft, profile: { ...firstDraft.profile, name: 'Ignored by idempotency' } })

    expect(retried).toEqual(first)
  })

  it('keeps releases immutable while pinning each capability binding to its version', async () => {
    const repository = new EnterpriseCatalogRepository(new MemoryPostgresDatabase(), { now: () => 200 })
    await repository.saveAssetVersion({
      assetId: 'model-standard', orgId: 'org-a', kind: 'model', name: 'Standard model', expectedRevision: 0,
      idempotencyKey: 'model-v1',
      content: { provider: 'deepseek', model: 'chat', credentialRef: 'credential:model-standard' },
      createdBy: 'user-a',
    })
    await repository.saveAssetVersion({
      assetId: 'sop-quote', orgId: 'org-a', kind: 'sop', name: 'Quote', expectedRevision: 0,
      idempotencyKey: 'sop-v1', content: { steps: [{ action: 'check quote' }] }, createdBy: 'user-a',
    })
    await repository.saveDraft({
      ...firstDraft, bindings: [{ kind: 'sop', assetId: 'sop-quote', version: 1 }], idempotencyKey: 'draft-with-sop',
      profile: { ...firstDraft.profile, modelRef: { kind: 'model', assetId: 'model-standard', version: 1 } },
    })
    const draft = await repository.getDraft('preset-sales')
    const release = await repository.publishDraft({
      presetId: 'preset-sales', expectedRevision: draft!.revision,
      idempotencyKey: 'release-1', publishedBy: 'user-a',
    })
    await repository.saveAssetVersion({
      assetId: 'sop-quote', orgId: 'org-a', kind: 'sop', name: 'Quote v2', expectedRevision: 1,
      idempotencyKey: 'sop-v2', content: { steps: [{ action: 'check quote' }, { action: 'confirm tax' }] }, createdBy: 'user-a',
    })

    expect(release.snapshot.bindings).toEqual([{ kind: 'sop', assetId: 'sop-quote', version: 1 }])
    expect((await repository.listReleases('preset-sales'))[0]).toEqual(release)
    expect((await repository.listReleases('preset-sales'))[0].snapshot.profile.prompt).toBe('Help the sales team.')
  })

  it('rolls back by creating a new release from an immutable prior snapshot', async () => {
    const repository = new EnterpriseCatalogRepository(new MemoryPostgresDatabase())
    await repository.saveDraft(firstDraft)
    const first = await repository.publishDraft({
      presetId: 'preset-sales', expectedRevision: 1,
      idempotencyKey: 'publish-one', publishedBy: 'user-a',
    })
    const draft = await repository.getDraft('preset-sales')
    await repository.saveDraft({
      ...firstDraft, expectedRevision: draft!.revision, idempotencyKey: 'draft-two',
      profile: { ...firstDraft.profile, prompt: 'A new instruction.' },
    })
    const secondDraft = await repository.getDraft('preset-sales')
    await repository.publishDraft({
      presetId: 'preset-sales', expectedRevision: secondDraft!.revision,
      idempotencyKey: 'publish-two', publishedBy: 'user-a',
    })
    const currentDraft = await repository.getDraft('preset-sales')
    const rollback = await repository.rollbackRelease({
      presetId: 'preset-sales', releaseId: first.releaseId,
      expectedRevision: currentDraft!.revision,
      idempotencyKey: 'rollback-one', publishedBy: 'user-a',
    })

    expect(rollback.version).toBe(3)
    expect(rollback.releaseId).not.toBe(first.releaseId)
    expect(rollback.snapshot).toEqual(first.snapshot)
    expect(rollback.sourceReleaseId).toBe(first.releaseId)
  })

  it('rejects raw secret fields from assets and employee snapshots', async () => {
    const repository = new EnterpriseCatalogRepository(new MemoryPostgresDatabase())

    await expect(repository.saveAssetVersion({
      assetId: 'tool-dangerous', orgId: 'org-a', kind: 'tool', name: 'Dangerous', expectedRevision: 0,
      idempotencyKey: 'secret-asset', content: { apiKey: 'raw-secret' }, createdBy: 'user-a',
    })).rejects.toThrow('secret-bearing field apiKey')
    await expect(repository.saveDraft({
      ...firstDraft, idempotencyKey: 'secret-draft',
      profile: { ...firstDraft.profile, toolPolicy: { token: 'raw-secret' } },
    }))
      .rejects.toThrow('secret-bearing field token')
  })

  it('rolls back all release writes when binding insertion fails', async () => {
    const database = new MemoryPostgresDatabase()
    const repository = new EnterpriseCatalogRepository(database)
    await repository.saveAssetVersion({
      assetId: 'sop-quote', orgId: 'org-a', kind: 'sop', name: 'Quote', expectedRevision: 0,
      idempotencyKey: 'sop-v1', content: { steps: [] }, createdBy: 'user-a',
    })
    await repository.saveDraft({ ...firstDraft, bindings: [{ kind: 'sop', assetId: 'sop-quote', version: 1 }] })
    database.failNextReleaseBinding = true

    await expect(repository.publishDraft({
      presetId: 'preset-sales', expectedRevision: 1,
      idempotencyKey: 'broken-release', publishedBy: 'user-a',
    }))
      .rejects.toThrow('injected release binding failure')
    await expect(repository.listReleases('preset-sales')).resolves.toEqual([])
    await expect(repository.getDraft('preset-sales')).resolves.toMatchObject({ revision: 1, status: 'draft' })
  })
})
