import { describe, expect, it } from 'vitest'
import { SessionLogOffset } from '@deepseek-ai/dsh-session'
import { PostgresSessionPersistence } from '../src/index.ts'
import { PostgresSessionStore } from '../src/store.ts'
import type { PostgresDatabase, PostgresQueryResult } from '../src/types.ts'

interface Header {
  id: string
  header_json: unknown
  incarnation: string
  revision: number
  created_at: number
  inherited_event_count: number
}

interface Event {
  seq: number
  event_json: unknown
}

class MemoryPostgresDatabase implements PostgresDatabase {
  private readonly meta = new Map<string, string>()
  private readonly headers = new Map<string, Header>()
  private readonly events = new Map<string, Map<number, Event>>()
  private tail = Promise.resolve()
  transactionCalls = 0
  readonly queries: string[] = []
  failNextEventInsert = false

  async transaction<T>(action: (transaction: MemoryPostgresDatabase) => Promise<T>): Promise<T> {
    this.transactionCalls += 1
    const run = this.tail.then(async () => {
      const checkpoint = this.snapshot()
      try {
        return await action(this)
      } catch (error: unknown) {
        this.restore(checkpoint)
        throw error
      }
    })
    this.tail = run.then(() => undefined, () => undefined)
    return run
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    this.queries.push(text)
    const rows = this.rows(text, values)
    return { rows: rows as Row[], rowCount: rows.length }
  }

  corruptTail(id: string): void {
    const session = this.events.get(id)
    if (session === undefined) throw new Error('missing test session')
    const tail = Math.max(...session.keys())
    session.set(tail, { seq: tail, event_json: '{' })
  }

  removeEvent(id: string, seq: number): void {
    this.events.get(id)?.delete(seq)
  }

  private rows(text: string, values: readonly unknown[]): Record<string, unknown>[] {
    if (text.startsWith('CREATE ') || text.startsWith('CREATE INDEX') || text.startsWith('ALTER TABLE') || text.startsWith('SET TRANSACTION') || text.startsWith('SELECT pg_advisory_xact_lock')) return []
    if (text.startsWith('SELECT value FROM dsh_session_persistence_meta')) {
      const key = text.includes("'schema-version'") ? 'schema-version' : 'store-id'
      const value = this.meta.get(key)
      return value === undefined ? [] : [{ value }]
    }
    if (text.startsWith('INSERT INTO dsh_session_persistence_meta')) {
      const key = text.includes("'schema-version'") ? 'schema-version' : 'store-id'
      const value = this.meta.get(key) ?? values[0] as string
      this.meta.set(key, value)
      return text.includes('RETURNING value') ? [{ value }] : []
    }
    if (text.startsWith('UPDATE dsh_session_persistence_meta')) {
      this.meta.set('schema-version', values[0] as string)
      return []
    }
    if (text.startsWith('INSERT INTO dsh_session_headers')) {
      const id = values[0] as string
      if (this.headers.has(id)) return []
      const header: unknown = typeof values[1] === 'string' ? JSON.parse(values[1]) as unknown : values[1]
      const row: Header = {
        id, header_json: header, incarnation: values[2] as string, revision: 0,
        created_at: values[3] as number, inherited_event_count: values[4] as number,
      }
      this.headers.set(id, row)
      return [this.header(row)]
    }
    if (text.includes('FROM dsh_session_headers') && text.includes('WHERE id = $1')) {
      const row = this.headers.get(values[0] as string)
      return row === undefined ? [] : [this.header(row)]
    }
    if (text.includes('FROM dsh_session_headers ORDER BY')) return [...this.headers.values()]
      .sort((left, right) => right.created_at - left.created_at || left.id.localeCompare(right.id))
      .map(row => this.header(row))
    if (text.startsWith('SELECT seq FROM dsh_session_events')) {
      const session = this.events.get(values[0] as string)
      const seq = session === undefined || session.size === 0 ? undefined : Math.max(...session.keys())
      return seq === undefined ? [] : [{ seq }]
    }
    if (text.startsWith('SELECT seq, event_json FROM dsh_session_events')) {
      const minimum = text.includes('seq >= $2') ? values[1] as number : 0
      return [...(this.events.get(values[0] as string)?.values() ?? [])]
        .filter(row => row.seq >= minimum).sort((left, right) => left.seq - right.seq)
        .map(row => ({ ...row }))
    }
    if (text.startsWith('INSERT INTO dsh_session_events')) {
      if (this.failNextEventInsert) {
        this.failNextEventInsert = false
        throw new Error('injected event write failure')
      }
      const id = values[0] as string
      const seq = values[1] as number
      const session = this.events.get(id) ?? new Map<number, Event>()
      if (session.has(seq)) throw new Error('duplicate event sequence')
      session.set(seq, { seq, event_json: typeof values[2] === 'string' ? JSON.parse(values[2]) : values[2] })
      this.events.set(id, session)
      return []
    }
    if (text.startsWith('UPDATE dsh_session_headers SET revision = revision + 1')) {
      const row = this.headers.get(values[0] as string)
      if (row === undefined) return []
      row.revision += 1
      return text.includes('RETURNING') ? [this.header(row)] : []
    }
    if (text.startsWith('DELETE FROM dsh_session_events')) {
      const session = this.events.get(values[0] as string)
      for (const seq of session?.keys() ?? []) if (seq >= values[1] as number) session?.delete(seq)
      return []
    }
    throw new Error(`unhandled PostgreSQL test query: ${text}`)
  }

