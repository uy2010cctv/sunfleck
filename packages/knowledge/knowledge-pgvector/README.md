---
description: "PostgreSQL and pgvector knowledge documents, immutable versions, chunks, and ACL-filtered retrieval."
kind: "package-reference"
---
# @deepseek-ai/dsh-knowledge-pgvector

English | [中文](README.zh.md)

## Summary

PostgreSQL and pgvector knowledge documents, immutable versions, chunks, and ACL-filtered retrieval.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

PostgreSQL and pgvector persistence for DSH enterprise knowledge:

- Documents have immutable, numbered versions and metadata-only source references.
- Chunks accept caller-provided embeddings; this package does not call an embedding provider.
- Search is always constrained by `orgId` and the caller's user, group, and role ACLs in SQL.
- Search results carry the document version, content hash, chunk identity, and permission evidence.
- Document and ACL writes use optimistic revisions, transaction-scoped advisory locks, and idempotency keys.
- Migration creates the `vector` extension and package-owned tables with a guarded schema version.

## Model Experience

### Knowledge retrieval

#### What the model sees

Only chunks returned by an ACL-filtered `knowledge_search` supplied by the host. The repository never assembles provider prompts or calls a model.

#### Token effect

Search itself consumes zero model tokens. Returned chunk text may be inserted into a host prompt and incur normal DSH model cost.

#### KV Cache effect

None at the repository layer; cache behavior belongs to the DSH Session/provider runtime.

## Known Limitations and Deferred Work

- Embedding generation, document extraction, artifact storage, and Host API wiring are separate layers.
- The first migration uses an unbounded `vector` column because providers may use different dimensions; deployments should add a dimension-specific index when the embedding model is fixed.
- The optional PostgreSQL integration test requires `DSH_TEST_POSTGRES_URL` and a PostgreSQL installation with pgvector.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
