import { describe, expect, it } from 'vitest'
import {
  EnterpriseCatalogRepository,
  EnterpriseCatalogError,
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
  private readonly idempotency = new Map<string, { request_digest?: string; result_json: unknown }>()
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
    if (text.startsWith('CREATE ') || text.startsWith('ALTER ') || text.startsWith('DROP ')
      || text.startsWith('SELECT pg_advisory_xact_lock')) return []
    if (text.startsWith('SELECT value FROM dsh_enterprise_catalog_meta')) {
      const value = this.meta.get('schema-version')
      return value === undefined ? [] : [{ value }]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_catalog_meta')) {
      this.meta.set('schema-version', String(values[0]))
      return []
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_catalog_idempotency')) {
      const result = this.idempotency.get(`${String(values[0])}:${String(values[1])}`)
      return result === undefined ? [] : [structuredClone(result)]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_catalog_idempotency')) {
      const hasDigest = text.includes('request_digest')
      this.idempotency.set(`${String(values[0])}:${String(values[1])}`, {
        ...(hasDigest ? { request_digest: String(values[2]), result_json: parse(values[3]) } : { result_json: parse(values[2]) }),
      })
      return []
    }
    if (text.includes('FROM dsh_enterprise_employee_drafts') && text.includes('ORDER BY updated_at DESC')) {
      let rows = [...this.drafts.values()].filter(row => row.org_id === String(values[0]))
      const statusIndex = columnParameter(text, 'status')
      const ownerIndex = columnParameter(text, 'owner_user_id')
      const visibilityIndex = columnParameter(text, 'visibility')
      const searchIndex = parameter(text, 'lower\\(preset_id\\) LIKE')
      const cursorUpdatedIndex = parameter(text, '\\(updated_at, preset_id\\) < \\(')
      if (statusIndex !== undefined) rows = rows.filter(row => row.status === values[statusIndex])
      if (ownerIndex !== undefined) rows = rows.filter(row => row.owner_user_id === values[ownerIndex])
      if (visibilityIndex !== undefined) rows = rows.filter(row => row.visibility === values[visibilityIndex])
      if (text.includes('dsh_enterprise_employee_drafts.visibility')) {
        const viewerIndex = parameter(text, 'dsh_enterprise_employee_drafts.owner_user_id =')
        const viewer = viewerIndex === undefined ? undefined : String(values[viewerIndex])
        rows = rows.filter(row => row.visibility === 'organization' || row.owner_user_id === viewer)
      }
      if (searchIndex !== undefined) {
        const search = String(values[searchIndex]).slice(1, -1).toLowerCase()
        rows = rows.filter(row => row.preset_id.toLowerCase().includes(search)
          || JSON.stringify(row.profile_json).toLowerCase().includes(search))
      }
      if (cursorUpdatedIndex !== undefined) {
        const updatedAt = Number(values[cursorUpdatedIndex])
        const presetId = String(values[cursorUpdatedIndex + 1])
        rows = rows.filter(row => row.updated_at < updatedAt || (row.updated_at === updatedAt && row.preset_id < presetId))
      }
      rows.sort((left, right) => right.updated_at - left.updated_at || right.preset_id.localeCompare(left.preset_id))
      return rows.slice(0, Number(values.at(-1))).map(clone)
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
      const draftId = text.includes("status = 'published'") ? values[0] : values.at(-1)
      const row = this.drafts.get(String(draftId))
      if (row === undefined) return []
      if (text.includes('profile_json')) {
        row.org_id = String(values[0]); row.owner_user_id = String(values[1]); row.visibility = String(values[2])
        row.profile_json = parse(values[3]); row.bindings_json = parse(values[4]); row.updated_at = Number(values[5])
      }
      if (text.includes("status = 'published'")) row.status = 'published'
      else if (text.includes("status = 'draft'")) row.status = 'draft'
      row.revision += 1
      return [clone(row)]
    }
    if (text.includes('FROM dsh_enterprise_asset_catalog') && text.includes('ORDER BY updated_at DESC')) {
      let rows = [...this.assets.values()].filter(row => row.org_id === String(values[0]))
      const kindIndex = parameter(text, 'kind =')
      const archivedIndex = parameter(text, 'archived =')
      const searchIndex = parameter(text, 'lower\\(asset_id\\) LIKE')
      const cursorUpdatedIndex = parameter(text, '\\(updated_at, asset_id\\) < \\(')
      if (kindIndex !== undefined) rows = rows.filter(row => row.kind === values[kindIndex])
      if (archivedIndex !== undefined) rows = rows.filter(row => row.archived === values[archivedIndex])
      if (searchIndex !== undefined) {
        const search = String(values[searchIndex]).slice(1, -1).toLowerCase()
        rows = rows.filter(row => row.asset_id.toLowerCase().includes(search) || row.name.toLowerCase().includes(search))
      }
      if (cursorUpdatedIndex !== undefined) {
        const updatedAt = Number(values[cursorUpdatedIndex])
        const assetId = String(values[cursorUpdatedIndex + 1])
        rows = rows.filter(row => row.updated_at < updatedAt || (row.updated_at === updatedAt && row.asset_id < assetId))
      }
      rows.sort((left, right) => right.updated_at - left.updated_at || right.asset_id.localeCompare(left.asset_id))
      return rows.slice(0, Number(values.at(-1))).map(clone)
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_asset_catalog')) {
      const row = this.assets.get(String(values[0]))
      return row === undefined || (text.includes('org_id = $2') && row.org_id !== values[1]) ? [] : [clone(row)]
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
      const row = this.assets.get(String(text.includes('archived = TRUE') ? values[1] : values.at(-1)))
      if (row === undefined) return []
      if (text.includes('archived = TRUE')) {
        if (row.org_id !== values[2] || row.revision !== values[3]) return []
        row.archived = true; row.updated_at = Number(values[0]); row.revision += 1
      }
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
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_asset_versions') && text.includes('ORDER BY version')) {
      return [...this.versions.values()].filter(row => row.asset_id === String(values[0]))
        .sort((left, right) => left.version - right.version).map(clone)
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
      return row === undefined || (text.includes('org_id = $2') && row.org_id !== values[1]) ? [] : [clone(row)]
    }
    if (text.startsWith('SELECT ') && text.includes('FROM dsh_enterprise_employee_releases WHERE preset_id')) {
      const rows = [...this.releases.values()].filter(row => row.preset_id === String(values[0]))
        .sort((left, right) => left.version - right.version)
      return (text.includes('ORDER BY version DESC') ? rows.reverse().slice(0, 1) : rows).map(clone)
    }
    if (text.startsWith('SELECT kind, asset_id, asset_version FROM dsh_enterprise_employee_release_assets')) {
      return [...this.bindings.values()].filter(row => row.release_id === String(values[0])).map(clone)
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
    idempotency: Map<string, { request_digest?: string; result_json: unknown }>
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
function parameter(text: string, prefix: string): number | undefined {
  const match = new RegExp(`${prefix}[^$]*\\$(\\d+)`, 'u').exec(text)
  return match?.[1] === undefined ? undefined : Number(match[1]) - 1
}
function columnParameter(text: string, column: string): number | undefined {
  const match = new RegExp(`(?:^|\\s)${column} = \\$(\\d+)`, 'u').exec(text)
  return match?.[1] === undefined ? undefined : Number(match[1]) - 1
}

const CURSOR_SIGNING_KEY = '0123456789abcdef0123456789abcdef'

function changeBase64urlPaddingBits(value: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const last = value.at(-1)
  if (last === undefined) throw new Error('base64url segment is empty')
  const index = alphabet.indexOf(last)
  const replacement = alphabet[(index & ~3) | ((index + 1) & 3)]
  if (replacement === undefined) throw new Error('base64url replacement is unavailable')
  return `${value.slice(0, -1)}${replacement}`
}

function catalogRepository(
  database: PostgresDatabase = new MemoryPostgresDatabase(),
  options: { now?: () => number } = {},
): EnterpriseCatalogRepository {
  return new EnterpriseCatalogRepository(database, { ...options, cursorSigningKey: CURSOR_SIGNING_KEY })
}

const firstDraft = {
  presetId: 'preset-sales', orgId: 'org-a', ownerUserId: 'user-a', expectedRevision: 0,
  idempotencyKey: 'draft-1', visibility: 'organization' as const,
  profile: { name: 'Sales assistant', prompt: 'Help the sales team.' },
  bindings: [],
}

describe('EnterpriseCatalogRepository', () => {
  it('learns and publishes an asset atomically without publishing pending profile edits', async () => {
    const repository = catalogRepository()
    await repository.saveDraft(firstDraft)
    await repository.publishDraft({ orgId: 'org-a', presetId: firstDraft.presetId, expectedRevision: 1, idempotencyKey: 'initial', publishedBy: 'user-a' })
    await repository.saveDraft({ ...firstDraft, expectedRevision: 2, idempotencyKey: 'pending', profile: { ...firstDraft.profile, prompt: 'Unpublished change' } })
    const input = { orgId: 'org-a', presetId: firstDraft.presetId, assetId: 'learned-sop', kind: 'sop' as const, name: 'Learned SOP', content: { content: 'Check the totals', workspaceRoot: '/managed/ops' }, actorUserId: 'user-a', idempotencyKey: 'learn-1' }
    const result = await repository.learnEmployeeAsset(input)
    expect(result.release.snapshot.profile.prompt).toBe('Help the sales team.')
    expect(result.release.snapshot.bindings).toContainEqual({ kind: 'sop', assetId: 'learned-sop', version: 1 })
    expect(await repository.getDraft(firstDraft.presetId, 'org-a')).toMatchObject({ profile: { prompt: 'Unpublished change' }, bindings: result.release.snapshot.bindings })
    expect(await repository.learnEmployeeAsset(input)).toEqual(result)
    expect(await repository.listAssetVersions('org-a', 'learned-sop')).toHaveLength(1)
    const next = await repository.learnEmployeeAsset({ ...input, assetId: 'learned-skill', kind: 'skill', idempotencyKey: 'learn-2' })
    expect(next.release.snapshot.bindings).toHaveLength(2)
    expect((await repository.listReleases(firstDraft.presetId, 'org-a'))[0]?.snapshot.bindings).toEqual([])
  })

  it('does not create learned assets for another organization or an unpublished employee', async () => {
    const repository = catalogRepository()
    await repository.saveDraft(firstDraft)
    const input = { orgId: 'org-a', presetId: firstDraft.presetId, assetId: 'learned-sop', kind: 'sop' as const, name: 'SOP', content: { content: 'Check totals' }, actorUserId: 'user-a', idempotencyKey: 'learn-1' }
    await expect(repository.learnEmployeeAsset(input)).rejects.toThrow()
    await expect(repository.learnEmployeeAsset({ ...input, orgId: 'org-b' })).rejects.toThrow()
    expect(await repository.getAsset('org-a', 'learned-sop')).toBeUndefined()
  })

  it('creates a versioned employee draft', async () => {
    const repository = catalogRepository(new MemoryPostgresDatabase(), { now: () => 100 })

    await expect(repository.saveDraft(firstDraft)).resolves.toMatchObject({ presetId: 'preset-sales', revision: 1, status: 'draft' })
  })

  it('returns the current release when an unchanged published draft is submitted again', async () => {
    const repository = catalogRepository()
    await repository.saveDraft(firstDraft)
    const first = await repository.publishDraft({
      orgId: 'org-a', presetId: firstDraft.presetId, expectedRevision: 1,
      idempotencyKey: 'publish-first', publishedBy: 'user-a',
    })
    const repeated = await repository.publishDraft({
      orgId: 'org-a', presetId: firstDraft.presetId, expectedRevision: 2,
      idempotencyKey: 'publish-repeat', publishedBy: 'user-a',
    })

    expect(repeated).toEqual(first)
    expect(await repository.listReleases(firstDraft.presetId, 'org-a')).toHaveLength(1)
    expect((await repository.getDraft(firstDraft.presetId, 'org-a'))?.revision).toBe(2)
  })

  it('rejects stale employee draft saves without overwriting the durable revision', async () => {
    const repository = catalogRepository()
    await repository.saveDraft(firstDraft)

    await expect(repository.saveDraft({ ...firstDraft, idempotencyKey: 'draft-stale', profile: { ...firstDraft.profile, name: 'Stale' } }))
      .rejects.toBeInstanceOf(EmployeeDraftRevisionConflictError)
    await expect(repository.getDraft('preset-sales', 'org-a')).resolves.toMatchObject({ profile: { name: 'Sales assistant' }, revision: 1 })
  })

  it('returns the original result only for an identical idempotent draft save', async () => {
    const repository = catalogRepository()
    const first = await repository.saveDraft(firstDraft)
    const retried = await repository.saveDraft(firstDraft)

    expect(retried).toEqual(first)
    await expect(repository.saveDraft({ ...firstDraft, profile: { ...firstDraft.profile, name: 'Different' } }))
      .rejects.toMatchObject({ constructor: EnterpriseCatalogError, code: 'idempotency-conflict' })
  })

  it('keeps releases immutable while pinning each capability binding to its version', async () => {
    const repository = catalogRepository(new MemoryPostgresDatabase(), { now: () => 200 })
    await repository.saveAssetVersion({
      assetId: 'model-standard', orgId: 'org-a', kind: 'model', name: 'Standard model', expectedRevision: 0,
      idempotencyKey: 'model-v1',
      content: { provider: 'deepseek', model: 'chat', credentialRef: 'DSH_MODEL_KEY' },
      createdBy: 'user-a',
    })
    await repository.saveAssetVersion({
      assetId: 'sop-quote', orgId: 'org-a', kind: 'sop', name: 'Quote', expectedRevision: 0,
      idempotencyKey: 'sop-v1', content: { steps: [{ action: 'check quote' }] }, createdBy: 'user-a',
    })
    await repository.saveDraft({
      ...firstDraft,
      bindings: [
        { kind: 'model', assetId: 'model-standard', version: 1 },
        { kind: 'sop', assetId: 'sop-quote', version: 1 },
      ],
      idempotencyKey: 'draft-with-sop',
      profile: { ...firstDraft.profile, modelRef: { kind: 'model', assetId: 'model-standard', version: 1 } },
    })
    const draft = await repository.getDraft('preset-sales', 'org-a')
    const release = await repository.publishDraft({
      orgId: 'org-a', presetId: 'preset-sales', expectedRevision: draft!.revision,
      idempotencyKey: 'release-1', publishedBy: 'user-a',
    })
    await repository.saveAssetVersion({
      assetId: 'sop-quote', orgId: 'org-a', kind: 'sop', name: 'Quote v2', expectedRevision: 1,
      idempotencyKey: 'sop-v2', content: { steps: [{ action: 'check quote' }, { action: 'confirm tax' }] }, createdBy: 'user-a',
    })

    expect(release.snapshot.bindings).toEqual([
      { kind: 'model', assetId: 'model-standard', version: 1 },
      { kind: 'sop', assetId: 'sop-quote', version: 1 },
    ])
    expect((await repository.listReleases('preset-sales', 'org-a'))[0]).toEqual(release)
    expect((await repository.listReleases('preset-sales', 'org-a'))[0].snapshot.profile.prompt).toBe('Help the sales team.')
    await expect(repository.getRelease(release.releaseId, 'org-a')).resolves.toEqual(release)
    await expect(repository.getRelease(release.releaseId, 'org-b')).resolves.toBeUndefined()
    await expect(repository.getRelease('missing-release', 'org-a')).resolves.toBeUndefined()
  })

  it('publishes a configured provider model route without requiring a model catalog asset', async () => {
    const repository = catalogRepository(new MemoryPostgresDatabase(), { now: () => 200 })
    await repository.saveDraft({
      ...firstDraft,
      idempotencyKey: 'draft-provider-route',
      profile: { ...firstDraft.profile, modelRef: 'deepseek/deepseek-v4-flash' },
      bindings: [],
    })

    await expect(repository.publishDraft({
      orgId: 'org-a', presetId: 'preset-sales', expectedRevision: 1,
      idempotencyKey: 'publish-provider-route', publishedBy: 'user-a',
    })).resolves.toMatchObject({
      snapshot: { profile: { modelRef: 'deepseek/deepseek-v4-flash' }, bindings: [] },
    })
  })

  it('rolls back by creating a new release from an immutable prior snapshot', async () => {
    const repository = catalogRepository()
    await repository.saveDraft(firstDraft)
    const first = await repository.publishDraft({
      orgId: 'org-a', presetId: 'preset-sales', expectedRevision: 1,
      idempotencyKey: 'publish-one', publishedBy: 'user-a',
    })
    const draft = await repository.getDraft('preset-sales', 'org-a')
    await repository.saveDraft({
      ...firstDraft, expectedRevision: draft!.revision, idempotencyKey: 'draft-two',
      profile: { ...firstDraft.profile, prompt: 'A new instruction.' },
    })
    const secondDraft = await repository.getDraft('preset-sales', 'org-a')
    await repository.publishDraft({
      orgId: 'org-a', presetId: 'preset-sales', expectedRevision: secondDraft!.revision,
      idempotencyKey: 'publish-two', publishedBy: 'user-a',
    })
    const currentDraft = await repository.getDraft('preset-sales', 'org-a')
    const rollback = await repository.rollbackRelease({
      orgId: 'org-a', presetId: 'preset-sales', releaseId: first.releaseId,
      expectedRevision: currentDraft!.revision,
      idempotencyKey: 'rollback-one', publishedBy: 'user-a',
    })

    expect(rollback.version).toBe(3)
    expect(rollback.releaseId).not.toBe(first.releaseId)
    expect(rollback.snapshot).toEqual(first.snapshot)
    expect(rollback.sourceReleaseId).toBe(first.releaseId)
  })

  it('rejects raw secret fields from assets and employee snapshots', async () => {
    const repository = catalogRepository()

    await expect(repository.saveAssetVersion({
      assetId: 'tool-dangerous', orgId: 'org-a', kind: 'tool', name: 'Dangerous', expectedRevision: 0,
      idempotencyKey: 'secret-asset', content: { apiKey: 'raw-secret' }, createdBy: 'user-a',
    })).rejects.toThrow('secret-bearing field apiKey')
    await expect(repository.saveDraft({
      ...firstDraft, idempotencyKey: 'secret-draft',
      profile: { ...firstDraft.profile, toolPolicy: { token: 'raw-secret' } },
    }))
      .rejects.toThrow('secret-bearing field token')
    for (const field of [
      'api-key', 'access_token', 'private_key', 'auth', 'headers',
      'refreshToken', 'openaiApiKey', 'webhookSecret', 'dbPassword',
      'proxyAuthorization', 'customHeaders',
    ]) {
      await expect(repository.saveAssetVersion({
        assetId: `tool-${field}`, orgId: 'org-a', kind: 'tool', name: 'Dangerous', expectedRevision: 0,
        idempotencyKey: `secret-${field}`, content: { [field]: 'raw-secret' }, createdBy: 'user-a',
      })).rejects.toThrow('secret-bearing field')
    }
  })

  it('rolls back all release writes when binding insertion fails', async () => {
    const database = new MemoryPostgresDatabase()
    const repository = catalogRepository(database)
    await repository.saveAssetVersion({
      assetId: 'sop-quote', orgId: 'org-a', kind: 'sop', name: 'Quote', expectedRevision: 0,
      idempotencyKey: 'sop-v1', content: { steps: [] }, createdBy: 'user-a',
    })
    await repository.saveDraft({ ...firstDraft, bindings: [{ kind: 'sop', assetId: 'sop-quote', version: 1 }] })
    database.failNextReleaseBinding = true

    await expect(repository.publishDraft({
      orgId: 'org-a', presetId: 'preset-sales', expectedRevision: 1,
      idempotencyKey: 'broken-release', publishedBy: 'user-a',
    }))
      .rejects.toThrow('injected release binding failure')
    await expect(repository.listReleases('preset-sales', 'org-a')).resolves.toEqual([])
    await expect(repository.getDraft('preset-sales', 'org-a')).resolves.toMatchObject({ revision: 1, status: 'draft' })
  })

  it('lists organization-scoped drafts with filters, stable cursors, and parameterized search', async () => {
    let now = 100
    const database = new MemoryPostgresDatabase()
    const repository = catalogRepository(database, { now: () => now })
    await repository.saveDraft(firstDraft)
    now = 200
    await repository.saveDraft({
      ...firstDraft, presetId: 'preset-support', ownerUserId: 'user-b', visibility: 'private',
      idempotencyKey: 'draft-support', profile: { name: 'Support employee' },
    })
    await repository.saveDraft({
      ...firstDraft, presetId: 'preset-other-org', orgId: 'org-b', idempotencyKey: 'draft-other',
    })

    const first = await repository.listDrafts({ orgId: 'org-a', limit: 1 })
    const second = await repository.listDrafts({ orgId: 'org-a', limit: 1, cursor: first.nextCursor })
    expect(first.items.map(item => item.presetId)).toEqual(['preset-support'])
    expect(second.items.map(item => item.presetId)).toEqual(['preset-sales'])
    expect(second.nextCursor).toBeUndefined()
    await expect(repository.listDrafts({
      orgId: 'org-a', ownerUserId: 'user-b', visibility: 'private', status: 'draft', search: "Support%' OR TRUE--",
    })).resolves.toMatchObject({ items: [] })
    expect(database.queries.some(query => query.includes("Support%' OR TRUE--"))).toBe(false)
  })

  it('rejects invalid draft list limits and opaque cursors', async () => {
    const repository = catalogRepository()
    await expect(repository.listDrafts({ orgId: 'org-a', limit: 0 })).rejects.toThrow('limit')
    await expect(repository.listDrafts({ orgId: 'org-a', limit: 101 })).rejects.toThrow('limit')
    await expect(repository.listDrafts({ orgId: 'org-a', cursor: 'not-a-cursor' })).rejects.toThrow('cursor')
    await repository.saveDraft(firstDraft)
    await repository.saveDraft({ ...firstDraft, presetId: 'preset-two', idempotencyKey: 'draft-two-for-cursor' })
    const page = await repository.listDrafts({ orgId: 'org-a', ownerUserId: 'user-a', limit: 1 })
    await expect(repository.listDrafts({ orgId: 'org-a', ownerUserId: 'user-b', cursor: page.nextCursor }))
      .rejects.toThrow('cursor')
  })

  it('paginates only drafts visible to the viewer without hidden empty pages', async () => {
    let now = 10
    const repository = catalogRepository(new MemoryPostgresDatabase(), { now: () => now++ })
    await repository.saveDraft({ ...firstDraft, presetId: 'owned', ownerUserId: 'viewer', visibility: 'private', idempotencyKey: 'owned' })
    await repository.saveDraft({ ...firstDraft, presetId: 'organization', ownerUserId: 'other', visibility: 'organization', idempotencyKey: 'organization' })
    await repository.saveDraft({ ...firstDraft, presetId: 'hidden', ownerUserId: 'other', visibility: 'private', idempotencyKey: 'hidden' })

    const first = await repository.listDrafts({ orgId: 'org-a', viewerUserId: 'viewer', limit: 1 })
    expect(first.items.map(item => item.presetId)).toEqual(['organization'])
    expect(first.nextCursor).toBeDefined()
    const second = await repository.listDrafts({
      orgId: 'org-a', viewerUserId: 'viewer', limit: 1, cursor: first.nextCursor,
    })
    expect(second.items.map(item => item.presetId)).toEqual(['owned'])
    expect(second.nextCursor).toBeUndefined()
  })

  it('gets and lists assets without exposing another organization', async () => {
    let now = 100
    const repository = catalogRepository(new MemoryPostgresDatabase(), { now: () => now })
    await repository.saveAssetVersion({
      assetId: 'sop-a', orgId: 'org-a', kind: 'sop', name: 'Sales SOP', expectedRevision: 0,
      idempotencyKey: 'asset-a', content: { steps: [] }, createdBy: 'user-a',
    })
    now = 200
    await repository.saveAssetVersion({
      assetId: 'tool-a', orgId: 'org-a', kind: 'tool', name: 'Sales Tool', expectedRevision: 0,
      idempotencyKey: 'tool-a', content: { command: 'safe' }, createdBy: 'user-a',
    })
    await repository.saveAssetVersion({
      assetId: 'sop-b', orgId: 'org-b', kind: 'sop', name: 'Other SOP', expectedRevision: 0,
      idempotencyKey: 'asset-b', content: { steps: [] }, createdBy: 'user-b',
    })

    await expect(repository.getAsset('org-a', 'sop-b')).resolves.toBeUndefined()
    const first = await repository.listAssets({ orgId: 'org-a', limit: 1, search: 'Sales' })
    const second = await repository.listAssets({ orgId: 'org-a', limit: 1, search: 'Sales', cursor: first.nextCursor })
    expect(first.items.map(item => item.assetId)).toEqual(['tool-a'])
    expect(second.items.map(item => item.assetId)).toEqual(['sop-a'])
    await expect(repository.listAssets({ orgId: 'org-a', kind: 'sop', archived: false }))
      .resolves.toMatchObject({ items: [{ assetId: 'sop-a' }] })
  })

  it('validates asset ownership before listing its versions', async () => {
    const repository = catalogRepository()
    await repository.saveAssetVersion({
      assetId: 'sop-owned', orgId: 'org-a', kind: 'sop', name: 'Owned', expectedRevision: 0,
      idempotencyKey: 'owned-v1', content: { version: 1 }, createdBy: 'user-a',
    })
    await repository.saveAssetVersion({
      assetId: 'sop-owned', orgId: 'org-a', kind: 'sop', name: 'Owned', expectedRevision: 1,
      idempotencyKey: 'owned-v2', content: { version: 2 }, createdBy: 'user-a',
    })

    await expect(repository.listAssetVersions('org-a', 'sop-owned'))
      .resolves.toMatchObject([{ version: 1 }, { version: 2 }])
    await expect(repository.listAssetVersions('org-b', 'sop-owned'))
      .rejects.toMatchObject({ code: 'not-found', resourceType: 'asset', resourceId: 'sop-owned' })
  })

  it('archives assets with CAS and request-digest protected idempotency', async () => {
    const repository = catalogRepository(new MemoryPostgresDatabase(), { now: () => 300 })
    await repository.saveAssetVersion({
      assetId: 'sop-archive', orgId: 'org-a', kind: 'sop', name: 'Archive me', expectedRevision: 0,
      idempotencyKey: 'archive-source', content: { steps: [] }, createdBy: 'user-a',
    })

    const archived = await repository.archiveAsset('org-a', 'sop-archive', 1, 'archive-key')
    await expect(repository.archiveAsset('org-a', 'sop-archive', 1, 'archive-key')).resolves.toEqual(archived)
    expect(archived).toMatchObject({ archived: true, revision: 2, updatedAt: 300 })
    await expect(repository.archiveAsset('org-a', 'sop-archive', 2, 'archive-key'))
      .rejects.toMatchObject({ code: 'idempotency-conflict', resourceType: 'asset' })
    await expect(repository.archiveAsset('org-b', 'sop-archive', 2, 'other-key'))
      .rejects.toMatchObject({ code: 'not-found', resourceType: 'asset', resourceId: 'sop-archive' })
  })

  it('rejects stale archive revisions without changing the asset', async () => {
    const repository = catalogRepository()
    await repository.saveAssetVersion({
      assetId: 'sop-cas', orgId: 'org-a', kind: 'sop', name: 'CAS', expectedRevision: 0,
      idempotencyKey: 'cas-source', content: { steps: [] }, createdBy: 'user-a',
    })

    await expect(repository.archiveAsset('org-a', 'sop-cas', 0, 'cas-archive'))
      .rejects.toBeInstanceOf(EmployeeDraftRevisionConflictError)
    await expect(repository.getAsset('org-a', 'sop-cas')).resolves.toMatchObject({ archived: false, revision: 1 })
  })

  it('rejects tampered cursors and cursors signed by another key', async () => {
    const database = new MemoryPostgresDatabase()
    const repository = catalogRepository(database)
    await repository.saveDraft(firstDraft)
    await repository.saveDraft({ ...firstDraft, presetId: 'preset-two', idempotencyKey: 'signed-two' })
    const first = await repository.listDrafts({ orgId: 'org-a', limit: 1 })
    const cursor = first.nextCursor!
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('A') ? 'B' : 'A'}`

    await expect(repository.listDrafts({ orgId: 'org-a', limit: 1, cursor: tampered }))
      .rejects.toMatchObject({ code: 'cursor-invalid', resourceType: 'employee' })
    const wrongKey = new EnterpriseCatalogRepository(database, {
      cursorSigningKey: 'fedcba9876543210fedcba9876543210',
    })
    await expect(wrongKey.listDrafts({ orgId: 'org-a', limit: 1, cursor }))
      .rejects.toMatchObject({ code: 'cursor-invalid', resourceType: 'employee' })
  })

  it('rejects non-canonical base64url segments even when padding bits decode identically', async () => {
    const database = new MemoryPostgresDatabase()
    const repository = catalogRepository(database)
    await repository.saveDraft(firstDraft)
    await repository.saveDraft({ ...firstDraft, presetId: 'preset-two', idempotencyKey: 'canonical-two' })
    const page = await repository.listDrafts({ orgId: 'org-a', limit: 1 })
    const [payload, signature] = page.nextCursor?.split('.') ?? []
    if (payload === undefined || signature === undefined) throw new Error('signed cursor is unavailable')
    const nonCanonical = `${payload}.${changeBase64urlPaddingBits(signature)}`
    expect(nonCanonical).not.toBe(`${payload}.${signature}`)

    await expect(repository.listDrafts({ orgId: 'org-a', limit: 1, cursor: nonCanonical }))
      .rejects.toMatchObject({ code: 'cursor-invalid', resourceType: 'employee' })
  })

  it('continues a cursor after repository restart with the same stable key', async () => {
    const database = new MemoryPostgresDatabase()
    const firstRepository = catalogRepository(database)
    await firstRepository.saveDraft(firstDraft)
    await firstRepository.saveDraft({ ...firstDraft, presetId: 'preset-two', idempotencyKey: 'restart-two' })
    const first = await firstRepository.listDrafts({ orgId: 'org-a', limit: 1 })
    const restarted = catalogRepository(database)

    await expect(restarted.listDrafts({ orgId: 'org-a', limit: 1, cursor: first.nextCursor }))
      .resolves.toMatchObject({ items: [{ presetId: 'preset-sales' }] })
  })

  it('allows an unsigned first page but refuses cursor generation and consumption without a key', async () => {
    const database = new MemoryPostgresDatabase()
    const unsigned = new EnterpriseCatalogRepository(database)
    await unsigned.saveDraft(firstDraft)
    await expect(unsigned.listDrafts({ orgId: 'org-a' })).resolves.toMatchObject({ items: [{ presetId: 'preset-sales' }] })
    await unsigned.saveDraft({ ...firstDraft, presetId: 'preset-two', idempotencyKey: 'unsigned-two' })
    await expect(unsigned.listDrafts({ orgId: 'org-a', limit: 1 })).rejects.toThrow('cursor signing key')

    const signed = catalogRepository(database)
    const page = await signed.listDrafts({ orgId: 'org-a', limit: 1 })
    await expect(unsigned.listDrafts({ orgId: 'org-a', limit: 1, cursor: page.nextCursor }))
      .rejects.toMatchObject({ code: 'cursor-invalid', resourceType: 'employee' })
  })
})
