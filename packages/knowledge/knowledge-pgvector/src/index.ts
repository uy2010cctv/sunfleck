/** DSH enterprise knowledge storage and ACL-filtered pgvector retrieval. */

export { EnterpriseKnowledgeRepository, KnowledgeRevisionConflictError, knowledgeEmbeddingDigest } from './repository.ts'
export { migrateKnowledge, KNOWLEDGE_SCHEMA_VERSION } from './schema.ts'
export type * from './types.ts'
