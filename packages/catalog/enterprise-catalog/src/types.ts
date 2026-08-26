/** Driver-neutral contracts for the DSH enterprise employee and asset catalog. */

export type CatalogAssetKind = 'sop' | 'knowledge' | 'skill' | 'tool' | 'model'
export type CatalogVisibility = 'organization' | 'private' | 'restricted'

export interface EnterpriseAssetRef {
  readonly kind: CatalogAssetKind
  readonly assetId: string
  readonly version: number
}

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

export interface EmployeeDraftView extends Omit<EmployeeDraftInput, 'expectedRevision' | 'idempotencyKey'> {
  readonly revision: number
  readonly status: 'draft' | 'published'
  readonly updatedAt: number
}

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

export interface EnterpriseAssetView {
  readonly assetId: string
  readonly orgId: string
  readonly kind: CatalogAssetKind
  readonly name: string
  readonly revision: number
  readonly archived: boolean
  readonly updatedAt: number
}

export interface EnterpriseAssetVersionView {
  readonly assetId: string
  readonly version: number
  readonly content: Readonly<Record<string, unknown>>
  readonly createdBy: string
  readonly createdAt: number
}

export interface PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[]
  readonly rowCount: number | null
}

export interface PostgresDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>
  transaction<T>(operation: (database: PostgresDatabase) => Promise<T>): Promise<T>
}
