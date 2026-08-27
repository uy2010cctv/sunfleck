/** Transactional employee draft/release and versioned asset repository. */

import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import type {
  CatalogAssetKind, CatalogCursorPage, CatalogListInput, EmployeeDraftInput, EmployeeDraftView,
  EmployeeReleaseView, EnterpriseAssetRef, EnterpriseAssetVersionView, EnterpriseAssetView,
  EnterpriseCatalogRepositoryOptions, ListEmployeeDraftsInput, ListEnterpriseAssetsInput,
  PostgresDatabase, SaveAssetVersionInput,
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

/**
 * Computes the catalog's canonical SHA-256 digest.
 * @param value - JSON-compatible value to digest.
 * @returns Lowercase hexadecimal SHA-256 digest.
 */
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
    if (/credentialRef$/u.test(key)) {
      if (typeof child !== 'string' || !isCredentialRefName(child)) {
        throw new Error(`catalog config contains invalid credential reference at ${fieldPath}`)
      }
      continue
    }
    const normalizedKey = key.replaceAll(/[^a-z0-9]/giu, '').toLowerCase()
    if (/(?:token|accesstoken|apikey|secret|password|privatekey|credential|authorization|bearer|headers|clientsecret)/u
      .test(normalizedKey) || normalizedKey === 'auth') {
      throw new Error(`catalog config contains secret-bearing field ${key} at ${fieldPath}`)
    }
    assertNoSecrets(child, fieldPath)
  }
}

/** Revision compare-and-swap failure for a draft or catalog asset. */
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

interface CatalogCursor {
  readonly version: 1
  readonly scope: string
  readonly updatedAt: number
  readonly id: string
}

const DEFAULT_LIST_LIMIT = 50

function listLimit(input: CatalogListInput): number {
  const limit = input.limit ?? DEFAULT_LIST_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('catalog list limit must be an integer from 1 to 100')
  return limit
}

function cursorScope(kind: 'draft' | 'asset', input: ListEmployeeDraftsInput | ListEnterpriseAssetsInput): string {
  if (kind === 'draft') {
    const draft = input as ListEmployeeDraftsInput
    return catalogDigest({
      kind, orgId: draft.orgId, search: draft.search,
      status: draft.status, ownerUserId: draft.ownerUserId, visibility: draft.visibility,
    })
  }
  const asset = input as ListEnterpriseAssetsInput
  return catalogDigest({
    kind, orgId: asset.orgId, search: asset.search, assetKind: asset.kind, archived: asset.archived,
  })
}

function cursorSigningKey(value: Buffer | string | undefined): Buffer | undefined {
  if (value === undefined) return undefined
  const key = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(value, 'utf8')
  return key.length === 0 ? undefined : key
}

function cursorSignature(payload: string, key: Buffer): Buffer {
  return createHmac('sha256', key).update(payload).digest()
}

function decodeCursor(value: string | undefined, scope: string, key: Buffer | undefined): CatalogCursor | undefined {
  if (value === undefined) return undefined
  if (key === undefined) throw new Error('catalog cursor signing key is required to consume a cursor')
  try {
    const segments = value.split('.')
    if (segments.length !== 2 || segments[0] === undefined || segments[1] === undefined) {
      throw new Error('catalog list cursor signature is invalid')
    }
    const supplied = Buffer.from(segments[1], 'base64url')
    const expected = cursorSignature(segments[0], key)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new Error('catalog list cursor signature is invalid')
    }
    const parsed: unknown = JSON.parse(Buffer.from(segments[0], 'base64url').toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('invalid')
    const cursor = parsed as Record<string, unknown>
    if (cursor['version'] !== 1 || cursor['scope'] !== scope
      || typeof cursor['updatedAt'] !== 'number' || !Number.isSafeInteger(cursor['updatedAt'])
      || typeof cursor['id'] !== 'string' || cursor['id'].length === 0) throw new Error('invalid')
    return cursor as unknown as CatalogCursor
  } catch (error) {
    if (error instanceof Error && error.message.includes('signature')) throw error
    throw new Error('catalog list cursor is invalid or belongs to another query')
  }
}

