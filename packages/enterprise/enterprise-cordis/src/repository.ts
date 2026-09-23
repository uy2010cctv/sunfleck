import type {
  CordisPackageVersion,
  CordisPluginArchive,
  CordisReviewRequest,
  CordisScopeBinding,
  CordisSessionGeneration,
  CordisValidationReport,
  CordisArtifactMetadata,
  DepartmentManagerSet,
  EnterpriseCordisAuditEvent,
} from './types.ts'
import { archiveScopeKey } from './archive-key.ts'

/** Data used by `EnterpriseCordisRepository`. */
export interface EnterpriseCordisRepository {
  package(packageId: string): Promise<CordisPackageVersion | undefined>
  packages(pluginId: string, orgId: string): Promise<readonly CordisPackageVersion[]>
  listPackages(orgId: string): Promise<readonly CordisPackageVersion[]>
  putPackage(value: CordisPackageVersion): Promise<void>
  putPackageWithArtifact(value: CordisPackageVersion, artifact: CordisArtifactMetadata): Promise<void>
  artifact(artifactRef: string): Promise<CordisArtifactMetadata | undefined>
  review(reviewId: string): Promise<CordisReviewRequest | undefined>
  putReview(value: CordisReviewRequest, expectedRevision: number): Promise<void>
  approveDepartment(
    review: CordisReviewRequest,
    binding: CordisScopeBinding,
    expectedReviewRevision: number,
    expectedBindingRevision: number,
  ): Promise<void>
  publishOrganization(
    review: CordisReviewRequest,
    binding: CordisScopeBinding,
    expectedReviewRevision: number,
    expectedBindingRevision: number,
  ): Promise<void>
  listReviews(orgId: string): Promise<readonly CordisReviewRequest[]>
  binding(bindingId: string): Promise<CordisScopeBinding | undefined>
  bindingForScope(orgId: string, scopeKey: string, pluginId: string): Promise<CordisScopeBinding | undefined>
  putBinding(value: CordisScopeBinding, expectedRevision: number): Promise<void>
  listBindings(orgId: string): Promise<readonly CordisScopeBinding[]>
  archiveForScope(orgId: string, scopeKey: string, pluginId: string): Promise<CordisPluginArchive | undefined>
  listArchives(orgId: string): Promise<readonly CordisPluginArchive[]>
  putArchive(value: CordisPluginArchive, expectedRevision: number,
    stopBinding?: { binding: CordisScopeBinding; expectedRevision: number }): Promise<void>
  sessionGeneration(sessionId: string): Promise<CordisSessionGeneration | undefined>
  putSessionGeneration(value: CordisSessionGeneration): Promise<void>
  validationReport(reportRef: string): Promise<CordisValidationReport | undefined>
  putValidationReport(value: CordisValidationReport): Promise<void>
  command<T>(scope: string, idempotencyKey: string): Promise<T | undefined>
  putCommand<T>(scope: string, idempotencyKey: string, value: T): Promise<void>
  appendAudit(value: EnterpriseCordisAuditEvent): Promise<void>
  listAudit(orgId: string): Promise<readonly EnterpriseCordisAuditEvent[]>
  departmentManagers(orgId: string, departmentId: string): Promise<DepartmentManagerSet | undefined>
  putDepartmentManagers(value: DepartmentManagerSet, expectedRevision: number): Promise<void>
}

function copy<T>(value: T): T { return structuredClone(value) }

/** Deterministic in-memory adapter for domain tests and development composition. */
export class InMemoryEnterpriseCordisRepository implements EnterpriseCordisRepository {
  private readonly packageRows = new Map<string, CordisPackageVersion>()
  private readonly artifactRows = new Map<string, CordisArtifactMetadata>()
  private readonly reviewRows = new Map<string, CordisReviewRequest>()
  private readonly bindingRows = new Map<string, CordisScopeBinding>()
  private readonly archiveRows = new Map<string, CordisPluginArchive>()
  private readonly commands = new Map<string, unknown>()
  private readonly sessionGenerations = new Map<string, CordisSessionGeneration>()
  private readonly validationReports = new Map<string, CordisValidationReport>()
  private readonly auditRows: EnterpriseCordisAuditEvent[] = []
  private readonly managerRows = new Map<string, DepartmentManagerSet>()

