# Recorder local-model settings consolidation

English | [中文](2026-09-22-recorder-local-models-consolidation.zh.md)

## Delivered state

System Settings now has one **Local models** entry for the recorder pipeline. The former standalone **Recording & speech models** navigation item was removed. The Local models page contains the existing ASR and CAM controls plus a **Memory processing model** card with provider, model, timeout, and a read-only dedicated Session ID.

The dedicated Session ID is derived from the authenticated user. The live administrator page read back `recorder-memory-bootstrap-admin`. ASR remains `paraformer-zh`, CAM remains `cam++`, and both local services report ready. Memory processing is configured for provider `zai-coding-cn`, model `glm-5.3-flash`, and a 15,000 ms timeout.

## Persistence and execution

Saving the memory route writes `/root/.dsh/storages/recorder-memory-runtime.json` atomically with owner-only mode `0600`, schema version `1`, and a monotonically checked revision. The first live save produced revision `1`. The knowledge plugin reads this file before every recorder-memory batch, so later saves apply without restarting the worker. Existing environment variables remain a migration fallback only when the file does not exist.

ASR/CAM Save and Start/reload remain separate from Save memory configuration. This prevents a language-model route change from restarting the local speech services.

## Deployment and verification

- DSH source commit: `4fccf500fd46cdf01e6385bdaa393ebfd1cdbf30`
- Active 47 release: `/opt/dsh/releases/recorder-local-models-20260922-4fccf500fd`
- Knowledge plugin: `0.3.11-enterprise.15`, source commit `b3c401b`
- DSH focused verification: 5 files and 11 tests passed; full build and pre-push Host/Client typecheck passed.
- Knowledge focused verification: 13 tests, typecheck, and build passed.
- Browser verification confirmed the consolidated navigation, all three model cards, the dedicated Session ID, and the `Configuration saved` readback.
- Server readback confirmed mode `0600`, revision `1`, all three services active, and `dsh-enterprise` restart count `0` for this release.

Rollback metadata and the prior profile package remain under `/opt/dsh/backups/20260922-recorder-local-models`.