function encodeCursor(scope: string, updatedAt: number, id: string, key: Buffer | undefined): string {
  if (key === undefined) throw new Error('catalog cursor signing key is required to generate a cursor')
  const payload = Buffer.from(JSON.stringify({ version: 1, scope, updatedAt, id } satisfies CatalogCursor)).toString('base64url')
  return `${payload}.${cursorSignature(payload, key).toString('base64url')}`
}

function escapedSearch(value: string): string {
  return `%${value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
}

/** Transactional PostgreSQL repository for enterprise employees and capability assets. */
export class EnterpriseCatalogRepository {
  private initialized: Promise<void> | undefined
  private readonly cursorKey: Buffer | undefined
  constructor(
    private readonly database: PostgresDatabase,
    private readonly options: EnterpriseCatalogRepositoryOptions = {},
  ) {
    this.cursorKey = cursorSigningKey(options.cursorSigningKey)
  }

  private now(): number { return this.options.now?.() ?? Date.now() }

  private initialize(): Promise<void> {
    this.initialized ??= migrateEnterpriseCatalog(this.database)
    return this.initialized
  }

  /**
   * Saves an employee draft after revision and secret checks.
   * @param input - Organization-scoped draft and write controls.
   * @returns Persisted draft at its new revision, or the recorded idempotent result.
   */
  async saveDraft(input: EmployeeDraftInput): Promise<EmployeeDraftView> {
    await this.initialize()
    assertNoSecrets(input.profile)
    assertNoSecrets(input.bindings)
    return this.database.transaction(async (database) => {
      await this.lock(database, `${input.orgId}:draft:${input.presetId}`)
      const prior = await this.idempotent<EmployeeDraftView>(database, input.orgId, 'draft', input.idempotencyKey)
      if (prior !== undefined) return prior
      const current = await database.query<DraftRow>(
        'SELECT * FROM dsh_enterprise_employee_drafts WHERE preset_id = $1 FOR UPDATE', [input.presetId],
      )
      const row = current.rows[0]
      if (row !== undefined && row.org_id !== input.orgId) {
        throw new Error(`employee draft ${input.presetId} is outside organization ${input.orgId}`)
      }
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
      await this.remember(database, input.orgId, 'draft', input.idempotencyKey, view)
      return view
    })
  }

  /**
   * Reads an employee draft without widening organization scope.
   * @param presetId - Native Agent Preset identifier.
   * @param orgId - Organization allowed to own the draft.
   * @returns The draft, or `undefined` when no draft exists in that organization.
   */
  async getDraft(presetId: string, orgId: string): Promise<EmployeeDraftView | undefined> {
    await this.initialize()
    const result = await this.database.query<DraftRow>(
      'SELECT * FROM dsh_enterprise_employee_drafts WHERE preset_id = $1 AND org_id = $2', [presetId, orgId],
    )
    return result.rows[0] === undefined ? undefined : this.draft(result.rows[0])
  }

  /**
   * Lists drafts inside one organization using a stable, query-bound cursor.
   * @param input - Organization scope, optional filters, limit, and prior cursor.
   * @returns One page and a cursor only when another matching row exists.
   */
  async listDrafts(input: ListEmployeeDraftsInput): Promise<CatalogCursorPage<EmployeeDraftView>> {
    await this.initialize()
    const limit = listLimit(input)
    const scope = cursorScope('draft', input)
    const cursor = decodeCursor(input.cursor, scope, this.cursorKey)
    const values: unknown[] = [input.orgId]
    const filters = ['org_id = $1']
    const add = (sql: string, value: unknown): void => {
      values.push(value)
      filters.push(`${sql} $${String(values.length)}`)
    }
    if (input.status !== undefined) add('status =', input.status)
    if (input.ownerUserId !== undefined) add('owner_user_id =', input.ownerUserId)
    if (input.visibility !== undefined) add('visibility =', input.visibility)
    if (input.search !== undefined) {
      values.push(escapedSearch(input.search))
      filters.push(`(lower(preset_id) LIKE lower($${String(values.length)}) ESCAPE '\\' OR lower(profile_json::text) LIKE lower($${String(values.length)}) ESCAPE '\\')`)
    }
    if (cursor !== undefined) {
      values.push(cursor.updatedAt, cursor.id)
      filters.push(`(updated_at, preset_id) < ($${String(values.length - 1)}, $${String(values.length)})`)
    }
    values.push(limit + 1)
    const result = await this.database.query<DraftRow>(
      `SELECT * FROM dsh_enterprise_employee_drafts WHERE ${filters.join(' AND ')}
       ORDER BY updated_at DESC, preset_id DESC LIMIT $${String(values.length)}`,
      values,
    )
    const rows = result.rows.slice(0, limit)
    const last = rows.at(-1)
    return {
      items: rows.map(row => this.draft(row)),
      ...(result.rows.length > limit && last !== undefined
        ? { nextCursor: encodeCursor(scope, Number(last.updated_at), last.preset_id, this.cursorKey) }
        : {}),
    }
  }

  /**
   * Saves a new immutable asset version after revision and secret checks.
   * @param input - Organization-scoped asset content and write controls.
   * @returns Persisted version, or the recorded idempotent result.
   */
  async saveAssetVersion(input: SaveAssetVersionInput): Promise<EnterpriseAssetVersionView> {
    await this.initialize()
    assertNoSecrets(input.content)
    return this.database.transaction(async (database) => {
      await this.lock(database, `${input.orgId}:asset:${input.assetId}`)
      const prior = await this.idempotent<EnterpriseAssetVersionView>(database, input.orgId, 'asset', input.idempotencyKey)
      if (prior !== undefined) return prior
      const existing = await database.query<AssetRow>(
        'SELECT * FROM dsh_enterprise_asset_catalog WHERE asset_id = $1 FOR UPDATE', [input.assetId],
      )
      const asset = existing.rows[0]
      if (asset !== undefined && (asset.org_id !== input.orgId || asset.kind !== input.kind)) {
        throw new Error(`asset ${input.assetId} is outside organization ${input.orgId} or has a different kind`)
      }
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
      await this.remember(database, input.orgId, 'asset', input.idempotencyKey, view)
      return view
    })
  }

  /**
   * Returns an asset only when it belongs to the requested organization.
   * @param orgId - Organization allowed to own the asset.
   * @param assetId - Catalog asset identifier.
   * @returns The asset, or `undefined` when it is absent from that organization.
   */
  async getAsset(orgId: string, assetId: string): Promise<EnterpriseAssetView | undefined> {
    await this.initialize()
    const result = await this.database.query<AssetRow>(
      'SELECT * FROM dsh_enterprise_asset_catalog WHERE asset_id = $1 AND org_id = $2', [assetId, orgId],
    )
    return result.rows[0] === undefined ? undefined : this.asset(result.rows[0])
  }

  /**
   * Lists assets inside one organization using a stable, query-bound cursor.
   * @param input - Organization scope, optional filters, limit, and prior cursor.
   * @returns One page and a cursor only when another matching row exists.
   */
  async listAssets(input: ListEnterpriseAssetsInput): Promise<CatalogCursorPage<EnterpriseAssetView>> {
    await this.initialize()
    const limit = listLimit(input)
    const scope = cursorScope('asset', input)
    const cursor = decodeCursor(input.cursor, scope, this.cursorKey)
    const values: unknown[] = [input.orgId]
    const filters = ['org_id = $1']
    const add = (sql: string, value: unknown): void => {
      values.push(value)
      filters.push(`${sql} $${String(values.length)}`)
    }
    if (input.kind !== undefined) add('kind =', input.kind)
    if (input.archived !== undefined) add('archived =', input.archived)
    if (input.search !== undefined) {
      values.push(escapedSearch(input.search))
      filters.push(`(lower(asset_id) LIKE lower($${String(values.length)}) ESCAPE '\\' OR lower(name) LIKE lower($${String(values.length)}) ESCAPE '\\')`)
    }
    if (cursor !== undefined) {
      values.push(cursor.updatedAt, cursor.id)
      filters.push(`(updated_at, asset_id) < ($${String(values.length - 1)}, $${String(values.length)})`)
    }
    values.push(limit + 1)
    const result = await this.database.query<AssetRow>(
      `SELECT * FROM dsh_enterprise_asset_catalog WHERE ${filters.join(' AND ')}
       ORDER BY updated_at DESC, asset_id DESC LIMIT $${String(values.length)}`,
      values,
    )
    const rows = result.rows.slice(0, limit)
    const last = rows.at(-1)
    return {
      items: rows.map(row => this.asset(row)),
      ...(result.rows.length > limit && last !== undefined
        ? { nextCursor: encodeCursor(scope, Number(last.updated_at), last.asset_id, this.cursorKey) }
        : {}),
    }
  }

  /**
   * Lists immutable versions after proving organization ownership.
   * @param orgId - Organization allowed to own the asset.
   * @param assetId - Catalog asset identifier.
   * @returns Versions in ascending version order.
   */
  async listAssetVersions(orgId: string, assetId: string): Promise<EnterpriseAssetVersionView[]> {
    await this.initialize()
    const asset = await this.getAsset(orgId, assetId)
    if (asset === undefined) throw new Error(`asset ${assetId} does not exist in organization ${orgId}`)
    const result = await this.database.query<VersionRow>(
      'SELECT * FROM dsh_enterprise_asset_versions WHERE asset_id = $1 ORDER BY version', [assetId],
    )
    return result.rows.map(row => this.version(row))
  }

  /**
   * Logically archives an asset with revision CAS and request-bound idempotency.
   * @param orgId - Organization allowed to own the asset.
   * @param assetId - Catalog asset identifier.
   * @param expectedRevision - Revision that must still be current.
   * @param idempotencyKey - Caller key bound to this exact archive request.
   * @returns Archived asset at its advanced revision, or the exact retry's recorded result.
   */
  async archiveAsset(
    orgId: string, assetId: string, expectedRevision: number, idempotencyKey: string,
  ): Promise<EnterpriseAssetView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `${orgId}:asset:${assetId}`)
      const digest = catalogDigest({ orgId, assetId, expectedRevision })
      const prior = await database.query<{ request_digest: string | null; result_json: unknown }>(
        'SELECT request_digest, result_json FROM dsh_enterprise_catalog_idempotency WHERE org_id = $1 AND key = $2',
        [orgId, `archive:${idempotencyKey}`],
      )
      if (prior.rows[0] !== undefined) {
        if (prior.rows[0].request_digest !== digest) throw new Error('catalog idempotency key was reused with a different request')
        return parse(prior.rows[0].result_json) as EnterpriseAssetView
      }
      const current = await database.query<AssetRow>(
        'SELECT * FROM dsh_enterprise_asset_catalog WHERE asset_id = $1 AND org_id = $2 FOR UPDATE', [assetId, orgId],
      )
      const asset = current.rows[0]
      if (asset === undefined) throw new Error(`asset ${assetId} does not exist in organization ${orgId}`)
      const actual = Number(asset.revision)
      if (actual !== expectedRevision) throw new EmployeeDraftRevisionConflictError(assetId, expectedRevision, actual)
      if (asset.archived) throw new Error(`asset ${assetId} is already archived`)
      const updated = await database.query<AssetRow>(
        `UPDATE dsh_enterprise_asset_catalog SET archived = TRUE, updated_at = $1, revision = revision + 1
         WHERE asset_id = $2 AND org_id = $3 AND revision = $4 RETURNING *`,
        [this.now(), assetId, orgId, expectedRevision],
      )
      const row = updated.rows[0]
      if (row === undefined) throw new EmployeeDraftRevisionConflictError(assetId, expectedRevision, actual)
      const view = this.asset(row)
      await database.query(
        `INSERT INTO dsh_enterprise_catalog_idempotency(org_id, key, request_digest, result_json)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [orgId, `archive:${idempotencyKey}`, digest, JSON.stringify(view)],
      )
      return view
    })
  }

  /**
   * Publishes an immutable employee release from the current draft.
   * @param input - Organization scope, revision, actor, and idempotency controls.
   * @returns Published release, or the recorded idempotent result.
   */
  async publishDraft(input: {
    orgId: string
    presetId: string
    expectedRevision: number
    idempotencyKey: string
    publishedBy: string
  }): Promise<EmployeeReleaseView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `${input.orgId}:draft:${input.presetId}`)
      const prior = await this.idempotent<EmployeeReleaseView>(database, input.orgId, 'publish', input.idempotencyKey)
      if (prior !== undefined) return prior
      const draftResult = await database.query<DraftRow>(
        'SELECT * FROM dsh_enterprise_employee_drafts WHERE preset_id = $1 AND org_id = $2 FOR UPDATE',
        [input.presetId, input.orgId],
      )
      const draft = draftResult.rows[0]
      if (draft === undefined) throw new Error(`employee draft ${input.presetId} does not exist`)
      if (Number(draft.revision) !== input.expectedRevision) {
        throw new EmployeeDraftRevisionConflictError(input.presetId, input.expectedRevision, Number(draft.revision))
      }
      const snapshot = { profile: object(draft.profile_json), bindings: refs(draft.bindings_json) }
      assertNoSecrets(snapshot)
      const modelRef = snapshot.profile['modelRef']
      if (modelRef !== undefined) {
        if (typeof modelRef !== 'object' || modelRef === null || Array.isArray(modelRef)) {
          throw new Error('employee release modelRef is invalid')
        }
        const ref = modelRef as Record<string, unknown>
        const bound = snapshot.bindings.some(binding => binding.kind === 'model'
          && binding.assetId === ref['assetId'] && binding.version === ref['version'])
        if (!bound) throw new Error('employee release modelRef is not pinned in bindings')
      }
      const max = await database.query<{ version: number | string }>(
        'SELECT MAX(version) AS version FROM dsh_enterprise_employee_releases WHERE preset_id = $1 AND org_id = $2',
        [input.presetId, input.orgId],
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
        const asset = await database.query<AssetRow>(
          'SELECT * FROM dsh_enterprise_asset_catalog WHERE asset_id = $1 FOR UPDATE', [binding.assetId],
        )
        const assetRow = asset.rows[0]
        if (assetRow === undefined || assetRow.org_id !== draft.org_id || assetRow.kind !== binding.kind || assetRow.archived) {
          throw new Error(`employee release binding ${binding.assetId} is unavailable in organization ${draft.org_id}`)
        }
        const assetVersion = await database.query<VersionRow>(
          'SELECT * FROM dsh_enterprise_asset_versions WHERE asset_id = $1 AND version = $2',
          [binding.assetId, binding.version],
        )
        if (assetVersion.rows[0] === undefined) throw new Error(`employee release binding ${binding.assetId}@${String(binding.version)} does not exist`)
        await database.query(
          'INSERT INTO dsh_enterprise_employee_release_assets(release_id, kind, asset_id, asset_version) VALUES ($1, $2, $3, $4)',
          [releaseId, binding.kind, binding.assetId, binding.version],
        )
      }
      const revised = await database.query(
        "UPDATE dsh_enterprise_employee_drafts SET status = 'published', revision = revision + 1 WHERE preset_id = $1 AND org_id = $2 AND revision = $3",
        [input.presetId, input.orgId, input.expectedRevision],
      )
      if (revised.rowCount !== 1) {
        throw new EmployeeDraftRevisionConflictError(input.presetId, input.expectedRevision, Number(draft.revision))
      }
      const view = this.release(required(release.rows[0], 'catalog release insert returned no row'))
      await this.remember(database, draft.org_id, 'publish', input.idempotencyKey, view)
      return view
    })
  }

  /**
   * Lists immutable releases for one organization-owned Preset.
   * @param presetId - Native Agent Preset identifier.
   * @param orgId - Organization allowed to own the releases.
   * @returns Releases in ascending version order.
   */
  async listReleases(presetId: string, orgId: string): Promise<EmployeeReleaseView[]> {
    await this.initialize()
    const result = await this.database.query<ReleaseRow>(
      'SELECT * FROM dsh_enterprise_employee_releases WHERE preset_id = $1 AND org_id = $2 ORDER BY version', [presetId, orgId],
    )
    return result.rows.map(row => this.release(row))
  }

  /**
   * Publishes a new release from an earlier immutable snapshot.
   * @param input - Source release, organization, revision, actor, and idempotency controls.
   * @returns Newly published release whose source identifies the prior release.
   */
  async rollbackRelease(input: {
    orgId: string
    presetId: string
    releaseId: string
    expectedRevision: number
    idempotencyKey: string
    publishedBy: string
  }): Promise<EmployeeReleaseView> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `${input.orgId}:draft:${input.presetId}`)
      const prior = await this.idempotent<EmployeeReleaseView>(database, input.orgId, 'rollback', input.idempotencyKey)
      if (prior !== undefined) return prior
      const sourceResult = await database.query<ReleaseRow>(
        'SELECT * FROM dsh_enterprise_employee_releases WHERE release_id = $1 FOR UPDATE', [input.releaseId],
      )
      const source = sourceResult.rows[0]
      if (source === undefined || source.preset_id !== input.presetId) {
        throw new Error(`employee release ${input.releaseId} does not exist`)
      }
      if (source.org_id !== input.orgId) throw new Error(`employee release ${input.releaseId} is outside organization ${input.orgId}`)
      const draftResult = await database.query<DraftRow>(
        'SELECT * FROM dsh_enterprise_employee_drafts WHERE preset_id = $1 AND org_id = $2 FOR UPDATE',
        [input.presetId, input.orgId],
      )
      const draftRow = draftResult.rows[0]
      if (draftRow === undefined) throw new Error(`employee draft ${input.presetId} does not exist`)
      const draft = this.draft(draftRow)
      if (draft.revision !== input.expectedRevision) {
        throw new EmployeeDraftRevisionConflictError(input.presetId, input.expectedRevision, draft.revision)
      }
      const max = await database.query<{ version: number | string }>(
        'SELECT MAX(version) AS version FROM dsh_enterprise_employee_releases WHERE preset_id = $1 AND org_id = $2',
        [input.presetId, input.orgId],
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
      const newReleaseId = release.rows[0]?.release_id
      if (newReleaseId === undefined) throw new Error('catalog rollback insert returned no row')
      const bindings = await database.query<{
        kind: string
        asset_id: string
        asset_version: number | string
      }>(
        'SELECT kind, asset_id, asset_version FROM dsh_enterprise_employee_release_assets WHERE release_id = $1',
        [source.release_id],
      )
      for (const binding of bindings.rows) {
        await database.query(
          'INSERT INTO dsh_enterprise_employee_release_assets(release_id, kind, asset_id, asset_version) VALUES ($1, $2, $3, $4)',
          [newReleaseId, binding.kind, binding.asset_id, Number(binding.asset_version)],
        )
      }
      const revised = await database.query(
        "UPDATE dsh_enterprise_employee_drafts SET status = 'published', revision = revision + 1 WHERE preset_id = $1 AND org_id = $2 AND revision = $3",
        [input.presetId, input.orgId, input.expectedRevision],
      )
      if (revised.rowCount !== 1) {
        throw new EmployeeDraftRevisionConflictError(input.presetId, input.expectedRevision, draft.revision)
      }
      const view = this.release(required(release.rows[0], 'catalog rollback insert returned no row'))
      await this.remember(database, input.orgId, 'rollback', input.idempotencyKey, view)
      return view
    })
  }

  private async idempotent<T>(database: PostgresDatabase, orgId: string, operation: string, key: string): Promise<T | undefined> {
    const result = await database.query<{ result_json: unknown }>(
      'SELECT result_json FROM dsh_enterprise_catalog_idempotency WHERE org_id = $1 AND key = $2',
      [orgId, `${operation}:${key}`],
    )
    return result.rows[0] === undefined ? undefined : parse(result.rows[0].result_json) as T
  }

  private async lock(database: PostgresDatabase, resource: string): Promise<void> {
    await database.query('SELECT pg_advisory_xact_lock(hashtext($1))', [resource])
  }
  private async remember(database: PostgresDatabase, orgId: string, operation: string, key: string, value: unknown): Promise<void> {
    await database.query(
      'INSERT INTO dsh_enterprise_catalog_idempotency(org_id, key, result_json) VALUES ($1, $2, $3::jsonb)',
      [orgId, `${operation}:${key}`, JSON.stringify(value)],
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
    const normalizedSnapshot = { profile: object(snapshot.profile), bindings: refs(snapshot.bindings) }
    if (catalogDigest(normalizedSnapshot) !== row.digest) {
      throw new Error(`catalog release ${row.release_id} digest verification failed`)
    }
    return {
      releaseId: row.release_id, presetId: row.preset_id, orgId: row.org_id,
      version: Number(row.version), digest: row.digest,
      snapshot: normalizedSnapshot,
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
  private asset(row: AssetRow): EnterpriseAssetView {
    return {
      assetId: row.asset_id, orgId: row.org_id, kind: row.kind, name: row.name,
      revision: Number(row.revision), archived: row.archived, updatedAt: Number(row.updated_at),
    }
  }
}
