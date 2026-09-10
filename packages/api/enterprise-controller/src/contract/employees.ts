/** Allowed values for `EnterpriseAssetKind`. */
export type EnterpriseAssetKind = 'sop' | 'knowledge' | 'skill' | 'tool' | 'model'
/** Allowed values for `EnterpriseVisibility`. */
export type EnterpriseVisibility = 'organization' | 'private' | 'restricted'
/** Data used by `EnterpriseEmployeeAssetRef`. */
export interface EnterpriseEmployeeAssetRef {
  kind: EnterpriseAssetKind
  assetId: string
  version: number
}
/** Data used by `EnterpriseEmployeeDraft`. */
export interface EnterpriseEmployeeDraft {
  presetId: string
  orgId: string
  ownerUserId: string
  visibility: EnterpriseVisibility
  profile: Readonly<Record<string, JsonValue>>
  bindings: readonly EnterpriseEmployeeAssetRef[]
  revision: number
  status: 'draft' | 'published'
  updatedAt: number
}
/** Data used by `EnterpriseEmployeeRelease`. */
export interface EnterpriseEmployeeRelease {
  releaseId: string
  presetId: string
  orgId: string
  version: number
  digest: string
  snapshot: {
    profile: Readonly<Record<string, JsonValue>>
    bindings: readonly EnterpriseEmployeeAssetRef[]
  }
  publishedBy: string
  publishedAt: number
  sourceReleaseId?: string
}
/** Data used by `EnterpriseEmployeePage`. */
export interface EnterpriseEmployeePage {
  items: readonly EnterpriseEmployeeDraft[]
  nextCursor?: string
}

/** Data used by `EnterpriseEmployeeListRequest`. */
export interface EnterpriseEmployeeListRequest {
  readonly limit?: number
  readonly cursor?: string
  readonly search?: string
  readonly status?: EnterpriseEmployeeDraft['status']
  readonly ownerUserId?: string
  readonly visibility?: EnterpriseVisibility
}
/** Data used by `EnterpriseEmployeeLookup`. */
export interface EnterpriseEmployeeLookup { readonly presetId: string }
/** Data used by `EnterpriseEmployeeSaveRequest`. */
export interface EnterpriseEmployeeSaveRequest {
  readonly presetId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly visibility: EnterpriseVisibility
  readonly profile: Readonly<Record<string, JsonValue>>
  readonly bindings: readonly EnterpriseEmployeeAssetRef[]
}
/** Data used by `EnterpriseEmployeePublishRequest`. */
export interface EnterpriseEmployeePublishRequest {
  readonly presetId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
/** Data used by `EnterpriseEmployeeRollbackRequest`. */
export interface EnterpriseEmployeeRollbackRequest extends EnterpriseEmployeePublishRequest {
  readonly releaseId: string
}
/** Data used by `EnterpriseEmployeeOptimizePromptRequest`. */
export interface EnterpriseEmployeeOptimizePromptRequest {
  readonly provider: string
  readonly model: string
  readonly prompt: string
}
/** Data used by `EnterpriseEmployeeOptimizePromptResult`. */
export interface EnterpriseEmployeeOptimizePromptResult {
  readonly prompt: string
}
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
