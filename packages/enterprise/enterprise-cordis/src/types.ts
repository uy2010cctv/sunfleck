import type { EnterpriseRole } from '@deepseek-ai/dsh-enterprise-governance'

export type CordisPluginScope =
  | { type: 'session'; sessionId: string }
  | { type: 'personal-workspace'; workspaceId: string; ownerUserId: string }
  | { type: 'department'; departmentId: string }
  | { type: 'organization'; organizationId: string }

export interface EnterpriseCordisPrincipal {
  readonly orgId: string
  readonly userId: string
  readonly roles: readonly EnterpriseRole[]
}

export interface DshPluginManifestV1 {
  readonly apiVersion: 'dsh-plugin/v1'
  readonly runtime: 'in-process' | 'isolated-realm' | 'sandboxed-iframe'
  readonly provides: readonly string[]
  readonly capabilities: readonly string[]
}

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
}

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
  readonly updatedAt: number
}

export type CordisReviewStatus =
  | 'pending'
  | 'changes-requested'
  | 'approved-department'
  | 'published-organization'
  | 'superseded'
  | 'revoked'

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

export interface EnterpriseCordisWorkspaceView {
  readonly workspaceId: string
  readonly orgId: string
  readonly kind: 'personal' | 'department'
  readonly ownerUserId?: string
  readonly departmentId?: string
}

export interface EnterpriseCordisDirectory {
  workspace(workspaceId: string): Promise<EnterpriseCordisWorkspaceView | undefined>
  userDepartments(orgId: string, userId: string): Promise<readonly string[]>
  isDepartmentManager(orgId: string, departmentId: string, userId: string): Promise<boolean>
}

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

export interface DerivedCordisPackage extends CordisPackageVersion {
  readonly reviewRevision: number
}

export interface PublishedCordisReview extends CordisReviewRequest {
  readonly publishedBy: string
  readonly organizationBinding: CordisScopeBinding
}
