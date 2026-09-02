# Agent Note: Enterprise TeamRun over the Agent Teams Session log

Status: implemented

English | [中文](2026-09-02-enterprise-team-runtime-adapter.zh.md)

## Problem

The enterprise control plane can reserve TeamRuns and project runtime outcomes, while the private Agent Teams domain already owns a durable roster, mailbox, task DAG, and continuable children. A product bridge must not create a second runtime database, start mutable presets instead of immutable employee Releases, inherit a Human request principal into autonomous turns, or report capability bindings that were never installed.

## Decision

`@deepseek-ai/dsh-experimental-enterprise-team-runtime` implements the injected `EnterpriseTeamRuntimeDriver`. The existing `TeamService` remains the only owner of runtime Team events. Its root Session log adds versioned TeamRun, Human-member, and decision snapshots beside the existing Agent roster, mailbox, and task events.

The root Session id is a deterministic function of the TeamRun id. Repeated start operations inspect and fold that Session before creating work, so the control-plane operation id and runtime log converge on one identity. The driver resolves the authenticated organization, Workspace grant, employee Releases, and Human directory entries again at the runtime boundary.

The Team Lead uses the leader Release preset, configured model route, and persona. Continuable teammates retain their exact Release id, digest, preset, model route, role, persona, and tool filter in durable descriptors and Team member events. Human roster entries carry user identity and role only; they have no Session id, mailbox authority, tools, or credential inheritance.

The adapter accepts no capability-asset bindings until a version-aware runtime assembler exists. SOP, knowledge, skill, tool, and model-asset bindings are rejected instead of being silently ignored. Model routing from the Release profile is supported.

Start records `starting`, registers the roster, creates Agent children, records `active`, then submits the initial objective outside the enterprise principal context. Partial provisioning records `failed`, drains created children, and disposes the new root handle. Cancellation records `cancelled` before interrupting live Agents. Human answers are CAS-protected Team decision events and are then delivered to the Lead without propagating the Human principal.

## Recovery and ownership

The Session log, not process-local handles, owns durable state. Reconciliation folds stored events without resuming an Agent. When a command requires a live root, the adapter resumes the root with the pinned Release and the subagent continuation manager cold-resumes children from their descriptors. Adapter disposal releases only live handles and never deletes Session data.

The enterprise overlay loads Agent Teams Host, tools, browser projection, this adapter, and then the enterprise controller. The ordinary Web profile stays unchanged. All packages remain private and excluded from official releases.

## Alternatives considered

**Store runtime roster and decisions only in PostgreSQL.** Rejected because it would create a second runtime authority and lose native Session replay.

**Use the latest mutable Agent Preset.** Rejected because a TeamRun must retain the exact employee Release identity and model/persona evidence.

**Ignore unsupported asset bindings.** Rejected because UI evidence would claim capabilities the runtime did not install.

**Pass the authenticated principal into Agent turns.** Rejected because an autonomous Agent must not inherit Human authority or credentials.

## Verification

Tests cover old Team-event replay, mixed Human and Agent roster projection, operation-id replay, runtime revision and decision CAS, immutable Release metadata, Workspace and Session binding, partial-start cleanup, cancellation, Human-answer wakeup, cold reconciliation, restart resume, missing or cross-organization Releases, unsupported bindings, controller injection, and enterprise overlay order.

## Consequences

The local enterprise profile can start and reconcile real DSH TeamRuns with immutable employee evidence. Human task ownership, version-aware asset assembly, multi-process Team ownership, external channels, and the full Team Room remain separate work.
