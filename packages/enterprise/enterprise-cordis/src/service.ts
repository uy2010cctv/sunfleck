import { createHash, randomUUID } from 'node:crypto'
import type { EnterpriseRole } from '@deepseek-ai/dsh-enterprise-governance'
import type { EnterpriseCordisRepository } from './repository.ts'
import { archiveScopeKey } from './archive-key.ts'
import {
  InMemoryEnterpriseCordisArtifactStore,
  type EnterpriseCordisArtifactStore,
} from './artifact-store.ts'
import { BuiltinEnterpriseCordisScanner, type EnterpriseCordisScanner } from './scanner.ts'
import type {
  CordisPackageDraft,
  CordisPackageVersion,
  CordisPluginArchive,
  CordisPluginScope,
  CordisReviewRequest,
  CordisScopeBinding,
  CordisSessionGeneration,
  CordisValidationCheck,
  CordisWorkspaceProjection,
  DerivedCordisPackage,
  DepartmentManagerSet,
  EnterpriseCordisAuditEvent,
  EnterpriseCordisDirectory,
  EnterpriseCordisPrincipal,
  EnterpriseCordisEvent,
  EnterpriseCordisEventName,
  PublishedCordisReview,
} from './types.ts'

/** Allowed values for `EnterpriseCordisErrorCode`. */
export type EnterpriseCordisErrorCode =
  | 'workspace-not-found'
  | 'organization-mismatch'
  | 'personal-owner-required'
  | 'department-member-required'
  | 'department-manager-required'
  | 'administrator-required'
  | 'protected-contract'
  | 'package-not-found'
  | 'plugin-archived'
  | 'review-not-found'
  | 'review-package-mismatch'
  | 'review-state-invalid'
  | 'revision-conflict'
  | 'validation-failed'

/** Provides `EnterpriseCordisError` capabilities. */
export class EnterpriseCordisError extends Error {
  constructor(readonly code: EnterpriseCordisErrorCode, message: string) { super(message) }
}

/** Data used by `EnterpriseCordisServiceOptions`. */
export interface EnterpriseCordisServiceOptions {
  readonly directory: EnterpriseCordisDirectory
  readonly now?: () => number
  readonly randomId?: (prefix: string) => string
  readonly emit?: (name: EnterpriseCordisEventName, event: EnterpriseCordisEvent) => void
  readonly artifactStore?: EnterpriseCordisArtifactStore
  readonly scanners?: readonly EnterpriseCordisScanner[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Shared enterprise Cordis domain service used by Host APIs and Agent tools. */
    enterpriseCordis: EnterpriseCordisService
  }
  interface Events {
    /**
     * An immutable enterprise Cordis Package version was persisted.
     * @param event - Package, scope, actor, and organization correlation data.
     * @mode emit
     */
    'enterprise/cordis-package-saved'(event: EnterpriseCordisEvent): void
    /**
     * A department Cordis Package entered manager review.
     * @param event - Review target, actor, and organization correlation data.
     * @mode emit
     */
    'enterprise/cordis-review-requested'(event: EnterpriseCordisEvent): void
    /**
     * A Cordis review changed status or selected a derived Package.
     * @param event - Review target, actor, and organization correlation data.
     * @mode emit
     */
    'enterprise/cordis-review-updated'(event: EnterpriseCordisEvent): void
    /**
     * A validated Package became the active department binding.
     * @param event - Activated Package, scope, actor, and organization correlation data.
     * @mode emit
     */
    'enterprise/cordis-department-activated'(event: EnterpriseCordisEvent): void
    /**
     * A validated Package became the active organization binding.
     * @param event - Published Package, scope, actor, and organization correlation data.
     * @mode emit
     */
    'enterprise/cordis-organization-published'(event: EnterpriseCordisEvent): void
    /**
     * The observed health of an enterprise Cordis run changed.
     * @param event - Run health, Package, scope, and organization correlation data.
     * @mode emit
     */
    'enterprise/cordis-run-health-updated'(event: EnterpriseCordisEvent): void
    /**
     * An enterprise Cordis binding was stopped by governance.
     * @param event - Disabled Package, scope, actor, and organization correlation data.
     * @mode emit
     */
    'enterprise/cordis-plugin-disabled'(event: EnterpriseCordisEvent): void
  }
}

const PROTECTED = new Set([
  'identity.provider', 'authorization.policy', 'audit.sink', 'credentials.store',
  'session.persistence', 'enterprise.repository', 'artifact.store',
])
const CAPABILITIES = new Set([
  'workspace.read', 'workspace.write', 'network.fetch', 'ui.slot',
  'events.subscribe', 'tools.register', 'service.consume',
])

function scopeKey(scope: CordisPluginScope): string { return JSON.stringify(scope) }

function sameScope(left: CordisPluginScope, right: CordisPluginScope): boolean {
  if (left.type === 'personal-workspace' && right.type === 'personal-workspace') {
    return left.workspaceId === right.workspaceId && left.ownerUserId === right.ownerUserId
  }
  if (left.type === 'department' && right.type === 'department') return left.departmentId === right.departmentId
  if (left.type === 'organization' && right.type === 'organization') return left.organizationId === right.organizationId
  if (left.type === 'session' && right.type === 'session') return left.sessionId === right.sessionId
  return false
}

/** Select one runnable version per Plugin, giving the most specific authorized scope precedence.
 * @param bindings - Visible active scope bindings or pinned generation entries.
 * @returns one deterministically selected binding for each Plugin.
 */
