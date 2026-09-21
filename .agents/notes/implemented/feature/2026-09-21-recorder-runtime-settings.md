# Agent Note: Recorder runtime settings

Status: implemented

English | [中文](2026-09-21-recorder-runtime-settings.zh.md)

## Problem

Recorder ASR and speaker recognition were selected through process environment variables. An ordinary user could not see which models were intended, distinguish saved configuration from a running process, or switch local and online execution without editing service files. Sending provider secrets through browser settings would also expose values outside the Credential service.

## Decision

The Settings client registers one explicit **Recording & speech models** section. ASR and CAM each select local or online execution, model id, and online endpoint; CAM additionally owns enablement and the owner-match threshold. Online configuration stores only Credential references in browser-visible state.

The authenticated Enterprise controller validates configuration, resolves Credential values on the Host, and calls the recorder gateway through a server-only administration token. The gateway authenticates that token and forwards to the Mac ASR process using its existing ASR token. The Mac persists the complete desired configuration in a mode-0600 revisioned file and never returns credential values.

Save and Start are separate operations. Save uses optimistic revision matching and does not replace active model objects. Start loads the saved ASR and CAM adapters and publishes them atomically after loading succeeds. Status distinguishes saved configuration, process state, model readiness, credential readiness, and runtime errors.

Local ASR selects FunASR unless the model id names Whisper. Online ASR uses an OpenAI-compatible multipart audio transcription request. Online CAM sends 16 kHz PCM16 audio to an HTTPS JSON embedding endpoint. The generic online protocols do not define a health route, so Start sends a one-second silence inference probe to each selected online provider before publishing the candidate adapters.

## Alternatives considered

**Continue using environment variables.** This leaves configuration invisible to users, requires a process restart, and cannot provide save/start state readback.

**Send API keys in the settings form.** This would expose secrets to browser state and duplicate Credential ownership, so the page accepts references only.

**Write configuration directly from the browser to the Mac.** This would bypass enterprise authentication and make the private tunnel a public control plane, so every mutation passes through the Host and gateway.

## Consequences

Users can inspect, configure, start, and reload recorder models from one system settings page while secrets remain server-side. Revision checks prevent stale tabs from overwriting a newer choice, and a failed model load leaves an explicit error. The design adds a three-hop administration path and a local secret-bearing file. Online endpoints remain provider-specific deployments and require a real credential plus an inference request before provider availability is known.
