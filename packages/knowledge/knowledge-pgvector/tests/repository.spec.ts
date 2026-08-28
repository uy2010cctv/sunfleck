import { describe, expect, it } from 'vitest'
import { EnterpriseKnowledgeRepository, type PostgresDatabase, type PostgresQueryResult } from '../src/index.ts'

type Row = Record<string, unknown>

/** Small transactional database double that executes the repository's SQL contract in memory. */
class MemoryDatabase implements PostgresDatabase {
  readonly queries: string[] = []
  private readonly meta = new Map<string, string>()
  private readonly documents = new Map<string, Row>()
  private readonly versions = new Map<string, Row>()
  private readonly chunks = new Map<string, Row>()
  private readonly acl = new Map<string, Row>()
  private readonly idempotency = new Map<string, unknown>()

  async transaction<T>(operation: (database: MemoryDatabase) => Promise<T>): Promise<T> {
    const snapshot = structuredClone({ meta: this.meta, documents: this.documents, versions: this.versions,
      chunks: this.chunks, acl: this.acl, idempotency: this.idempotency })
    try { return await operation(this) } catch (error) {
      this.restore(snapshot)
      throw error
    }
  }

  async query<T extends Row = Row>(text: string, values: readonly unknown[] = []): Promise<PostgresQueryResult<T>> {
    this.queries.push(text)
    const rows = this.execute(text, values)
    return { rows: rows as T[], rowCount: rows.length }
  }

  private execute(text: string, values: readonly unknown[]): Row[] {
    if (text.startsWith('CREATE ') || text.startsWith('SELECT pg_advisory_xact_lock')) return []
    if (text.startsWith('SELECT value FROM dsh_knowledge_meta')) {
      const value = this.meta.get('schema-version')
      return value === undefined ? [] : [{ value }]
    }
    if (text.startsWith('INSERT INTO dsh_knowledge_meta')) {
      this.meta.set('schema-version', String(values[0])); return []
    }
    if (text.startsWith('SELECT result_json FROM dsh_knowledge_idempotency')) {
      const value = this.idempotency.get(`${values[0]}:${values[1]}:${values[2]}`)
      return value === undefined ? [] : [{ result_json: structuredClone(value) }]
    }
    if (text.startsWith('INSERT INTO dsh_knowledge_idempotency')) {
      this.idempotency.set(`${values[0]}:${values[1]}:${values[2]}`, parse(values[3])); return []
    }
    if (text.startsWith('SELECT * FROM dsh_knowledge_documents')) {
      const row = this.documents.get(String(values[0]))
      return row === undefined ? [] : [structuredClone(row)]
    }
    if (text.startsWith('INSERT INTO dsh_knowledge_documents')) {
      const row = { document_id: String(values[0]), org_id: String(values[1]), title: String(values[2]),
        source_ref: values[3] ?? null, mime_type: values[4] ?? null, created_by: String(values[5]),
        visibility: String(values[6]), revision: 1, archived: false, created_at: Number(values[7]), updated_at: Number(values[7]) }
      this.documents.set(row.document_id, row); return [structuredClone(row)]
    }
    if (text.startsWith('UPDATE dsh_knowledge_documents')) {
      const row = this.documents.get(String(values.at(-1)))
      if (row === undefined) return []
      if (text.includes('revision = revision + 1')) {
        row.updated_at = Number(values[0]); row.revision = Number(row.revision) + 1
      } else {
        row.title = String(values[0]); row.source_ref = values[1] ?? null; row.mime_type = values[2] ?? null
        row.visibility = String(values[3]); row.updated_at = Number(values[4]); row.revision = Number(row.revision) + 1
      }
      return [structuredClone(row)]
    }
    if (text.startsWith('SELECT MAX(version)')) {
      const documentId = String(values[0])
      const versions = [...this.versions.values()].filter(row => row.document_id === documentId)
      return [{ version: versions.length === 0 ? 0 : Math.max(...versions.map(row => Number(row.version))) }]
    }
    if (text.startsWith('SELECT version FROM dsh_knowledge_versions')) {
      const row = this.versions.get(`${values[0]}:${values[1]}`)
      return row === undefined ? [] : [{ version: row.version }]
    }
    if (text.startsWith('SELECT * FROM dsh_knowledge_versions')) {
      const row = this.versions.get(`${values[0]}:${values[1]}`)
      return row === undefined ? [] : [structuredClone(row)]
    }
    if (text.startsWith('INSERT INTO dsh_knowledge_versions')) {
      const version = Number(values[1]); const row = { document_id: String(values[0]), version,
        org_id: String(values[2]), content_hash: String(values[3]), source_ref: values[4] ?? null,
        metadata_json: parse(values[5]), created_by: String(values[6]), created_at: Number(values[7]) }
      this.versions.set(`${row.document_id}:${row.version}`, row); return [structuredClone(row)]
    }
    if (text.startsWith('SELECT * FROM dsh_knowledge_chunks')) {
      const documentId = String(values[0]); const version = Number(values[1])
      return [...this.chunks.values()].filter(row => row.document_id === documentId && Number(row.version) === version)
        .sort((a, b) => Number(a.ordinal) - Number(b.ordinal)).map(row => structuredClone(row))
    }
    if (text.startsWith('INSERT INTO dsh_knowledge_chunks')) {
      const row = { document_id: String(values[0]), version: Number(values[1]), chunk_id: String(values[2]),
        ordinal: Number(values[3]), text_content: String(values[4]), embedding: String(values[5]), metadata_json: parse(values[6]) }
      this.chunks.set(`${row.document_id}:${row.version}:${row.chunk_id}`, row); return [structuredClone(row)]
    }
    if (text.startsWith('SELECT * FROM dsh_knowledge_acl')) {
      return [...this.acl.values()].filter(row => row.document_id === String(values[0])).map(row => structuredClone(row))
    }
    if (text.startsWith('DELETE FROM dsh_knowledge_acl')) {
      for (const key of [...this.acl.keys()]) if (key.startsWith(`${values[0]}:`)) this.acl.delete(key)
      return []
    }
    if (text.startsWith('INSERT INTO dsh_knowledge_acl')) {
      const row = {
        document_id: String(values[0]), principal_type: String(values[1]), principal_id: String(values[2]),
        can_read: Boolean(values[3]),
      }
      this.acl.set(`${row.document_id}:${row.principal_type}:${row.principal_id}`, row); return []
    }
    if (text.startsWith('SELECT c.document_id')) {
      return [...this.chunks.values()].filter(row => Number(row.version) === 1).map(row => ({
        document_id: row.document_id, org_id: 'org-a', document_title: 'Visible', version: row.version,
        content_hash: 'hash-v1', chunk_id: row.chunk_id, ordinal: row.ordinal, text_content: row.text_content,
        score: 0.9, permission_evidence: 'acl:user:reader',
      }))
    }
    throw new Error(`unhandled knowledge SQL: ${text}`)
  }

