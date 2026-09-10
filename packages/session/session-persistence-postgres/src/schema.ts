/** PostgreSQL schema and schema ownership for native DSH session persistence. */

import type { PostgresQueryable } from './types.ts'

/**
 * Version 2 added the inherited-event offset used by forked durable sessions.
 *
 * Keep the column even though v0.1.5 now stores the offset inside the header
 * JSONB payload: deployed enterprise databases already own this schema, and a
 * downgrade would make an otherwise compatible release refuse to start.
 */
export const SESSION_PERSISTENCE_POSTGRES_SCHEMA_VERSION = 2

const statements = [
  `CREATE TABLE IF NOT EXISTS dsh_session_persistence_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_session_headers (
    id TEXT PRIMARY KEY,
    header_json JSONB NOT NULL,
    incarnation UUID NOT NULL,
    revision BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL,
    inherited_event_count BIGINT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_session_events (
    session_id TEXT NOT NULL REFERENCES dsh_session_headers(id) ON DELETE CASCADE,
    seq BIGINT NOT NULL,
    event_json JSONB NOT NULL,
    event_type TEXT NOT NULL,
    event_time BIGINT NOT NULL,
    PRIMARY KEY(session_id, seq)
  )`,
  'CREATE INDEX IF NOT EXISTS dsh_session_headers_created_at ON dsh_session_headers(created_at DESC, id)',
  'CREATE INDEX IF NOT EXISTS dsh_session_events_session_time ON dsh_session_events(session_id, event_time, seq)',
] as const

/** Create or validate the schema in the caller-owned transaction. */
export async function migratePostgresSessionPersistence(database: PostgresQueryable): Promise<void> {
  for (const statement of statements) await database.query(statement)
  const current = await database.query<{ value: string }>(
    "SELECT value FROM dsh_session_persistence_meta WHERE key = 'schema-version'",
  )
  const version = current.rows[0]?.value
  if (version === undefined) {
    await database.query(
      "INSERT INTO dsh_session_persistence_meta(key, value) VALUES ('schema-version', $1)",
      [String(SESSION_PERSISTENCE_POSTGRES_SCHEMA_VERSION)],
    )
    return
  }
  if (Number(version) === 1) {
    await database.query(
      'ALTER TABLE dsh_session_headers ADD COLUMN IF NOT EXISTS inherited_event_count BIGINT NOT NULL DEFAULT 0',
    )
    await database.query(
      "UPDATE dsh_session_persistence_meta SET value = $1 WHERE key = 'schema-version'",
      [String(SESSION_PERSISTENCE_POSTGRES_SCHEMA_VERSION)],
    )
    return
  }
  if (Number(version) !== SESSION_PERSISTENCE_POSTGRES_SCHEMA_VERSION) {
    throw new Error(
      `session persistence PostgreSQL schema version ${version} is not supported; expected ${String(SESSION_PERSISTENCE_POSTGRES_SCHEMA_VERSION)}`,
    )
  }
}
