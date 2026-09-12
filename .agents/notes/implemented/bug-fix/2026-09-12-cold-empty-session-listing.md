# Agent Note: Cold empty Session listing

Status: implemented

English | [中文](2026-09-12-cold-empty-session-listing.zh.md)

## Problem

After a Host restart, PostgreSQL Sessions are cold. When their projection cache is absent, the Session list previously treated blankness as unknown and visible. Failed or abandoned Sessions containing only seed and permission events therefore appeared as several ordinary "New Session" rows even though no conversation had ever started.

## Decision

The persistence snapshot carries optional lightweight `conversationStarted` evidence. PostgreSQL derives it with an indexed existence check for `turn/start`, without loading or replaying the complete log. Session Query preserves that evidence for persisted cold records, and Session Controller classifies a cache-missing cold row as blank when PostgreSQL proves no turn started. The client already shows only the current blank row, so stale shells disappear while the active draft remains reusable.

Backends that cannot determine this cheaply leave the field absent and retain the previous fail-visible behavior. A real `turn/start` always keeps the Session visible even when title generation or projection caching failed.

## Alternatives considered

**Hide every titleless Session.** This could conceal a real conversation whose title generation failed, so it was rejected.

**Load every cold log during listing.** Large conversations can contain hundreds of thousands of streaming events; replaying them to draw the sidebar would make startup unsafe.

**Delete empty Session rows.** Deletion is irreversible and conflates presentation with retention. Confirmed duplicates are archived separately.

## Consequences

PostgreSQL-backed enterprise restarts no longer expose stale empty shells as conversations. Listing adds one bounded correlated existence check per header, backed by the session-id event index, while other persistence backends retain conservative behavior.
