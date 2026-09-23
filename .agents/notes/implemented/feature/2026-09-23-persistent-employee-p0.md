# Agent Note: Persistent employee P0

Status: implemented

English | [中文](2026-09-23-persistent-employee-p0.zh.md)

## Problem

Employees existed only while a call or TeamRun kept one alive: there was no employee identity outside sessions, no inbox that could hold a message for a dormant employee, no bridge from a channel message into an employee's session log, and sticky binding had no storage.

## Decision

P0 ships the persistent employee plane on the enterprise identity SQLite store, schema v6: `employee_accounts`, `surfaces`, `employee_inbox`, and `sticky_bindings` tables. The `ctx.employeeAccounts` service package owns account facts, inbox queueing, and sticky bindings. The `ctx.surfaces` dm bridge anchors one Workspace-backed session per (user, employee) pair — created through the webhook session template with `Steer` delivery and a durable-landing check, so a message counts as delivered only once its session log records it. `/enterprise/employees` endpoints sit behind the existing enterprise cookie authentication and the shared authorization policy and bind sticky on delivery success; the workbench staff view lists employees with a DM entry.

Key sub-decisions:

- **Storage lives in the identity SQLite store, not Postgres.** Accounts, inbox rows, and sticky bindings are identity-domain governance data sharing the organization bootstrap transaction domain, and a live `DatabaseSync` cannot ride a cordis.yml plugin config.
- **Provenance rides the merge-extensible `surface-message` `MessageSourceMap` source** (`surfaceId`, `inboxItemId`, `originActor`), the channel the webhook template already uses; `SessionHeader` meta supports only `agentPreset` and `cwd`, so who sent a message replays from the logged message source.
- **Delivery serializes per employee and session creation per pair**, in-process single-writer promise tails.
- **Shared logic moved to authoritative homes instead of byte copies**: the `pendingInboxMessages` fold lives at the `@deepseek-ai/dsh-agent-loop/inbox` subpath and `installInitialModelSelection` in `@deepseek-ai/dsh-agent-default-model`.
- **Controller endpoints answer 503 `employee-plane-unavailable` until a deployment composition provides both plugins.** Composition ownership is a deployment decision: the enterprise overlay's identity store is Postgres, so which deployment mounts the SQLite employee plane is not this repository's default.

## Alternatives considered

**Employee rows in the enterprise Postgres store.** This would split one governance domain across two stores and put the organization bootstrap transaction out of reach of the account write; the identity SQLite schema already owns org-scoped rows.

**Recording the origin actor in `SessionHeader` meta.** The header supports only `agentPreset` and `cwd`, so each provenance field would need a header-schema change instead of a member of the merge-extensible message-source union — and a header describes the session, not each message.

**Byte-copying the inbox fold and model-selection install into the surface bridge.** Copies drift; both helpers already had an authoritative home to move to.

## Deferred

Channel, group, and project surfaces; memory compartments (L4/L5); release-to-preset resolution (the anchored session takes an explicit `defaultAgentPreset` config); WeCom live wiring (configuration readiness only).

## Consequences

An external dm now has a full path into an employee session with a replayable log: the delivered `user/message` and its `surface-message` source reconstruct from the session log, and the landing check refuses to mark an inbox row delivered once its payload can no longer reach the model. Dormant employees receive messages durably through the per-employee inbox. P1 memory work builds on `EmployeeAccount` as the employee identity.
