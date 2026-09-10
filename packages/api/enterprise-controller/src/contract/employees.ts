export type EnterpriseAssetKind = 'sop' | 'knowledge' | 'skill' | 'tool' | 'model'
export type EnterpriseVisibility = 'organization' | 'private' | 'restricted'
export interface EnterpriseEmployeeAssetRef {
  kind: EnterpriseAssetKind
  assetId: string
  version: number
}
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
export interface EnterpriseEmployeePage {
  items: readonly EnterpriseEmployeeDraft[]
  nextCursor?: string
}

export interface EnterpriseEmployeeListRequest {
  readonly limit?: number
  readonly cursor?: string
  readonly search?: string
  readonly status?: EnterpriseEmployeeDraft['status']
  readonly ownerUserId?: string
  readonly visibility?: EnterpriseVisibility
}
export interface EnterpriseEmployeeLookup { readonly presetId: string }
export interface EnterpriseEmployeeSaveRequest {
  readonly presetId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
  readonly visibility: EnterpriseVisibility
  readonly profile: Readonly<Record<string, JsonValue>>
  readonly bindings: readonly EnterpriseEmployeeAssetRef[]
}
export interface EnterpriseEmployeePublishRequest {
  readonly presetId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface EnterpriseEmployeeRollbackRequest extends EnterpriseEmployeePublishRequest {
  readonly releaseId: string
}
export interface EnterpriseEmployeeOptimizePromptRequest {
  readonly provider: string
  readonly model: string
  readonly prompt: string
}
export interface EnterpriseEmployeeOptimizePromptResult {
  readonly prompt: string
}
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
