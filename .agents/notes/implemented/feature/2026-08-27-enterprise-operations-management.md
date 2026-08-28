# Agent Note: Organization-scoped Operations management

Status: implemented

English | [中文](2026-08-27-enterprise-operations-management.zh.md)

## Problem

The durable Operations projection could create work records, approvals, schedules, and fixed teams, but management clients could not reliably page or filter them, edit teams and schedules with compare-and-swap, or cancel pending approvals. Production also left native release and Session reference validation unwired. Offset pagination or unsigned cursors would make changing datasets unstable and allow query scope to be confused across organizations.

## Decision

The Operations repository owns organization-scoped keyset queries and CAS writes. Opaque cursor version 2 contains a canonical base64url payload authenticated with HMAC-SHA256. Its scope digest binds the entity kind, organization, and every filter. Work records use immutable `created_at DESC, session_id DESC, employee_release_id DESC`; approvals, schedules, and teams use immutable `created_at DESC` plus their stable identifier. `updatedAt` remains display metadata. Limits are integers from 1 through 100.

Work records filter by business state, source, and team; approvals by kind, state, and requester; schedules by state. Pending approvals accept a `cancelled` transition and persist the actor and optional reason. The service boundary permits cancellation only for the original requester or an administrator. Fixed-team saves validate the leader and every member release in the organization, then replace the complete member set atomically. Schedule saves replace target, timezone, rule, input, and next-run time under a revision CAS. Archived schedules remain terminal.

Production derives separate Catalog and Operations cursor keys from deployment-owned secret material. Native reference resolvers receive the active repository transaction and query only through it, preventing pool re-entry deadlocks at `poolMax = 1`. The release resolver checks `dsh_enterprise_employee_releases(release_id, org_id)`. The Session resolver joins `dsh_session_headers(id)` to `resource_policies(resource_type = 'session', resource_id, org_id)`, so a missing or cross-organization policy fails closed; work-record organization ownership remains enforced by the Operations repository. Cancellation obtains the central authorization decision without auditing it yet. A central denial is audited once and reaches no driver; after central allowance, the service resolves the requester relationship and emits one final allowed or denied audit. Filtered schedule service calls return a cursor page while the no-filter overload preserves the legacy array. Existing idempotency envelopes without a request digest fail closed. Schema version 6 adds created-at page indexes and filter-specific created-at indexes.

## Alternatives considered

- **Offset pagination** — simple, but inserts and updates between requests can duplicate or skip records.
- **Unsigned JSON cursors** — inspectable, but callers could alter organization, filters, or ordering keys. Signed opaque cursors keep transport details private and fail scope changes.
- **One shared derived cursor key** — operationally easy, but a key disclosed through one repository would authenticate another repository's cursor. Domain-separated derivation limits that blast radius.
- **Patch individual team members** — reduces write volume, but creates partial membership semantics and more CAS surfaces. Whole-set replacement keeps one atomic team revision.
- **Allow archived schedule restoration** — convenient, but weakens archival as an audit terminal state. A restored behavior must be represented by a new schedule.

## Verification

Repository and service tests cover cursor limits and query-scope rejection, immutable pagination across an intervening update, active-transaction resolver injection, filtering, schedule page forwarding, cancellation decisions, CAS updates, member replacement, and archived schedule immutability. Real PostgreSQL tests cover `poolMax = 1` concurrent writes, pagination and filters, Session policies, and five filter-shape `EXPLAIN` plans for work state, work state plus source, approval kind, approval kind plus state, and schedule state; `SET LOCAL enable_seqscan = off` and every `EXPLAIN` run on the same transaction client.

## Consequences

Management reads remain stable while concurrent records change and fail closed across organization or filter scope. Production writes now require native references to exist. The cost is deployment-owned cursor key material, additional indexes, keyset-specific query code, and full member replacement for every team edit. Cursors are deliberately invalid after filter changes or key rotation.
