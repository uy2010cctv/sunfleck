# Agent Note: User-owned Device Plane

Status: implemented

English | [中文](2026-09-11-device-plane.zh.md)

## Problem

A multi-user DSH Host cannot safely run browser and desktop automation in one shared server account. Actions must execute on the requesting user's computer without sharing files, profiles, cookies, credentials, or OS authority across users.

## Decision

The Server owns device registration, scoped Computer Use Runs, typed actions, one-time Permits, replay-protected signed device requests, and durable results. The local `dsh-device-agent` owns its Ed25519 private key, OS permissions, local confirmation, Adapter processes, and evidence generation.

Browser and desktop execution remain separate. `agent-browser` and Playwright MCP accept only typed browser operations; Cua accepts typed desktop operations. A generic command or arbitrary module-path field is forbidden in the wire contract. Control actions require local confirmation in the default `confirm-each` mode. A claimed action with an unknown outcome is never automatically replayed.

The ordinary UX is **Digital employees → My computer → Connect this computer**. Pairing uses the local loopback Agent and exposes only its public identity. Device ids, keys, Adapter names, and Permit details stay out of the ordinary UI. Users can inspect recent actions and pause, resume, or stop active runs.

## Alternatives considered

**Run automation on the shared DSH Server.** This would collapse user OS identities and browser profiles into one trust boundary, so it was rejected.

**Embed Open Interpreter, OpenClaw, or another complete agent runtime.** DSH would lose authority over permissions and audit semantics, so only replaceable execution Adapters are integrated.

**Give the model a generic local command channel.** Arbitrary commands cannot be reliably policy-checked before execution, so the protocol uses a closed operation vocabulary.

## Consequences

The design buys user, device, Workspace, and Session isolation with durable evidence and local final control. It costs a separately installed local process, platform permissions, Adapter-specific cancellation behavior, and real-device qualification for every supported operating system.
