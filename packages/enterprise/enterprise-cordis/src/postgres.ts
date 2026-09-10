import type { EnterpriseCordisRepository } from './repository.ts'
import type {
  CordisPackageVersion,
  CordisReviewRequest,
  CordisScopeBinding,
  CordisSessionGeneration,
  CordisValidationReport,
  CordisArtifactMetadata,
  DepartmentManagerSet,
  EnterpriseCordisAuditEvent,
} from './types.ts'

/** Data used by `EnterpriseCordisPostgresResult`. */
export interface EnterpriseCordisPostgresResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[]
  readonly rowCount: number | null
}

/** Data used by `EnterpriseCordisPostgresDatabase`. */
export interface EnterpriseCordisPostgresDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<EnterpriseCordisPostgresResult<Row>>
  transaction<T>(operation: (database: EnterpriseCordisPostgresDatabase) => Promise<T>): Promise<T>
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_cordis_packages (
    package_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    plugin_id TEXT NOT NULL,
    dynamic_package_id TEXT NOT NULL,
    version BIGINT NOT NULL,
    scope_key TEXT NOT NULL,
    scope_json JSONB NOT NULL,
    derived_from_package_id TEXT,
    authored_by TEXT NOT NULL,
    modified_by TEXT,
    name TEXT NOT NULL,
    purpose TEXT NOT NULL,
    host_code TEXT,
    client_code TEXT,
    source_digest TEXT NOT NULL,
    manifest_json JSONB NOT NULL,
    artifact_ref TEXT NOT NULL,
    validation_report_ref TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    UNIQUE(org_id, plugin_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_cordis_reviews (
    review_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    plugin_id TEXT NOT NULL,
    package_id TEXT NOT NULL REFERENCES dsh_enterprise_cordis_packages(package_id),
    source_session_id TEXT NOT NULL,
    submitted_by TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    published_by TEXT,
    revision BIGINT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_cordis_bindings (
    binding_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    scope_key TEXT NOT NULL,
    scope_json JSONB NOT NULL,
    plugin_id TEXT NOT NULL,
    active_package_id TEXT NOT NULL REFERENCES dsh_enterprise_cordis_packages(package_id),
    generation BIGINT NOT NULL,
    revision BIGINT NOT NULL,
    activated_by TEXT NOT NULL,
    disabled BOOLEAN NOT NULL,
    disabled_reason TEXT,
    trust_level TEXT NOT NULL DEFAULT 'isolated',
    updated_at BIGINT NOT NULL,
    UNIQUE(org_id, scope_key, plugin_id)
  )`,
  "ALTER TABLE dsh_enterprise_cordis_bindings ADD COLUMN IF NOT EXISTS trust_level TEXT NOT NULL DEFAULT 'isolated'",
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_cordis_commands (
    command_scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    result_json JSONB NOT NULL,
    created_at BIGINT NOT NULL DEFAULT (extract(epoch from clock_timestamp()) * 1000)::BIGINT,
    PRIMARY KEY(command_scope, idempotency_key)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_cordis_session_generations (
    session_id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    entries_json JSONB NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_cordis_audit (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    plugin_id TEXT NOT NULL,
    package_id TEXT,
    review_id TEXT,
    created_at BIGINT NOT NULL,
    details_json JSONB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_cordis_artifacts (
    artifact_ref TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    digest TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_uri TEXT NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_cordis_validation_reports (
    report_ref TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    package_id TEXT NOT NULL,
    status TEXT NOT NULL,
    report_json JSONB NOT NULL,
    created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_department_managers (
    org_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    granted_by TEXT NOT NULL,
    granted_at BIGINT NOT NULL,
    revision BIGINT NOT NULL,
    PRIMARY KEY(org_id, department_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_enterprise_department_manager_sets (
    org_id TEXT NOT NULL,
    department_id TEXT NOT NULL,
    manager_user_ids JSONB NOT NULL,
    revision BIGINT NOT NULL,
    updated_by TEXT NOT NULL,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY(org_id, department_id)
  )`,
  'CREATE INDEX IF NOT EXISTS dsh_enterprise_cordis_reviews_department_status ON dsh_enterprise_cordis_reviews(org_id, department_id, status, updated_at DESC)',
  'CREATE INDEX IF NOT EXISTS dsh_enterprise_cordis_audit_org_time ON dsh_enterprise_cordis_audit(org_id, created_at DESC)',
] as const

/** Executes `migrateEnterpriseCordis`.
 * @param database - Input value used by this API.
 */
export async function migrateEnterpriseCordis(database: EnterpriseCordisPostgresDatabase): Promise<void> {
  for (const statement of SCHEMA) await database.query(statement)
}

function value<T>(input: unknown): T {
  return (typeof input === 'string' ? JSON.parse(input) : input) as T
}

interface PackageRow extends Record<string, unknown> {
  package_id: string
  org_id: string
  plugin_id: string
  dynamic_package_id: string
  version: string | number
  scope_json: unknown
  derived_from_package_id: string | null
  authored_by: string
  modified_by: string | null
  name: string
  purpose: string
  host_code: string | null
  client_code: string | null
  source_digest: string
  manifest_json: unknown
  artifact_ref: string
  validation_report_ref: string
  created_at: string | number
}

interface ReviewRow extends Record<string, unknown> {
  review_id: string
  org_id: string
  department_id: string
  plugin_id: string
  package_id: string
  source_session_id: string
  submitted_by: string
  status: CordisReviewRequest['status']
  reason: string | null
  published_by: string | null
  revision: string | number
  created_at: string | number
  updated_at: string | number
}

interface BindingRow extends Record<string, unknown> {
  binding_id: string
  org_id: string
  scope_json: unknown
  plugin_id: string
  active_package_id: string
  generation: string | number
  revision: string | number
  activated_by: string
  disabled: boolean
  disabled_reason: string | null
  trust_level: CordisScopeBinding['trustLevel']
  updated_at: string | number
}

function packageFromRow(row: PackageRow): CordisPackageVersion {
  return {
    packageId: row.package_id, orgId: row.org_id, pluginId: row.plugin_id,
    dynamicPackageId: row.dynamic_package_id, version: Number(row.version),
    scope: value(row.scope_json),
    ...(row.derived_from_package_id === null ? {} : { derivedFromPackageId: row.derived_from_package_id }),
    authoredBy: row.authored_by,
    ...(row.modified_by === null ? {} : { modifiedBy: row.modified_by }),
    name: row.name, purpose: row.purpose,
    ...(row.host_code === null ? {} : { hostCode: row.host_code }),
    ...(row.client_code === null ? {} : { clientCode: row.client_code }),
    sourceDigest: row.source_digest, manifest: value(row.manifest_json),
    artifactRef: row.artifact_ref, validationReportRef: row.validation_report_ref,
    createdAt: Number(row.created_at),
  }
}

function reviewFromRow(row: ReviewRow): CordisReviewRequest {
  return {
    reviewId: row.review_id, orgId: row.org_id, departmentId: row.department_id,
    pluginId: row.plugin_id, packageId: row.package_id, sourceSessionId: row.source_session_id,
    submittedBy: row.submitted_by, status: row.status,
    ...(row.reason === null ? {} : { reason: row.reason }),
    ...(row.published_by === null ? {} : { publishedBy: row.published_by }),
    revision: Number(row.revision), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

function bindingFromRow(row: BindingRow): CordisScopeBinding {
  return {
    bindingId: row.binding_id, orgId: row.org_id, scope: value(row.scope_json),
    pluginId: row.plugin_id, activePackageId: row.active_package_id,
    generation: Number(row.generation), revision: Number(row.revision),
    activatedBy: row.activated_by, disabled: row.disabled,
    ...(row.disabled_reason === null ? {} : { disabledReason: row.disabled_reason }),
    trustLevel: row.trust_level,
    updatedAt: Number(row.updated_at),
  }
}

/** Provides `PostgresEnterpriseCordisRepository` capabilities.
 * @param row - Input value used by this API.

 * @param row - Input value used by this API.

 * @param resultValue - Input value used by this API.

 * @param row - Input value used by this API.

 * @param row - Input value used by this API.

 * @param row - Input value used by this API.

 * @param key - Input value used by this API.

 * @param row - Input value used by this API.

 * @param row - Input value used by this API.

 * @param row - Input value used by this API.
 */
export class PostgresEnterpriseCordisRepository implements EnterpriseCordisRepository {
  constructor(private readonly database: EnterpriseCordisPostgresDatabase) {}

  async package(packageId: string): Promise<CordisPackageVersion | undefined> {
    const result = await this.database.query<PackageRow>(
      'SELECT * FROM dsh_enterprise_cordis_packages WHERE package_id = $1', [packageId],
    )
    return result.rows[0] === undefined ? undefined : packageFromRow(result.rows[0])
  }

  async packages(pluginId: string, orgId: string): Promise<readonly CordisPackageVersion[]> {
    const result = await this.database.query<PackageRow>(
      'SELECT * FROM dsh_enterprise_cordis_packages WHERE plugin_id = $1 AND org_id = $2 ORDER BY version',
      [pluginId, orgId],
    )
    return result.rows.map(packageFromRow)
  }

  /** @param row - Immutable Package version to persist. */
  async putPackage(row: CordisPackageVersion): Promise<void> {
    await this.database.query(`INSERT INTO dsh_enterprise_cordis_packages(
      package_id, org_id, plugin_id, dynamic_package_id, version, scope_key, scope_json,
      derived_from_package_id, authored_by, modified_by, name, purpose, host_code, client_code,
      source_digest, manifest_json, artifact_ref, validation_report_ref, created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19)`, [
      row.packageId, row.orgId, row.pluginId, row.dynamicPackageId, row.version,
      JSON.stringify(row.scope), JSON.stringify(row.scope), row.derivedFromPackageId ?? null,
      row.authoredBy, row.modifiedBy ?? null, row.name, row.purpose, row.hostCode ?? null,
      row.clientCode ?? null, row.sourceDigest, JSON.stringify(row.manifest),
      row.artifactRef, row.validationReportRef, row.createdAt,
    ])
  }

  /** @param row - Package version that references the artifact. */
  async putPackageWithArtifact(row: CordisPackageVersion, artifact: CordisArtifactMetadata): Promise<void> {
    await this.database.transaction(async (database) => {
      const result = await database.query(`INSERT INTO dsh_enterprise_cordis_artifacts(
        artifact_ref,org_id,digest,size_bytes,storage_uri,created_at
      ) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [
        artifact.artifactRef, artifact.orgId, artifact.digest, artifact.sizeBytes,
        artifact.storageUri, artifact.createdAt,
      ])
      if (result.rowCount !== 1) {
        const existing = await database.query<Record<string, unknown>>(
          'SELECT digest,org_id FROM dsh_enterprise_cordis_artifacts WHERE artifact_ref=$1', [artifact.artifactRef],
        )
        if (existing.rows[0]?.['digest'] !== artifact.digest || existing.rows[0]?.['org_id'] !== artifact.orgId) {
          throw new Error('Cordis artifact metadata conflict')
        }
      }
      await new PostgresEnterpriseCordisRepository(database).putPackage(row)
    })
  }

  async artifact(artifactRef: string): Promise<CordisArtifactMetadata | undefined> {
    const result = await this.database.query<Record<string, unknown>>(
      'SELECT * FROM dsh_enterprise_cordis_artifacts WHERE artifact_ref=$1', [artifactRef],
    )
    const row = result.rows[0]
    return row === undefined ? undefined : {
      artifactRef: String(row['artifact_ref']), orgId: String(row['org_id']), digest: String(row['digest']),
      sizeBytes: Number(row['size_bytes']), storageUri: String(row['storage_uri']), createdAt: Number(row['created_at']),
    }
  }

  async listPackages(orgId: string): Promise<readonly CordisPackageVersion[]> {
    const result = await this.database.query<PackageRow>(
      'SELECT * FROM dsh_enterprise_cordis_packages WHERE org_id=$1 ORDER BY created_at,package_id', [orgId],
    )
    return result.rows.map(packageFromRow)
  }

  async review(reviewId: string): Promise<CordisReviewRequest | undefined> {
    const result = await this.database.query<ReviewRow>(
      'SELECT * FROM dsh_enterprise_cordis_reviews WHERE review_id = $1', [reviewId],
    )
    return result.rows[0] === undefined ? undefined : reviewFromRow(result.rows[0])
  }

  /** @param row - Review request to insert or update. */
  async putReview(row: CordisReviewRequest, expectedRevision: number): Promise<void> {
    const result = expectedRevision === 0
      ? await this.database.query(`INSERT INTO dsh_enterprise_cordis_reviews(
        review_id, org_id, department_id, plugin_id, package_id, source_session_id, submitted_by,
        status, reason, published_by, revision, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`, [
        row.reviewId, row.orgId, row.departmentId, row.pluginId, row.packageId,
        row.sourceSessionId, row.submittedBy, row.status, row.reason ?? null,
        row.publishedBy ?? null, row.revision, row.createdAt, row.updatedAt,
      ])
      : await this.database.query(`UPDATE dsh_enterprise_cordis_reviews SET package_id=$1, status=$2,
        reason=$3, published_by=$4, revision=$5, updated_at=$6 WHERE review_id=$7 AND revision=$8`, [
        row.packageId, row.status, row.reason ?? null, row.publishedBy ?? null,
        row.revision, row.updatedAt, row.reviewId, expectedRevision,
      ])
    if (result.rowCount !== 1) throw new Error('Cordis review revision conflict')
  }

  async listReviews(orgId: string): Promise<readonly CordisReviewRequest[]> {
    const result = await this.database.query<ReviewRow>(
      'SELECT * FROM dsh_enterprise_cordis_reviews WHERE org_id=$1 ORDER BY updated_at DESC,review_id', [orgId],
    )
    return result.rows.map(reviewFromRow)
  }

  async approveDepartment(
    review: CordisReviewRequest,
    binding: CordisScopeBinding,
    expectedReviewRevision: number,
    expectedBindingRevision: number,
  ): Promise<void> {
    await this.database.transaction(async (database) => {
      const repository = new PostgresEnterpriseCordisRepository(database)
      await repository.putBinding(binding, expectedBindingRevision)
      await repository.putReview(review, expectedReviewRevision)
    })
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
    const result = await this.database.query<BindingRow>(
      'SELECT * FROM dsh_enterprise_cordis_bindings WHERE binding_id = $1', [bindingId],
    )
    return result.rows[0] === undefined ? undefined : bindingFromRow(result.rows[0])
  }

  /** @param key - Canonical scope key for the binding lookup. */
  async bindingForScope(orgId: string, key: string, pluginId: string): Promise<CordisScopeBinding | undefined> {
    const result = await this.database.query<BindingRow>(
      'SELECT * FROM dsh_enterprise_cordis_bindings WHERE org_id = $1 AND scope_key = $2 AND plugin_id = $3',
      [orgId, key, pluginId],
    )
    return result.rows[0] === undefined ? undefined : bindingFromRow(result.rows[0])
  }

  /** @param row - Scope binding to insert or compare-and-swap update. */
  async putBinding(row: CordisScopeBinding, expectedRevision: number): Promise<void> {
    const result = expectedRevision === 0
      ? await this.database.query(`INSERT INTO dsh_enterprise_cordis_bindings(
        binding_id, org_id, scope_key, scope_json, plugin_id, active_package_id, generation,
        revision, activated_by, disabled, disabled_reason, updated_at, trust_level
      ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`, [
        row.bindingId, row.orgId, JSON.stringify(row.scope), JSON.stringify(row.scope),
        row.pluginId, row.activePackageId, row.generation, row.revision, row.activatedBy,
        row.disabled, row.disabledReason ?? null, row.updatedAt, row.trustLevel,
      ])
      : await this.database.query(`UPDATE dsh_enterprise_cordis_bindings SET active_package_id=$1,
        generation=$2, revision=$3, activated_by=$4, disabled=$5, disabled_reason=$6, updated_at=$7,
        trust_level=$8 WHERE binding_id=$9 AND revision=$10`, [
        row.activePackageId, row.generation, row.revision, row.activatedBy,
        row.disabled, row.disabledReason ?? null, row.updatedAt, row.trustLevel, row.bindingId, expectedRevision,
      ])
    if (result.rowCount !== 1) throw new Error('Cordis binding revision conflict')
  }

  async listBindings(orgId: string): Promise<readonly CordisScopeBinding[]> {
    const result = await this.database.query<BindingRow>(
      'SELECT * FROM dsh_enterprise_cordis_bindings WHERE org_id=$1 ORDER BY binding_id', [orgId],
    )
    return result.rows.map(bindingFromRow)
  }

  async sessionGeneration(sessionId: string): Promise<CordisSessionGeneration | undefined> {
    const result = await this.database.query<Record<string, unknown>>(
      'SELECT * FROM dsh_enterprise_cordis_session_generations WHERE session_id=$1', [sessionId],
    )
    const row = result.rows[0]
    return row === undefined ? undefined : {
      sessionId: String(row['session_id']), orgId: String(row['org_id']), workspaceId: String(row['workspace_id']),
      entries: value(row['entries_json']), createdAt: Number(row['created_at']),
    }
  }

  /** @param row - Session generation pinned to durable Package versions. */
  async putSessionGeneration(row: CordisSessionGeneration): Promise<void> {
    const result = await this.database.query(`INSERT INTO dsh_enterprise_cordis_session_generations(
      session_id,org_id,workspace_id,entries_json,created_at
    ) VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT DO NOTHING`, [
      row.sessionId, row.orgId, row.workspaceId, JSON.stringify(row.entries), row.createdAt,
    ])
    if (result.rowCount !== 1) throw new Error('Cordis Session generation already exists')
  }

  async validationReport(reportRef: string): Promise<CordisValidationReport | undefined> {
    const result = await this.database.query<Record<string, unknown>>(
      'SELECT * FROM dsh_enterprise_cordis_validation_reports WHERE report_ref=$1', [reportRef],
    )
    const row = result.rows[0]
    return row === undefined ? undefined : {
      reportRef: String(row['report_ref']), orgId: String(row['org_id']), packageId: String(row['package_id']),
      status: String(row['status']) as CordisValidationReport['status'],
      checks: value<Record<string, unknown>>(row['report_json'])['checks'] as unknown as CordisValidationReport['checks'],
      createdAt: Number(row['created_at']),
    }
  }

  /** @param row - Validation report to persist once for its report reference. */
  async putValidationReport(row: CordisValidationReport): Promise<void> {
    const result = await this.database.query(`INSERT INTO dsh_enterprise_cordis_validation_reports(
      report_ref,org_id,package_id,status,report_json,created_at
    ) VALUES ($1,$2,$3,$4,$5::jsonb,$6) ON CONFLICT DO NOTHING`, [
      row.reportRef, row.orgId, row.packageId, row.status, JSON.stringify({ checks: row.checks }), row.createdAt,
    ])
    if (result.rowCount !== 1) throw new Error('Cordis validation report already exists')
  }

  async command<T>(scope: string, idempotencyKey: string): Promise<T | undefined> {
    const result = await this.database.query<{ result_json: unknown }>(
      'SELECT result_json FROM dsh_enterprise_cordis_commands WHERE command_scope=$1 AND idempotency_key=$2',
      [scope, idempotencyKey],
    )
    return result.rows[0] === undefined ? undefined : value(result.rows[0].result_json)
  }

  /** @param resultValue - Idempotent command result serialized for later replay. */
  async putCommand<T>(scope: string, idempotencyKey: string, resultValue: T): Promise<void> {
    await this.database.query(`INSERT INTO dsh_enterprise_cordis_commands(command_scope, idempotency_key, result_json)
      VALUES ($1,$2,$3::jsonb) ON CONFLICT (command_scope, idempotency_key) DO NOTHING`, [
      scope, idempotencyKey, JSON.stringify(resultValue),
    ])
  }

  /** @param row - Auditable Cordis governance event to append. */
  async appendAudit(row: EnterpriseCordisAuditEvent): Promise<void> {
    await this.database.query(`INSERT INTO dsh_enterprise_cordis_audit(
      id, org_id, actor_user_id, action, plugin_id, package_id, review_id, created_at, details_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [
      row.id, row.orgId, row.actorUserId, row.action, row.pluginId,
      row.packageId ?? null, row.reviewId ?? null, row.at, JSON.stringify(row.details),
    ])
  }

  async listAudit(orgId: string): Promise<readonly EnterpriseCordisAuditEvent[]> {
    const result = await this.database.query<Record<string, unknown>>(
      'SELECT * FROM dsh_enterprise_cordis_audit WHERE org_id=$1 ORDER BY created_at DESC, id', [orgId],
    )
    return result.rows.map(row => ({
      id: String(row['id']), orgId: String(row['org_id']), actorUserId: String(row['actor_user_id']),
      action: String(row['action']), pluginId: String(row['plugin_id']),
      ...(row['package_id'] === null ? {} : { packageId: String(row['package_id']) }),
      ...(row['review_id'] === null ? {} : { reviewId: String(row['review_id']) }),
      at: Number(row['created_at']), details: value(row['details_json']),
    }))
  }

  async departmentManagers(orgId: string, departmentId: string): Promise<DepartmentManagerSet | undefined> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT org_id,department_id,manager_user_ids,revision,updated_by,updated_at
       FROM dsh_enterprise_department_manager_sets WHERE org_id=$1 AND department_id=$2`,
      [orgId, departmentId],
    )
    const row = result.rows[0]
    return row === undefined ? undefined : {
      orgId: String(row['org_id']), departmentId: String(row['department_id']),
      managerUserIds: value(row['manager_user_ids']), revision: Number(row['revision']),
      updatedBy: String(row['updated_by']), updatedAt: Number(row['updated_at']),
    }
  }

  /** @param row - Department manager set to persist under the expected revision. */
  async putDepartmentManagers(row: DepartmentManagerSet, expectedRevision: number): Promise<void> {
    const result = expectedRevision === 0
      ? await this.database.query(`INSERT INTO dsh_enterprise_department_manager_sets(
        org_id,department_id,manager_user_ids,revision,updated_by,updated_at
      ) VALUES ($1,$2,$3::jsonb,$4,$5,$6) ON CONFLICT DO NOTHING`, [
        row.orgId, row.departmentId, JSON.stringify(row.managerUserIds), row.revision, row.updatedBy, row.updatedAt,
      ])
      : await this.database.query(`UPDATE dsh_enterprise_department_manager_sets SET
        manager_user_ids=$1::jsonb,revision=$2,updated_by=$3,updated_at=$4
        WHERE org_id=$5 AND department_id=$6 AND revision=$7`, [
        JSON.stringify(row.managerUserIds), row.revision, row.updatedBy, row.updatedAt,
        row.orgId, row.departmentId, expectedRevision,
      ])
    if (result.rowCount !== 1) throw new Error('Department manager revision conflict')
    await this.database.query('DELETE FROM dsh_enterprise_department_managers WHERE org_id=$1 AND department_id=$2', [
      row.orgId, row.departmentId,
    ])
    for (const userId of row.managerUserIds) {
      await this.database.query(`INSERT INTO dsh_enterprise_department_managers(
        org_id,department_id,user_id,granted_by,granted_at,revision
      ) VALUES ($1,$2,$3,$4,$5,$6)`, [
        row.orgId, row.departmentId, userId, row.updatedBy, row.updatedAt, row.revision,
      ])
    }
  }
}
