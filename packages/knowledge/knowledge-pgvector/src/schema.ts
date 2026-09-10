/** PostgreSQL schema for versioned enterprise knowledge and pgvector chunks. */

import type { PostgresDatabase } from './types.ts'

/** Value exported as `KNOWLEDGE_SCHEMA_VERSION`. */
export const KNOWLEDGE_SCHEMA_VERSION = 1

const statements = [
  'CREATE EXTENSION IF NOT EXISTS vector',
  'CREATE TABLE IF NOT EXISTS dsh_knowledge_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  `CREATE TABLE IF NOT EXISTS dsh_knowledge_documents (
    document_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, title TEXT NOT NULL,
    source_ref TEXT, mime_type TEXT, created_by TEXT NOT NULL,
    visibility TEXT NOT NULL CHECK (visibility IN ('organization', 'private', 'restricted')),
    revision BIGINT NOT NULL, archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_knowledge_versions (
    document_id TEXT NOT NULL REFERENCES dsh_knowledge_documents(document_id),
    version BIGINT NOT NULL, org_id TEXT NOT NULL, content_hash TEXT NOT NULL,
    source_ref TEXT, metadata_json JSONB NOT NULL, created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL, PRIMARY KEY (document_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_knowledge_chunks (
    document_id TEXT NOT NULL, version BIGINT NOT NULL, chunk_id TEXT NOT NULL,
    ordinal BIGINT NOT NULL, text_content TEXT NOT NULL, embedding vector NOT NULL,
    metadata_json JSONB NOT NULL,
    PRIMARY KEY (document_id, version, chunk_id),
    FOREIGN KEY (document_id, version) REFERENCES dsh_knowledge_versions(document_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_knowledge_acl (
    document_id TEXT NOT NULL REFERENCES dsh_knowledge_documents(document_id),
    principal_type TEXT NOT NULL CHECK (principal_type IN ('user', 'group', 'role')),
    principal_id TEXT NOT NULL, can_read BOOLEAN NOT NULL,
    PRIMARY KEY (document_id, principal_type, principal_id)
  )`,
  `CREATE TABLE IF NOT EXISTS dsh_knowledge_idempotency (
    org_id TEXT NOT NULL, operation TEXT NOT NULL, key TEXT NOT NULL,
    result_json JSONB NOT NULL, PRIMARY KEY (org_id, operation, key)
  )`,
  'CREATE INDEX IF NOT EXISTS dsh_knowledge_documents_org_idx ON dsh_knowledge_documents (org_id, archived)',
] as const

/** Executes `migrateKnowledge`.
 * @param database - Input value used by this API.
 */
export async function migrateKnowledge(database: PostgresDatabase): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction.query('SELECT pg_advisory_xact_lock($1)', [0x4453484b])
    for (const statement of statements) await transaction.query(statement)
    const current = await transaction.query<{ value: string }>(
      "SELECT value FROM dsh_knowledge_meta WHERE key = 'schema-version'",
    )
    if (current.rows[0] === undefined) {
      await transaction.query(
        "INSERT INTO dsh_knowledge_meta(key, value) VALUES ('schema-version', $1) ON CONFLICT (key) DO NOTHING",
        [String(KNOWLEDGE_SCHEMA_VERSION)],
      )
    } else if (Number(current.rows[0].value) !== KNOWLEDGE_SCHEMA_VERSION) {
      throw new Error('unsupported knowledge schema version')
    }
  })
}
