/** Production PostgreSQL composition for DSH Enterprise. */
import { createHmac } from 'node:crypto'
import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { migrateEnterpriseIdentityPostgres, PgEnterpriseIdentityRepository } from '@deepseek-ai/dsh-enterprise-identity-postgres'
import { PostgresSessionStore } from '@deepseek-ai/dsh-session-persistence-postgres'
import { EnterpriseCatalogRepository, migrateEnterpriseCatalog } from '@deepseek-ai/dsh-enterprise-catalog'
import {
  EnterpriseOperationsRepository,
  EnterpriseTeamControlRepository,
  migrateEnterpriseOperations,
} from '@deepseek-ai/dsh-enterprise-operations'
import { PostgresEnterpriseCordisRepository, migrateEnterpriseCordis } from '@deepseek-ai/dsh-enterprise-cordis'
import { EnterpriseKnowledgeRepository, migrateKnowledge } from '@deepseek-ai/dsh-knowledge-pgvector'
import { PostgresDevicePlaneRepository } from '@deepseek-ai/dsh-enterprise-device-plane'
import { EnterpriseProjectRepository, EnterpriseProjectService, migrateEnterpriseProject } from '@deepseek-ai/dsh-enterprise-project'
import type { PostgresDatabase as IdentityDatabase, PostgresQueryResult as IdentityResult } from '@deepseek-ai/dsh-enterprise-identity-postgres'
import type { PostgresDatabase as SessionDatabase, PostgresQueryResult as SessionResult } from '@deepseek-ai/dsh-session-persistence-postgres'
import type { PostgresDatabase as CatalogDatabase, PostgresQueryResult as CatalogResult } from '@deepseek-ai/dsh-enterprise-catalog'
import type { PostgresDatabase as OperationsDatabase, PostgresQueryResult as OperationsResult } from '@deepseek-ai/dsh-enterprise-operations'
import type { PostgresDatabase as KnowledgeDatabase, PostgresQueryResult as KnowledgeResult } from '@deepseek-ai/dsh-knowledge-pgvector'
import type {
  EnterpriseCordisPostgresDatabase as CordisDatabase,
  EnterpriseCordisPostgresResult as CordisResult,
} from '@deepseek-ai/dsh-enterprise-cordis'
import type { PostgresDatabase as ProjectDatabase, PostgresQueryResult as ProjectResult } from '@deepseek-ai/dsh-enterprise-project'
import { migrateSurfaceDirectory, PostgresSurfaceDirectory } from './surface-directory.ts'
import { migrateCollaboration, PostgresCollaborationRepository } from './collaboration.ts'
export { PostgresCollaborationRepository, CollaborationCreationConflictError } from './collaboration.ts'
export type { CollaborationConfig, CollaborationRecord, CollaborationTopic, CollaborationSession } from './collaboration.ts'

export { PostgresSurfaceDirectory, migrateSurfaceDirectory } from './surface-directory.ts'
export type { SurfaceDirectoryEntry, SurfaceDirectoryKind } from './surface-directory.ts'

/** Confirm that the enterprise gateway bound a native Session to this organization.
 * @param database - Identity PostgreSQL transaction.
 * @param orgId - Organization owning the work record.
 * @param sessionId - Native Session identity.
 * @returns whether the Session's authorized Workspace binding exists.
 */
export async function enterpriseSessionBound(database: IdentityDatabase, orgId: string, sessionId: string): Promise<boolean> {
  const result = await database.query<{ present: number }>(
    'SELECT 1 AS present FROM enterprise_session_workspaces WHERE session_id = $1 AND org_id = $2',
    [sessionId, orgId],
  )
  return result.rows[0] !== undefined
}

type AnyResult = IdentityResult & SessionResult & CatalogResult & OperationsResult & KnowledgeResult & CordisResult & ProjectResult

/** One transaction-aware wrapper shared by all enterprise PG adapters.
 * @param operation - Input value used by this API.
 */
