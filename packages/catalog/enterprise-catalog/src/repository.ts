/** Transactional employee draft/release and versioned asset repository. */

import { createHash, randomUUID } from 'node:crypto'
import type {
  CatalogAssetKind, EmployeeDraftInput, EmployeeDraftView, EmployeeReleaseView,
  EnterpriseAssetRef, EnterpriseAssetVersionView, PostgresDatabase,
  SaveAssetVersionInput,
} from './types.ts'
import { migrateEnterpriseCatalog } from './schema.ts'

function parse(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value
}

function object(value: unknown): Record<string, unknown> {
  const parsed = parse(value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('catalog JSON value is not an object')
  return parsed as Record<string, unknown>
}

function refs(value: unknown): EnterpriseAssetRef[] {
  const parsed = parse(value)
  if (!Array.isArray(parsed)) throw new Error('catalog bindings are not an array')
  return parsed as EnterpriseAssetRef[]
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function catalogDigest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

function assertNoSecrets(value: unknown, path = 'config'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      assertNoSecrets(item, `${path}[${String(index)}]`)
    })
    return
  }
  if (typeof value !== 'object' || value === null) return
  for (const [key, child] of Object.entries(value)) {
    const fieldPath = `${path}.${key}`
    if (!key.endsWith('Ref') && /(token|secret|password|apiKey|privateKey|credential)/iu.test(key)) {
      throw new Error(`catalog config contains secret-bearing field ${key} at ${fieldPath}`)
    }
    assertNoSecrets(child, fieldPath)
  }
}

export class EmployeeDraftRevisionConflictError extends Error {
  constructor(
    readonly presetId: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`employee draft ${presetId} revision conflict: expected ${String(expected)}, actual ${String(actual)}`)
  }
}

interface DraftRow extends Record<string, unknown> {
  readonly preset_id: string
  readonly org_id: string
  readonly owner_user_id: string
  readonly visibility: EmployeeDraftInput['visibility']
  readonly profile_json: unknown
  readonly bindings_json: unknown
  readonly status: EmployeeDraftView['status']
  readonly revision: number | string
  readonly updated_at: number | string
}

interface ReleaseRow extends Record<string, unknown> {
  readonly release_id: string
  readonly preset_id: string
  readonly org_id: string
  readonly version: number | string
  readonly digest: string
  readonly snapshot_json: unknown
  readonly published_by: string
  readonly published_at: number | string
  readonly source_release_id: string | null
}

interface AssetRow extends Record<string, unknown> {
  readonly asset_id: string
  readonly org_id: string
  readonly kind: CatalogAssetKind
  readonly name: string
  readonly revision: number | string
  readonly archived: boolean
  readonly updated_at: number | string
}

interface VersionRow extends Record<string, unknown> {
  readonly asset_id: string
  readonly version: number | string
  readonly content_json: unknown
  readonly created_by: string
  readonly created_at: number | string
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

export class EnterpriseCatalogRepository {
  private initialized: Promise<void> | undefined
  constructor(private readonly database: PostgresDatabase, private readonly options: { now?: () => number } = {}) {}

  private now(): number { return this.options.now?.() ?? Date.now() }

  private initialize(): Promise<void> {
    this.initialized ??= migrateEnterpriseCatalog(this.database)
    return this.initialized
  }

  async saveDraft(input: EmployeeDraftInput): Promise<EmployeeDraftView> {
    await this.initialize()
    assertNoSecrets(input.profile)
    assertNoSecrets(input.bindings)
    return this.database.transaction(async (database) => {
      const prior = await this.idempotent<EmployeeDraftView>(database, input.orgId, input.idempotencyKey)
      if (prior !== undefined) return prior
      const current = await database.query<DraftRow>(
        'SELECT * FROM dsh_enterprise_employee_drafts WHERE preset_id = $1', [input.presetId],
      )
      const row = current.rows[0]
      const actual = row === undefined ? 0 : Number(row.revision)
      if (actual !== input.expectedRevision) {
        throw new EmployeeDraftRevisionConflictError(input.presetId, input.expectedRevision, actual)
      }
      const updatedAt = this.now()
      const result = row === undefined
        ? await database.query<DraftRow>(
          `INSERT INTO dsh_enterprise_employee_drafts(
             preset_id, org_id, owner_user_id, visibility, profile_json, bindings_json, status, revision, updated_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'draft', 1, $7) RETURNING *`,
          [input.presetId, input.orgId, input.ownerUserId, input.visibility,
            JSON.stringify(input.profile), JSON.stringify(input.bindings), updatedAt],
        )
        : await database.query<DraftRow>(
          `UPDATE dsh_enterprise_employee_drafts SET
             org_id = $1, owner_user_id = $2, visibility = $3, profile_json = $4::jsonb,
             bindings_json = $5::jsonb, updated_at = $6, revision = revision + 1, status = 'draft'
           WHERE preset_id = $7 RETURNING *`,
          [input.orgId, input.ownerUserId, input.visibility, JSON.stringify(input.profile),
            JSON.stringify(input.bindings), updatedAt, input.presetId],
        )
      const view = this.draft(required(result.rows[0], 'catalog draft insert returned no row'))
      await this.remember(database, input.orgId, input.idempotencyKey, view)
      return view
    })
  }

