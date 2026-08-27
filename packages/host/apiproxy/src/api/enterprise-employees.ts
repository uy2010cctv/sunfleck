import type { RpcRequest, RpcResponse } from './rpc.ts'

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
  profile: Readonly<Record<string, unknown>>
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
    profile: Readonly<Record<string, unknown>>
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

export interface EnterpriseEmployeesApi {
  list(
    request: RpcRequest<{
      limit?: number
      cursor?: string
      search?: string
      status?: EnterpriseEmployeeDraft['status']
      ownerUserId?: string
      visibility?: EnterpriseVisibility
    }>,
  ): Promise<RpcResponse<EnterpriseEmployeePage>>
  getDraft(
    request: RpcRequest<{ presetId: string }>,
  ): Promise<RpcResponse<EnterpriseEmployeeDraft>>
  saveDraft(
    request: RpcRequest<{
      presetId: string
      expectedRevision: number
      idempotencyKey: string
      visibility: EnterpriseVisibility
      profile: Readonly<Record<string, unknown>>
      bindings: readonly EnterpriseEmployeeAssetRef[]
    }>,
  ): Promise<RpcResponse<EnterpriseEmployeeDraft>>
  publish(
    request: RpcRequest<{ presetId: string; expectedRevision: number; idempotencyKey: string }>,
  ): Promise<RpcResponse<EnterpriseEmployeeRelease>>
  listReleases(
    request: RpcRequest<{ presetId: string }>,
  ): Promise<RpcResponse<readonly EnterpriseEmployeeRelease[]>>
  rollback(
    request: RpcRequest<{
      presetId: string
      releaseId: string
      expectedRevision: number
      idempotencyKey: string
    }>,
  ): Promise<RpcResponse<EnterpriseEmployeeRelease>>
}
