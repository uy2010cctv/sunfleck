import type { EnterpriseAssetKind } from './employees.ts'

export interface EnterpriseAsset {
  assetId: string
  orgId: string
  kind: EnterpriseAssetKind
  name: string
  revision: number
  archived: boolean
  updatedAt: number
}
export interface EnterpriseAssetVersion {
  assetId: string
  version: number
  content: Readonly<Record<string, JsonValue>>
  createdBy: string
  createdAt: number
}
export interface EnterpriseAssetPage {
  items: readonly EnterpriseAsset[]
  nextCursor?: string
}
export interface EnterpriseAssetListRequest {
  readonly limit?: number
  readonly cursor?: string
  readonly search?: string
  readonly kind?: EnterpriseAssetKind
  readonly archived?: boolean
}
export interface EnterpriseAssetLookup { readonly assetId: string }
export interface EnterpriseAssetSaveRequest {
  readonly assetId: string
  readonly kind: EnterpriseAssetKind
  readonly name: string
  readonly content: Readonly<Record<string, JsonValue>>
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface EnterpriseAssetArchiveRequest {
  readonly assetId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
