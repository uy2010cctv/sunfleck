/** PostgreSQL-backed durable event storage for native DSH sessions. */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Pool, type PoolClient } from 'pg'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import {
  SessionPersistence,
  SessionAlreadyExistsError,
  SessionAlreadyOwnedError,
  SessionHandleClosedError,
  SessionPersistenceNotFoundError,
  SessionReadOnlyError,
  assertContiguous,
  assertStoredId,
  assertVersion,
  materializeAppendBatch,
  materializeCreateHeader,
  validateStoredEvents,
  type SessionAccess,
  type SessionHandle,
  type SessionHandleAppendOptions,
  type SessionHandleFlushOptions,
  type SessionHandleReadOptions,
  type SessionHandleReadResult,
  type SessionPersistenceCreateOptions,
  type SessionPersistenceListOptions,
  type SessionPersistenceOpenOptions,
  type SessionPersistenceSnapshot,
  type SessionPersistenceStatOptions,
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
  override readonly name = 'session-persistence-postgres'

  static inject = ['sessions', 'enterprisePostgres']

  static Config: z<Config> = z.object({
    connectionString: z.string().default(''),
    database: z.any(),
    databaseMode: z.union([z.const('postgres'), z.const('standalone')]).default('standalone'),
  })

  private readonly store: PostgresSessionStore
  private readonly writers = new Map<SessionId, PostgresSessionHandle>()
  private readonly handles = new Set<PostgresSessionHandle>()

  constructor(ctx: Context, public config: Config) {
    super(ctx)
    const enterprisePostgres = ctx.get('enterprisePostgres') as { database: PostgresDatabase } | undefined
    const database = config.database ?? (config.databaseMode === 'postgres' ? enterprisePostgres?.database : undefined) ?? databaseFor(config)
    this.store = new PostgresSessionStore(database)
    ctx.effect(() => async () => {
      for (const handle of [...this.handles]) await handle.close()
      await this.store.close()
    }, 'session-persistence-postgres open handles')
  }

  protected async [Service.init](): Promise<void> {
    await this.store.initialize()
  }

  async create(header: SessionHeader, options?: SessionPersistenceCreateOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    const snapshot = materializeCreateHeader(header)
    const inheritedEventCount = options?.inheritedEventCount ?? 0
    if (!Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0) throw new TypeError('inheritedEventCount must be a non-negative safe integer')
    if (!await this.store.createStored(withStoredPrefix(snapshot, inheritedEventCount))) throw new SessionAlreadyExistsError(snapshot.id)
    return this.adopt(new PostgresSessionHandle(this, snapshot.id, snapshot, 'write', SessionLogOffset(inheritedEventCount), 0))
  }

  async open(id: SessionId, access: SessionAccess, options?: SessionPersistenceOpenOptions): Promise<SessionHandle> {
    options?.signal?.throwIfAborted()
    if (access === 'write' && this.writers.has(id)) throw new SessionAlreadyOwnedError(id)
    const stored = await this.requireStored(id, options?.signal)
    return this.adopt(new PostgresSessionHandle(this, id, stored.header, access, stored.inheritedEventCount, stored.events.length))
  }

  async flush(): Promise<void> { await Promise.all([...this.writers.values()].map(writer => writer.flush())) }

  async stat(id: SessionId, options?: SessionPersistenceStatOptions): Promise<SessionPersistenceSnapshot | undefined> {
    const stored = await this.store.loadStored(id, options?.signal)
    if (stored === undefined) return undefined
    const decoded = decodeStoredPrefix(stored.meta)
    this.validate(id, decoded.header, [...stored.events])
    return {
      header: decoded.header, revision: stored.revision, eventCount: stored.events.length,
      conversationStarted: stored.events.some(event => event.type === 'turn/start'),
    }
  }

  async list(options?: SessionPersistenceListOptions): Promise<readonly SessionPersistenceSnapshot[]> {
    const snapshots = await this.store.listSnapshots(options?.signal)
    return snapshots.map(snapshot => ({ ...snapshot, header: decodeStoredPrefix(snapshot.header).header }))
  }

  /** Executes `PostgresSessionPersistence.read` for this instance.
   * @param id - Input value used by this API.
   * @param signal - Input value used by this API.
   * @returns Result produced by this API.
  */
  async read(id: SessionId, signal?: AbortSignal): Promise<readonly SessionEvent[]> { return (await this.requireStored(id, signal)).events }
  /** Executes `PostgresSessionPersistence.append` for this instance.
   * @param events - Input value used by this API.
   * @param header - Input value used by this API.
   * @param inheritedEventCount - Input value used by this API.
  */
  append(header: SessionHeader, inheritedEventCount: number, events: readonly SessionEvent[]): Promise<void> {
    return this.store.appendBatch(withStoredPrefix(header, inheritedEventCount), events, true)
  }
  /** Executes `PostgresSessionPersistence.release` for this instance.
   * @param handle - Input value used by this API.
  */
  release(handle: PostgresSessionHandle): void {
    this.handles.delete(handle)
    if (this.writers.get(handle.id) === handle) this.writers.delete(handle.id)
  }
  private adopt(handle: PostgresSessionHandle): PostgresSessionHandle {
    this.handles.add(handle)
    if (handle.access === 'write') this.writers.set(handle.id, handle)
    return handle
  }
  private async requireStored(id: SessionId, signal?: AbortSignal) {
    const stored = await this.store.loadStored(id, signal)
    if (stored === undefined) throw new SessionPersistenceNotFoundError(id)
    const decoded = decodeStoredPrefix(stored.meta)
    return {
      header: decoded.header,
      inheritedEventCount: decoded.inheritedEventCount,
      events: this.validate(id, decoded.header, [...stored.events]),
    }
  }
  private validate(id: SessionId, header: SessionHeader, events: SessionEvent[]): SessionEvent[] {
    assertStoredId(id, header)
    assertVersion(header)
    assertContiguous(id, events, 0)
    return validateStoredEvents(header, events)
  }
}

