/** Transactional PostgreSQL storage primitives for the native session event log. */

import { randomUUID } from 'node:crypto'
import type { SessionEvent, SessionHeader, SessionId } from '@deepseek-ai/dsh-session'
import {
  SessionPersistenceRevision,
  type SessionPersistenceSnapshot,
} from '@deepseek-ai/dsh-session-persistence'
import { migratePostgresSessionPersistence } from './schema.ts'
import type { PostgresDatabase, PostgresQueryable } from './types.ts'

interface HeaderRow extends Record<string, unknown> {
  readonly id: string
  readonly header_json: unknown
  readonly incarnation: string
  readonly revision: string | number
}

interface EventRow extends Record<string, unknown> {
  readonly seq: string | number
  readonly event_json: unknown
}

/** One validated durable PostgreSQL session prefix. */
export interface PostgresStoredPrefix {
  readonly meta: SessionHeader
  readonly events: readonly SessionEvent[]
  readonly revision: SessionPersistenceRevision
  readonly tornMarker?: number
}

/** PostgreSQL implementation of the persistence service's durable primitives. */
export class PostgresSessionStore {
  readonly name: string = 'session-persistence-postgres'
  private initialized: Promise<void> | undefined
  private storeIdentity: string | undefined

  constructor(private readonly database: PostgresDatabase) {}

  /** Initializes the package-owned schema once. */
  initialize(): Promise<void> {
    this.initialized ??= this.database.transaction(async (transaction) => {
      await transaction.query('SELECT pg_advisory_xact_lock($1)', [0x44534850])
      await migratePostgresSessionPersistence(transaction)
      const existing = await transaction.query<{ value: string }>(
        "SELECT value FROM dsh_session_persistence_meta WHERE key = 'store-id'",
      )
      if (existing.rows[0] === undefined) {
        const identity = randomUUID()
        const inserted = await transaction.query<{ value: string }>(
          `INSERT INTO dsh_session_persistence_meta(key, value) VALUES ('store-id', $1)
           ON CONFLICT (key) DO NOTHING RETURNING value`, [identity],
        )
        if (inserted.rows[0] !== undefined) this.storeIdentity = inserted.rows[0].value
        else {
          const current = await transaction.query<{ value: string }>(
            "SELECT value FROM dsh_session_persistence_meta WHERE key = 'store-id'",
          )
          if (current.rows[0] === undefined) throw new Error('session persistence PostgreSQL store identity is unavailable')
          this.storeIdentity = current.rows[0].value
        }
      } else {
        this.storeIdentity = existing.rows[0].value
      }
    })
    return this.initialized
  }

  async loadStored(id: SessionId, signal?: AbortSignal): Promise<PostgresStoredPrefix | undefined> {
    await this.observe(signal)
    return this.database.transaction(async (transaction) => {
      await transaction.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const result = await transaction.query<HeaderRow>(
        'SELECT id, header_json, incarnation, revision FROM dsh_session_headers WHERE id = $1', [id],
      )
      const header = result.rows[0]
      if (header === undefined) return undefined
      const parsed = parseContiguousEvents(id, await this.readEvents(transaction, id))
      signal?.throwIfAborted()
      return {
        meta: parseHeader(header.header_json),
        events: parsed.events,
        revision: this.revision(header),
        ...(parsed.tornMarker === undefined ? {} : { tornMarker: parsed.tornMarker }),
      }
    })
  }

