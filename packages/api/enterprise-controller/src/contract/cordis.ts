import type {
  CordisPackageDraft,
  CordisPackageVersion,
  CordisPluginArchive,
  CordisReviewRequest,
  CordisScopeBinding,
  CordisSessionGeneration,
  CordisWorkspaceProjection,
  DepartmentManagerSet,
  DerivedCordisPackage,
  PublishedCordisReview,
} from '@deepseek-ai/dsh-enterprise-cordis'

/** Data used by `CordisWorkspaceListRequest`. */
export interface CordisWorkspaceListRequest { readonly workspaceId: string }
/** Data used by `CordisWorkspaceSaveRequest`. */
export interface CordisWorkspaceSaveRequest {
  readonly workspaceId: string
  readonly draft: CordisPackageDraft
  readonly idempotencyKey: string
}
/** Archive or restore one owner-private Workspace Plugin. */
export interface CordisWorkspaceArchiveRequest {
  readonly workspaceId: string
  readonly pluginId: string
  readonly idempotencyKey: string
}
/** Data used by `CordisWorkspaceActivateRequest`. */
export interface CordisWorkspaceActivateRequest {
  readonly workspaceId: string
  readonly pluginId: string
  readonly packageId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
/** Data used by `CordisWorkspaceStopRequest`. */
export interface CordisWorkspaceStopRequest {
  readonly bindingId: string
  readonly pluginId: string
  readonly expectedRevision: number
  readonly reason: string
  readonly idempotencyKey: string
}
/** Data used by `CordisWorkspaceRollbackRequest`. */
export interface CordisWorkspaceRollbackRequest extends CordisWorkspaceStopRequest {
  readonly packageId: string
}
/** Data used by `CordisWorkspacePinGenerationRequest`. */
export interface CordisWorkspacePinGenerationRequest {
  readonly workspaceId: string
  readonly sessionId: string
}
/** Data used by `CordisReviewSubmitRequest`. */
export interface CordisReviewSubmitRequest {
  readonly workspaceId: string
  readonly sourceSessionId: string
  readonly draft: CordisPackageDraft
  readonly idempotencyKey: string
}
/** Data used by `CordisReviewListRequest`. */
export interface CordisReviewListRequest { readonly status?: CordisReviewRequest['status'] }
/** Data used by `CordisReviewDeriveRequest`. */
export interface CordisReviewDeriveRequest {
  readonly reviewId: string
  readonly pluginId: string
  readonly expectedRevision: number
  readonly draft: CordisPackageDraft
  readonly idempotencyKey: string
}
/** Data used by `CordisReviewTransitionRequest`. */
export interface CordisReviewTransitionRequest {
  readonly reviewId: string
  readonly pluginId: string
  readonly packageId: string
  readonly reason: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
/** Data used by `CordisReviewPublishRequest`. */
export interface CordisReviewPublishRequest {
  readonly reviewId: string
  readonly pluginId: string
  readonly packageId: string
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
/** Data used by `CordisDepartmentManagersRequest`. */
export interface CordisDepartmentManagersRequest { readonly departmentId: string }
/** Data used by `CordisDepartmentManagersSaveRequest`. */
export interface CordisDepartmentManagersSaveRequest extends CordisDepartmentManagersRequest {
  readonly managerUserIds: readonly string[]
  readonly expectedRevision: number
  readonly idempotencyKey: string
}
/** Data used by `CordisGovernanceDisableRequest`. */
export interface CordisGovernanceDisableRequest {
  readonly bindingId: string
  readonly pluginId: string
  readonly expectedRevision: number
  readonly reason: string
  readonly idempotencyKey: string
}
/** Data used by `CordisGovernanceSetTrustRequest`. */
export interface CordisGovernanceSetTrustRequest extends CordisGovernanceDisableRequest {
  readonly trustLevel: CordisScopeBinding['trustLevel']
}

export type {
  CordisPackageDraft,
  CordisPackageVersion,
  CordisPluginArchive,
  CordisReviewRequest,
  CordisScopeBinding,
  CordisSessionGeneration,
  CordisWorkspaceProjection,
  DepartmentManagerSet,
  DerivedCordisPackage,
  PublishedCordisReview,
}
