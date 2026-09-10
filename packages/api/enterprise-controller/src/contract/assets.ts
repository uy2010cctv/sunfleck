import type { EnterpriseAssetKind } from './employees.ts'

/** Data used by `EnterpriseAsset`. */
export interface EnterpriseAsset {
  assetId: string
  orgId: string
  kind: EnterpriseAssetKind
  name: string
  revision: number
  archived: boolean
  updatedAt: number
}
/** Data used by `EnterpriseAssetVersion`. */
export interface EnterpriseAssetVersion {
  assetId: string
  version: number
  content: Readonly<Record<string, JsonValue>>
  createdBy: string
  createdAt: number
}
/** Data used by `EnterpriseAssetPage`. */
export interface EnterpriseAssetPage {
  items: readonly EnterpriseAsset[]
  nextCursor?: string
}
/** Data used by `EnterpriseAssetListRequest`. */
export interface EnterpriseAssetListRequest {
  readonly limit?: number
  readonly cursor?: string
  readonly search?: string
  readonly kind?: EnterpriseAssetKind
  readonly archived?: boolean
}
/** Data used by `EnterpriseAssetLookup`. */
export interface EnterpriseAssetLookup { readonly assetId: string }
/** Data used by `EnterpriseAssetSaveRequest`. */
export interface EnterpriseAssetSaveRequest {
  readonly assetId: string
  readonly kind: EnterpriseAssetKind
  readonly name: string
  readonly content: Readonly<Record<string, JsonValue>>
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
/** Data used by `EnterpriseAssetArchiveRequest`. */
export interface EnterpriseAssetArchiveRequest {
  readonly assetId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
