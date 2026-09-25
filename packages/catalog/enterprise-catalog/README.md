---
description: "Versioned DSH enterprise employee drafts, releases, and capability assets."
kind: "package-reference"
---
# @deepseek-ai/dsh-enterprise-catalog

English | [中文](README.zh.md)

## Summary

Versioned DSH enterprise employee drafts, releases, and capability assets.

`learnEmployeeAsset` commits a learned SOP/skill version, its employee binding and an immutable release in one transaction. It retains existing bindings and preserves pending human draft edits without publishing them. Idempotent retries return the original result; unchanged content reuses its asset version.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Versioned enterprise catalog over native DSH identities:

- Agent Preset ids remain the canonical employee identity.
- Draft, release, rollback, and asset-version writes acquire the entity lock before the idempotency lock. Their idempotency rows bind a canonical request digest to the stored result; exact retries return that result and key reuse with another request fails explicitly. Result-only rows created by the earlier schema remain readable during migration.
- Management lists are always organization-scoped, use parameterized filters, and paginate by HMAC-SHA256-signed opaque cursors in `updatedAt` and id order.
- Releases are immutable snapshots with deterministic SHA-256 digests. `listLatestReleases()` reads and verifies only the newest version per preset for Host startup restoration.
- Publishing an unchanged draft already marked published returns its current immutable release and records the new idempotency key instead of creating a duplicate version.
- SOP, knowledge, skill, tool, and model assets are versioned and bound to a release.
- Asset archive is a logical, revision-checked write; an idempotency key is bound to the request digest and returns its original result on an exact retry.
- Raw secrets are rejected; runtime credentials are referenced by `credentialRef`.
- PostgreSQL writes use caller-owned transactions, and every query is parameterized.
- Pagination indexes cover organization, update time, and resource id. `pg_trgm` GIN expression indexes cover lowercase Preset ids, draft profile JSON, asset ids, and asset names for the package's `%term%` search expressions.

Production repositories provide a stable `cursorSigningKey` as a `Buffer` or string. The production composition requires at least 32 bytes with eight distinct byte values. A repository without a key can read a first page only when it does not need to return a cursor; generating or consuming a cursor fails explicitly. Cursor payload and signature segments must be canonical Base64URL, including unused padding bits. Rotating the key invalidates outstanding cursors.

## Model Experience

### Catalog persistence

#### What the model sees

Nothing. The catalog stores control-plane metadata and `EmployeePreset` release snapshots; it does not add prompts, messages, tools, or model calls.

#### Token effect

Zero tokens until a released employee is used by an existing DSH Session.

#### KV Cache effect

None; catalog writes do not assemble provider requests.

### Autonomous capability persistence

#### What the model sees

`learnEmployeeAsset` registers an SOP or skill, binds it to the current employee, and publishes a release in one transaction. It preserves existing capabilities and unpublished human edits; retries are idempotent, and unchanged content reuses its asset version.

#### Token effect

Zero tokens in this repository layer; the separate enterprise learning context decides what reaches a model request.

#### KV Cache effect

None directly; immutable asset versions let the context layer render stable learned instructions.

## Known Limitations and Deferred Work

- This package supplies the catalog repository and contracts; Host API composition and browser pages are separate layers.
- PostgreSQL integration tests run when `DSH_TEST_POSTGRES_URL` is set and are mandatory in CI.
- The database role must be able to install `pg_trgm` during schema migration, or deployment must preinstall the extension.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
