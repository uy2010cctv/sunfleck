# Agent Note: Enterprise team definitions

Status: implemented

English | [中文](2026-09-01-enterprise-team-definitions.zh.md)

## Problem

The fixed-team record supports today's workbench and schedule targets, but its leader, member labels, Workflow template, and approval JSON cannot express a human owner, explicit responsibilities, charter completeness, evidence verification, or attention limits. Adding those fields directly would couple an existing compatibility record to future execution state and force legacy data to pretend it has a charter.

## Decision

`EnterpriseTeamDefinition` is a separate revisioned control-plane record. Its roster uses discriminated human user and immutable Agent release references; roles name responsibilities independently from actors. Verification policy records verifier, rubric-reference, and high-risk human-review requirements. Attention policy records a centralized decision queue and optional open-decision and work-in-progress limits without inventing an SLA.

Definitions move among `needs-charter`, `active`, and terminal `archived` states. Active validation requires a non-empty name and north star, a rostered human owner, a rostered Agent leader, unique roles and actors, valid role references, complete verification and attention fields, and a non-empty trimmed unique allowlist for restricted visibility. Organization and private definitions carry no allowlist. Only archive enters the terminal state, and every later save is rejected.

The PostgreSQL table stores only charter, roster, policy, visibility, revision, and lifecycle fields. TeamRun and other runtime state do not belong in this table. Writes use organization-scoped queries, compare-and-swap revisions, and request-digest-bound idempotency; lists use the existing signed, organization-bound keyset cursor.

Migration and fixed-team creation insert a `needs-charter` definition when one is absent. They preserve the team id, organization visibility, immutable leader release, member release references, role labels, approval policy, and timestamps. The bootstrap uses `system:legacy-fixed-team-migration` when no owner was recorded and leaves name, north star, responsibilities, verification policy, and attention policy empty. Repeated migration is idempotent, and team work-record and schedule entry points invoke the execution validator before starting work.

The generated `enterpriseTeamDefinition` Remote namespace exposes list, get, save, and archive. Browser requests contain write guards and definition fields but no organization or acting-user field; Host request context supplies the principal, and the existing `team.read` and `team.manage` policy plus audit path protects every operation. The Host service filters list and get results by stored organization, private, or restricted visibility without adding principal fields to the repository API. The older `enterpriseTeam` namespace and fixed-team repository remain available for the current workbench.

## Alternatives considered

**Extend the fixed-team row.** Rejected because the current workbench and schedules depend on its smaller compatibility record, while legacy rows have no truthful charter content.

**Add TeamRun with the definition.** Rejected because execution needs separate lifecycle, evidence, approval, and recovery decisions; storing partial runtime state in a charter table would establish the wrong persistence owner.

## Consequences

- Human and Agent membership has one typed representation before execution orchestration is designed.
- Legacy records remain visible without fabricated charter content and require an explicit charter before they can become active.
- FixedTeam CRUD and UI payloads remain compatible while team execution requires an active definition.
- TeamRun, browser editing, and Agent runtime coordination remain deferred and cannot be inferred from the presence of a definition.

## Verification

Focused Vitest coverage exercises active validation, legacy migration, CRUD, organization isolation, CAS, idempotency, terminal archive behavior, principal injection, RBAC decisions, audit calls, and stable Remote failures. The PostgreSQL integration suite owns schema, migration, and CAS coverage when `DSH_TEST_POSTGRES_URL` is available. Root typecheck builds Host declarations and generated Typert clients before compiling the Client graph.
