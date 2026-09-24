import type { EnterpriseRole } from '@deepseek-ai/dsh-enterprise-governance'

/** Allowed values for `CordisPluginScope`. */
export type CordisPluginScope =
  | { type: 'session'; sessionId: string }
  | { type: 'personal-workspace'; workspaceId: string; ownerUserId: string }
  | { type: 'department'; departmentId: string }
  | { type: 'organization'; organizationId: string }

/** Data used by `EnterpriseCordisPrincipal`. */
export interface EnterpriseCordisPrincipal {
  readonly orgId: string
  readonly userId: string
  readonly roles: readonly EnterpriseRole[]
}

/** Data used by `DshPluginManifestV1`. */
export interface DshPluginManifestV1 {
  readonly apiVersion: 'dsh-plugin/v1'
  readonly runtime: 'in-process' | 'isolated-realm' | 'sandboxed-iframe'
  readonly provides: readonly string[]
  readonly capabilities: readonly string[]
  readonly license?: string
  readonly dependencies?: readonly DshPluginDependency[]
}

/** Data used by `DshPluginDependency`. */
export interface DshPluginDependency {
  readonly name: string
  readonly version: string
  readonly integrity: string
  readonly license: string
}

/** Data used by `CordisValidationCheck`. */
export interface CordisValidationCheck {
  readonly id: 'manifest' | 'permissions' | 'isolation' | 'secrets' | 'host-api' | 'ui-lifecycle' | 'rollback'
    | 'malware' | 'license' | 'supply-chain'
  readonly status: 'passed' | 'failed'
  readonly message: string
}

/** Data used by `CordisValidationReport`. */
export interface CordisValidationReport {
  readonly reportRef: string
  readonly orgId: string
  readonly packageId: string
  readonly status: 'passed' | 'failed'
  readonly checks: readonly CordisValidationCheck[]
  readonly createdAt: number
}

/** Data used by `CordisArtifactMetadata`. */
export interface CordisArtifactMetadata {
  readonly artifactRef: string
  readonly orgId: string
  readonly digest: string
  readonly sizeBytes: number
  readonly storageUri: string
  readonly createdAt: number
}

/** Data used by `CordisPackageDraft`. */
export interface CordisPackageDraft {
  readonly pluginId: string
  readonly dynamicPackageId: string
  readonly name: string
  readonly purpose: string
  readonly hostCode?: string
  readonly clientCode?: string
  readonly manifest: DshPluginManifestV1
  readonly artifactRef: string
  readonly validationReportRef: string
}

/** Data used by `CordisPackageVersion`. */
export interface CordisPackageVersion extends CordisPackageDraft {
  readonly packageId: string
  readonly orgId: string
  readonly version: number
  readonly scope: CordisPluginScope
  readonly derivedFromPackageId?: string
  readonly authoredBy: string
  readonly modifiedBy?: string
  readonly sourceDigest: string
  readonly createdAt: number
  /** Caller-specific permission to submit a private version from a department Workspace for review. */
  readonly canSubmitDepartment?: boolean
}

/** Data used by `CordisScopeBinding`. */
export interface CordisScopeBinding {
  readonly bindingId: string
  readonly orgId: string
  readonly scope: CordisPluginScope
  readonly pluginId: string
  readonly activePackageId: string
  readonly generation: number
  readonly revision: number
  readonly activatedBy: string
  readonly disabled: boolean
  readonly disabledReason?: string
  readonly trustLevel: 'isolated' | 'trusted-in-process'
  readonly updatedAt: number
  /** Caller-specific management permission on Workspace list projections. */
  readonly canManage?: boolean
}

/** Reversible private Plugin removal; immutable Package source remains stored. */
export interface CordisPluginArchive {
  readonly orgId: string
  readonly scope: Extract<CordisPluginScope, { type: 'personal-workspace' }>
  readonly pluginId: string
  readonly archived: boolean
  readonly revision: number
  readonly updatedBy: string
  readonly updatedAt: number
}

