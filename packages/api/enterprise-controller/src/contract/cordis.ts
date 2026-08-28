import type {
  CordisPackageDraft,
  CordisPackageVersion,
  CordisReviewRequest,
  CordisScopeBinding,
  CordisWorkspaceProjection,
  DepartmentManagerSet,
  DerivedCordisPackage,
  PublishedCordisReview,
} from '@deepseek-ai/dsh-enterprise-cordis'

export interface CordisWorkspaceListRequest { readonly workspaceId: string }
export interface CordisWorkspaceSaveRequest {
  readonly workspaceId: string
  readonly draft: CordisPackageDraft
  readonly idempotencyKey: string
}
export interface CordisWorkspaceActivateRequest {
  readonly workspaceId: string
  readonly pluginId: string
  readonly packageId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface CordisReviewSubmitRequest {
  readonly workspaceId: string
  readonly sourceSessionId: string
  readonly draft: CordisPackageDraft
  readonly idempotencyKey: string
}
export interface CordisReviewListRequest { readonly status?: CordisReviewRequest['status'] }
export interface CordisReviewDeriveRequest {
  readonly reviewId: string
  readonly pluginId: string
  readonly expectedRevision: number
  readonly draft: CordisPackageDraft
  readonly idempotencyKey: string
}
export interface CordisReviewTransitionRequest {
  readonly reviewId: string
  readonly pluginId: string
  readonly packageId: string
  readonly reason: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface CordisReviewPublishRequest {
  readonly reviewId: string
  readonly pluginId: string
  readonly packageId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface CordisDepartmentManagersRequest { readonly departmentId: string }
export interface CordisDepartmentManagersSaveRequest extends CordisDepartmentManagersRequest {
  readonly managerUserIds: readonly string[]
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
export interface CordisGovernanceDisableRequest {
  readonly bindingId: string
  readonly pluginId: string
  readonly expectedRevision: number
  readonly reason: string
  readonly idempotencyKey: string
}

export type {
  CordisPackageDraft,
  CordisPackageVersion,
  CordisReviewRequest,
  CordisScopeBinding,
  CordisWorkspaceProjection,
  DepartmentManagerSet,
  DerivedCordisPackage,
  PublishedCordisReview,
}