  async package(packageId: string): Promise<CordisPackageVersion | undefined> {
    const value = this.packageRows.get(packageId)
    return value === undefined ? undefined : copy(value)
  }

  async packages(pluginId: string, orgId: string): Promise<readonly CordisPackageVersion[]> {
    return [...this.packageRows.values()].filter(row => row.pluginId === pluginId && row.orgId === orgId)
      .sort((left, right) => left.version - right.version).map(copy)
  }

  async putPackage(value: CordisPackageVersion): Promise<void> {
    if (this.packageRows.has(value.packageId)) throw new Error(`Cordis package ${value.packageId} already exists`)
    this.packageRows.set(value.packageId, copy(value))
  }

  async putPackageWithArtifact(value: CordisPackageVersion, artifact: CordisArtifactMetadata): Promise<void> {
    if (this.packageRows.has(value.packageId)) throw new Error(`Cordis package ${value.packageId} already exists`)
    const currentArtifact = this.artifactRows.get(artifact.artifactRef)
    if (currentArtifact !== undefined && currentArtifact.digest !== artifact.digest) {
      throw new Error('Cordis artifact metadata conflict')
    }
    this.artifactRows.set(artifact.artifactRef, copy(artifact))
    this.packageRows.set(value.packageId, copy(value))
  }

  async artifact(artifactRef: string): Promise<CordisArtifactMetadata | undefined> {
    const value = this.artifactRows.get(artifactRef)
    return value === undefined ? undefined : copy(value)
  }

  async listPackages(orgId: string): Promise<readonly CordisPackageVersion[]> {
    return [...this.packageRows.values()].filter(row => row.orgId === orgId)
      .sort((left, right) => left.createdAt - right.createdAt || left.packageId.localeCompare(right.packageId)).map(copy)
  }

  async review(reviewId: string): Promise<CordisReviewRequest | undefined> {
    const value = this.reviewRows.get(reviewId)
    return value === undefined ? undefined : copy(value)
  }

  async putReview(value: CordisReviewRequest, expectedRevision: number): Promise<void> {
    const current = this.reviewRows.get(value.reviewId)
    if ((current?.revision ?? 0) !== expectedRevision) throw new Error('Cordis review revision conflict')
    this.reviewRows.set(value.reviewId, copy(value))
  }

