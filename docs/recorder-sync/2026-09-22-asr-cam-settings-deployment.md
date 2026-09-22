# ASR and CAM settings deployment

English | [中文](2026-09-22-asr-cam-settings-deployment.zh.md)

## Delivered state

The 47 Host now runs release `/opt/dsh/releases/recorder-runtime-settings-20260922-afdc090500` from source commit `afdc0905001b2681cb1af3ce26942a15e89e9ff9`. Settings includes the explicit **Recording & speech models** section with local and online choices for ASR and CAM, model fields, online endpoint and Credential reference fields, the owner-match threshold, and separate Save, Start/reload, and Refresh actions.

The deployed local runtime reports ASR model `paraformer-zh`, CAM model `cam++`, owner-match threshold `0.72`, and ready state for both models. The browser Start/reload action completed and the page read back `Running · v1`, `ASR Ready`, and `CAM Ready`. Online-mode fields were rendered for both model types without saving the temporary selection, so the active configuration remains local.

## Deployment and credentials

The release archive contained only Git-tracked source and verified build outputs; `.env`, `.git`, untracked files, and local credentials were excluded. The recorder gateway was updated from the same release. ASR and recorder-administration tokens were rotated across the Mac launchd service, the 47 gateway, and the DSH enterprise environment without recording token values. Temporary token files were removed and the prior ASR token was scrubbed from the backups created by this deployment.

Backups and rollback metadata live under `/opt/dsh/backups/20260922-asr-cam-settings`. The previous release path is recorded in `previous-release`; rollback switches `/opt/dsh/current` to that path, restores the saved gateway source and environment files, and restarts `recorder-gateway`, `recorder-memory-worker`, and `dsh-enterprise`. The old ASR token is intentionally unavailable after rotation, so rollback must keep the current rotated ASR token in both the gateway and Mac launchd configuration.

## Verification

- Recorder settings UI and Host bridge: 8 focused Vitest cases passed.
- Recorder ASR service: 107 Python tests passed in the service virtual environment.
- Recorder gateway: 9 Python tests passed.
- Employee identity regression: 25 focused Agent Preset and enterprise-controller tests passed.
- Full DSH/Web build and the pre-push host/client typecheck passed.
- Live readback through the Mac service and the 47 gateway reported both ASR and CAM ready with local credentials satisfied.
- `dsh-enterprise`, `recorder-gateway`, `recorder-memory-worker`, Nginx, and PostgreSQL were active after deployment.

The first DSH start hit the existing client-module injection ordering race (`webServer` was not yet injected); systemd restarted it once and the second start remained active. This deployment records that restart instead of treating a final active process as proof that startup was clean.
