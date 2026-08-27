/** Production PostgreSQL composition for DSH Enterprise. */
import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from 'pg'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { migrateEnterpriseIdentityPostgres, PgEnterpriseIdentityRepository } from '@deepseek-ai/dsh-enterprise-identity-postgres'
import { PostgresSessionStore } from '@deepseek-ai/dsh-session-persistence-postgres'
import { EnterpriseCatalogRepository, migrateEnterpriseCatalog } from '@deepseek-ai/dsh-enterprise-catalog'
import { EnterpriseOperationsRepository, migrateEnterpriseOperations } from '@deepseek-ai/dsh-enterprise-operations'
import { EnterpriseKnowledgeRepository, migrateKnowledge } from '@deepseek-ai/dsh-knowledge-pgvector'
import type { PostgresDatabase as IdentityDatabase, PostgresQueryResult as IdentityResult } from '@deepseek-ai/dsh-enterprise-identity-postgres'
import type { PostgresDatabase as SessionDatabase, PostgresQueryResult as SessionResult } from '@deepseek-ai/dsh-session-persistence-postgres'
import type { PostgresDatabase as CatalogDatabase, PostgresQueryResult as CatalogResult } from '@deepseek-ai/dsh-enterprise-catalog'
import type { PostgresDatabase as OperationsDatabase, PostgresQueryResult as OperationsResult } from '@deepseek-ai/dsh-enterprise-operations'
import type { PostgresDatabase as KnowledgeDatabase, PostgresQueryResult as KnowledgeResult } from '@deepseek-ai/dsh-knowledge-pgvector'

type AnyResult = IdentityResult & SessionResult & CatalogResult & OperationsResult & KnowledgeResult

/** One transaction-aware wrapper shared by all enterprise PG adapters. */
export class EnterprisePostgresDatabase implements
  IdentityDatabase, SessionDatabase, CatalogDatabase, OperationsDatabase, KnowledgeDatabase {
  private ending: Promise<void> | undefined

  constructor(readonly pool: Pool, readonly client?: PoolClient) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values: readonly unknown[] = [],
  ): Promise<AnyResult & { rows: Row[] }> {
    const result = await (this.client ?? this.pool).query<Row & QueryResultRow>(text, [...values])
    return { rows: result.rows as Row[], rowCount: result.rowCount } as AnyResult & { rows: Row[] }
  }

  async connect(): Promise<EnterprisePostgresDatabase> {
    return new EnterprisePostgresDatabase(this.pool, await this.pool.connect())
  }

  release(): void { this.client?.release() }

  async end(): Promise<void> { await (this.ending ??= this.pool.end()) }

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

  async health(): Promise<{ ok: true; serverVersion: string }> {
    const result = await this.query<{ server_version: string }>('SELECT current_setting(\'server_version\') AS server_version')
    const serverVersion = result.rows[0]?.server_version
    if (serverVersion === undefined) throw new Error('PostgreSQL health check returned no server version')
    return { ok: true, serverVersion }
  }
}

export interface EnterprisePostgresConfig {
  readonly connectionString: string
  readonly poolMax?: number
  readonly idleTimeoutMs?: number
  readonly connectionTimeoutMs?: number
  readonly ssl?: boolean | object
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    enterprisePostgres: EnterprisePostgresComposition
  }
}

export const Config: z<EnterprisePostgresConfig> = z.object({
  connectionString: z.string().required(),
  poolMax: z.natural().min(1).max(200).default(20),
  idleTimeoutMs: z.natural().max(86_400_000).default(30_000),
  connectionTimeoutMs: z.natural().max(120_000).default(10_000),
  ssl: z.any().default(false),
})

export interface EnterprisePostgresComposition {
  readonly database: EnterprisePostgresDatabase
  readonly identity: PgEnterpriseIdentityRepository
  readonly session: PostgresSessionStore
  readonly catalog: EnterpriseCatalogRepository
  readonly operations: EnterpriseOperationsRepository
  readonly knowledge: EnterpriseKnowledgeRepository
  readonly close: () => Promise<void>
}

function poolConfig(config: EnterprisePostgresConfig): PoolConfig {
  if (config.connectionString.trim() === '') throw new Error('DSH_ENTERPRISE_DATABASE_URL is required')
  return {
    connectionString: config.connectionString,
    max: config.poolMax ?? 20,
    idleTimeoutMillis: config.idleTimeoutMs ?? 30_000,
    connectionTimeoutMillis: config.connectionTimeoutMs ?? 10_000,
    ...(config.ssl === undefined ? {} : { ssl: config.ssl }),
  }
}

/** Create, health-check, migrate, and expose every enterprise PostgreSQL adapter. */
export async function createEnterprisePostgresComposition(config: EnterprisePostgresConfig): Promise<EnterprisePostgresComposition> {
  const pool = new Pool(poolConfig(config))
  const database = new EnterprisePostgresDatabase(pool)
  try {
    await database.health()
    await database.transaction(transaction => migrateEnterpriseIdentityPostgres(transaction))
    const session = new PostgresSessionStore(database)
    await session.initialize()
    await migrateEnterpriseCatalog(database)
    await migrateEnterpriseOperations(database)
    await migrateKnowledge(database)
    const identity = new PgEnterpriseIdentityRepository(database)
    const catalog = new EnterpriseCatalogRepository(database)
    const operations = new EnterpriseOperationsRepository(database)
    const knowledge = new EnterpriseKnowledgeRepository(database)
    return { database, identity, session, catalog, operations, knowledge, close: () => database.end() }
  } catch (error) {
    await database.end()
    throw error
  }
}

/** Cordis plugin entrypoint used by the enterprise deployment patch. */
export async function apply(ctx: Context, config: EnterprisePostgresConfig): Promise<void> {
  const composition = await createEnterprisePostgresComposition(config)
  ctx.provide('enterprisePostgres', composition)
  ctx.effect(() => () => { void composition.close() }, 'enterprise-postgres: close pool')
}

export const inject: readonly string[] = []

export { name } from './invariant.ts'
