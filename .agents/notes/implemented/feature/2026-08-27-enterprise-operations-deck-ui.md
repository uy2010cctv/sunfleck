# Agent Note: Enterprise operations deck uses authenticated read models

Status: implemented

English | [中文](2026-08-27-enterprise-operations-deck-ui.zh.md)

## Problem

The first enterprise workbench projected Agent Presets and the current browser Session mirror. That was a useful ordinary-profile fallback, but it could not operate the persistent employee catalog, release history, approvals, schedules, capability assets, or fixed teams added to the enterprise Host. Treating a transport or permission failure as a reason to fall back would also broaden the visible projection and conceal the actual failure.

## Decision

`@deepseek-ai/dsh-client-ui-enterprise-workbench` is the enterprise operations deck over the typed `enterpriseEmployees`, `enterpriseAssets`, `enterpriseTeams`, and `enterpriseOperations` client domains. Its overlay-local navigation owns digital employees, work records, approvals, schedules, capability assets, and teams. Enterprise governance, identity, credentials, and model administration remain Settings surfaces.

The employee roster sends search, status, visibility, owner, limit, and cursor fields to the Host. The employee editor loads one persistent draft and its release history, keeps changes local until explicit save, validates supported profile fields, sends the current `expectedRevision`, preserves dirty input on `enterprise-conflict`, and exposes publish and rollback as separate mutations. Work, approval, schedule, asset, and team pages use their typed read models and revision-fenced mutations. Browser payloads never contain `orgId` or `principal`; the authenticated Host owns those values.

The runtime's single Host-stream consumer emits decoded `connection/host-frame` events after the native Session and Workspace folds. The workbench consumes `enterprise/event` frames, bounds and deduplicates their `eventId` values, and refreshes the employee, asset, team, approval, schedule, or work-record page that owns the event. Page states are independent, so a forbidden or failed read can coexist with usable successful pages.

An ordinary profile falls back to the Agent Preset, Session, and Workspace projection only when `enterpriseEmployee.list` explicitly reports that the enterprise API is unavailable. Authorization, cursor, transport, and other internal failures stay visible and never trigger fallback.

## Alternatives considered

- **Keep the Agent Preset and Session projection as the enterprise source of truth** — it has no persistent release, approval, schedule, asset, or team records and cannot represent cross-user permission-filtered enterprise state.
- **Fall back on every enterprise API error** — this hides outages and authorization failures while potentially showing a broader native projection than the authenticated enterprise read model allowed.
- **Put enterprise navigation and governance into one administrator dashboard** — ordinary operators need operational records, while identity, credentials, models, and organization policy have a different permission and task boundary already owned by Settings.
- **Open a second Host event stream in the workbench** — the client runtime already owns the one stream pump; forwarding decoded frames preserves single-consumer transport ownership and lets additive read-model clients subscribe locally.

## Consequences

Operators can manage the persistent enterprise entities without leaving the DSH overlay, while the native conversation remains the execution surface. The deck has responsive 320 px, tablet, and desktop layouts; keyboard focus containment, Escape handling, dirty-leave confirmation, reduced-motion behavior, and paired Chinese/English vocabulary are part of the component contract. Capability bindings and policy bodies remain ID/JSON-oriented operator inputs, and the UI deliberately shows no productivity, SLA, percentage, or inferred business-result metrics. Focused controller, React, API-fallback, conflict, event-deduplication, mutation-payload, and responsive-style tests pin the boundary.