  async readStoredRevision(
    id: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionPersistenceRevision | undefined> {
    await this.observe(signal)
    const result = await this.database.query<HeaderRow>(
      'SELECT id, header_json, incarnation, revision FROM dsh_session_headers WHERE id = $1', [id],
    )
    signal?.throwIfAborted()
    const header = result.rows[0]
    return header === undefined ? undefined : this.revision(header)
  }

  async loadStoredFrom(id: SessionId, fromSeq: number, signal?: AbortSignal): Promise<{ meta: SessionHeader; events: readonly SessionEvent[] } | undefined> {
    await this.observe(signal)
    return this.database.transaction(async (transaction) => {
      await transaction.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      const headers = await transaction.query<HeaderRow>(
        'SELECT id, header_json, incarnation, revision FROM dsh_session_headers WHERE id = $1', [id],
      )
      const header = headers.rows[0]
      if (header === undefined) return undefined
      const parsed = parseContiguousEvents(id, await this.readEvents(transaction, id))
      signal?.throwIfAborted()
      if (parsed.tornMarker !== undefined && parsed.tornMarker >= fromSeq) {
        throw new Error(`session ${id} has a corrupt event in requested suffix at seq ${parsed.tornMarker}`)
      }
      return { meta: parseHeader(header.header_json), events: parsed.events.filter(event => event.seq >= fromSeq) }
    })
  }

  async appendBatch(meta: SessionHeader, events: readonly SessionEvent[], isMaterialized: boolean): Promise<void> {
    await this.initialize()
    if (events.length === 0) return
    await this.database.transaction(async (transaction) => {
      let header: HeaderRow | undefined
      if (!isMaterialized) {
        const inserted = await transaction.query<HeaderRow>(
          `INSERT INTO dsh_session_headers(id, header_json, incarnation, revision, created_at)
           VALUES ($1, $2::jsonb, $3::uuid, 0, $4)
           ON CONFLICT (id) DO NOTHING
           RETURNING id, header_json, incarnation, revision`,
          [meta.id, JSON.stringify(meta), randomUUID(), meta.createdAt],
        )
        header = inserted.rows[0]
      }
      if (header === undefined) {
        const locked = await transaction.query<HeaderRow>(
          `SELECT id, header_json, incarnation, revision FROM dsh_session_headers
           WHERE id = $1 FOR UPDATE`, [meta.id],
        )
        header = locked.rows[0]
      }
      if (header === undefined) throw new Error(`session ${meta.id} metadata row is missing`)
      assertSameHeader(meta, parseHeader(header.header_json))
      const tail = await transaction.query<{ seq: string | number }>(
        'SELECT seq FROM dsh_session_events WHERE session_id = $1 ORDER BY seq DESC LIMIT 1', [meta.id],
      )
      const expected = tail.rows[0] === undefined ? 0 : integer(tail.rows[0].seq, 'event sequence') + 1
      assertContiguousAppend(meta.id, events, expected)
      for (const event of events) {
        await transaction.query(
          `INSERT INTO dsh_session_events(session_id, seq, event_json, event_type, event_time)
           VALUES ($1, $2, $3::jsonb, $4, $5)`,
          [meta.id, event.seq, JSON.stringify(event), event.type, event.time],
        )
      }
      const revised = await transaction.query<HeaderRow>(
        `UPDATE dsh_session_headers SET revision = revision + 1 WHERE id = $1
         RETURNING id, header_json, incarnation, revision`, [meta.id],
      )
      if (revised.rows.length !== 1) throw new Error(`session ${meta.id} metadata row is missing`)
    })
  }

  /** Materialize an empty session and report whether its id was newly claimed. */
  async createStored(meta: SessionHeader): Promise<boolean> {
    await this.initialize()
    return this.database.transaction(async (transaction) => {
      const inserted = await transaction.query<HeaderRow>(
        `INSERT INTO dsh_session_headers(id, header_json, incarnation, revision, created_at)
         VALUES ($1, $2::jsonb, $3::uuid, 0, $4)
         ON CONFLICT (id) DO NOTHING
         RETURNING id, header_json, incarnation, revision`,
        [meta.id, JSON.stringify(meta), randomUUID(), meta.createdAt],
      )
      return inserted.rows.length === 1
    })
  }

  async commitRepair(
    meta: SessionHeader,
    tornMarker: number | undefined,
    closers: readonly SessionEvent[],
  ): Promise<void> {
    await this.initialize()
    if (tornMarker === undefined && closers.length === 0) return
    await this.database.transaction(async (transaction) => {
      const locked = await transaction.query<HeaderRow>(
        `SELECT id, header_json, incarnation, revision FROM dsh_session_headers
         WHERE id = $1 FOR UPDATE`, [meta.id],
      )
      const header = locked.rows[0]
      if (header === undefined) throw new Error(`session ${meta.id} metadata row is missing`)
      assertSameHeader(meta, parseHeader(header.header_json))
      const rows = await transaction.query<EventRow>(
        'SELECT seq, event_json FROM dsh_session_events WHERE session_id = $1 ORDER BY seq', [meta.id],
      )
      const current = parseContiguousEvents(meta.id, rows.rows)
      if (current.tornMarker !== tornMarker) {
        throw new Error(`session ${meta.id} repair is stale: physical tail changed`)
      }
      if (tornMarker !== undefined) {
        await transaction.query('DELETE FROM dsh_session_events WHERE session_id = $1 AND seq >= $2', [meta.id, tornMarker])
      }
      const last = current.events.at(-1)
      const next = last === undefined ? 0 : last.seq + 1
      assertContiguousAppend(meta.id, closers, next)
      for (const event of closers) {
        await transaction.query(
          `INSERT INTO dsh_session_events(session_id, seq, event_json, event_type, event_time)
           VALUES ($1, $2, $3::jsonb, $4, $5)`,
          [meta.id, event.seq, JSON.stringify(event), event.type, event.time],
        )
      }
      await transaction.query('UPDATE dsh_session_headers SET revision = revision + 1 WHERE id = $1', [meta.id])
    })
  }

  async list(signal?: AbortSignal): Promise<SessionHeader[]> {
    await this.observe(signal)
    const result = await this.database.query<HeaderRow>(
      'SELECT id, header_json, incarnation, revision FROM dsh_session_headers ORDER BY created_at DESC, id',
    )
    signal?.throwIfAborted()
    return result.rows.map(row => parseHeader(row.header_json))
  }

  async listSnapshots(signal?: AbortSignal): Promise<SessionPersistenceSnapshot[]> {
    await this.observe(signal)
    const result = await this.database.query<HeaderRow>(
      'SELECT id, header_json, incarnation, revision FROM dsh_session_headers ORDER BY created_at DESC, id',
    )
    signal?.throwIfAborted()
    return result.rows.map(row => ({ header: parseHeader(row.header_json), revision: this.revision(row) }))
  }

  async close(): Promise<void> {
    await this.database.end?.()
  }

  private async observe(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    await this.initialize()
    signal?.throwIfAborted()
  }

  private async readEvents(database: PostgresQueryable, id: SessionId): Promise<readonly EventRow[]> {
    const result = await database.query<EventRow>(
      'SELECT seq, event_json FROM dsh_session_events WHERE session_id = $1 ORDER BY seq', [id],
    )
    return result.rows
  }

  private revision(row: HeaderRow) {
    if (this.storeIdentity === undefined) throw new Error('session persistence PostgreSQL store identity is unavailable')
    return SessionPersistenceRevision(
      `postgres:store:${this.storeIdentity}:incarnation:${row.incarnation}:revision:${String(row.revision)}`,
    )
  }
}

function parseHeader(value: unknown): SessionHeader {
  const parsed = parseJson(value, 'session header')
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('session header is not an object')
  return structuredClone(parsed) as SessionHeader
}

function parseEvent(value: unknown): SessionEvent {
  const parsed = parseJson(value, 'session event')
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('session event is not an object')
  return structuredClone(parsed) as SessionEvent
}

function parseJson(value: unknown, subject: string): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch (error: unknown) {
    throw new Error(`stored ${subject} contains invalid JSON`, { cause: error })
  }
}

