# Device Plane

English | [中文](device-plane.zh.md)

DSH Device Plane separates enterprise authority from execution on a user's computer. PostgreSQL and the authenticated root Session remain the business and audit sources of truth; the local Agent is an execution endpoint only.

## Architecture

`enterpriseDevice` registers devices, starts scoped Computer Use Runs, queues typed actions, and records results. `/device-agent/v1` authenticates the local process with Ed25519 signatures and replay-protected nonces without browser cookies. `dsh-device-agent` polls the durable queue, consumes the one-time Permit immediately before execution, applies the Run confirmation policy, invokes an Adapter, and returns a bounded summary plus evidence hash. Model-created Runs default to delegated control, so actions within the already granted enterprise scope do not open a prompt for every click. Administrators can retain `confirm-each`; business, sandbox, and irreversible-action approvals remain separate.

Adapters are deliberately separate:

- Cua Driver: the primary user-PC observation and control path. It discovers visible windows, reads a bounded native accessibility snapshot, and performs locally confirmed token or coordinate actions.
- agent-browser: starts and navigates a visible isolated browser, and remains the structured-DOM fallback.
- Playwright MCP: isolated compatibility browser fallback.

Only fixed operations are accepted. Cua exposes window discovery, exact-window snapshots, element-token or coordinate clicks, text entry, and screen-size observation. Browser adapters expose open, DOM snapshot, click, and fill. The Server cannot supply arbitrary CLI arguments or local module paths. The model-facing tool directs visible user-PC work through Cua first; browser adapters bootstrap an isolated browser or provide an explicit fallback.

## Local agent

Build and start the Agent:

```bash
pnpm --filter @deepseek-ai/dsh-device-agent bundle
node apps/device-agent/lib/bin.js --server http://your-dsh-host
```

The Agent listens only on `127.0.0.1:47631`. In DSH, open **Digital employees → My devices → Connect this computer**. Reconnecting the same owner-scoped public key returns the existing device instead of creating a duplicate. Its Ed25519 private key is stored under `~/.dsh/device-agent` with owner-only permissions and is never returned by the loopback endpoint.

Browser adapters do not depend on the service account's `PATH`. The Agent launches the package-local `agent-browser` and Playwright MCP entrypoints with its own Node executable. It reuses an installed Chrome executable when available, while keeping the automation profile isolated. User-PC browser windows are visible by default so local confirmation, QR login, and takeover happen on the user's screen. Managed installations can set `DSH_DEVICE_BROWSER_EXECUTABLE` to override browser discovery or `DSH_DEVICE_BROWSER_HEADLESS=1` to explicitly opt into background execution.

Cua snapshots return a bounded accessibility tree to the Agent and deliberately omit screenshot bytes from the server result. Screen pixels, login QR codes, and unrelated desktop content therefore remain on the paired computer. Control actions require the exact process and window returned by Cua, plus either a fresh element token or screenshot-relative coordinates.

## Safety and recovery

Device, Run, Permit, nonce, action, result, and evidence metadata are durable. A Permit expires after 60 seconds and can be consumed once. Device requests expire after 60 seconds and each nonce is accepted once. A queued action can be claimed by one Agent. A claimed action is never automatically replayed after an ambiguous disconnect. If the local Cua SDK reports `session_ended`, the Agent recreates that Run's named desktop session and retries the same in-flight action once; it does not create a second Server action or consume another Permit.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxenterprisedevicecontroller--enterprisedevicecontroller"></a>

### `ctx.enterpriseDeviceController` — `EnterpriseDeviceController`

Authenticated Device Plane pairing and heartbeat service.

```ts cordis-catalog
/**
 * List devices paired to the authenticated user.
 * @param request - Device visibility filters.
 * @returns Paired devices with derived online status.
 */
@Remote('list') async list(request: EnterpriseDeviceListRequest): Promise<EnterpriseDeviceView[]>

/**
 * List recent Computer Use runs owned by the authenticated user.
 * @param request - Optional bounded result limit.
 * @returns Recent run snapshots in update order.
 */
@Remote('listRuns') async listRuns(request: EnterpriseComputerUseRunListRequest): Promise<EnterpriseComputerUseRun[]>

/**
 * List recent Computer Use actions owned by the authenticated user.
 * @param request - Optional bounded result limit.
 * @returns Recent actions and retained evidence metadata.
 */
@Remote('listActions') async listActions(request: EnterpriseDeviceActionListRequest): Promise<EnterpriseDeviceActionView[]>

/**
 * Read one action result owned by the authenticated user.
 * @param request - Stable operation lookup.
 * @returns Current action state and retained evidence metadata.
 */
@Remote('getAction') async getAction(request: EnterpriseDeviceActionLookup): Promise<EnterpriseDeviceActionView>

/**
 * Pair a local device identity with the authenticated user.
 * @param request - Local device name, platform, and public key.
 * @returns The server-assigned device identity.
 */
@Remote('pair') async pair(request: EnterpriseDevicePairRequest): Promise<{ deviceId: string }>

/** Create one ten-minute recorder binding code for the authenticated user.
 * @param request - Empty recorder-pairing request owned by the authenticated principal.
 * @returns One plaintext code and its expiry; only the hash remains durable.
 */
@Remote('createRecorderPairing') async createRecorderPairing( request: EnterpriseRecorderPairingRequest, ): Promise<EnterpriseRecorderPairingChallenge>

/** List recorder devices owned by the authenticated user.
 * @param request - Recorder status filter.
 * @returns Redacted recorder devices for the authenticated principal.
 */
@Remote('listRecorders') async listRecorders(request: EnterpriseRecorderListRequest): Promise<EnterpriseRecorderDeviceView[]>

/**
 * Refresh the online status of an owned device.
 * @param request - Owned device identity.
 */
@Remote('heartbeat') async heartbeat(request: { deviceId: string }): Promise<void>

/**
 * Start one governed Computer Use run.
 * @param request - Device, workspace, session, and confirmation mode.
 * @returns The new run identity.
 */
@Remote('startRun') async startRun(request: EnterpriseComputerUseStartRequest): Promise<{ runId: string }>

/**
 * Validate and queue one short-lived device operation action.
 * @param request - Governed adapter operation and required capability.
 * @returns The permit and queued action identities.
 */
@Remote('issuePermit') async issuePermit(request: EnterpriseDevicePermitRequest): Promise<{ permitId: string; actionId: string }>

/**
 * Consume a permit exactly once before local execution.
 * @param request - Operation ownership tuple.
 */
@Remote('consumePermit') async consumePermit(request: Pick<EnterpriseDevicePermitRequest, 'deviceId' | 'runId' | 'operationId'>): Promise<void>

/**
 * Pause, resume, or stop a Computer Use run using optimistic concurrency.
 * @param request - Target state and expected run revision.
 * @returns The transitioned run snapshot.
 */
@Remote('transitionRun') async transitionRun(request: EnterpriseComputerUseTransitionRequest): Promise<EnterpriseComputerUseRun>
```

Source: [`packages/api/enterprise-controller/src/index.ts`](../../packages/api/enterprise-controller/src/index.ts)
<!-- END GENERATED cordis-surface -->
