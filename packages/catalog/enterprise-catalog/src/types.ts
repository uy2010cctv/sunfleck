/** Driver-neutral contracts for the DSH enterprise employee and asset catalog. */

/** Capability categories stored by the enterprise catalog. */
export type CatalogAssetKind = 'sop' | 'knowledge' | 'skill' | 'tool' | 'model'
/** Organization visibility assigned to an employee draft. */
export type CatalogVisibility = 'organization' | 'private' | 'restricted'

/** Common cursor pagination fields for organization-scoped catalog lists. */
export interface CatalogListInput {
  readonly orgId: string
  readonly limit?: number
  readonly cursor?: string
  readonly search?: string
}

/** One cursor page whose cursor is meaningful only for the originating query. */
export interface CatalogCursorPage<Item> {
  readonly items: readonly Item[]
  readonly nextCursor?: string
}

/** Filters accepted by the employee draft management list. */
export interface ListEmployeeDraftsInput extends CatalogListInput {
  readonly status?: EmployeeDraftView['status']
  readonly ownerUserId?: string
  readonly visibility?: CatalogVisibility
  readonly viewerUserId?: string
  readonly includeAllVisible?: boolean
}

/** Filters accepted by the capability asset management list. */
export interface ListEnterpriseAssetsInput extends CatalogListInput {
  readonly kind?: CatalogAssetKind
  readonly archived?: boolean
}

/** Immutable capability version pinned by an employee release. */
export interface EnterpriseAssetRef {
  readonly kind: CatalogAssetKind
  readonly assetId: string
  readonly version: number
}

/** Revision-checked employee draft save request. */
export interface EmployeeDraftInput {
  readonly presetId: string
  readonly orgId: string
  readonly ownerUserId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly visibility: CatalogVisibility
  readonly profile: Readonly<Record<string, unknown>>
  readonly bindings: readonly EnterpriseAssetRef[]
}

/** Persisted employee draft returned to management consumers. */
export interface EmployeeDraftView extends Omit<EmployeeDraftInput, 'expectedRevision' | 'idempotencyKey'> {
  readonly revision: number
  readonly status: 'draft' | 'published'
  readonly updatedAt: number
}

/** Immutable published employee snapshot. */
export interface EmployeeReleaseView {
  readonly releaseId: string
  readonly presetId: string
  readonly orgId: string
  readonly version: number
  readonly digest: string
  readonly snapshot: {
    readonly profile: Readonly<Record<string, unknown>>
    readonly bindings: readonly EnterpriseAssetRef[]
  }
  readonly publishedBy: string
  readonly publishedAt: number
  readonly sourceReleaseId?: string
}

/** Revision-checked asset version save request. */
export interface SaveAssetVersionInput {
  readonly assetId: string
  readonly orgId: string
  readonly kind: CatalogAssetKind
  readonly name: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly content: Readonly<Record<string, unknown>>
  readonly createdBy: string
}

/** One employee-owned learned text capability, committed with its binding and release. */
export interface LearnEmployeeAssetInput {
  readonly orgId: string
  readonly presetId: string
  readonly assetId: string
  readonly kind: 'sop' | 'skill'
  readonly name: string
  readonly content: Readonly<Record<string, unknown>>
  readonly actorUserId: string
  readonly idempotencyKey: string
}

/** Current metadata for one versioned catalog asset. */
export interface EnterpriseAssetView {
  readonly assetId: string
  readonly orgId: string
  readonly kind: CatalogAssetKind
  readonly name: string
  readonly revision: number
  readonly archived: boolean
  readonly updatedAt: number
}

/** Immutable content and authorship for one asset version. */
export interface EnterpriseAssetVersionView {
  readonly assetId: string
  readonly version: number
  readonly content: Readonly<Record<string, unknown>>
  readonly createdBy: string
  readonly createdAt: number
}

/** Driver-neutral subset of a PostgreSQL query result. */
export interface PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[]
  readonly rowCount: number | null
}

/** Query and caller-owned transaction operations required by the catalog. */
export interface PostgresDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>
  transaction<T>(operation: (database: PostgresDatabase) => Promise<T>): Promise<T>
}

/** Clock and stable HMAC key used by one catalog repository instance. */
export interface EnterpriseCatalogRepositoryOptions {
  readonly now?: () => number
  readonly cursorSigningKey?: Buffer | string
}