  private header(row: Header): Record<string, unknown> {
    return {
      id: row.id, header_json: structuredClone(row.header_json), incarnation: row.incarnation,
      revision: row.revision, inherited_event_count: row.inherited_event_count,
    }
  }

  private snapshot(): { meta: Map<string, string>; headers: Map<string, Header>; events: Map<string, Map<number, Event>> } {
    return structuredClone({ meta: this.meta, headers: this.headers, events: this.events })
  }

  private restore(snapshot: { meta: Map<string, string>; headers: Map<string, Header>; events: Map<string, Map<number, Event>> }): void {
    this.meta.clear(); this.headers.clear(); this.events.clear()
    for (const [key, value] of snapshot.meta) this.meta.set(key, value)
    for (const [key, value] of snapshot.headers) this.headers.set(key, value)
    for (const [key, value] of snapshot.events) this.events.set(key, value)
  }
}

const header = { id: 'session-a', version: 1, createdAt: 1, isSeeded: false } as const
const storage = { meta: header, inheritedEventCount: SessionLogOffset(0) }
const turnStart = { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as const
const turnEnd = { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } } as const

describe('PostgresSessionStore', () => {
  it('exposes a SessionPersistence service provider', () => {
    expect(PostgresSessionPersistence.name).toBe('PostgresSessionPersistence')
  })

  it('creates the durable session schema before the first append', async () => {
    const database = new MemoryPostgresDatabase()
    const store = new PostgresSessionStore(database)
    await store.initialize()

    expect(database.queries.join('\n')).toContain('CREATE TABLE IF NOT EXISTS dsh_session_headers')
    expect(database.queries.join('\n')).toContain('CREATE TABLE IF NOT EXISTS dsh_session_events')
  })

  it('persists ordered events and advances one source-qualified revision per append', async () => {
    const database = new MemoryPostgresDatabase()
    const store = new PostgresSessionStore(database)
    await store.appendBatch(storage, [turnStart], false)
    const first = await store.loadStored(header.id)
    await store.appendBatch(storage, [turnEnd], true)
    const second = await store.loadStored(header.id)

    expect(second?.events).toEqual([turnStart, turnEnd])
    expect(second?.revision).not.toBe(first?.revision)
  })

  it('round-trips the exact fork-inherited event count', async () => {
    const database = new MemoryPostgresDatabase()
    const store = new PostgresSessionStore(database)
    const seeded = { ...header, id: 'session-seeded', isSeeded: true, parentSession: 'session-parent' }
    await store.appendBatch(
      { meta: seeded, inheritedEventCount: SessionLogOffset(1) },
      [turnStart, turnEnd],
      false,
    )

    await expect(store.loadStored(seeded.id)).resolves.toMatchObject({ inheritedEventCount: 1 })
    await expect(store.loadStoredFrom(seeded.id, SessionLogOffset(1))).resolves.toMatchObject({
      inheritedEventCount: 1,
      events: [turnEnd],
    })
  })

  it('accepts an existing header whose PostgreSQL JSONB keys are returned in another order', async () => {
    const database = new MemoryPostgresDatabase()
    const store = new PostgresSessionStore(database)
    const original = {
      id: 'session-ordered-header', version: 1, createdAt: 1, cwd: '/work',
      runtime: { model: { provider: 'deepseek', name: 'chat' }, tools: ['bash', 'read'] }, isSeeded: false,
    } as const
    const reordered = {
      runtime: { tools: ['bash', 'read'], model: { name: 'chat', provider: 'deepseek' } },
      cwd: '/work', createdAt: 1, id: 'session-ordered-header', version: 1, isSeeded: false,
    } as const
    await store.appendBatch({ meta: original, inheritedEventCount: SessionLogOffset(0) }, [turnStart], false)

    await expect(store.appendBatch({ meta: reordered, inheritedEventCount: SessionLogOffset(0) }, [turnEnd], true)).resolves.toBeUndefined()
  })

  it('reads a header, events, and revision from one database transaction snapshot', async () => {
    const database = new MemoryPostgresDatabase()
    const store = new PostgresSessionStore(database)
    await store.appendBatch(storage, [turnStart], false)
    database.transactionCalls = 0

    await store.loadStored(header.id)

    expect(database.transactionCalls).toBe(1)
  })

  it('rejects concurrent writers that claim the same next sequence', async () => {
    const database = new MemoryPostgresDatabase()
    const store = new PostgresSessionStore(database)
    await store.appendBatch(storage, [turnStart], false)

    const writes = await Promise.allSettled([
      store.appendBatch(storage, [turnEnd], true),
      store.appendBatch(storage, [turnEnd], true),
    ])

    expect(writes.filter(write => write.status === 'fulfilled')).toHaveLength(1)
    expect(writes.filter(write => write.status === 'rejected')).toHaveLength(1)
    expect((await store.loadStored(header.id))?.events).toEqual([turnStart, turnEnd])
  })

  it('rolls back the header and events when the first materializing batch fails', async () => {
    const database = new MemoryPostgresDatabase()
    database.failNextEventInsert = true
    const store = new PostgresSessionStore(database)

    await expect(store.appendBatch(storage, [turnStart], false)).rejects.toThrow('injected event write failure')
    expect(await store.loadStored(header.id)).toBeUndefined()
  })

  it('identifies and durably truncates only a corrupt final event row', async () => {
    const database = new MemoryPostgresDatabase()
    const store = new PostgresSessionStore(database)
    await store.appendBatch(storage, [turnStart, turnEnd], false)
    database.corruptTail(header.id)
    const torn = await store.loadStored(header.id)

    expect(torn?.tornMarker).toBe(1)
    await store.commitRepair(storage, torn?.tornMarker, [])
    expect((await store.loadStored(header.id))?.events).toEqual([turnStart])
  })

  it('rejects a requested suffix when an earlier sequence is missing', async () => {
    const database = new MemoryPostgresDatabase()
    const store = new PostgresSessionStore(database)
    await store.appendBatch(storage, [turnStart, turnEnd], false)
    database.removeEvent(header.id, 0)

    await expect(store.loadStoredFrom(header.id, SessionLogOffset(1))).rejects.toThrow('corrupt event in requested suffix')
  })

  it('rejects a corrupt event inside a requested suffix', async () => {
    const database = new MemoryPostgresDatabase()
    const store = new PostgresSessionStore(database)
    await store.appendBatch(storage, [turnStart, turnEnd], false)
    database.corruptTail(header.id)

    await expect(store.loadStoredFrom(header.id, SessionLogOffset(1))).rejects.toThrow('corrupt event in requested suffix')
  })

  it('takes the session schema advisory lock before checking or creating its store identity', async () => {
    const database = new MemoryPostgresDatabase()

    await new PostgresSessionStore(database).initialize()

    const lock = database.queries.indexOf('SELECT pg_advisory_xact_lock($1)')
    const schema = database.queries.findIndex(query => query.startsWith('CREATE TABLE'))
    const identity = database.queries.findIndex(query => query.startsWith('INSERT INTO dsh_session_persistence_meta') && query.includes("'store-id'"))
    expect(lock).toBeGreaterThanOrEqual(0)
    expect(schema).toBeGreaterThan(lock)
    expect(identity).toBeGreaterThan(schema)
    expect(database.queries[identity]).toContain('ON CONFLICT (key)')
  })
})
