---
description: "Configure recorder ASR and CAM execution, start selected models, and inspect redacted runtime readiness from DSH Settings."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-recorder

English | [中文](README.zh.md)

## Summary

Users can choose local or online recorder transcription and speaker recognition, save a revisioned configuration, and start or reload selected models. The page separates saved configuration from active runtime state and reports ASR, CAM, and credential readiness. Online modes accept Credential references, so secret values remain outside browser state. Choose this package when a web composition exposes the Enterprise recorder controller.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Open **Recording & speech models**, save the desired ASR and CAM configuration, select **Start / reload**, and inspect the returned readiness status.

### When to choose it

Choose this package for a web composition that includes the authenticated Enterprise recorder controller and recorder administration services. Use deployment-owned environment configuration when the composition has no interactive Settings application.

### Minimal configuration

Mount the browser plugin after the shared Settings shell:

```yaml
- id: ui-settings-recorder
  name: '@deepseek-ai/dsh-client-ui-settings-recorder'
```

The plugin has no configuration fields. The Host reads `DSH_RECORDER_ADMIN_URL` and `DSH_RECORDER_ADMIN_TOKEN`; those deployment values do not cross the browser package.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The page calls the authenticated `enterpriseDevice` Remote. The Host validates fields, resolves Credential references, and sends the desired configuration through a server-only recorder administration bridge. Save changes desired configuration; Start separately loads that revision on the Mac runtime. The browser receives model selections, revisions, readiness flags, and errors without credential values.

| Area | Source |
|---|---|
| Browser registration and locale wiring | [`src/client/index.ts`](src/client/index.ts) |
| Observable operations | [`src/client/store.ts`](src/client/store.ts) |
| Settings form and status readback | [`src/client/RecorderSettingsSection.tsx`](src/client/RecorderSettingsSection.tsx) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Settings shell](../ui-settings/README.md) — owns shared navigation and the section slot.
- [Enterprise controller](../../api/enterprise-controller/README.md) — owns the authenticated recorder Remote.
- [Credential service](../../credentials/README.md) — owns online provider secret values.
- [Recorder runtime decision](../../../.agents/notes/implemented/feature/2026-09-21-recorder-runtime-settings.md) — records control-path and secret-ownership rationale.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package only registers a browser Settings section and adds no model-visible input or tool.

#### KV Cache effect

None; the package does not assemble or send model requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

The page controls deployed recorder adapters; it does not translate arbitrary vendor protocols.

- Online ASR requires an OpenAI-compatible audio transcription endpoint.
- Online CAM requires the recorder speaker-embedding JSON protocol documented by the ASR service.
- The generic online protocols define no common health route, so Start sends a one-second silence inference probe before it reports the provider ready.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The page owns one Settings registration and observable browser state; the Host and recorder services own persistence and model processes.