export class EnterprisePostgresDatabase implements
  IdentityDatabase, SessionDatabase, CatalogDatabase, OperationsDatabase, KnowledgeDatabase, CordisDatabase, ProjectDatabase {
  private ending: Promise<void> | undefined

  constructor(readonly pool: Pool, readonly client?: PoolClient) {}

  /* oxlint-disable typescript/no-unnecessary-type-parameters -- each caller selects its PostgreSQL row type. */
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values: readonly unknown[] = [],
  ): Promise<AnyResult & { rows: Row[] }> {
    const result = await (this.client ?? this.pool).query<Row & QueryResultRow>(text, [...values])
    return { rows: result.rows, rowCount: result.rowCount }
  }
  /* oxlint-enable typescript/no-unnecessary-type-parameters */

  async connect(): Promise<EnterprisePostgresDatabase> {
    return new EnterprisePostgresDatabase(this.pool, await this.pool.connect())
  }

  release(): void { this.client?.release() }

  async end(): Promise<void> { await (this.ending ??= this.pool.end()) }

  /** @param operation - Work executed atomically against one checked-out database connection. */
  async transaction<T>(operation: (database: EnterprisePostgresDatabase) => Promise<T>): Promise<T> {
    const transaction = this.client === undefined ? await this.connect() : this
    const owner = transaction === this
    await transaction.query('BEGIN')
    try {
      const result = await operation(transaction)
      await transaction.query('COMMIT')
      return result
    } catch (error) {
      await transaction.query('ROLLBACK')
      throw error
    } finally {
      if (!owner) transaction.release()
    }
  }

  /** Executes `EnterprisePostgresDatabase.health` for this instance.
   * @returns Result produced by this API.
   */
  async health(): Promise<{ ok: true; serverVersion: string }> {
    const result = await this.query<{ server_version: string }>('SELECT current_setting(\'server_version\') AS server_version')
    const serverVersion = result.rows[0]?.server_version
    if (serverVersion === undefined) throw new Error('PostgreSQL health check returned no server version')
    return { ok: true, serverVersion }
  }
}

/** Data used by `EnterprisePostgresConfig`. */
export interface EnterprisePostgresConfig {
  /** PostgreSQL connection string; supplied by the Host rather than a browser client. */
  readonly connectionString: string
  /** Stable catalog cursor key; production derives it from deployment-owned secret material. */
  readonly cursorSigningKey: Buffer | string
  /** Maximum open PostgreSQL connections for the shared enterprise pool. */
  readonly poolMax?: number
  /** Idle connection timeout in milliseconds. */
  readonly idleTimeoutMs?: number
  /** New connection timeout in milliseconds. */
  readonly connectionTimeoutMs?: number
  /** TLS mode or driver TLS options for the PostgreSQL connection. */
  readonly ssl?: boolean | object
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    enterprisePostgres: EnterprisePostgresComposition
  }
}

export const Config: z<EnterprisePostgresConfig> = z.object({
  connectionString: z.string().required(),
  cursorSigningKey: z.any().required(),
  poolMax: z.natural().min(1).max(200).default(20),
  idleTimeoutMs: z.natural().max(86_400_000).default(30_000),
  connectionTimeoutMs: z.natural().max(120_000).default(10_000),
  ssl: z.any().default(false),
})

/** Shared production PostgreSQL adapters and their owned pool lifecycle. */
export interface EnterprisePostgresComposition {
  readonly database: EnterprisePostgresDatabase
  readonly identity: PgEnterpriseIdentityRepository
  readonly session: PostgresSessionStore
  readonly catalog: EnterpriseCatalogRepository
  readonly operations: EnterpriseOperationsRepository
  readonly teamControl: EnterpriseTeamControlRepository
  readonly knowledge: EnterpriseKnowledgeRepository
  readonly cordis: PostgresEnterpriseCordisRepository
  readonly devicePlane: PostgresDevicePlaneRepository
  readonly projects: EnterpriseProjectService
  readonly surfaceDirectory: PostgresSurfaceDirectory
  readonly collaboration: PostgresCollaborationRepository
  readonly close: () => Promise<void>
}

function poolConfig(config: EnterprisePostgresConfig): PoolConfig {
  if (config.connectionString.trim() === '') throw new Error('DSH_ENTERPRISE_DATABASE_URL is required')
  const cursorKey = Buffer.isBuffer(config.cursorSigningKey)
    ? config.cursorSigningKey
    : Buffer.from(config.cursorSigningKey, 'utf8')
  if (cursorKey.length < 32) throw new Error('enterprise catalog cursor signing key must be at least 32 bytes')
  if (new Set(cursorKey).size < 8) throw new Error('enterprise catalog cursor signing key has insufficient entropy')
  return {
    connectionString: config.connectionString,
    max: config.poolMax ?? 20,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 10_000,
    ...(config.ssl === undefined ? {} : { ssl: config.ssl }),
  }
}

