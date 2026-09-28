---
description: "PostgreSQL composition and lifecycle provider for DSH Enterprise."
kind: "package-reference"
---
# `@deepseek-ai/dsh-enterprise-postgres`

English | [中文](README.zh.md)

## Summary

PostgreSQL composition and lifecycle provider for DSH Enterprise.

## Table of Contents

- [Package Details](#package-details)
- [Dev Note](#dev-note)

-----

<a id="package-details"></a>
## Package Details

Production PostgreSQL composition for DSH Enterprise. It owns one bounded `pg.Pool`, verifies connectivity, initializes the identity, Session, catalog, operations, project, surface-directory, and pgvector schemas, and exposes the adapters over a shared transaction-aware database wrapper. The project service supports its complete member-gated lifecycle; collaboration creation retries use a creator-scoped deterministic identity and transactional stored-value comparison; collaboration persistence stores explicit human memberships, published employee references, channel topics, and native Session bindings under a transaction-locked schema version.

Collaboration schema version 2 adds a room event log without rewriting version 1 rooms or native Session destinations. Each event stores the exact signed NIP-01 JSON, organization and room identity, author binding, thread root, request identity, and optional native Session cursor. Signatures are verified at append and read, so altered stored content is refused. PostgreSQL assigns an ordered `BIGINT` sequence that callers receive as a decimal string. Request and source retries preserve the first event when the author and semantic payload match; changed retries conflict. Indexed reads and full-text search require the enterprise controller to check current room membership and Workspace access before calling the repository. A separate public-key binding table retains each human, employee, or service actor's first key; private keys remain in the credentials service. Signed task events can establish one owner and compare-and-swap its handoff to another employee.

Channel thread reads may include historical employee posts and activity facts whose stored thread root is absent, using Host-resolved native Session ids, plus human reactions whose signed target references those facts. Root-marker tags are excluded from reaction target matching. The query admits only Sessions bound to the exact root in a channel with thread topic policy, within the same organization and room, and applies sequence cursors and limits to the combined page. It returns original verified signed events and stored metadata; the controller supplies the thread parent in its response view without changing signatures or storage.

Collaboration schema version 3 adds a durable dispatch outbox. The signed `dsh-target` and `dsh-route` tags create destination rows in the same transaction as the event. A service Bot request records its authorized human requester, who must still be a room member when appended. Workers claim destinations with bounded leases and fencing tokens; completion or release requires the same token, and expired claims can be recovered after a restart. A signed Bot handoff creates its destination only in the transaction that successfully transfers task ownership. Dispatch workers recheck current membership, Workspace rights, and native delivery receipts before completing a claim.

Collaboration schema version 4 stores each human member's last read event sequence. Migration initializes existing members at the latest event in each old room; newly created rooms start without a cursor. The repository advances it only to an existing signed event in that room, never backwards; membership removal deletes the cursor. Unread attention considers signed text posts after that sequence, excludes the reader's own human posts, and recognizes only explicit signed `dsh-mention` user-id tags.

The channel-workflow schema stores immutable YAML revisions, trigger reservations, pending human decisions, and scheduled occurrences separately from the signed-room schema version. A clock occurrence is staged in PostgreSQL before its schedule advances, leased to one worker, and retried after a missed acknowledgement; each action uses a stable step key. Room search combines indexed full-text terms with Unicode substring matching so a short Chinese phrase can match a longer message.

Workflow schema version 4 fences execution and decision continuations, records human message triggers atomically with signed room events, and exposes committed approvals to restart recovery. Older schema rows remain intact through monotonic migrations.

Workflow schema version 5 also stores the exact workflow ids and revisions alongside each human room trigger. Replay reads those immutable versions, even when a manager has since published a different YAML definition. The signed request tag is checked against the durable idempotency field, and signed event hashes and Schnorr signatures are verified on both append and read.

Operations confirms a work record's Session through the organization-scoped `enterprise_session_workspaces` binding written by the authenticated gateway. This reference remains valid when the Session log runs in the separate V4 PostgreSQL database; the old main-database `dsh_session_headers` table is not used to authorize new work records.

The provider does not store credentials, connection strings, or cursor keys in PostgreSQL or DSH Session events. The deployment supplies `connectionString` and a stable `cursorSigningKey` of at least 32 bytes and eight distinct byte values from its secret manager and owns pool sizing, TLS, backup, and database role permissions. The enterprise CLI overlay derives the cursor key from `DSH_ENTERPRISE_MASTER_KEY` with HMAC-SHA256 and the domain label `dsh-enterprise-catalog/cursor-signing/v1`; it never passes the credential-encryption key bytes directly to the catalog.

## Model Experience

### Enterprise persistence composition

#### What the model sees

Nothing. `enterprisePostgres` composes Host-owned repositories and registers no prompt, tool, or model call.

#### Token effect

Zero tokens; connection and schema work happens before Agent request assembly.

#### KV Cache effect

None; provider request caching is outside the database composition.

## Known Limitations and Deferred Work

- The browser Host API still needs an application-specific composition to expose catalog and operations methods; this package only provides the durable services.
- The legacy surface directory remains available for roster reads. The collaboration repository adds member-scoped group/channel persistence; the enterprise controller owns authorized native Session routing. Employee inbox and token inbound delivery still require their separately composed runtime.
- Collaboration bootstrap creates base room tables before attachment and preference foreign keys. These additive tables are also checked when a version-4 database resumes.
- SQLite-to-PostgreSQL data migration for legacy Session logs remains a separate controlled operation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
