# Agent Note: Enterprise project and surface directory in PostgreSQL

Status: implemented

English | [中文](2026-09-25-enterprise-project-and-surface-directory.zh.md)

## Problem

The enterprise Web controller exposes project and surface routes, but the production composition does not provide `enterpriseProjects` or `surfaces`. Both list routes answer 503. The project repository already uses PostgreSQL; the full surface runtime requires a synchronous SQLite identity store and employee account service, while the enterprise deployment uses PostgreSQL identity.

## Decision

The enterprise PostgreSQL composition migrates the project schema after identity and provides the complete member-gated `enterpriseProjects` service. It also owns a versioned, organization-scoped PostgreSQL surface directory for the Web roster. When the full `surfaces` runtime is absent, only authenticated `GET /enterprise/surfaces` reads that directory through the existing `channel.read` authorization and audit path. Surface creation, message delivery, and inbound channel routes retain `surface-plane-unavailable`; a list response never claims those capabilities are mounted.

## Alternatives considered

**Mount the SQLite surface runtime against an empty sidecar database.** Rejected because its employee and organization records would diverge from PostgreSQL identity and could make authorization or delivery decisions from stale data.

**Return an unconditional empty list.** Rejected because it would hide storage failure and erase the distinction between no stored surfaces and an unavailable source of truth.

## Consequences

- Project creation, listing, membership, and archival use one PostgreSQL pool and the existing project repository.
- The surface directory is a read-only projection with no writer in this composition; it starts empty and remains empty until a PostgreSQL surface runtime or explicit importer supplies rows.
- A future PostgreSQL surface runtime must own employee accounts, inbox delivery, and directory writes together before the write routes can replace their 503 response. The controller uses that full runtime whenever it is mounted.
