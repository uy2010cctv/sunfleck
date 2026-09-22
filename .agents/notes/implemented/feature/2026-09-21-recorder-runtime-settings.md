# Agent Note: Recorder runtime settings

Status: implemented

English | [中文](2026-09-21-recorder-runtime-settings.zh.md)

## Problem

Recorder ASR and speaker recognition were selected through process environment variables. An ordinary user could not see which models were intended, distinguish saved configuration from a running process, or switch local and online execution without editing service files. Sending provider secrets through browser settings would also expose values outside the Credential service.

## Decision

The Settings client contributes recorder controls to the dsh-knowledge **Local Models** section instead of registering another navigation entry. ASR and CAM each select local or online execution, model id, and online endpoint; CAM additionally owns enablement and the owner-match threshold. Online configuration stores only Credential references in browser-visible state.

The same surface selects the recorder-memory processing provider, model, and timeout and shows the authenticated user's dedicated `recorder-memory-<userId>` inference Session id. The Host persists that route in the owner-only `$DSH_HOME/storages/recorder-memory-runtime.json` file with optimistic revision matching. dsh-knowledge reads the file before each processing batch; environment variables remain only as a migration fallback when the file does not exist.

The authenticated Enterprise controller validates configuration, resolves Credential values on the Host, and calls the recorder gateway through a server-only administration token. The gateway authenticates that token and forwards to the Mac ASR process using its existing ASR token. The Mac persists the complete desired configuration in a mode-0600 revisioned file and never returns credential values.

Save and Start are separate operations. Save uses optimistic revision matching and does not replace active model objects. Start loads the saved ASR and CAM adapters and publishes them atomically after loading succeeds. Status distinguishes saved configuration, process state, model readiness, credential readiness, and runtime errors.

Local ASR selects FunASR unless the model id names Whisper. Online ASR uses an OpenAI-compatible multipart audio transcription request. Online CAM sends 16 kHz PCM16 audio to an HTTPS JSON embedding endpoint. The generic online protocols do not define a health route, so Start sends a one-second silence inference probe to each selected online provider before publishing the candidate adapters.

## Alternatives considered

**Continue using environment variables.** This leaves configuration invisible to users, requires a process restart, and cannot provide save/start state readback.

**Keep recorder controls as a separate Settings navigation item.** ASR, CAM, embeddings, reranking, OCR, Ollama, and memory processing are all local-model operations; splitting them made the model inventory harder to understand and left memory processing invisible.

**Send API keys in the settings form.** This would expose secrets to browser state and duplicate Credential ownership, so the page accepts references only.

**Write configuration directly from the browser to the Mac.** This would bypass enterprise authentication and make the private tunnel a public control plane, so every mutation passes through the Host and gateway.

## Consequences

Users can inspect, configure, start, and reload recorder models from the existing Local Models page while secrets remain server-side. They can also change the memory-processing route without restarting DSH and see the Session identity used to isolate that work. Revision checks prevent stale tabs from overwriting a newer choice, and a failed model load leaves an explicit error. The design adds a three-hop administration path, a local secret-bearing ASR file, and a separate secret-free Host memory-route file. Online endpoints remain provider-specific deployments and require a real credential plus an inference request before provider availability is known.