function parseContiguousEvents(id: SessionId, rows: readonly EventRow[]): {
  events: SessionEvent[]
  tornMarker?: number
} {
  const events: SessionEvent[] = []
  for (const [index, row] of rows.entries()) {
    const seq = integer(row.seq, 'event sequence')
    try {
      const event = parseEvent(row.event_json)
      if (event.seq !== seq || seq !== events.length) throw new Error(`invalid event sequence ${seq}`)
      events.push(event)
    } catch (error: unknown) {
      if (index === rows.length - 1) return { events, tornMarker: seq }
      throw new Error(`session ${id} contains corrupt committed event at seq ${seq}`, { cause: error })
    }
  }
  return { events }
}

function integer(value: string | number, name: string): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`stored ${name} is not a non-negative safe integer`)
  return number
}

function assertContiguousAppend(id: SessionId, events: readonly SessionEvent[], expected: number): void {
  for (const [index, event] of events.entries()) {
    if (event.seq !== expected + index) {
      throw new Error(`session ${id} append starts at seq ${events[0]?.seq}, stored next seq is ${expected}`)
    }
  }
}

function assertSameHeader(expected: SessionHeader, actual: SessionHeader): void {
  if (canonicalJson(expected) !== canonicalJson(actual)) {
    throw new Error(`session ${expected.id} metadata does not match its existing durable header`)
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