export function effectiveCordisBindings<T extends Pick<CordisScopeBinding, 'pluginId' | 'scope' | 'generation' | 'bindingId'>>(
  bindings: readonly T[],
): T[] {
  const priority = (scope: CordisPluginScope): number => {
    switch (scope.type) {
      case 'session': return 4
      case 'personal-workspace': return 3
      case 'department': return 2
      case 'organization': return 1
    }
  }
  const selected = new Map<string, T>()
  for (const binding of bindings) {
    const previous = selected.get(binding.pluginId)
    if (previous === undefined || priority(binding.scope) > priority(previous.scope)
      || (priority(binding.scope) === priority(previous.scope)
        && (binding.generation > previous.generation
          || binding.generation === previous.generation
            && binding.bindingId.localeCompare(previous.bindingId) > 0))) {
      selected.set(binding.pluginId, binding)
    }
  }
  return [...selected.values()].sort((left, right) => left.pluginId.localeCompare(right.pluginId))
}

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

/** Governs immutable enterprise Cordis Packages, bindings, reviews, and Session Generations. */
export class EnterpriseCordisService {
  private readonly now: () => number
  private readonly randomId: (prefix: string) => string
  private readonly inFlight = new Map<string, Promise<unknown>>()
  private readonly artifactStore: EnterpriseCordisArtifactStore
  private readonly scanners: readonly EnterpriseCordisScanner[]

  constructor(
    private readonly repository: EnterpriseCordisRepository,
    private readonly options: EnterpriseCordisServiceOptions,
  ) {
    this.now = options.now ?? Date.now
    this.randomId = options.randomId ?? (prefix => `${prefix}-${randomUUID()}`)
    this.artifactStore = options.artifactStore ?? new InMemoryEnterpriseCordisArtifactStore()
    this.scanners = [new BuiltinEnterpriseCordisScanner(), ...(options.scanners ?? [])]
  }