/** Data used by `CordisSessionGenerationEntry`. */
export interface CordisSessionGenerationEntry {
  readonly pluginId: string
  readonly packageId: string
  readonly bindingId: string
  readonly generation: number
  readonly scope: CordisPluginScope
  readonly trustLevel: CordisScopeBinding['trustLevel']
}

/** Immutable package selection captured when a Session first uses a Workspace. */
export interface CordisSessionGeneration {
  readonly sessionId: string
  readonly orgId: string
  readonly workspaceId: string
  readonly entries: readonly CordisSessionGenerationEntry[]
  readonly createdAt: number
}

/** Allowed values for `CordisReviewStatus`. */
export type CordisReviewStatus =
  | 'pending'
  | 'changes-requested'
  | 'approved-department'
  | 'published-organization'
  | 'superseded'
  | 'revoked'

/** Data used by `CordisReviewRequest`. */
export interface CordisReviewRequest {
  readonly reviewId: string
  readonly orgId: string
  readonly departmentId: string
  readonly pluginId: string
  readonly packageId: string
  readonly sourceSessionId: string
  readonly submittedBy: string
  readonly status: CordisReviewStatus
  readonly reason?: string
  readonly publishedBy?: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

/** Data used by `EnterpriseCordisWorkspaceView`. */
export interface EnterpriseCordisWorkspaceView {
  readonly workspaceId: string
  readonly orgId: string
  readonly kind: 'personal' | 'department'
  readonly ownerUserId?: string
  readonly departmentId?: string
}

/** Data used by `EnterpriseCordisDirectory`. */
export interface EnterpriseCordisDirectory {
  workspace(workspaceId: string): Promise<EnterpriseCordisWorkspaceView | undefined>
  userDepartments(orgId: string, userId: string): Promise<readonly string[]>
  isDepartmentManager(orgId: string, departmentId: string, userId: string): Promise<boolean>
}

/** Data used by `EnterpriseCordisAuditEvent`. */
export interface EnterpriseCordisAuditEvent {
  readonly id: string
  readonly orgId: string
  readonly actorUserId: string
  readonly action: string
  readonly pluginId: string
  readonly packageId?: string
  readonly reviewId?: string
  readonly at: number
  readonly details: Readonly<Record<string, unknown>>
}

/** Data used by `DepartmentManagerSet`. */
export interface DepartmentManagerSet {
  readonly orgId: string
  readonly departmentId: string
  readonly managerUserIds: readonly string[]
  readonly revision: number
  readonly updatedBy: string
  readonly updatedAt: number
}

/** Data used by `DerivedCordisPackage`. */
export interface DerivedCordisPackage extends CordisPackageVersion {
  readonly reviewRevision: number
}

/** Data used by `PublishedCordisReview`. */
export interface PublishedCordisReview extends CordisReviewRequest {
  readonly publishedBy: string
  readonly organizationBinding: CordisScopeBinding
}

/** Data used by `CordisWorkspaceProjection`. */
export interface CordisWorkspaceProjection {
  readonly packages: readonly CordisPackageVersion[]
  readonly archivedPackages: readonly CordisPackageVersion[]
  readonly bindings: readonly CordisScopeBinding[]
}

/** Allowed values for `EnterpriseCordisEventName`. */
export type EnterpriseCordisEventName =
  | 'enterprise/cordis-package-saved'
  | 'enterprise/cordis-review-requested'
  | 'enterprise/cordis-review-updated'
  | 'enterprise/cordis-department-activated'
  | 'enterprise/cordis-organization-published'
  | 'enterprise/cordis-run-health-updated'
  | 'enterprise/cordis-plugin-disabled'

/** Data used by `EnterpriseCordisEvent`. */
export interface EnterpriseCordisEvent {
  readonly orgId: string
  readonly pluginId: string
  readonly packageId?: string
  readonly bindingId?: string
  readonly reviewId?: string
  readonly at: number
}
