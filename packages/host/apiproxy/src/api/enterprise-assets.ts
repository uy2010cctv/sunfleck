import type { EnterpriseAssetKind } from './enterprise-employees.ts'
import type { RpcRequest, RpcResponse } from './rpc.ts'

export interface EnterpriseAsset { assetId: string; orgId: string; kind: EnterpriseAssetKind; name: string; revision: number; archived: boolean; updatedAt: number }
export interface EnterpriseAssetVersion { assetId: string; version: number; content: Readonly<Record<string, unknown>>; createdBy: string; createdAt: number }
export interface EnterpriseAssetPage { items: readonly EnterpriseAsset[]; nextCursor?: string }
export interface EnterpriseAssetsApi {
  list(request: RpcRequest<{ limit?: number; cursor?: string; search?: string; kind?: EnterpriseAssetKind; archived?: boolean }>): Promise<RpcResponse<EnterpriseAssetPage>>
  get(request: RpcRequest<{ assetId: string }>): Promise<RpcResponse<EnterpriseAsset>>
  saveVersion(request: RpcRequest<{ assetId: string; kind: EnterpriseAssetKind; name: string; content: Readonly<Record<string, unknown>>; expectedRevision: number; idempotencyKey: string }>): Promise<RpcResponse<EnterpriseAssetVersion>>
  listVersions(request: RpcRequest<{ assetId: string }>): Promise<RpcResponse<readonly EnterpriseAssetVersion[]>>
  archive(request: RpcRequest<{ assetId: string; expectedRevision: number; idempotencyKey: string }>): Promise<RpcResponse<EnterpriseAsset>>
}
