/** PostgreSQL-backed durable event storage for native DSH sessions. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Pool, type PoolClient } from 'pg'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionHeader, SessionId, SessionPreparation } from '@deepseek-ai/dsh-session'
import {
  DEFAULT_PREPARED_SESSION_CACHE_SIZE,
  DEFAULT_WRITE_BATCH_MAX_DELAY_MS,
  MAX_WRITE_BATCH_DELAY_MS,
  PersistenceCoordinator,
  SessionPersistence,
  type SessionInspection,
  type SessionEventSuffix,
  type BorrowedSessionSource,
  type SessionLocation,
  type SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import { PostgresSessionStore } from './store.ts'
import type { PostgresDatabase, PostgresQueryResult, PostgresQueryable } from './types.ts'

export { SESSION_PERSISTENCE_POSTGRES_SCHEMA_VERSION, migratePostgresSessionPersistence } from './schema.ts'
export { PostgresSessionStore } from './store.ts'
export type { PostgresDatabase, PostgresQueryResult, PostgresQueryable } from './types.ts'

/** Plugin configuration. A database object is available only to programmatic composition. */
export interface Config {
  /** PostgreSQL connection string. Required unless programmatic `database` is supplied. */
  connectionString?: string
  /** Maximum retained cold preparations. */
  preparedSessionCacheSize?: number
  /** Fixed write-behind coalescing delay. */
  writeBatchMaxDelayMs?: number
  /** Programmatic driver-neutral database injection; not accepted from declarative config. */
  database?: PostgresDatabase
  /** When set, resolve the database from the enterprise PostgreSQL composition. */
  databaseMode?: 'postgres' | 'standalone'
}

/** PostgreSQL `Pool` adapter with one checked-out client for each transaction. */
export class PgPoolDatabase implements PostgresDatabase {
  constructor(private readonly pool: Pool) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    const result = await this.pool.query<Row>(text, [...values])
    return { rows: result.rows, rowCount: result.rowCount }
  }

  async transaction<T>(action: (transaction: PostgresQueryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await action(new PgClientQueryable(client))
      await client.query('COMMIT')
      return result
    } catch (error: unknown) {
      try {
        await client.query('ROLLBACK')
      } catch (rollbackError: unknown) {
        throw new AggregateError([error, rollbackError], 'PostgreSQL session transaction and rollback failed')
      }
      throw error
    } finally {
      client.release()
    }
  }

  end(): Promise<void> {
    return this.pool.end()
  }
}

class PgClientQueryable implements PostgresQueryable {
  constructor(private readonly client: PoolClient) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    const result = await this.client.query<Row>(text, [...values])
    return { rows: result.rows, rowCount: result.rowCount }
  }
}

/** Durable `SessionPersistence` provider backed by PostgreSQL rows and transactions. */
export class PostgresSessionPersistence extends SessionPersistence {
  override readonly supportsRawArtifacts = false
  override readonly name = 'session-persistence-postgres'

  static inject = ['sessions', 'enterprisePostgres']

  static Config: z<Config> = z.object({
    connectionString: z.string().default(''),
    preparedSessionCacheSize: z.number().step(1).min(1).default(DEFAULT_PREPARED_SESSION_CACHE_SIZE),
    writeBatchMaxDelayMs: z.number().step(1).min(1).max(MAX_WRITE_BATCH_DELAY_MS)
      .default(DEFAULT_WRITE_BATCH_MAX_DELAY_MS),
    database: z.any(),
    databaseMode: z.union([z.const('postgres'), z.const('standalone')]).default('standalone'),
  })

  private readonly store: PostgresSessionStore
  private readonly coordinator: PersistenceCoordinator<number>

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    const enterprisePostgres = ctx.get('enterprisePostgres') as { database: PostgresDatabase } | undefined
    const database = config.database ?? (config.databaseMode === 'postgres' ? enterprisePostgres?.database : undefined) ?? databaseFor(config)
    this.store = new PostgresSessionStore(database)
    this.coordinator = new PersistenceCoordinator(ctx, this.store, {
      preparedSessionCacheSize: config.preparedSessionCacheSize ?? DEFAULT_PREPARED_SESSION_CACHE_SIZE,
      writeBatchMaxDelayMs: config.writeBatchMaxDelayMs ?? DEFAULT_WRITE_BATCH_MAX_DELAY_MS,
    })
  }

  protected async [Service.init](): Promise<void> {
    await this.store.initialize()
  }

  locate(_meta: SessionHeader): SessionLocation | undefined {
    return undefined
  }

  create(meta: SessionHeader, inheritedEventCount: SessionLogOffset = SessionLogOffset(0)): Promise<void> {
    return this.coordinator.create(meta, inheritedEventCount)
  }

  append(id: SessionId, events: readonly import('@deepseek-ai/dsh-session').SessionEvent[]): Promise<void> {
    return this.coordinator.append(id, events)
  }

  override prepare(id: SessionId, signal?: AbortSignal): Promise<SessionPreparation> {
    return this.coordinator.prepare(id, signal)
  }

  load(id: SessionId): Promise<SessionInspection> {
    return this.coordinator.load(id)
  }

  inspect(id: SessionId, signal?: AbortSignal): Promise<SessionInspection> {
    return this.coordinator.inspect(id, signal)
  }

  override borrowSession(id: SessionId, signal?: AbortSignal): Promise<BorrowedSessionSource> {
    return this.coordinator.borrowSession(id, signal)
  }

  readFrom(id: SessionId, fromSeq: SessionLogOffset, signal?: AbortSignal): Promise<SessionEventSuffix> {
    return this.coordinator.readFrom(id, fromSeq, signal)
  }

  list(signal?: AbortSignal): Promise<SessionHeader[]> {
    return this.store.list(signal)
  }

  listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]> {
    return this.store.listSnapshots(signal)
  }
}

function databaseFor(config: Config): PostgresDatabase {
  if (config.connectionString === undefined || config.connectionString.length === 0) {
    throw new Error('session persistence PostgreSQL requires connectionString or programmatic database')
  }
  return new PgPoolDatabase(new Pool({ connectionString: config.connectionString }))
}

export default PostgresSessionPersistence
