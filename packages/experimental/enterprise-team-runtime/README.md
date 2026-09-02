---
description: "Run an enterprise Team Definition through the experimental Agent Teams Session domain, with immutable employee releases and Human decisions."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-enterprise-team-runtime

English | [中文](README.zh.md)

## Summary

This private source-checkout package implements the `EnterpriseTeamRuntimeDriver` over the existing Agent Teams root Session log. It creates the leader Session in the selected enterprise Workspace, pins every Agent to an immutable employee Release, registers Human roster members without Agent authority, creates continuable Agent teammates, and appends TeamRun and Human-decision events through `ctx.agentTeams`. PostgreSQL remains a query projection; the root Session event log owns runtime truth.

## Use this package

The enterprise Web overlay loads Agent Teams, its model and browser consumers, this adapter, and then the enterprise controller. The adapter fails loud when the Workspace, Release, configured model route, preset, or required runtime service is missing. Ordinary Web profiles do not load this package.

The adapter currently accepts Releases with no capability-asset bindings. A configured `modelRef` and the Release persona are applied to the Agent. Releases that bind versioned SOP, knowledge, skill, tool, or model assets are rejected until a runtime assembler can install those exact versions; the adapter never claims that an unmounted capability is active.

## Runtime behavior

- The root Session id is derived deterministically from the TeamRun id, so a repeated start operation reconciles the same log.
- Human members appear in the shared roster but receive no Agent Session, mailbox address, tool authority, or Human credential inheritance.
- Agent members are continuable children whose descriptor retains the Release id, role, model route, persona, and tool filter needed for cold resume.
- Start, state, cancellation, projected decisions, and Human answers use stable operation ids and monotonic runtime revisions.
- Cancellation records the authoritative event before interrupting the live root and children; persisted state remains available for replay.
- Reconciliation folds the stored root Session and does not require a live Agent.

## Model Experience

The Team Lead and Agent teammates receive the existing Agent Teams policy and tools. The Release persona and TeamRun objective are model-visible. Human roster and decision records stay in the Team event projection; a Human answer is also delivered to the Lead as a user message so the run can continue.

## Known Limitations and Deferred Work

- This package and the Agent Teams packages are private and excluded from official releases.
- Team tasks are still Agent-owned; Human task ownership is not implemented.
- Capability-asset bindings fail loud instead of being partially mounted.
- The runtime is process-local. Durable logs support restart reconciliation, but multiple processes do not concurrently own one Team.
- External channels and the enterprise Team Room are separate product layers.

## Further Exploration

- [Agent Teams](../agent-team/README.md) — roster, mailbox, task DAG, and durable Team events.
- [Human-agent team operating model](../../../docs/user/guide/human-agent-teams.md) — proposed product workflow and trust model.
- [Enterprise Team runtime decision](../../../.agents/notes/implemented/architecture/2026-09-02-enterprise-team-runtime-adapter.md) — identity, authority, failure, and recovery decisions.
