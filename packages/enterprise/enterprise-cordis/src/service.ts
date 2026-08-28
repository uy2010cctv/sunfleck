import { createHash, randomUUID } from 'node:crypto'
import type { EnterpriseRole } from '@deepseek-ai/dsh-enterprise-governance'
import type { EnterpriseCordisRepository } from './repository.ts'
import type {
  CordisPackageDraft,
  CordisPackageVersion,
  CordisPluginScope,
  CordisReviewRequest,
  CordisScopeBinding,
  DerivedCordisPackage,
  EnterpriseCordisAuditEvent,
  EnterpriseCordisDirectory,
  EnterpriseCordisPrincipal,
  PublishedCordisReview,
} from './types.ts'

export type EnterpriseCordisErrorCode =
  | 'workspace-not-found'
  | 'organization-mismatch'
  | 'personal-owner-required'
  | 'department-member-required'
  | 'department-manager-required'
  | 'administrator-required'
  | 'protected-contract'
  | 'package-not-found'
  | 'review-not-found'
  | 'review-package-mismatch'
  | 'review-state-invalid'
  | 'revision-conflict'

export class EnterpriseCordisError extends Error {
  constructor(readonly code: EnterpriseCordisErrorCode, message: string) { super(message) }
}

export interface EnterpriseCordisServiceOptions {
  readonly directory: EnterpriseCordisDirectory
  readonly now?: () => number
  readonly randomId?: (prefix: string) => string
}

const PROTECTED = new Set([
  'identity.provider', 'authorization.policy', 'audit.sink', 'credentials.store',
  'session.persistence', 'enterprise.repository', 'artifact.store',
])

function scopeKey(scope: CordisPluginScope): string { return JSON.stringify(scope) }

function digest(draft: CordisPackageDraft): string {
  return createHash('sha256').update(JSON.stringify({
    pluginId: draft.pluginId, dynamicPackageId: draft.dynamicPackageId,
    name: draft.name.trim(), purpose: draft.purpose.trim(),
    hostCode: draft.hostCode ?? null, clientCode: draft.clientCode ?? null,
    manifest: draft.manifest, artifactRef: draft.artifactRef,
    validationReportRef: draft.validationReportRef,
  })).digest('hex')
}

function isAdmin(roles: readonly EnterpriseRole[]): boolean { return roles.includes('administrator') }

export class EnterpriseCordisService {
  private readonly now: () => number
  private readonly randomId: (prefix: string) => string

  constructor(
    private readonly repository: EnterpriseCordisRepository,
    private readonly options: EnterpriseCordisServiceOptions,
  ) {
    this.now = options.now ?? Date.now
    this.randomId = options.randomId ?? (prefix => `${prefix}-${randomUUID()}`)
  }

  private validateDraft(draft: CordisPackageDraft): void {
    if (draft.name.trim() === '' || draft.purpose.trim() === '') throw new Error('Cordis package name and purpose are required')
    if (draft.hostCode === undefined && draft.clientCode === undefined) throw new Error('Cordis package needs Host or Client code')
    const protectedContract = draft.manifest.provides.find(value => PROTECTED.has(value))
    if (protectedContract !== undefined) {
      throw new EnterpriseCordisError('protected-contract', `User package cannot provide ${protectedContract}`)
    }
    if (draft.manifest.runtime === 'in-process') {
      throw new EnterpriseCordisError('protected-contract', 'User package must use an isolated runtime')
    }
  }

  private async workspace(principal: EnterpriseCordisPrincipal, workspaceId: string) {
    const workspace = await this.options.directory.workspace(workspaceId)
    if (workspace === undefined) throw new EnterpriseCordisError('workspace-not-found', `Workspace ${workspaceId} was not found`)
    if (workspace.orgId !== principal.orgId) throw new EnterpriseCordisError('organization-mismatch', 'Workspace is outside organization')
    return workspace
  }