  async getDraft(presetId: string): Promise<EmployeeDraftView | undefined> {
    await this.initialize()
    const result = await this.database.query<DraftRow>(
      'SELECT * FROM dsh_enterprise_employee_drafts WHERE preset_id = $1', [presetId],
    )
    return result.rows[0] === undefined ? undefined : this.draft(result.rows[0])
  }

  async saveAssetVersion(input: SaveAssetVersionInput): Promise<EnterpriseAssetVersionView> {
    await this.initialize()
    assertNoSecrets(input.content)
    return this.database.transaction(async (database) => {
      const prior = await this.idempotent<EnterpriseAssetVersionView>(database, input.orgId, input.idempotencyKey)
      if (prior !== undefined) return prior
      const existing = await database.query<AssetRow>(
        'SELECT * FROM dsh_enterprise_asset_catalog WHERE asset_id = $1', [input.assetId],
      )
      const asset = existing.rows[0]
      const actual = asset === undefined ? 0 : Number(asset.revision)
      if (actual !== input.expectedRevision) {
        throw new EmployeeDraftRevisionConflictError(input.assetId, input.expectedRevision, actual)
      }
      if (asset === undefined) {
        await database.query(
          `INSERT INTO dsh_enterprise_asset_catalog(
             asset_id, org_id, kind, name, revision, archived, updated_at)
           VALUES ($1, $2, $3, $4, 1, FALSE, $5) RETURNING *`,
          [input.assetId, input.orgId, input.kind, input.name, this.now()],
        )
      } else {
        await database.query(
          `UPDATE dsh_enterprise_asset_catalog SET name = $1, updated_at = $2,
             revision = revision + 1, archived = FALSE WHERE asset_id = $3 RETURNING *`,
          [input.name, this.now(), input.assetId],
        )
      }
      const max = await database.query<{ version: number | string }>(
        'SELECT MAX(version) AS version FROM dsh_enterprise_asset_versions WHERE asset_id = $1', [input.assetId],
      )
      const version = Number(max.rows[0]?.version ?? 0) + 1
      const result = await database.query<VersionRow>(
        `INSERT INTO dsh_enterprise_asset_versions(
           asset_id, version, content_json, created_by, created_at)
         VALUES ($1, $2, $3::jsonb, $4, $5) RETURNING *`,
        [input.assetId, version, JSON.stringify(input.content), input.createdBy, this.now()],
      )
      const view = this.version(required(result.rows[0], 'catalog asset version insert returned no row'))
      await this.remember(database, input.orgId, input.idempotencyKey, view)
      return view
    })
  }

