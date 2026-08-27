# Agent Note: Enterprise catalog management queries

Status: implemented

English | [中文](2026-08-27-enterprise-catalog-management-queries.zh.md)

## Problem

The enterprise catalog persists employee drafts and versioned assets but a management consumer cannot discover them without already knowing each identifier. Unscoped lists or asset-version reads would expose records across organizations, while offset pagination would duplicate or omit records as operators update the catalog.

Asset removal also needs a reversible operation that prevents a stale administrator or a reused idempotency key from applying a different request.

## Decision

`EnterpriseCatalogRepository` supplies organization-scoped draft and asset list operations. Draft filters cover status, owner, visibility, and literal case-insensitive search over Preset id and profile JSON. Asset filters cover kind, archive state, and literal case-insensitive search over asset id and name. Limits default to 50 and accept integers from 1 through 100.

Lists sort by `updated_at DESC` followed by the resource id descending. A page requests one lookahead row and returns an opaque cursor only when another row exists. The cursor records the last sort tuple and a digest of the organization, resource type, and all filters; changing that query rejects the cursor instead of silently changing its meaning.

`getAsset` includes the organization in its parameterized lookup. `listAssetVersions` first performs that ownership lookup and fails before reading version rows when the asset is absent from the requested organization. List predicates and search values are PostgreSQL parameters rather than SQL fragments supplied by callers.

`archiveAsset` sets `archived`, advances the asset revision, and leaves every version intact. It serializes with the existing per-asset advisory lock, verifies the expected revision, and performs the update with a revision compare-and-swap. Its idempotency record stores a digest of the organization, asset, and expected revision beside the result. An exact retry returns the original result even though the asset is already archived; the same key with different request fields fails.

## Alternatives considered

**Offset pagination.** Rejected because concurrent saves can move rows between offsets and cause duplicates or omissions. The sort tuple gives deterministic continuation without retaining server-side list state.

**Asset-version reads scoped only by globally unique asset id.** Rejected because organization ownership is an authorization invariant even when identifiers are globally unique. The repository proves ownership before reading versions.

**Physical deletion.** Rejected because published employee releases pin immutable asset versions and administrators need audit-preserving reversibility. Logical archive removes an asset from active selection without destroying history.

**Result-only idempotency.** Rejected for archive writes because a client could reuse one key with a different expected revision and receive a result for a request it did not make. Request digests make that conflict explicit.

## Consequences

Management consumers can page and filter catalog records without adding another projection store. Every read carries an organization id, and cross-organization point or version access returns no record or fails before version retrieval.

Cursor pagination reflects the ordered state at each request rather than a database snapshot, so an item updated between pages may move ahead of the cursor. Exact retries of archive writes are stable, while a new archive attempt against an already archived asset fails unless it is the recorded retry.

## Testing

The in-memory PostgreSQL repository tests pin filter combinations, bounds, stable continuation, query-bound cursor rejection, parameterized search, organization isolation, version ownership, revision conflicts, and archive idempotency conflicts. The real PostgreSQL suite pins the same management path against SQL ordering, JSONB, transactions, and the version-one schema migration when `DSH_TEST_POSTGRES_URL` is set; CI requires that variable.
