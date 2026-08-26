/** Driver-neutral contracts for the enterprise knowledge catalog and pgvector retrieval. */

export type KnowledgeVisibility = 'organization' | 'private' | 'restricted'
export type KnowledgePrincipalType = 'user' | 'group' | 'role'

export interface KnowledgeAclEntry {
  readonly principalType: KnowledgePrincipalType
  readonly principalId: string
  readonly read: boolean
}

export interface KnowledgeDocumentInput {
  readonly documentId: string
  readonly orgId: string
  readonly title: string
  readonly createdBy: string
  readonly visibility: KnowledgeVisibility
  readonly sourceRef?: string
  readonly mimeType?: string
  readonly idempotencyKey: string
  readonly expectedRevision: number
}

export interface KnowledgeDocumentView extends KnowledgeDocumentInput {
  readonly revision: number
  readonly archived: boolean
  readonly createdAt: number
  readonly updatedAt: number
}

export interface KnowledgeVersionInput {
  readonly documentId: string
  readonly orgId: string
  readonly contentHash: string
  readonly sourceRef?: string
  readonly metadata: Readonly<Record<string, unknown>>
  readonly createdBy: string
  readonly idempotencyKey: string
}

export interface KnowledgeVersionView {
  readonly documentId: string
  readonly orgId: string
  readonly version: number
  readonly contentHash: string
  readonly sourceRef?: string
  readonly metadata: Readonly<Record<string, unknown>>
  readonly createdBy: string
  readonly createdAt: number
}

export interface KnowledgeChunkInput {
  readonly chunkId: string
  readonly documentId: string
  readonly orgId: string
  readonly version: number
  readonly ordinal: number
  readonly text: string
  readonly embedding: readonly number[]
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface KnowledgeChunkWriteInput {
  readonly documentId: string
  readonly orgId: string
  readonly version: number
  readonly chunks: readonly KnowledgeChunkInput[]
  readonly idempotencyKey: string
}

export interface KnowledgeChunkView {
  readonly chunkId: string
  readonly documentId: string
  readonly version: number
  readonly ordinal: number
  readonly text: string
  readonly embeddingDimensions: number
  readonly metadata: Readonly<Record<string, unknown>>
}

export interface SetKnowledgeAclInput {
  readonly documentId: string
  readonly orgId: string
  readonly expectedRevision: number
  readonly entries: readonly KnowledgeAclEntry[]
  readonly idempotencyKey: string
}

export interface KnowledgeAclView extends KnowledgeAclEntry {
  readonly documentId: string
}

export interface KnowledgeSearchInput {
  readonly orgId: string
  readonly userId: string
  readonly groupIds?: readonly string[]
  readonly roleIds?: readonly string[]
  readonly embedding: readonly number[]
  /** Optional release-pinned version; omitted searches only the current version. */
  readonly version?: number
  readonly limit?: number
}

export type KnowledgePermissionEvidence =
  | { readonly kind: 'organization' }
  | { readonly kind: 'owner'; readonly userId: string }
  | { readonly kind: 'acl'; readonly principalType: KnowledgePrincipalType; readonly principalId: string }

export interface KnowledgeSearchResult {
  readonly documentId: string
  readonly orgId: string
  readonly documentTitle: string
  readonly version: number
  readonly contentHash: string
  readonly chunkId: string
  readonly ordinal: number
  readonly text: string
  readonly score: number
  readonly documentVersion: { readonly documentId: string; readonly version: number; readonly contentHash: string }
  readonly permissionEvidence: KnowledgePermissionEvidence
}

export interface PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  readonly rows: readonly Row[]
  readonly rowCount: number | null
}

/** Minimal transaction-aware surface; production uses pg while tests can use a memory double. */
export interface PostgresDatabase {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<PostgresQueryResult<Row>>
  transaction<T>(operation: (database: PostgresDatabase) => Promise<T>): Promise<T>
}

export interface KnowledgeRepository {
  saveDocument(input: KnowledgeDocumentInput): Promise<KnowledgeDocumentView>
  createVersion(input: KnowledgeVersionInput): Promise<KnowledgeVersionView>
  writeChunks(input: KnowledgeChunkWriteInput): Promise<readonly KnowledgeChunkView[]>
  setAcl(input: SetKnowledgeAclInput): Promise<{ document: KnowledgeDocumentView; entries: readonly KnowledgeAclView[] }>
  listAcl(documentId: string, orgId: string): Promise<readonly KnowledgeAclView[]>
  search(input: KnowledgeSearchInput): Promise<readonly KnowledgeSearchResult[]>
}
