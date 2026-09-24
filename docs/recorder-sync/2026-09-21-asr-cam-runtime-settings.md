# Recorder ASR and CAM runtime settings record

English | [中文](2026-09-21-asr-cam-runtime-settings.zh.md)

Date: 2026-09-21.

## Objective

Expose the ASR and CAM choices that the Mac process used to receive only from deployment configuration. Preserve server-side credential ownership, revision checks, and runtime readback.

## Changes

- Added **Recording & speech models** to Settings. ASR and CAM independently select local or online execution.
- Local configuration accepts a model id. CAM also accepts an enable switch and owner-voice match threshold.
- Online configuration submits an HTTPS endpoint and Credential reference. The DSH Host resolves the secret and never returns it to the browser.
- Added an administration path from the DSH Host through the recorder gateway to the Mac ASR process. The first hop uses a server administration token and the second uses the existing ASR token.
- The Mac writes revisioned desired configuration atomically to a mode-0600 `runtime.json`. A stale revision fails instead of overwriting a newer save.
- Save and Start are separate. Start loads candidate adapters, probes selected online providers with one second of silence, and replaces active inference objects only after every required check succeeds.
- Local ASR supports FunASR/Paraformer and faster-whisper. Local CAM supports CAM++.
- Online ASR uses an OpenAI-compatible audio transcription protocol. Online CAM uses an HTTPS JSON embedding protocol.
- The complete Mac ASR source, launch template, and tests live in `integrations/recorder-asr-service/` so runtime fixes remain under source control.

## Endpoints

The Mac ASR service adds three authenticated endpoints:

- `GET /v1/admin/runtime` returns redacted desired configuration and readiness.
- `POST /v1/admin/runtime/configure` persists configuration with `expectedRevision`.
- `POST /v1/admin/runtime/start` loads or hot-reloads saved models.

The recorder gateway proxies the same routes and requires `X-DSH-Recorder-Admin-Token`.

## Verification

- The ASR service passes 105 Python tests for persistence, redaction, revision conflicts, HTTPS enforcement, and online adapters.
- The gateway passes 9 Python tests, including exact administration-token matching.
- The DSH Settings, Remote bridge, and authorization classification pass 26 Vitest tests.

## Live validation remaining

- An online model requires a real provider HTTPS endpoint and Credential before one real audio inference can validate the provider.
- The deployed DSH, gateway, and Mac services require one browser save, start, refresh, and error-readback pass.
