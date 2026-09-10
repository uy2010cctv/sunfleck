/** Transactional PostgreSQL/pgvector repository with fail-closed organization ACL filtering. */

import { createHash } from 'node:crypto'
import type {
  KnowledgeAclEntry, KnowledgeAclView, KnowledgeChunkInput, KnowledgeChunkView,
  KnowledgeChunkWriteInput, KnowledgeDocumentInput, KnowledgeDocumentView, KnowledgePermissionEvidence,
  KnowledgeRepository, KnowledgeSearchInput, KnowledgeSearchResult, KnowledgeVersionInput, KnowledgeVersionView,
  PostgresDatabase,
} from './types.ts'
import { migrateKnowledge } from './schema.ts'

interface Row extends Record<string, unknown> {
  document_id: string
  org_id: string
  title?: string
  source_ref?: string | null
  mime_type?: string | null
  created_by?: string
  visibility?: KnowledgeDocumentInput['visibility']
  revision?: number | string
  archived?: boolean
  created_at?: number | string
  updated_at?: number | string
  version?: number | string
  content_hash?: string
  metadata_json?: unknown
  chunk_id?: string
  ordinal?: number | string
  text_content?: string
  embedding?: unknown
  document_title?: string
  principal_type?: string
  principal_id?: string
  can_read?: boolean
  permission_evidence?: string
  score?: number | string
}

function parse(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value }

function metadata(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = parse(value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('knowledge metadata must be an object')
  return parsed as Readonly<Record<string, unknown>>
}

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

function assertSafeMetadata(value: unknown, path = 'metadata'): void {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>{  assertSafeMetadata(child, `${path}[${String(index)}]`) })
    return
  }
  if (typeof value !== 'object' || value === null) return
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replaceAll(/[^a-z0-9]/giu, '').toLowerCase()
    if (/(?:token|apikey|secret|password|privatekey|authorization|bearer|cookie|clientsecret)/u.test(normalized)) {
      throw new Error(`knowledge metadata contains secret-bearing field ${key} at ${path}.${key}`)
    }
    assertSafeMetadata(child, `${path}.${key}`)
  }
}

function vector(value: readonly number[]): string {
  if (value.length === 0 || value.length > 65_535) throw new RangeError('knowledge embedding must contain 1-65535 dimensions')
  if (value.some(item => !Number.isFinite(item))) throw new RangeError('knowledge embedding must contain only finite numbers')
  return `[${value.join(',')}]`
}

function number(value: number | string | undefined, message: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new Error(message)
  return result
}

/** Provides `KnowledgeRevisionConflictError` capabilities. */
export class KnowledgeRevisionConflictError extends Error {
  constructor(readonly documentId: string, readonly expected: number, readonly actual: number) {
    super(`knowledge document ${documentId} revision conflict: expected ${String(expected)}, actual ${String(actual)}`)
  }
}

function documentView(row: Row): KnowledgeDocumentView {
  const sourceRef = row.source_ref
  const mimeType = row.mime_type
  return {
    documentId: row.document_id, orgId: row.org_id, title: required(row.title, 'knowledge document title missing'),
    createdBy: required(row.created_by, 'knowledge document creator missing'),
    visibility: required(row.visibility, 'knowledge document visibility missing'),
    ...sourceRef === null || sourceRef === undefined ? {} : { sourceRef },
    ...mimeType === null || mimeType === undefined ? {} : { mimeType },
    expectedRevision: number(row.revision, 'knowledge document revision missing'),
    idempotencyKey: '', revision: number(row.revision, 'knowledge document revision missing'),
    archived: row.archived === true, createdAt: number(row.created_at, 'knowledge document creation time missing'),
    updatedAt: number(row.updated_at, 'knowledge document update time missing'),
  }
}

function versionView(row: Row): KnowledgeVersionView {
  const sourceRef = row.source_ref
  return {
    documentId: row.document_id, orgId: row.org_id, version: number(row.version, 'knowledge version missing'),
    contentHash: required(row.content_hash, 'knowledge content hash missing'),
    ...sourceRef === null || sourceRef === undefined ? {} : { sourceRef },
    metadata: metadata(row.metadata_json), createdBy: required(row.created_by, 'knowledge version creator missing'),
    createdAt: number(row.created_at, 'knowledge version creation time missing'),
  }
}