/** Create, health-check, migrate, and expose every enterprise PostgreSQL adapter.
 * @param config - Input value used by this API.
 * @returns Result produced by this API.
 */
export async function createEnterprisePostgresComposition(config: EnterprisePostgresConfig): Promise<EnterprisePostgresComposition> {
  const rootCursorSigningKey = Buffer.isBuffer(config.cursorSigningKey)
    ? Buffer.from(config.cursorSigningKey)
    : Buffer.from(config.cursorSigningKey, 'utf8')
  const deriveCursorKey = (domain: string): Buffer => createHmac('sha256', rootCursorSigningKey).update(domain).digest()
  const pool = new Pool(poolConfig(config))
  const database = new EnterprisePostgresDatabase(pool)
  try {
    await database.health()
    await database.transaction(transaction => migrateEnterpriseIdentityPostgres(transaction))
    await migrateEnterpriseProject(database)
    await migrateSurfaceDirectory(database)
    await migrateCollaboration(database)
    const session = new PostgresSessionStore(database)
    await session.initialize()
    await migrateEnterpriseCatalog(database)
    await migrateEnterpriseOperations(database)
    await migrateKnowledge(database)
    await migrateEnterpriseCordis(database)
    const identity = new PgEnterpriseIdentityRepository(database)
    const catalog = new EnterpriseCatalogRepository(database, {
      cursorSigningKey: deriveCursorKey('dsh-enterprise-catalog-cursor-v1'),
    })
    const operations = new EnterpriseOperationsRepository(database, {
      cursorSigningKey: deriveCursorKey('dsh-enterprise-operations-cursor-v2'),
      resolveRelease: async (transaction, orgId, releaseId) => {
        const result = await transaction.query(
          'SELECT 1 FROM dsh_enterprise_employee_releases WHERE release_id = $1 AND org_id = $2', [releaseId, orgId],
        )
        return result.rows[0] !== undefined
      },
      resolveUser: async (transaction, orgId, userId) => {
        const result = await transaction.query(
          'SELECT 1 FROM users WHERE id = $1 AND org_id = $2', [userId, orgId],
        )
        return result.rows[0] !== undefined
      },
      resolveDepartment: async (transaction, orgId, departmentId) => {
        const result = await transaction.query(
          'SELECT 1 FROM departments WHERE id = $1 AND org_id = $2', [departmentId, orgId],
        )
        return result.rows[0] !== undefined
      },
      resolveSession: (transaction, orgId, sessionId) => enterpriseSessionBound(transaction, orgId, sessionId),
    })
    const teamControl = new EnterpriseTeamControlRepository(database, {
      cursorSigningKey: deriveCursorKey('dsh-enterprise-team-control-cursor-v1'),
    })
    const knowledge = new EnterpriseKnowledgeRepository(database)
    const cordis = new PostgresEnterpriseCordisRepository(database)
    const devicePlane = new PostgresDevicePlaneRepository(database)
    const projects = new EnterpriseProjectService(new EnterpriseProjectRepository(database))
    const surfaceDirectory = new PostgresSurfaceDirectory(database)
    const collaboration = new PostgresCollaborationRepository(database)
    return { database, identity, session, catalog, operations, teamControl, knowledge, cordis, devicePlane, projects,
      surfaceDirectory, collaboration,
      close: () => database.end() }
  } catch (error) {
    await database.end()
    throw error
  }
}

/** Cordis plugin entrypoint used by the enterprise deployment patch.
 * @param config - Input value used by this API.
 * @param ctx - Input value used by this API.
*/
export async function apply(ctx: Context, config: EnterprisePostgresConfig): Promise<void> {
  const composition = await createEnterprisePostgresComposition(config)
  ctx.provide('enterprisePostgres', composition)
  ctx.provide('enterpriseProjects', composition.projects)
  ctx.effect(() => () => { void composition.close() }, 'enterprise-postgres: close pool')
}

export const inject: readonly string[] = []

export { name } from './invariant.ts'