  private emit(name: EnterpriseCordisEventName, event: Omit<EnterpriseCordisEvent, 'at'>): void {
    this.options.emit?.(name, { ...event, at: this.now() })
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
    if (draft.manifest.capabilities.some(capability => !CAPABILITIES.has(capability))) {
      throw new EnterpriseCordisError('validation-failed', 'Cordis package requests an unknown capability')
    }
    const source = `${draft.hostCode ?? ''}\n${draft.clientCode ?? ''}`
    if (/\b(?:process\.env|child_process|Deno\.|Bun\.)|\brequire\s*\(|\bimport\s*\(\s*['"]node:/u.test(source)) {
      throw new EnterpriseCordisError('validation-failed', 'Cordis package uses a forbidden Host API')
    }
    if (/(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*['"][^'"]{8,}/iu.test(source)) {
      throw new EnterpriseCordisError('validation-failed', 'Cordis package source contains a probable secret')
    }
  }

  private async validationChecks(draft: CordisPackageDraft): Promise<readonly CordisValidationCheck[]> {
    const source = `${draft.hostCode ?? ''}\n${draft.clientCode ?? ''}`
    const check = (id: CordisValidationCheck['id'], passed: boolean, message: string): CordisValidationCheck => ({
      id, status: passed ? 'passed' : 'failed', message,
    })
    const structural = [
      check('manifest', draft.name.trim() !== '' && draft.purpose.trim() !== ''
        && (draft.hostCode !== undefined || draft.clientCode !== undefined), 'Manifest, identity, and package halves are valid.'),
      check('permissions', draft.manifest.capabilities.every(capability => CAPABILITIES.has(capability))
        && draft.manifest.provides.every(contract => !PROTECTED.has(contract)), 'Capabilities are declared and protected contracts are excluded.'),
      check('isolation', draft.manifest.runtime !== 'in-process', 'User package uses an isolated runtime.'),
      check('secrets', !/(?:api[_-]?key|access[_-]?token|password)\s*[:=]\s*['"][^'"]{8,}/iu.test(source), 'No probable embedded secret was found.'),
      check('host-api', !/\b(?:process\.env|child_process|Deno\.|Bun\.)|\brequire\s*\(|\bimport\s*\(\s*['"]node:/u.test(source), 'No forbidden Node or host-global API was found.'),
      check('ui-lifecycle', draft.clientCode === undefined || /\breturn\b/u.test(draft.clientCode), 'Client source exposes a loadable lifecycle value.'),
      check('rollback', true, 'Immutable Package source supports pointer rollback.'),
    ]
    const scanned = (await Promise.all(this.scanners.map(scanner => scanner.scan(draft)))).flat()
    return [...structural, ...scanned]
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

  private async personalScope(principal: EnterpriseCordisPrincipal, workspaceId: string): Promise<CordisPluginArchive['scope']> {
    const workspace = await this.workspace(principal, workspaceId)
    if (workspace.kind === 'personal' && workspace.ownerUserId === principal.userId) {
      return { type: 'personal-workspace', workspaceId, ownerUserId: principal.userId }
    }
    if (workspace.kind === 'department' && workspace.departmentId !== undefined) {
      const memberships = await this.options.directory.userDepartments(principal.orgId, principal.userId)
      if (memberships.includes(workspace.departmentId) || isAdmin(principal.roles)) {
        return { type: 'personal-workspace', workspaceId, ownerUserId: principal.userId }
      }
    }
    throw new EnterpriseCordisError('personal-owner-required', 'Workspace access is required to save a private Cordis package')
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
    const flightKey = `${scope}:${idempotencyKey}`
    const current = this.inFlight.get(flightKey)
    if (current !== undefined) return current as Promise<T>
    const pending = (async () => {
      const value = await run()
      await this.repository.putCommand(scope, idempotencyKey, value)
      return value
    })()
    this.inFlight.set(flightKey, pending)
    try { return await pending } finally { this.inFlight.delete(flightKey) }
  }

  private async packageFromDraft(input: {
    principal: EnterpriseCordisPrincipal
    draft: CordisPackageDraft
    scope: CordisPluginScope
    authoredBy?: string
    modifiedBy?: string
    derivedFromPackageId?: string
  }): Promise<CordisPackageVersion> {
    const previous = await this.repository.packages(input.draft.pluginId, input.principal.orgId)
    const packageId = this.randomId('cordis-package')
    const validationReportRef = `${input.draft.validationReportRef}#${packageId}`
    const checks = await this.validationChecks(input.draft)
    await this.repository.putValidationReport({
      reportRef: validationReportRef, orgId: input.principal.orgId, packageId,
      status: checks.some(check => check.status === 'failed') ? 'failed' : 'passed',
      checks, createdAt: this.now(),
    })
    this.validateDraft(input.draft)
    if (checks.some(check => check.status === 'failed')) {
      throw new EnterpriseCordisError('validation-failed', 'Cordis package did not pass the automatic validation pipeline')
    }
    const artifact = await this.artifactStore.put({
      orgId: input.principal.orgId, pluginId: input.draft.pluginId,
      name: input.draft.name, purpose: input.draft.purpose,
      ...(input.draft.hostCode === undefined ? {} : { hostCode: input.draft.hostCode }),
      ...(input.draft.clientCode === undefined ? {} : { clientCode: input.draft.clientCode }),
    })
    const {
      hostCode: _hostCode, clientCode: _clientCode, artifactRef: _requestedArtifactRef,
      ...metadataDraft
    } = input.draft
    const value: CordisPackageVersion = {
      ...metadataDraft,
      packageId,
      artifactRef: artifact.artifactRef,
      validationReportRef,
      orgId: input.principal.orgId,
      version: previous.length + 1,
      scope: input.scope,
      authoredBy: input.authoredBy ?? input.principal.userId,
      ...(input.modifiedBy === undefined ? {} : { modifiedBy: input.modifiedBy }),
      ...(input.derivedFromPackageId === undefined ? {} : { derivedFromPackageId: input.derivedFromPackageId }),
      sourceDigest: digest(input.draft),
      createdAt: this.now(),
    }
    await this.repository.putPackageWithArtifact(value, {
      ...artifact, orgId: input.principal.orgId, createdAt: value.createdAt,
    })
    return this.hydrate(value)
  }

  private async hydrate(pkg: CordisPackageVersion): Promise<CordisPackageVersion> {
    if (pkg.hostCode !== undefined || pkg.clientCode !== undefined) return pkg
    const source = await this.artifactStore.read(pkg.artifactRef)
    if (source.orgId !== pkg.orgId || source.pluginId !== pkg.pluginId) {
      throw new EnterpriseCordisError('validation-failed', 'Cordis artifact ownership mismatch')
    }
    return {
      ...pkg,
      ...(source.hostCode === undefined ? {} : { hostCode: source.hostCode }),
      ...(source.clientCode === undefined ? {} : { clientCode: source.clientCode }),
    }
  }

  /**
   * Load one Package and hydrate its verified source artifact.
   * @param packageId - immutable Package identity.
   * @returns hydrated Package when it exists.
   */
  async packageSource(packageId: string): Promise<CordisPackageVersion | undefined> {
    const pkg = await this.repository.package(packageId)
    return pkg === undefined ? undefined : this.hydrate(pkg)
  }

  /**
   * Persist an immutable Package owned by a personal Workspace.
   * @param input - authenticated principal, Workspace, draft, and idempotency key.
   * @returns saved Package version.
   */
  async savePersonal(input: {
    principal: EnterpriseCordisPrincipal
    workspaceId: string
    draft: CordisPackageDraft
    idempotencyKey: string
  }): Promise<CordisPackageVersion> {
    return this.idempotent(input.principal, 'save-personal', input.idempotencyKey, async () => {
      const scope = await this.personalScope(input.principal, input.workspaceId)
      if ((await this.repository.archiveForScope(input.principal.orgId, archiveScopeKey(scope), input.draft.pluginId))?.archived) {
        throw new EnterpriseCordisError('plugin-archived', 'Restore the private Plugin before saving another version')
      }
      const pkg = await this.packageFromDraft({
        principal: input.principal, draft: input.draft, scope,
      })
      this.emit('enterprise/cordis-package-saved', { orgId: input.principal.orgId, pluginId: pkg.pluginId, packageId: pkg.packageId })
      return pkg
    })
  }

  /**
   * Activate a personal Workspace Package using revision compare-and-swap.
   * @param input - principal, Workspace, Package, revision, and idempotency data.
   * @returns personal binding, unchanged when the requested Package is already active.
   */
  async activatePersonal(input: {
    principal: EnterpriseCordisPrincipal
    workspaceId: string
    pluginId: string
    packageId: string
    expectedRevision: number
    idempotencyKey: string
  }): Promise<CordisScopeBinding> {
    return this.idempotent(input.principal, 'activate-personal', input.idempotencyKey, async () => {
      const scope = await this.personalScope(input.principal, input.workspaceId)
      if ((await this.repository.archiveForScope(input.principal.orgId, archiveScopeKey(scope), input.pluginId))?.archived) {
        throw new EnterpriseCordisError('plugin-archived', 'Restore the private Plugin before activation')
      }
      const storedPackage = await this.repository.package(input.packageId)
      const pkg = storedPackage === undefined ? undefined : await this.hydrate(storedPackage)
      if (pkg === undefined || pkg.orgId !== input.principal.orgId || pkg.pluginId !== input.pluginId) {
        throw new EnterpriseCordisError('package-not-found', 'Cordis package was not found')
      }
      if (!sameScope(pkg.scope, scope)) {
        throw new EnterpriseCordisError('package-not-found', 'Cordis package is outside the private Workspace scope')
      }
      const current = await this.repository.bindingForScope(input.principal.orgId, scopeKey(scope), input.pluginId)
      if ((current?.revision ?? 0) !== input.expectedRevision) {
        throw new EnterpriseCordisError('revision-conflict', 'Cordis binding revision conflict')
      }
      if (current?.activePackageId === input.packageId && !current.disabled) return current
      const value: CordisScopeBinding = {
        bindingId: current?.bindingId ?? this.randomId('cordis-binding'),
        orgId: input.principal.orgId, scope, pluginId: input.pluginId, activePackageId: input.packageId,
        generation: (current?.generation ?? 0) + 1, revision: (current?.revision ?? 0) + 1,
        activatedBy: input.principal.userId, disabled: false,
        trustLevel: current?.trustLevel ?? 'isolated', updatedAt: this.now(),
      }
      await this.repository.putBinding(value, current?.revision ?? 0)
      this.emit('enterprise/cordis-run-health-updated', { orgId: value.orgId, pluginId: value.pluginId, packageId: value.activePackageId, bindingId: value.bindingId })
      return value
    })
  }

  /** Hide a private Plugin and stop its binding while retaining every immutable version.
   * @param input - authenticated owner, Workspace, Plugin, and idempotency key.
   * @returns the archived Plugin state.
   */
  async archivePersonal(input: {
    principal: EnterpriseCordisPrincipal
    workspaceId: string
    pluginId: string
    idempotencyKey: string
  }): Promise<CordisPluginArchive> {
    return this.idempotent(input.principal, 'archive-personal', input.idempotencyKey, async () => {
      const scope = await this.personalScope(input.principal, input.workspaceId)
      const versions = await this.repository.packages(input.pluginId, input.principal.orgId)
      if (!versions.some(pkg => sameScope(pkg.scope, scope))) {
        throw new EnterpriseCordisError('package-not-found', 'Private Cordis Plugin was not found')
      }
      const current = await this.repository.archiveForScope(input.principal.orgId, archiveScopeKey(scope), input.pluginId)
      if (current?.archived) return current
      const at = this.now()
      const next: CordisPluginArchive = {
        orgId: input.principal.orgId, scope, pluginId: input.pluginId, archived: true,
        revision: (current?.revision ?? 0) + 1, updatedBy: input.principal.userId, updatedAt: at,
      }
      const binding = await this.repository.bindingForScope(input.principal.orgId, scopeKey(scope), input.pluginId)
      const stopped = binding === undefined || binding.disabled ? undefined : {
        binding: { ...binding, disabled: true, disabledReason: 'private-plugin-archived',
          revision: binding.revision + 1, updatedAt: at }, expectedRevision: binding.revision,
      }
      await this.repository.putArchive(next, current?.revision ?? 0, stopped)
      await this.repository.appendAudit({
        id: this.randomId('cordis-audit'), orgId: next.orgId, actorUserId: input.principal.userId,
        action: 'cordis.plugin.archive', pluginId: input.pluginId, at,
        details: { workspaceId: input.workspaceId },
      })
      return next
    })
  }

  /** Restore a previously archived private Plugin without reactivating its binding.
   * @param input - authenticated owner, Workspace, Plugin, and idempotency key.
   * @returns restored Plugin state.
   */
  async restorePersonal(input: {
    principal: EnterpriseCordisPrincipal
    workspaceId: string
    pluginId: string
    idempotencyKey: string
  }): Promise<CordisPluginArchive> {
    return this.idempotent(input.principal, 'restore-personal', input.idempotencyKey, async () => {
      const scope = await this.personalScope(input.principal, input.workspaceId)
      const current = await this.repository.archiveForScope(input.principal.orgId, archiveScopeKey(scope), input.pluginId)
      if (current === undefined || !current.archived) {
        throw new EnterpriseCordisError('package-not-found', 'Archived private Cordis Plugin was not found')
      }
      const at = this.now()
      const next: CordisPluginArchive = { ...current, archived: false, revision: current.revision + 1,
        updatedBy: input.principal.userId, updatedAt: at }
      const binding = await this.repository.bindingForScope(input.principal.orgId, scopeKey(scope), input.pluginId)
      const stopped = binding === undefined || binding.disabled ? undefined : {
        binding: { ...binding, disabled: true, disabledReason: 'private-plugin-archived',
          revision: binding.revision + 1, updatedAt: at }, expectedRevision: binding.revision,
      }
      await this.repository.putArchive(next, current.revision, stopped)
      await this.repository.appendAudit({
        id: this.randomId('cordis-audit'), orgId: next.orgId, actorUserId: input.principal.userId,
        action: 'cordis.plugin.restore', pluginId: input.pluginId, at,
        details: { workspaceId: input.workspaceId },
      })
      return next
    })
  }

  /**
   * Submit a department Workspace Package for manager review.
   * @param input - principal, Workspace, source Session, draft, and idempotency data.
   * @returns created review request.
   */
  async submitDepartment(input: {
    principal: EnterpriseCordisPrincipal
    workspaceId: string
    draft: CordisPackageDraft
    sourceSessionId: string
    idempotencyKey: string
  }): Promise<CordisReviewRequest> {
    return this.idempotent(input.principal, 'submit-department', input.idempotencyKey, () =>
      this.createDepartmentReview(input))
  }

  /** Submit an existing owner-private version in a department Workspace without activating it for members.
   * @param input - owner, Workspace, saved version, and request key; the source Package identifies one review.
   * @returns the existing review for that immutable version, or a new pending review.
   */
  async submitSavedDepartment(input: {
    principal: EnterpriseCordisPrincipal
    workspaceId: string
    packageId: string
    idempotencyKey: string
  }): Promise<CordisReviewRequest> {
    const stored = await this.repository.package(input.packageId)
    if (stored === undefined || stored.orgId !== input.principal.orgId
      || stored.scope.type !== 'personal-workspace'
      || stored.scope.workspaceId !== input.workspaceId
      || stored.scope.ownerUserId !== input.principal.userId) {
      throw new EnterpriseCordisError('package-not-found', 'Private Cordis package was not found')
    }
    if ((await this.repository.archiveForScope(stored.orgId, archiveScopeKey(stored.scope), stored.pluginId))?.archived) {
      throw new EnterpriseCordisError('plugin-archived', 'Restore the private Plugin before submitting it')
    }
    return this.idempotent(input.principal, 'submit-saved-department', `package:${input.packageId}`, async () => {
      const source = await this.hydrate(stored)
      const draft: CordisPackageDraft = {
        pluginId: source.pluginId, dynamicPackageId: source.dynamicPackageId,
        name: source.name, purpose: source.purpose, manifest: source.manifest,
        artifactRef: source.artifactRef, validationReportRef: source.validationReportRef,
        ...(source.hostCode === undefined ? {} : { hostCode: source.hostCode }),
        ...(source.clientCode === undefined ? {} : { clientCode: source.clientCode }),
      }
      return this.createDepartmentReview({
        principal: input.principal, workspaceId: input.workspaceId, draft,
        sourceSessionId: source.pluginId.split(':', 1)[0] ?? source.pluginId,
        derivedFromPackageId: source.packageId,
      })
    })
  }

  private async createDepartmentReview(input: {
    principal: EnterpriseCordisPrincipal
    workspaceId: string
    draft: CordisPackageDraft
    sourceSessionId: string
    derivedFromPackageId?: string
  }): Promise<CordisReviewRequest> {
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
      ...(input.derivedFromPackageId === undefined ? {} : { derivedFromPackageId: input.derivedFromPackageId }),
    })
    const at = this.now()
    const review: CordisReviewRequest = {
      reviewId: this.randomId('cordis-review'), orgId: input.principal.orgId,
      departmentId: workspace.departmentId, pluginId: pkg.pluginId, packageId: pkg.packageId,
      sourceSessionId: input.sourceSessionId, submittedBy: input.principal.userId,
      status: 'pending', revision: 1, createdAt: at, updatedAt: at,
    }
    await this.repository.putReview(review, 0)
    this.emit('enterprise/cordis-review-requested', { orgId: review.orgId, pluginId: review.pluginId, packageId: review.packageId, reviewId: review.reviewId })
    return review
  }

  private async review(input: { principal: EnterpriseCordisPrincipal; reviewId: string }): Promise<CordisReviewRequest> {
    const review = await this.repository.review(input.reviewId)
    if (review === undefined || review.orgId !== input.principal.orgId) {
      throw new EnterpriseCordisError('review-not-found', 'Cordis review was not found')
    }
    await this.manager(input.principal, review.departmentId)
    return review
  }

  /**
   * Create an immutable manager-derived Package for an existing review.
   * @param input - principal, review, revised draft, CAS revision, and idempotency data.
   * @returns derived Package and new review revision.
   */
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
      this.emit('enterprise/cordis-review-updated', { orgId: next.orgId, pluginId: next.pluginId, packageId: next.packageId, reviewId: next.reviewId })
      return { ...pkg, reviewRevision: next.revision }
    })
  }

  /**
   * Approve a pending Package for department use or return it to its author.
   * @param input - principal, review transition, reason, CAS revision, and idempotency data.
   * @returns updated review request.
   */
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
      if (review.status !== 'pending') {
        throw new EnterpriseCordisError('review-state-invalid', `Cannot review ${review.status}`)
      }
      const next: CordisReviewRequest = {
        ...review,
        status: input.action === 'approve_department' ? 'approved-department' : 'changes-requested',
        reason: input.reason.trim(), revision: review.revision + 1, updatedAt: this.now(),
      }
      if (input.action === 'approve_department') {
        const scope: CordisPluginScope = { type: 'department', departmentId: review.departmentId }
        const current = await this.repository.bindingForScope(input.principal.orgId, scopeKey(scope), review.pluginId)
        const binding: CordisScopeBinding = {
          bindingId: current?.bindingId ?? this.randomId('cordis-binding'), orgId: input.principal.orgId,
          scope, pluginId: review.pluginId, activePackageId: review.packageId,
          generation: (current?.generation ?? 0) + 1, revision: (current?.revision ?? 0) + 1,
          activatedBy: input.principal.userId, disabled: false,
          trustLevel: current?.trustLevel ?? 'isolated', updatedAt: this.now(),
        }
        await this.repository.approveDepartment(next, binding, review.revision, current?.revision ?? 0)
        this.emit('enterprise/cordis-department-activated', { orgId: binding.orgId, pluginId: binding.pluginId, packageId: binding.activePackageId, bindingId: binding.bindingId, reviewId: review.reviewId })
      } else {
        await this.repository.putReview(next, review.revision)
      }
      this.emit('enterprise/cordis-review-updated', { orgId: next.orgId, pluginId: next.pluginId, packageId: next.packageId, reviewId: next.reviewId })
      return next
    })
  }

  /**
   * Publish a department-approved Package as the organization binding.
   * @param input - principal, review Package, CAS revision, and idempotency data.
   * @returns publication result and organization binding.
   */
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
      if (review.status !== 'approved-department') {
        throw new EnterpriseCordisError('review-state-invalid', `Cannot publish ${review.status}`)
      }
      const storedPackage = await this.repository.package(input.packageId)
      const pkg = storedPackage === undefined ? undefined : await this.hydrate(storedPackage)
      if (pkg === undefined) throw new EnterpriseCordisError('package-not-found', 'Cordis package was not found')
      this.validateDraft(pkg)
      const report = await this.repository.validationReport(pkg.validationReportRef)
      if (report?.status !== 'passed') {
        throw new EnterpriseCordisError('validation-failed', 'Cordis package did not pass the automatic publication gate')
      }
      const scope: CordisPluginScope = { type: 'organization', organizationId: input.principal.orgId }
      const current = await this.repository.bindingForScope(input.principal.orgId, scopeKey(scope), review.pluginId)
      const binding: CordisScopeBinding = {
        bindingId: current?.bindingId ?? this.randomId('cordis-binding'), orgId: input.principal.orgId,
        scope, pluginId: review.pluginId, activePackageId: input.packageId,
        generation: (current?.generation ?? 0) + 1, revision: (current?.revision ?? 0) + 1,
        activatedBy: input.principal.userId, disabled: false,
        trustLevel: current?.trustLevel ?? 'isolated', updatedAt: this.now(),
      }
      const next: PublishedCordisReview = {
        ...review, status: 'published-organization', publishedBy: input.principal.userId,
        revision: review.revision + 1, updatedAt: this.now(), organizationBinding: binding,
      }
      const { organizationBinding: _binding, ...stored } = next
      await this.repository.publishOrganization(stored, binding, review.revision, current?.revision ?? 0)
      this.emit('enterprise/cordis-organization-published', { orgId: binding.orgId, pluginId: binding.pluginId, packageId: binding.activePackageId, bindingId: binding.bindingId, reviewId: review.reviewId })
      return next
    })
  }

  /**
   * Emergency-disable a binding as an enterprise administrator.
   * @param input - principal, binding, reason, CAS revision, and idempotency data.
   * @returns disabled binding.
   */
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
      this.emit('enterprise/cordis-plugin-disabled', { orgId: next.orgId, pluginId: next.pluginId, packageId: next.activePackageId, bindingId: next.bindingId })
      return next
    })
  }

  private async authorizeBindingMutation(
    principal: EnterpriseCordisPrincipal,
    binding: CordisScopeBinding,
  ): Promise<void> {
    if (isAdmin(principal.roles)) return
    if (binding.scope.type === 'personal-workspace' && binding.scope.ownerUserId === principal.userId) return
    if (binding.scope.type === 'department') return this.manager(principal, binding.scope.departmentId)
    throw new EnterpriseCordisError('administrator-required', 'Administrator permission is required')
  }

  /**
   * Stop a binding within the caller's governed scope.
   * @param input - principal, binding, reason, CAS revision, and idempotency data.
   * @returns disabled binding, unchanged when it is already disabled.
   */
  async stopBinding(input: {
    principal: EnterpriseCordisPrincipal
    bindingId: string
    expectedRevision: number
    reason: string
    idempotencyKey: string
  }): Promise<CordisScopeBinding> {
    return this.idempotent(input.principal, 'stop-binding', input.idempotencyKey, async () => {
      const current = await this.repository.binding(input.bindingId)
      if (current === undefined || current.orgId !== input.principal.orgId) {
        throw new EnterpriseCordisError('package-not-found', 'Cordis binding was not found')
      }
      await this.authorizeBindingMutation(input.principal, current)
      if (current.revision !== input.expectedRevision) {
        throw new EnterpriseCordisError('revision-conflict', 'Cordis binding revision conflict')
      }
      if (current.disabled) return current
      const next: CordisScopeBinding = {
        ...current, disabled: true, disabledReason: input.reason.trim(),
        revision: current.revision + 1, updatedAt: this.now(),
      }
      await this.repository.putBinding(next, current.revision)
      this.emit('enterprise/cordis-run-health-updated', { orgId: next.orgId, pluginId: next.pluginId, packageId: next.activePackageId, bindingId: next.bindingId })
      return next
    })
  }

  /**
   * Roll a private binding to an older Package or resume a governed binding's approved Package.
   * @param input - principal, binding, Package, reason, CAS revision, and idempotency data.
   * @returns binding, unchanged when the requested Package is already active.
   */
  async rollbackBinding(input: {
    principal: EnterpriseCordisPrincipal
    bindingId: string
    packageId: string
    expectedRevision: number
    reason: string
    idempotencyKey: string
  }): Promise<CordisScopeBinding> {
    return this.idempotent(input.principal, 'rollback-binding', input.idempotencyKey, async () => {
      const current = await this.repository.binding(input.bindingId)
      if (current === undefined || current.orgId !== input.principal.orgId) {
        throw new EnterpriseCordisError('package-not-found', 'Cordis binding was not found')
      }
      await this.authorizeBindingMutation(input.principal, current)
      if (current.scope.type === 'personal-workspace'
        && (await this.repository.archiveForScope(current.orgId, archiveScopeKey(current.scope), current.pluginId))?.archived) {
        throw new EnterpriseCordisError('plugin-archived', 'Restore the private Plugin before rollback')
      }
      if (current.revision !== input.expectedRevision) {
        throw new EnterpriseCordisError('revision-conflict', 'Cordis binding revision conflict')
      }
      const pkg = await this.repository.package(input.packageId)
      if (pkg === undefined || pkg.orgId !== current.orgId || pkg.pluginId !== current.pluginId
        || (current.scope.type === 'personal-workspace' && !sameScope(pkg.scope, current.scope))
        || (current.scope.type !== 'personal-workspace' && pkg.packageId !== current.activePackageId)) {
        throw new EnterpriseCordisError('package-not-found', 'Rollback package was not found')
      }
      if (!current.disabled && current.activePackageId === pkg.packageId) return current
      const { disabledReason: _disabledReason, ...enabled } = current
      const next: CordisScopeBinding = {
        ...enabled, activePackageId: pkg.packageId, disabled: false, activatedBy: input.principal.userId,
        generation: current.generation + 1, revision: current.revision + 1, updatedAt: this.now(),
      }
      await this.repository.putBinding(next, current.revision)
      await this.repository.appendAudit({
        id: this.randomId('cordis-audit'), orgId: current.orgId, actorUserId: input.principal.userId,
        action: 'cordis.binding.rollback', pluginId: current.pluginId, packageId: pkg.packageId,
        at: next.updatedAt, details: { bindingId: current.bindingId, reason: input.reason.trim() },
      })
      this.emit('enterprise/cordis-run-health-updated', { orgId: next.orgId, pluginId: next.pluginId, packageId: next.activePackageId, bindingId: next.bindingId })
      return next
    })
  }

  /**
   * Set isolated or trusted in-process execution for an organization binding.
   * @param input - administrator principal, binding, trust level, reason, and CAS data.
   * @returns updated organization binding.
   */
  async setTrust(input: {
    principal: EnterpriseCordisPrincipal
    bindingId: string
    trustLevel: CordisScopeBinding['trustLevel']
    expectedRevision: number
    reason: string
    idempotencyKey: string
  }): Promise<CordisScopeBinding> {
    return this.idempotent(input.principal, 'set-trust', input.idempotencyKey, async () => {
      if (!isAdmin(input.principal.roles)) {
        throw new EnterpriseCordisError('administrator-required', 'Administrator permission is required')
      }
      const current = await this.repository.binding(input.bindingId)
      if (current === undefined || current.orgId !== input.principal.orgId) {
        throw new EnterpriseCordisError('package-not-found', 'Cordis binding was not found')
      }
      if (current.scope.type !== 'organization') {
        throw new EnterpriseCordisError('protected-contract', 'Only organization plugins can be promoted to trusted execution')
      }
      if (current.revision !== input.expectedRevision) {
        throw new EnterpriseCordisError('revision-conflict', 'Cordis binding revision conflict')
      }
      const next: CordisScopeBinding = {
        ...current, trustLevel: input.trustLevel, revision: current.revision + 1, updatedAt: this.now(),
      }
      await this.repository.putBinding(next, current.revision)
      await this.repository.appendAudit({
        id: this.randomId('cordis-audit'), orgId: current.orgId, actorUserId: input.principal.userId,
        action: 'cordis.binding.trust', pluginId: current.pluginId, packageId: current.activePackageId,
        at: next.updatedAt, details: { bindingId: current.bindingId, trustLevel: input.trustLevel, reason: input.reason.trim() },
      })
      return next
    })
  }

  /**
   * Capture the visible active bindings for one Session exactly once.
   * @param input - principal, Workspace, and Session identity.
   * @returns immutable Session Generation.
   */
  async pinSessionGeneration(input: {
    principal: EnterpriseCordisPrincipal
    workspaceId: string
    sessionId: string
  }): Promise<CordisSessionGeneration> {
    const existing = await this.repository.sessionGeneration(input.sessionId)
    if (existing !== undefined) {
      if (existing.orgId !== input.principal.orgId || existing.workspaceId !== input.workspaceId) {
        throw new EnterpriseCordisError('organization-mismatch', 'Session generation belongs to another Workspace')
      }
      if (existing.entries.some(entry => entry.scope.type === 'personal-workspace'
        && entry.scope.ownerUserId !== input.principal.userId)) {
        throw new EnterpriseCordisError('personal-owner-required', 'Session generation contains another user private Plugin')
      }
      return existing
    }
    const projection = await this.listWorkspace({ principal: input.principal, workspaceId: input.workspaceId })
    const value: CordisSessionGeneration = {
      sessionId: input.sessionId, orgId: input.principal.orgId, workspaceId: input.workspaceId,
      entries: effectiveCordisBindings(projection.bindings.filter(binding => !binding.disabled)).map(binding => ({
        pluginId: binding.pluginId, packageId: binding.activePackageId,
        bindingId: binding.bindingId, generation: binding.generation, scope: binding.scope,
        trustLevel: binding.trustLevel,
      })),
      createdAt: this.now(),
    }
    await this.repository.putSessionGeneration(value)
    return value
  }

  /**
   * Replace a department's manager set after membership validation.
   * @param input - administrator principal, department members, CAS revision, and idempotency data.
   * @returns updated department manager set.
   */
  async setDepartmentManagers(input: {
    principal: EnterpriseCordisPrincipal
    departmentId: string
    managerUserIds: readonly string[]
    expectedRevision: number
    idempotencyKey: string
  }): Promise<DepartmentManagerSet> {
    return this.idempotent(input.principal, 'set-department-managers', input.idempotencyKey, async () => {
      if (!isAdmin(input.principal.roles)) {
        throw new EnterpriseCordisError('administrator-required', 'Administrator permission is required')
      }
      for (const userId of new Set(input.managerUserIds)) {
        const memberships = await this.options.directory.userDepartments(input.principal.orgId, userId)
        if (!memberships.includes(input.departmentId)) {
          throw new EnterpriseCordisError(
            'department-member-required',
            `Department manager ${userId} must belong to department ${input.departmentId}`,
          )
        }
      }
      const current = await this.repository.departmentManagers(input.principal.orgId, input.departmentId)
      if ((current?.revision ?? 0) !== input.expectedRevision) {
        throw new EnterpriseCordisError('revision-conflict', 'Department manager revision conflict')
      }
      const auditId = this.randomId('cordis-audit')
      const value: DepartmentManagerSet = {
        orgId: input.principal.orgId, departmentId: input.departmentId,
        managerUserIds: [...new Set(input.managerUserIds)].sort(),
        revision: (current?.revision ?? 0) + 1, updatedBy: input.principal.userId, updatedAt: this.now(),
      }
      await this.repository.putDepartmentManagers(value, current?.revision ?? 0)
      await this.repository.appendAudit({
        id: auditId, orgId: input.principal.orgId, actorUserId: input.principal.userId,
        action: 'department-managers.update', pluginId: 'department-directory', at: value.updatedAt,
        details: { departmentId: input.departmentId, managerUserIds: value.managerUserIds },
      })
      return value
    })
  }

  /**
   * Read a department's manager set.
   * @param orgId - owning organization.
   * @param departmentId - department identity.
   * @returns manager set when configured.
   */
  async departmentManagers(orgId: string, departmentId: string): Promise<DepartmentManagerSet | undefined> {
    return this.repository.departmentManagers(orgId, departmentId)
  }

  /**
   * List Packages and bindings visible to a governed Workspace.
   * @param input - principal and Workspace identity.
   * @returns visible extension projection.
   */
  async listWorkspace(input: {
    principal: EnterpriseCordisPrincipal
    workspaceId: string
  }): Promise<CordisWorkspaceProjection> {
    const workspace = await this.workspace(input.principal, input.workspaceId)
    if (workspace.kind === 'personal' && workspace.ownerUserId !== input.principal.userId && !isAdmin(input.principal.roles)) {
      throw new EnterpriseCordisError('personal-owner-required', 'Personal Workspace owner permission is required')
    }
    if (workspace.kind === 'department' && workspace.departmentId !== undefined && !isAdmin(input.principal.roles)) {
      const memberships = await this.options.directory.userDepartments(input.principal.orgId, input.principal.userId)
      if (!memberships.includes(workspace.departmentId)) {
        throw new EnterpriseCordisError('department-member-required', 'Department membership is required')
      }
    }
    const visible = (scope: CordisPluginScope): boolean => scope.type === 'organization'
      || (scope.type === 'personal-workspace'
        && scope.workspaceId === workspace.workspaceId && scope.ownerUserId === input.principal.userId)
      || (workspace.kind === 'department' && scope.type === 'department'
        && scope.departmentId === workspace.departmentId)
    const mayReviewDepartment = workspace.kind === 'department' && workspace.departmentId !== undefined
      && (isAdmin(input.principal.roles) || await this.options.directory.isDepartmentManager(
        input.principal.orgId, workspace.departmentId, input.principal.userId,
      ))
    const archives = await this.repository.listArchives(input.principal.orgId)
    const archivedPrivate = (scope: CordisPluginScope, pluginId: string): boolean => scope.type === 'personal-workspace'
      && archives.some(row => row.archived && row.pluginId === pluginId && sameScope(row.scope, scope))
    const bindings = (await this.repository.listBindings(input.principal.orgId))
      .filter(row => visible(row.scope) && !archivedPrivate(row.scope, row.pluginId)
        && (!row.disabled || row.scope.type === 'personal-workspace'
          || (row.scope.type === 'department' ? mayReviewDepartment : isAdmin(input.principal.roles))))
      .map(row => ({ ...row, canManage: row.scope.type === 'personal-workspace'
        || (row.scope.type === 'department' ? mayReviewDepartment : isAdmin(input.principal.roles)) }))
    const sharedPackageIds = new Set(bindings.filter(row => row.scope.type === 'department')
      .map(row => row.activePackageId))
    const publishedPackageIds = new Set(bindings.filter(row => row.scope.type === 'organization')
      .map(row => row.activePackageId))
    const rows = await this.repository.listPackages(input.principal.orgId)
    return {
      packages: await Promise.all(rows
        .filter(row => !archivedPrivate(row.scope, row.pluginId)
          && (publishedPackageIds.has(row.packageId) || (visible(row.scope)
            && (row.scope.type === 'personal-workspace' || (row.scope.type === 'department'
              && (row.authoredBy === input.principal.userId || sharedPackageIds.has(row.packageId)
                || mayReviewDepartment))))))
        .map(async (row) => {
          const pkg = await this.hydrate(row)
          return pkg.scope.type === 'personal-workspace' && workspace.kind === 'department'
            && pkg.scope.ownerUserId === input.principal.userId
            ? { ...pkg, canSubmitDepartment: true } : pkg
        })),
      archivedPackages: await Promise.all(rows
        .filter(row => visible(row.scope) && archivedPrivate(row.scope, row.pluginId))
        .map(row => this.hydrate(row))),
      bindings,
    }
  }

  /**
   * List reviews authored by or governed by the caller.
   * @param input - authenticated principal.
   * @returns visible review requests.
   */
  async listReviews(input: { principal: EnterpriseCordisPrincipal }): Promise<readonly CordisReviewRequest[]> {
    const reviews = await this.repository.listReviews(input.principal.orgId)
    if (isAdmin(input.principal.roles)) return reviews
    const visible: CordisReviewRequest[] = []
    for (const review of reviews) {
      if (review.submittedBy === input.principal.userId
        || await this.options.directory.isDepartmentManager(
          input.principal.orgId, review.departmentId, input.principal.userId,
        )) visible.push(review)
    }
    return visible
  }

  /**
   * Append an explicit Cordis governance audit event.
   * @param event - immutable audit record.
   * @returns when the event has been persisted.
   */
  async audit(event: EnterpriseCordisAuditEvent): Promise<void> { await this.repository.appendAudit(event) }
}