function aclView(row: Row): KnowledgeAclView {
  return {
    documentId: row.document_id,
    principalType: row.principal_type as KnowledgeAclEntry['principalType'],
    principalId: required(row.principal_id, 'knowledge ACL principal missing'),
    read: row.can_read === true,
  }
}

function permissionEvidence(value: string | undefined, userId: string): KnowledgePermissionEvidence {
  if (value === 'organization') return { kind: 'organization' }
  if (value === 'owner') return { kind: 'owner', userId }
  const match = /^acl:(user|group|role):(.+)$/u.exec(value ?? '')
  if (match?.[1] === undefined || match[2] === undefined) throw new Error('knowledge search returned invalid permission evidence')
  return { kind: 'acl', principalType: match[1] as KnowledgeAclEntry['principalType'], principalId: match[2] }
}

/** Provides `EnterpriseKnowledgeRepository` capabilities. */
export class EnterpriseKnowledgeRepository implements KnowledgeRepository {
  private initialized: Promise<void> | undefined

  constructor(private readonly database: PostgresDatabase, private readonly options: { now?: () => number } = {}) {}

  private now(): number { return this.options.now?.() ?? Date.now() }
  private initialize(): Promise<void> { this.initialized ??= migrateKnowledge(this.database); return this.initialized }

  private async lock(database: PostgresDatabase, resource: string): Promise<void> {
    await database.query('SELECT pg_advisory_xact_lock(hashtext($1))', [resource])
  }

  private async idempotent<T>(database: PostgresDatabase, orgId: string, operation: string, key: string): Promise<T | undefined> {
    const result = await database.query<{ result_json: unknown }>(
      'SELECT result_json FROM dsh_knowledge_idempotency WHERE org_id = $1 AND operation = $2 AND key = $3',
      [orgId, operation, key],
    )
    const row = result.rows[0]
    return row === undefined ? undefined : parse(row.result_json) as T
  }

  private async remember(database: PostgresDatabase, orgId: string, operation: string, key: string, value: unknown): Promise<void> {
    await database.query(
      'INSERT INTO dsh_knowledge_idempotency(org_id, operation, key, result_json) VALUES ($1, $2, $3, $4::jsonb)',
      [orgId, operation, key, JSON.stringify(value)],
    )
  }