  async listReviews(orgId: string): Promise<readonly CordisReviewRequest[]> {
    return [...this.reviewRows.values()].filter(row => row.orgId === orgId)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.reviewId.localeCompare(right.reviewId)).map(copy)
  }

  async approveDepartment(
    review: CordisReviewRequest,
    binding: CordisScopeBinding,
    expectedReviewRevision: number,
    expectedBindingRevision: number,
  ): Promise<void> {
    const currentReview = this.reviewRows.get(review.reviewId)
    const currentBinding = this.bindingRows.get(binding.bindingId)
    if ((currentReview?.revision ?? 0) !== expectedReviewRevision) throw new Error('Cordis review revision conflict')
    if ((currentBinding?.revision ?? 0) !== expectedBindingRevision) throw new Error('Cordis binding revision conflict')
    this.reviewRows.set(review.reviewId, copy(review))
    this.bindingRows.set(binding.bindingId, copy(binding))
  }

  async publishOrganization(
    review: CordisReviewRequest,
    binding: CordisScopeBinding,
    expectedReviewRevision: number,
    expectedBindingRevision: number,
  ): Promise<void> {
    await this.approveDepartment(review, binding, expectedReviewRevision, expectedBindingRevision)
  }

  async binding(bindingId: string): Promise<CordisScopeBinding | undefined> {
    const value = this.bindingRows.get(bindingId)
    return value === undefined ? undefined : copy(value)
  }

  async bindingForScope(orgId: string, scopeKey: string, pluginId: string): Promise<CordisScopeBinding | undefined> {
    const value = [...this.bindingRows.values()].find(row =>
      row.orgId === orgId && row.pluginId === pluginId && JSON.stringify(row.scope) === scopeKey)
    return value === undefined ? undefined : copy(value)
  }

  async putBinding(value: CordisScopeBinding, expectedRevision: number): Promise<void> {
    const current = this.bindingRows.get(value.bindingId)
    if ((current?.revision ?? 0) !== expectedRevision) throw new Error('Cordis binding revision conflict')
    this.bindingRows.set(value.bindingId, copy(value))
  }

  async listBindings(orgId: string): Promise<readonly CordisScopeBinding[]> {
    return [...this.bindingRows.values()].filter(row => row.orgId === orgId)
      .sort((left, right) => left.bindingId.localeCompare(right.bindingId)).map(copy)
  }

  async archiveForScope(orgId: string, scopeKey: string, pluginId: string): Promise<CordisPluginArchive | undefined> {
    const value = this.archiveRows.get(`${orgId}:${scopeKey}:${pluginId}`)
    return value === undefined ? undefined : copy(value)
  }

  async listArchives(orgId: string): Promise<readonly CordisPluginArchive[]> {
    return [...this.archiveRows.values()].filter(row => row.orgId === orgId).map(copy)
  }

  async putArchive(value: CordisPluginArchive, expectedRevision: number,
    stopBinding?: { binding: CordisScopeBinding; expectedRevision: number }): Promise<void> {
    const key = `${value.orgId}:${archiveScopeKey(value.scope)}:${value.pluginId}`
    if ((this.archiveRows.get(key)?.revision ?? 0) !== expectedRevision) {
      throw new Error('Cordis archive revision conflict')
    }
    if (stopBinding !== undefined
      && (this.bindingRows.get(stopBinding.binding.bindingId)?.revision ?? 0) !== stopBinding.expectedRevision) {
      throw new Error('Cordis binding revision conflict')
    }
    if (stopBinding !== undefined) this.bindingRows.set(stopBinding.binding.bindingId, copy(stopBinding.binding))
    this.archiveRows.set(key, copy(value))
  }

  async sessionGeneration(sessionId: string): Promise<CordisSessionGeneration | undefined> {
    const value = this.sessionGenerations.get(sessionId)
    return value === undefined ? undefined : copy(value)
  }

  async putSessionGeneration(value: CordisSessionGeneration): Promise<void> {
    const current = this.sessionGenerations.get(value.sessionId)
    if (current !== undefined && JSON.stringify(current) !== JSON.stringify(value)) {
      throw new Error('Cordis Session generation already exists')
    }
    this.sessionGenerations.set(value.sessionId, copy(value))
  }

  async validationReport(reportRef: string): Promise<CordisValidationReport | undefined> {
    const value = this.validationReports.get(reportRef)
    return value === undefined ? undefined : copy(value)
  }

  async putValidationReport(value: CordisValidationReport): Promise<void> {
    const current = this.validationReports.get(value.reportRef)
    if (current !== undefined && JSON.stringify(current) !== JSON.stringify(value)) {
      throw new Error('Cordis validation report already exists')
    }
    this.validationReports.set(value.reportRef, copy(value))
  }

  async command<T>(scope: string, idempotencyKey: string): Promise<T | undefined> {
    const value = this.commands.get(`${scope}:${idempotencyKey}`)
    return value === undefined ? undefined : copy(value as T)
  }

  async putCommand<T>(scope: string, idempotencyKey: string, value: T): Promise<void> {
    const key = `${scope}:${idempotencyKey}`
    const current = this.commands.get(key)
    if (current !== undefined && JSON.stringify(current) !== JSON.stringify(value)) {
      throw new Error('Cordis idempotency key result conflict')
    }
    this.commands.set(key, copy(value))
  }

  async appendAudit(value: EnterpriseCordisAuditEvent): Promise<void> { this.auditRows.push(copy(value)) }

  async listAudit(orgId: string): Promise<readonly EnterpriseCordisAuditEvent[]> {
    return this.auditRows.filter(row => row.orgId === orgId).map(copy)
  }

  async departmentManagers(orgId: string, departmentId: string): Promise<DepartmentManagerSet | undefined> {
    const value = this.managerRows.get(`${orgId}:${departmentId}`)
    return value === undefined ? undefined : copy(value)
  }

  async putDepartmentManagers(value: DepartmentManagerSet, expectedRevision: number): Promise<void> {
    const key = `${value.orgId}:${value.departmentId}`
    const current = this.managerRows.get(key)
    if ((current?.revision ?? 0) !== expectedRevision) throw new Error('Department manager revision conflict')
    this.managerRows.set(key, copy(value))
  }
}