class PostgresSessionHandle implements SessionHandle {
  private closed = false

  constructor(
    private readonly persistence: PostgresSessionPersistence,
    readonly id: SessionId,
    readonly header: SessionHeader,
    readonly access: SessionAccess,
    readonly inheritedEventCount: SessionLogOffset,
    private cursor: number,
  ) {}

  async read(offset = 0, length = Number.MAX_SAFE_INTEGER, options?: SessionHandleReadOptions): Promise<SessionHandleReadResult> {
    this.assertOpen('read')
    if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError(`read offset must be a non-negative safe integer, got ${String(offset)}`)
    if (!Number.isSafeInteger(length) || length < 0) throw new TypeError(`read length must be a non-negative safe integer, got ${String(length)}`)
    options?.signal?.throwIfAborted()
    const events = await this.persistence.read(this.id, options?.signal)
    this.cursor = Math.max(this.cursor, events.length)
    return { eventState: 'detached', events: events.slice(offset, offset + length) }
  }

  async append(events: readonly SessionEvent[], options?: SessionHandleAppendOptions): Promise<void> {
    this.assertOpen('append')
    if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'append')
    options?.signal?.throwIfAborted()
    const batch = materializeAppendBatch(events)
    assertContiguous(this.id, batch, this.cursor)
    if (batch.length === 0) return
    await this.persistence.append(this.header, this.inheritedEventCount, batch)
    this.cursor += batch.length
  }

  async flush(options?: SessionHandleFlushOptions): Promise<void> {
    this.assertOpen('flush')
    if (this.access !== 'write') throw new SessionReadOnlyError(this.id, 'flush')
    options?.signal?.throwIfAborted()
  }

  async close(): Promise<void> { if (!this.closed) { this.closed = true; this.persistence.release(this) } }
  [Symbol.asyncDispose](): Promise<void> { return this.close() }
  private assertOpen(operation: string): void { if (this.closed) throw new SessionHandleClosedError(this.id, operation) }
}

const STORED_PREFIX = '__dsh_session_persistence_postgres_inherited_event_count'
function withStoredPrefix(header: SessionHeader, inheritedEventCount: number): SessionHeader {
  return { ...header, [STORED_PREFIX]: inheritedEventCount } as SessionHeader
}
function decodeStoredPrefix(stored: SessionHeader): { header: SessionHeader; inheritedEventCount: SessionLogOffset } {
  const record = stored as SessionHeader & Record<string, unknown>
  const value = record[STORED_PREFIX]
  const inheritedEventCount = value === undefined ? 0 : value
  if (typeof inheritedEventCount !== 'number' || !Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0) throw new Error('stored inherited event count is invalid')
  const { [STORED_PREFIX]: _prefix, ...header } = record
  return { header: header as SessionHeader, inheritedEventCount: SessionLogOffset(inheritedEventCount) }
}

function databaseFor(config: Config): PostgresDatabase {
  if (config.connectionString === undefined || config.connectionString.length === 0) {
    throw new Error('session persistence PostgreSQL requires connectionString or programmatic database')
  }
  return new PgPoolDatabase(new Pool({ connectionString: config.connectionString }))
}

export default PostgresSessionPersistence