  async saveDocument(input: KnowledgeDocumentInput): Promise<KnowledgeDocumentView> {
    if (!input.documentId || !input.orgId || !input.createdBy || !input.title.trim()) throw new Error('knowledge document identity and title are required')
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `${input.orgId}:document:${input.documentId}`)
      const prior = await this.idempotent<KnowledgeDocumentView>(database, input.orgId, 'document', input.idempotencyKey)
      if (prior !== undefined) return prior
      const currentResult = await database.query<Row>('SELECT * FROM dsh_knowledge_documents WHERE document_id = $1 FOR UPDATE', [input.documentId])
      const current = currentResult.rows[0]
      if (current !== undefined && current.org_id !== input.orgId) throw new Error(`knowledge document ${input.documentId} is outside organization ${input.orgId}`)
      const actual = current === undefined ? 0 : number(current.revision, 'knowledge document revision missing')
      if (actual !== input.expectedRevision) throw new KnowledgeRevisionConflictError(input.documentId, input.expectedRevision, actual)
      const now = this.now()
      const result = current === undefined
        ? await database.query<Row>(
          `INSERT INTO dsh_knowledge_documents(document_id, org_id, title, source_ref, mime_type, created_by, visibility, revision, archived, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, FALSE, $8, $8) RETURNING *`,
          [input.documentId, input.orgId, input.title.trim(), input.sourceRef ?? null,
            input.mimeType ?? null, input.createdBy, input.visibility, now],
        )
        : await database.query<Row>(
          `UPDATE dsh_knowledge_documents SET title = $1, source_ref = $2, mime_type = $3, visibility = $4,
           archived = FALSE, revision = revision + 1, updated_at = $5 WHERE document_id = $6 RETURNING *`,
          [input.title.trim(), input.sourceRef ?? null, input.mimeType ?? null, input.visibility, now, input.documentId],
        )
      const row = required(result.rows[0], 'knowledge document write returned no row')
      const view = documentView(row)
      await this.remember(database, input.orgId, 'document', input.idempotencyKey, view)
      return view
    })
  }

  async createVersion(input: KnowledgeVersionInput): Promise<KnowledgeVersionView> {
    if (!input.contentHash) throw new Error('knowledge content hash is required')
    assertSafeMetadata(input.metadata)
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `${input.orgId}:document:${input.documentId}:versions`)
      const prior = await this.idempotent<KnowledgeVersionView>(database, input.orgId, 'version', input.idempotencyKey)
      if (prior !== undefined) return prior
      const document = (await database.query<Row>('SELECT * FROM dsh_knowledge_documents WHERE document_id = $1 FOR UPDATE', [input.documentId])).rows[0]
      if (document === undefined) throw new Error(`knowledge document ${input.documentId} does not exist`)
      if (document.org_id !== input.orgId) throw new Error(`knowledge document ${input.documentId} is outside organization ${input.orgId}`)
      const max = await database.query<{ version: number | string }>(
        'SELECT MAX(version) AS version FROM dsh_knowledge_versions WHERE document_id = $1', [input.documentId],
      )
      const version = number(max.rows[0]?.version ?? 0, 'knowledge version number is invalid') + 1
      const result = await database.query<Row>(
        `INSERT INTO dsh_knowledge_versions(document_id, version, org_id, content_hash, source_ref, metadata_json, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8) RETURNING *`,
        [input.documentId, version, input.orgId, input.contentHash, input.sourceRef ?? null,
          JSON.stringify(input.metadata), input.createdBy, this.now()],
      )
      const view = versionView(required(result.rows[0], 'knowledge version write returned no row'))
      await this.remember(database, input.orgId, 'version', input.idempotencyKey, view)
      return view
    })
  }

  async writeChunks(input: KnowledgeChunkWriteInput): Promise<readonly KnowledgeChunkView[]> {
    if (input.chunks.some(chunk => chunk.documentId !== input.documentId
      || chunk.orgId !== input.orgId || chunk.version !== input.version)) {
      throw new Error('knowledge chunks must belong to the requested document, organization, and version')
    }
    const embeddings = input.chunks.map(chunk => vector(chunk.embedding))
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `${input.orgId}:document:${input.documentId}:version:${String(input.version)}:chunks`)
      const prior = await this.idempotent<readonly KnowledgeChunkView[]>(database, input.orgId, 'chunks', input.idempotencyKey)
      if (prior !== undefined) return prior
      const version = (await database.query<Row>(
        'SELECT * FROM dsh_knowledge_versions WHERE document_id = $1 AND version = $2 AND org_id = $3',
        [input.documentId, input.version, input.orgId],
      )).rows[0]
      if (version === undefined) throw new Error(`knowledge version ${input.documentId}@${String(input.version)} does not exist in organization ${input.orgId}`)
      const existing = await database.query<Row>(
        'SELECT * FROM dsh_knowledge_chunks WHERE document_id = $1 AND version = $2 ORDER BY ordinal',
        [input.documentId, input.version],
      )
      const byId = new Map(existing.rows.map(row => [row.chunk_id, row]))
      for (let index = 0; index < input.chunks.length; index += 1) {
        const chunk = input.chunks[index] as KnowledgeChunkInput
        const embedding = embeddings[index] as string
        if (!chunk.chunkId || !Number.isSafeInteger(chunk.ordinal) || chunk.ordinal < 0) throw new Error('knowledge chunk id and non-negative ordinal are required')
        if (!chunk.text) throw new Error('knowledge chunk text is required')
        if (chunk.metadata !== undefined) assertSafeMetadata(chunk.metadata)
        const priorChunk = byId.get(chunk.chunkId)
        if (priorChunk !== undefined) {
          if (priorChunk.text_content !== chunk.text || Number(priorChunk.ordinal) !== chunk.ordinal
            || String(priorChunk.embedding) !== embedding) {
            throw new Error(`knowledge chunk ${chunk.chunkId} is immutable and conflicts with the existing value`)
          }
          continue
        }
        await database.query(
          `INSERT INTO dsh_knowledge_chunks(document_id, version, chunk_id, ordinal, text_content, embedding, metadata_json)
           VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb)`,
          [chunk.documentId, chunk.version, chunk.chunkId, chunk.ordinal, chunk.text, embedding, JSON.stringify(chunk.metadata ?? {})],
        )
      }
      const rows = await database.query<Row>(
        'SELECT * FROM dsh_knowledge_chunks WHERE document_id = $1 AND version = $2 ORDER BY ordinal',
        [input.documentId, input.version],
      )
      const views = rows.rows.map(row => ({
        chunkId: required(row.chunk_id, 'knowledge chunk id missing'), documentId: row.document_id,
        version: number(row.version, 'knowledge chunk version missing'), ordinal: number(row.ordinal, 'knowledge chunk ordinal missing'),
        text: required(row.text_content, 'knowledge chunk text missing'), embeddingDimensions: vectorDimensions(row.embedding),
        metadata: metadata(row.metadata_json),
      }))
      await this.remember(database, input.orgId, 'chunks', input.idempotencyKey, views)
      return views
    })
  }

  async setAcl(input: {
    documentId: string
    orgId: string
    expectedRevision: number
    entries: readonly KnowledgeAclEntry[]
    idempotencyKey: string
  }): Promise<{ document: KnowledgeDocumentView; entries: readonly KnowledgeAclView[] }> {
    const seen = new Set<string>()
    for (const entry of input.entries) {
      if (!entry.principalId || !['user', 'group', 'role'].includes(entry.principalType)) throw new Error('knowledge ACL principal is invalid')
      const key = `${entry.principalType}:${entry.principalId}`
      if (seen.has(key)) throw new Error(`knowledge ACL contains duplicate principal ${key}`)
      seen.add(key)
    }
    await this.initialize()
    return this.database.transaction(async (database) => {
      await this.lock(database, `${input.orgId}:document:${input.documentId}:acl`)
      const prior = await this.idempotent<{ document: KnowledgeDocumentView; entries: readonly KnowledgeAclView[] }>(database, input.orgId, 'acl', input.idempotencyKey)
      if (prior !== undefined) return prior
      const result = await database.query<Row>('SELECT * FROM dsh_knowledge_documents WHERE document_id = $1 FOR UPDATE', [input.documentId])
      const current = result.rows[0]
      if (current === undefined) throw new Error(`knowledge document ${input.documentId} does not exist`)
      if (current.org_id !== input.orgId) throw new Error(`knowledge document ${input.documentId} is outside organization ${input.orgId}`)
      const actual = number(current.revision, 'knowledge document revision missing')
      if (actual !== input.expectedRevision) throw new KnowledgeRevisionConflictError(input.documentId, input.expectedRevision, actual)
      const updated = await database.query<Row>(
        'UPDATE dsh_knowledge_documents SET revision = revision + 1, updated_at = $1 WHERE document_id = $2 RETURNING *',
        [this.now(), input.documentId],
      )
      await database.query('DELETE FROM dsh_knowledge_acl WHERE document_id = $1', [input.documentId])
      for (const entry of input.entries) {
        await database.query(
          'INSERT INTO dsh_knowledge_acl(document_id, principal_type, principal_id, can_read) VALUES ($1, $2, $3, $4)',
          [input.documentId, entry.principalType, entry.principalId, entry.read],
        )
      }
      const entries = (await database.query<Row>('SELECT * FROM dsh_knowledge_acl WHERE document_id = $1 ORDER BY principal_type, principal_id', [input.documentId])).rows.map(aclView)
      const value = { document: documentView(required(updated.rows[0], 'knowledge ACL update returned no document')), entries }
      await this.remember(database, input.orgId, 'acl', input.idempotencyKey, value)
      return value
    })
  }

  async listAcl(documentId: string, orgId: string): Promise<readonly KnowledgeAclView[]> {
    await this.initialize()
    const document = (await this.database.query<Row>('SELECT * FROM dsh_knowledge_documents WHERE document_id = $1', [documentId])).rows[0]
    if (document === undefined) return []
    if (document.org_id !== orgId) throw new Error(`knowledge document ${documentId} is outside organization ${orgId}`)
    return (await this.database.query<Row>('SELECT * FROM dsh_knowledge_acl WHERE document_id = $1 ORDER BY principal_type, principal_id', [documentId])).rows.map(aclView)
  }

  async search(input: KnowledgeSearchInput): Promise<readonly KnowledgeSearchResult[]> {
    const embedding = vector(input.embedding)
    const limit = input.limit ?? 20
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError('knowledge search limit must be an integer between 1 and 100')
    if (!input.orgId || !input.userId) throw new Error('knowledge search organization and user are required')
    await this.initialize()
    const result = await this.database.query<Row>(
      `SELECT c.document_id, d.org_id, d.title AS document_title, c.version, v.content_hash,
       c.chunk_id, c.ordinal, c.text_content, 1 - (c.embedding <=> $5::vector) AS score,
       CASE WHEN d.visibility = 'organization' THEN 'organization'
            WHEN d.created_by = $2 THEN 'owner'
            WHEN EXISTS (SELECT 1 FROM dsh_knowledge_acl a WHERE a.document_id = d.document_id AND a.principal_type = 'user' AND a.principal_id = $2 AND a.can_read) THEN 'acl:user:' || $2
            WHEN EXISTS (SELECT 1 FROM dsh_knowledge_acl a WHERE a.document_id = d.document_id AND a.principal_type = 'group' AND a.principal_id = ANY($3::text[]) AND a.can_read) THEN 'acl:group:' || (SELECT a.principal_id FROM dsh_knowledge_acl a WHERE a.document_id = d.document_id AND a.principal_type = 'group' AND a.principal_id = ANY($3::text[]) AND a.can_read LIMIT 1)
            ELSE 'acl:role:' || (SELECT a.principal_id FROM dsh_knowledge_acl a WHERE a.document_id = d.document_id AND a.principal_type = 'role' AND a.principal_id = ANY($4::text[]) AND a.can_read LIMIT 1)
       END AS permission_evidence
       FROM dsh_knowledge_chunks c
       JOIN dsh_knowledge_documents d ON d.document_id = c.document_id
       JOIN dsh_knowledge_versions v ON v.document_id = c.document_id AND v.version = c.version
       WHERE d.org_id = $1 AND d.archived = FALSE
         AND c.version = COALESCE($6::bigint, (SELECT MAX(current_version.version) FROM dsh_knowledge_versions current_version WHERE current_version.document_id = c.document_id))
         AND (d.visibility = 'organization' OR d.created_by = $2
           OR EXISTS (SELECT 1 FROM dsh_knowledge_acl a WHERE a.document_id = d.document_id AND a.principal_type = 'user' AND a.principal_id = $2 AND a.can_read)
           OR EXISTS (SELECT 1 FROM dsh_knowledge_acl a WHERE a.document_id = d.document_id AND a.principal_type = 'group' AND a.principal_id = ANY($3::text[]) AND a.can_read)
           OR EXISTS (SELECT 1 FROM dsh_knowledge_acl a WHERE a.document_id = d.document_id AND a.principal_type = 'role' AND a.principal_id = ANY($4::text[]) AND a.can_read))
       ORDER BY c.embedding <=> $5::vector LIMIT $7`,
      [input.orgId, input.userId, [...input.groupIds ?? []], [...input.roleIds ?? []], embedding, input.version ?? null, limit],
    )
    return result.rows.map(row => ({
      documentId: row.document_id, orgId: row.org_id, documentTitle: required(row.document_title, 'knowledge result title missing'),
      version: number(row.version, 'knowledge result version missing'), contentHash: required(row.content_hash, 'knowledge result content hash missing'),
      chunkId: required(row.chunk_id, 'knowledge result chunk id missing'), ordinal: number(row.ordinal, 'knowledge result ordinal missing'),
      text: required(row.text_content, 'knowledge result text missing'), score: Number(row.score),
      documentVersion: { documentId: row.document_id, version: number(row.version, 'knowledge result version missing'), contentHash: required(row.content_hash, 'knowledge result content hash missing') },
      permissionEvidence: permissionEvidence(row.permission_evidence, input.userId),
    }))
  }
}

function vectorDimensions(value: unknown): number {
  if (Array.isArray(value)) return value.length
  if (typeof value === 'string') {
    const trimmed = value.trim().replace(/^\[/u, '').replace(/\]$/u, '')
    return trimmed === '' ? 0 : trimmed.split(',').length
  }
  return 0
}

/** Stable digest helper for callers that persist embedding manifests.
 * @param embedding - Input value used by this API.
 * @returns Result produced by this API.
 */
export function knowledgeEmbeddingDigest(embedding: readonly number[]): string {
  return createHash('sha256').update(vector(embedding)).digest('hex')
}