  async publishDraft(input: {
    presetId: string
    expectedRevision: number
    idempotencyKey: string
    publishedBy: string
  }): Promise<EmployeeReleaseView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      const draftResult = await database.query<DraftRow>(
        'SELECT * FROM dsh_enterprise_employee_drafts WHERE preset_id = $1', [input.presetId],
      )
      const draft = draftResult.rows[0]
      if (draft === undefined) throw new Error(`employee draft ${input.presetId} does not exist`)
      if (Number(draft.revision) !== input.expectedRevision) {
        throw new EmployeeDraftRevisionConflictError(input.presetId, input.expectedRevision, Number(draft.revision))
      }
      const snapshot = { profile: object(draft.profile_json), bindings: refs(draft.bindings_json) }
      assertNoSecrets(snapshot)
      const max = await database.query<{ version: number | string }>(
        'SELECT MAX(version) AS version FROM dsh_enterprise_employee_releases WHERE preset_id = $1', [input.presetId],
      )
      const version = Number(max.rows[0]?.version ?? 0) + 1
      const releaseId = randomUUID()
      const release = await database.query<ReleaseRow>(
        `INSERT INTO dsh_enterprise_employee_releases(
           release_id, preset_id, org_id, version, digest, snapshot_json,
           published_by, published_at, source_release_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NULL) RETURNING *`,
        [releaseId, draft.preset_id, draft.org_id, version, catalogDigest(snapshot),
          JSON.stringify(snapshot), input.publishedBy, this.now()],
      )
      for (const binding of snapshot.bindings) {
        await database.query(
          'INSERT INTO dsh_enterprise_employee_release_assets(release_id, kind, asset_id, asset_version) VALUES ($1, $2, $3, $4)',
          [releaseId, binding.kind, binding.assetId, binding.version],
        )
      }
      await database.query(
        "UPDATE dsh_enterprise_employee_drafts SET status = 'published', revision = revision + 1 WHERE preset_id = $1",
        [input.presetId],
      )
      return this.release(required(release.rows[0], 'catalog release insert returned no row'))
    })
  }

  async listReleases(presetId: string): Promise<EmployeeReleaseView[]> {
    await this.initialize()
    const result = await this.database.query<ReleaseRow>(
      'SELECT * FROM dsh_enterprise_employee_releases WHERE preset_id = $1 ORDER BY version', [presetId],
    )
    return result.rows.map(row => this.release(row))
  }

  async rollbackRelease(input: {
    presetId: string
    releaseId: string
    expectedRevision: number
    idempotencyKey: string
    publishedBy: string
  }): Promise<EmployeeReleaseView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      const prior = await this.idempotent<EmployeeReleaseView>(database, 'rollback', input.idempotencyKey)
      if (prior !== undefined) return prior
      const sourceResult = await database.query<ReleaseRow>(
        'SELECT * FROM dsh_enterprise_employee_releases WHERE release_id = $1', [input.releaseId],
      )
      const source = sourceResult.rows[0]
      if (source === undefined || source.preset_id !== input.presetId) {
        throw new Error(`employee release ${input.releaseId} does not exist`)
      }
      const draft = await this.getDraft(input.presetId)
      if (draft === undefined) throw new Error(`employee draft ${input.presetId} does not exist`)
      if (draft.revision !== input.expectedRevision) {
        throw new EmployeeDraftRevisionConflictError(input.presetId, input.expectedRevision, draft.revision)
      }
      const max = await database.query<{ version: number | string }>(
        'SELECT MAX(version) AS version FROM dsh_enterprise_employee_releases WHERE preset_id = $1', [input.presetId],
      )
      const version = Number(max.rows[0]?.version ?? 0) + 1
      const release = await database.query<ReleaseRow>(
        `INSERT INTO dsh_enterprise_employee_releases(
           release_id, preset_id, org_id, version, digest, snapshot_json,
           published_by, published_at, source_release_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9) RETURNING *`,
        [randomUUID(), source.preset_id, source.org_id, version, source.digest,
          JSON.stringify(parse(source.snapshot_json)), input.publishedBy, this.now(), source.release_id],
      )
      const view = this.release(required(release.rows[0], 'catalog rollback insert returned no row'))
      await this.remember(database, 'rollback', input.idempotencyKey, view)
      return view
    })
  }

  private async idempotent<T>(database: PostgresDatabase, orgId: string, key: string): Promise<T | undefined> {
    const result = await database.query<{ result_json: unknown }>(
      'SELECT result_json FROM dsh_enterprise_catalog_idempotency WHERE org_id = $1 AND key = $2', [orgId, key],
    )
    return result.rows[0] === undefined ? undefined : parse(result.rows[0].result_json) as T
  }
  private async remember(database: PostgresDatabase, orgId: string, key: string, value: unknown): Promise<void> {
    await database.query(
      'INSERT INTO dsh_enterprise_catalog_idempotency(org_id, key, result_json) VALUES ($1, $2, $3::jsonb)',
      [orgId, key, JSON.stringify(value)],
    )
  }
  private draft(row: DraftRow): EmployeeDraftView {
    return {
      presetId: row.preset_id, orgId: row.org_id, ownerUserId: row.owner_user_id,
      visibility: row.visibility, profile: object(row.profile_json), bindings: refs(row.bindings_json),
      revision: Number(row.revision), status: row.status, updatedAt: Number(row.updated_at),
    }
  }
  private release(row: ReleaseRow): EmployeeReleaseView {
    const snapshot = object(row.snapshot_json)
    return {
      releaseId: row.release_id, presetId: row.preset_id, orgId: row.org_id,
      version: Number(row.version), digest: row.digest,
      snapshot: { profile: object(snapshot.profile), bindings: refs(snapshot.bindings) },
      publishedBy: row.published_by, publishedAt: Number(row.published_at),
      ...(row.source_release_id === null ? {} : { sourceReleaseId: row.source_release_id }),
    }
  }
  private version(row: VersionRow): EnterpriseAssetVersionView {
    return {
      assetId: row.asset_id, version: Number(row.version), content: object(row.content_json),
      createdBy: row.created_by, createdAt: Number(row.created_at),
    }
  }
}