  private restore(snapshot: {
    meta: Map<string, string>
    documents: Map<string, Row>
    versions: Map<string, Row>
    chunks: Map<string, Row>
    acl: Map<string, Row>
    idempotency: Map<string, unknown>
  }): void {
    this.meta.clear(); this.documents.clear(); this.versions.clear(); this.chunks.clear(); this.acl.clear(); this.idempotency.clear()
    for (const [key, value] of snapshot.meta) this.meta.set(key, value)
    for (const [key, value] of snapshot.documents) this.documents.set(key, value)
    for (const [key, value] of snapshot.versions) this.versions.set(key, value)
    for (const [key, value] of snapshot.chunks) this.chunks.set(key, value)
    for (const [key, value] of snapshot.acl) this.acl.set(key, value)
    for (const [key, value] of snapshot.idempotency) this.idempotency.set(key, value)
  }
}

function parse(value: unknown): unknown { return typeof value === 'string' ? JSON.parse(value) : value }

describe('EnterpriseKnowledgeRepository', () => {
  it('stores immutable versions and vector chunks with ACL evidence on retrieval', async () => {
    const db = new MemoryDatabase()
    const repository = new EnterpriseKnowledgeRepository(db, { now: () => 100 })
    await repository.saveDocument({ documentId: 'doc-1', orgId: 'org-a', title: 'Visible', createdBy: 'owner',
      visibility: 'restricted', expectedRevision: 0, idempotencyKey: 'doc-1' })
    const version = await repository.createVersion({ documentId: 'doc-1', orgId: 'org-a', contentHash: 'hash-v1',
      metadata: { source: 'handbook' }, createdBy: 'owner', idempotencyKey: 'version-1' })
    await repository.writeChunks({ documentId: 'doc-1', orgId: 'org-a', version: version.version, idempotencyKey: 'chunks-1', chunks: [
      { chunkId: 'chunk-1', documentId: 'doc-1', orgId: 'org-a', version: 1, ordinal: 0, text: 'Approved policy', embedding: [0.1, 0.2] },
    ] })
    await repository.setAcl({ documentId: 'doc-1', orgId: 'org-a', expectedRevision: 1, idempotencyKey: 'acl-1',
      entries: [{ principalType: 'user', principalId: 'reader', read: true }] })
    const result = await repository.search({ orgId: 'org-a', userId: 'reader', embedding: [0.1, 0.2] })
    expect(result[0]).toMatchObject({ documentId: 'doc-1', version: 1, chunkId: 'chunk-1', contentHash: 'hash-v1',
      documentVersion: { documentId: 'doc-1', version: 1, contentHash: 'hash-v1' },
      permissionEvidence: { kind: 'acl', principalType: 'user', principalId: 'reader' } })
    expect(result[0]?.text).toBe('Approved policy')
  })

  it('fails closed for invalid vectors and organization mismatches', async () => {
    const repository = new EnterpriseKnowledgeRepository(new MemoryDatabase())
    await expect(repository.search({ orgId: 'org-a', userId: 'u', embedding: [] })).rejects.toThrow(/embedding/i)
    await expect(repository.saveDocument({ documentId: 'doc', orgId: 'org-a', title: 'x', createdBy: 'u', visibility: 'organization', expectedRevision: 0, idempotencyKey: '1' })).resolves.toBeDefined()
    await expect(repository.createVersion({ documentId: 'doc', orgId: 'org-b', contentHash: 'x', metadata: {}, createdBy: 'u', idempotencyKey: '2' })).rejects.toThrow(/organization/i)
  })

  it('rejects secret-bearing version metadata and supports idempotent writes', async () => {
    const repository = new EnterpriseKnowledgeRepository(new MemoryDatabase())
    await repository.saveDocument({ documentId: 'doc', orgId: 'org-a', title: 'x', createdBy: 'u', visibility: 'organization', expectedRevision: 0, idempotencyKey: 'doc' })
    await expect(repository.createVersion({ documentId: 'doc', orgId: 'org-a', contentHash: 'x', metadata: { apiKey: 'secret' }, createdBy: 'u', idempotencyKey: 'v' })).rejects.toThrow(/secret/i)
    const first = await repository.createVersion({ documentId: 'doc', orgId: 'org-a', contentHash: 'x', metadata: {}, createdBy: 'u', idempotencyKey: 'v2' })
    await expect(repository.createVersion({ documentId: 'doc', orgId: 'org-a', contentHash: 'ignored', metadata: {}, createdBy: 'u', idempotencyKey: 'v2' })).resolves.toEqual(first)
  })
})