  private async manager(principal: EnterpriseCordisPrincipal, departmentId: string): Promise<void> {
    if (isAdmin(principal.roles)) return
    if (!await this.options.directory.isDepartmentManager(principal.orgId, departmentId, principal.userId)) {
      throw new EnterpriseCordisError('department-manager-required', 'Department manager permission is required')
    }
  }

  private commandScope(principal: EnterpriseCordisPrincipal, operation: string): string {
    return `${principal.orgId}:${principal.userId}:${operation}`
  }

  private async idempotent<T>(
    principal: EnterpriseCordisPrincipal,
    operation: string,
    idempotencyKey: string,
    run: () => Promise<T>,
  ): Promise<T> {
    const scope = this.commandScope(principal, operation)
    const existing = await this.repository.command<T>(scope, idempotencyKey)
    if (existing !== undefined) return existing
    const value = await run()
    await this.repository.putCommand(scope, idempotencyKey, value)
    return value
  }

  private async packageFromDraft(input: {
    principal: EnterpriseCordisPrincipal
    draft: CordisPackageDraft
    scope: CordisPluginScope
    authoredBy?: string
    modifiedBy?: string
    derivedFromPackageId?: string
  }): Promise<CordisPackageVersion> {
    this.validateDraft(input.draft)
    const previous = await this.repository.packages(input.draft.pluginId, input.principal.orgId)
    const value: CordisPackageVersion = {
      ...input.draft,
      packageId: this.randomId('cordis-package'),
      orgId: input.principal.orgId,
      version: previous.length + 1,
      scope: input.scope,
      authoredBy: input.authoredBy ?? input.principal.userId,
      ...(input.modifiedBy === undefined ? {} : { modifiedBy: input.modifiedBy }),
      ...(input.derivedFromPackageId === undefined ? {} : { derivedFromPackageId: input.derivedFromPackageId }),
      sourceDigest: digest(input.draft),
      createdAt: this.now(),
    }
    await this.repository.putPackage(value)
    return value
  }

  async savePersonal(input: {
    principal: EnterpriseCordisPrincipal
    workspaceId: string
    draft: CordisPackageDraft
    idempotencyKey: string
  }): Promise<CordisPackageVersion> {
    return this.idempotent(input.principal, 'save-personal', input.idempotencyKey, async () => {
      const workspace = await this.workspace(input.principal, input.workspaceId)
      if (workspace.kind !== 'personal' || workspace.ownerUserId !== input.principal.userId) {
        throw new EnterpriseCordisError('personal-owner-required', 'Personal Workspace owner permission is required')
      }
      return this.packageFromDraft({
        principal: input.principal, draft: input.draft,
        scope: { type: 'personal-workspace', workspaceId: workspace.workspaceId, ownerUserId: input.principal.userId },
      })
    })
  }

  async activatePersonal(input: {
    principal: EnterpriseCordisPrincipal
    workspaceId: string
    pluginId: string
    packageId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<CordisScopeBinding> {
    return this.idempotent(input.principal, 'activate-personal', input.idempotencyKey, async () => {
      const workspace = await this.workspace(input.principal, input.workspaceId)
      if (workspace.kind !== 'personal' || workspace.ownerUserId !== input.principal.userId) {
        throw new EnterpriseCordisError('personal-owner-required', 'Personal Workspace owner permission is required')
      }
      const pkg = await this.repository.package(input.packageId)
      if (pkg === undefined || pkg.orgId !== input.principal.orgId || pkg.pluginId !== input.pluginId) {
        throw new EnterpriseCordisError('package-not-found', 'Cordis package was not found')
      }
      const scope: CordisPluginScope = {
        type: 'personal-workspace', workspaceId: workspace.workspaceId, ownerUserId: input.principal.userId,
      }
      const current = await this.repository.bindingForScope(input.principal.orgId, scopeKey(scope), input.pluginId)
      if ((current?.revision ?? 0) !== input.expectedRevision) {
        throw new EnterpriseCordisError('revision-conflict', 'Cordis binding revision conflict')
      }
      const value: CordisScopeBinding = {
        bindingId: current?.bindingId ?? this.randomId('cordis-binding'),
        orgId: input.principal.orgId, scope, pluginId: input.pluginId, activePackageId: input.packageId,
        generation: (current?.generation ?? 0) + 1, revision: (current?.revision ?? 0) + 1,
        activatedBy: input.principal.userId, disabled: false, updatedAt: this.now(),
      }
      await this.repository.putBinding(value, current?.revision ?? 0)
      return value
    })
  }

  async submitDepartment(input: {
    principal: EnterpriseCordisPrincipal
    workspaceId: string
    draft: CordisPackageDraft
    sourceSessionId: string
    idempotencyKey: string
  }): Promise<CordisReviewRequest> {
    return this.idempotent(input.principal, 'submit-department', input.idempotencyKey, async () => {
      const workspace = await this.workspace(input.principal, input.workspaceId)
      if (workspace.kind !== 'department' || workspace.departmentId === undefined) {
        throw new EnterpriseCordisError('department-member-required', 'Department Workspace is required')
      }
      const memberships = await this.options.directory.userDepartments(input.principal.orgId, input.principal.userId)
      if (!memberships.includes(workspace.departmentId) && !isAdmin(input.principal.roles)) {
        throw new EnterpriseCordisError('department-member-required', 'Department membership is required')
      }
      const pkg = await this.packageFromDraft({
        principal: input.principal, draft: input.draft,
        scope: { type: 'department', departmentId: workspace.departmentId },
      })
      const at = this.now()
      const review: CordisReviewRequest = {
        reviewId: this.randomId('cordis-review'), orgId: input.principal.orgId,
        departmentId: workspace.departmentId, pluginId: pkg.pluginId, packageId: pkg.packageId,
        sourceSessionId: input.sourceSessionId, submittedBy: input.principal.userId,
        status: 'pending', revision: 1, createdAt: at, updatedAt: at,
      }
      await this.repository.putReview(review, 0)
      return review
    })
  }

  private async review(input: { principal: EnterpriseCordisPrincipal; reviewId: string }): Promise<CordisReviewRequest> {
    const review = await this.repository.review(input.reviewId)
    if (review === undefined || review.orgId !== input.principal.orgId) {
      throw new EnterpriseCordisError('review-not-found', 'Cordis review was not found')
    }
    await this.manager(input.principal, review.departmentId)
    return review
  }

  async deriveReview(input: {
    principal: EnterpriseCordisPrincipal
    reviewId: string
    expectedRevision: number
    draft: CordisPackageDraft
    idempotencyKey: string
  }): Promise<DerivedCordisPackage> {
    return this.idempotent(input.principal, 'derive-review', input.idempotencyKey, async () => {
      const review = await this.review(input)
      if (review.revision !== input.expectedRevision) throw new EnterpriseCordisError('revision-conflict', 'Cordis review revision conflict')
      const source = await this.repository.package(review.packageId)
      if (source === undefined) throw new EnterpriseCordisError('package-not-found', 'Submitted package was not found')
      const pkg = await this.packageFromDraft({
        principal: input.principal, draft: { ...input.draft, pluginId: review.pluginId },
        scope: { type: 'department', departmentId: review.departmentId },
        authoredBy: source.authoredBy, modifiedBy: input.principal.userId, derivedFromPackageId: source.packageId,
      })
      const next: CordisReviewRequest = {
        ...review, packageId: pkg.packageId, status: 'pending', revision: review.revision + 1, updatedAt: this.now(),
      }
      await this.repository.putReview(next, review.revision)
      return { ...pkg, reviewRevision: next.revision }
    })
  }

  async reviewDepartment(input: {
    principal: EnterpriseCordisPrincipal
    reviewId: string
    packageId: string
    action: 'approve_department' | 'return_to_author'
    reason: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<CordisReviewRequest> {
    return this.idempotent(input.principal, 'review-department', input.idempotencyKey, async () => {
      const review = await this.review(input)
      if (review.revision !== input.expectedRevision) throw new EnterpriseCordisError('revision-conflict', 'Cordis review revision conflict')
      if (review.packageId !== input.packageId) throw new EnterpriseCordisError('review-package-mismatch', 'Review package mismatch')
      if (review.status !== 'pending' && review.status !== 'changes-requested') {
        throw new EnterpriseCordisError('review-state-invalid', `Cannot review ${review.status}`)
      }
      const next: CordisReviewRequest = {
        ...review,
        status: input.action === 'approve_department' ? 'approved-department' : 'changes-requested',
        reason: input.reason.trim(), revision: review.revision + 1, updatedAt: this.now(),
      }
      await this.repository.putReview(next, review.revision)
      return next
    })
  }

  async publishOrganization(input: {
    principal: EnterpriseCordisPrincipal
    reviewId: string
    packageId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<PublishedCordisReview> {
    return this.idempotent(input.principal, 'publish-organization', input.idempotencyKey, async () => {
      const review = await this.review(input)
      if (review.revision !== input.expectedRevision) throw new EnterpriseCordisError('revision-conflict', 'Cordis review revision conflict')
      if (review.packageId !== input.packageId) throw new EnterpriseCordisError('review-package-mismatch', 'Review package mismatch')
      const pkg = await this.repository.package(input.packageId)
      if (pkg === undefined) throw new EnterpriseCordisError('package-not-found', 'Cordis package was not found')
      this.validateDraft(pkg)
      const scope: CordisPluginScope = { type: 'organization', organizationId: input.principal.orgId }
      const current = await this.repository.bindingForScope(input.principal.orgId, scopeKey(scope), review.pluginId)
      const binding: CordisScopeBinding = {
        bindingId: current?.bindingId ?? this.randomId('cordis-binding'), orgId: input.principal.orgId,
        scope, pluginId: review.pluginId, activePackageId: input.packageId,
        generation: (current?.generation ?? 0) + 1, revision: (current?.revision ?? 0) + 1,
        activatedBy: input.principal.userId, disabled: false, updatedAt: this.now(),
      }
      await this.repository.putBinding(binding, current?.revision ?? 0)
      const next: PublishedCordisReview = {
        ...review, status: 'published-organization', publishedBy: input.principal.userId,
        revision: review.revision + 1, updatedAt: this.now(), organizationBinding: binding,
      }
      const { organizationBinding: _binding, ...stored } = next
      await this.repository.putReview(stored, review.revision)
      return next
    })
  }

  async emergencyDisable(input: {
    principal: EnterpriseCordisPrincipal
    bindingId: string
    expectedRevision: number
    reason: string
    idempotencyKey: string
  }): Promise<CordisScopeBinding> {
    return this.idempotent(input.principal, 'emergency-disable', input.idempotencyKey, async () => {
      if (!isAdmin(input.principal.roles)) throw new EnterpriseCordisError('administrator-required', 'Administrator permission is required')
      const current = await this.repository.binding(input.bindingId)
      if (current === undefined || current.orgId !== input.principal.orgId) throw new EnterpriseCordisError('package-not-found', 'Cordis binding was not found')
      if (current.revision !== input.expectedRevision) throw new EnterpriseCordisError('revision-conflict', 'Cordis binding revision conflict')
      const next: CordisScopeBinding = {
        ...current, disabled: true, disabledReason: input.reason.trim(),
        revision: current.revision + 1, updatedAt: this.now(),
      }
      await this.repository.putBinding(next, current.revision)
      return next
    })
  }

  async audit(event: EnterpriseCordisAuditEvent): Promise<void> { await this.repository.appendAudit(event) }
}
