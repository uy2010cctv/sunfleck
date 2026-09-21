/** Authenticated Device Plane Remote contracts. */
/** Supported local execution backends. */
export type EnterpriseDeviceAdapterKind = 'cua' | 'agent-browser' | 'playwright-mcp'
/** Closed operation vocabulary accepted from authenticated browser clients. */
export type EnterpriseDeviceOperation =
  | { readonly kind: 'browser.open'; readonly url: string }
  | { readonly kind: 'browser.snapshot' }
  | { readonly kind: 'browser.click'; readonly selector: string }
  | { readonly kind: 'browser.fill'; readonly selector: string; readonly value: string }
  | { readonly kind: 'desktop.screen-size' }
  | { readonly kind: 'desktop.windows' }
  | { readonly kind: 'desktop.snapshot'; readonly pid: number; readonly windowId: number }
  | { readonly kind: 'desktop.click'; readonly pid: number; readonly windowId: number; readonly elementToken?: string; readonly x?: number; readonly y?: number }
  | { readonly kind: 'desktop.type'; readonly pid: number; readonly windowId: number; readonly elementToken: string; readonly text: string }
/** Public identity supplied by the loopback Device Agent during pairing. */
export interface EnterpriseDevicePairRequest {
  readonly deviceName: string
  readonly platform: 'macos' | 'windows' | 'linux'
  readonly publicKey: string
}
/** Redacted device status safe for the ordinary user interface. */
export interface EnterpriseDeviceView {
  readonly deviceId: string
  readonly deviceName: string
  readonly kind?: 'computer' | 'recorder'
  readonly platform: 'macos' | 'windows' | 'linux' | 'recorder'
  readonly status: 'online' | 'offline' | 'revoked'
  readonly lastHeartbeatAt?: number
}
/** Filters for the authenticated user's paired devices. */
export interface EnterpriseDeviceListRequest { readonly includeRevoked?: boolean }
/** Starts one short-lived recorder pairing ceremony for the authenticated user. */
export interface EnterpriseRecorderPairingRequest {}
/** Secret-free recorder pairing challenge shown once to the authenticated user. */
export interface EnterpriseRecorderPairingChallenge {
  readonly pairingId: string
  readonly code: string
  readonly expiresAt: number
}
/** Redacted recorder device projection owned by the authenticated user. */
export interface EnterpriseRecorderDeviceView {
  readonly recorderId: string
  readonly deviceName: string
  readonly status: 'active' | 'revoked'
  readonly lastSeenAt?: number
}
/** Filters for the authenticated user's recorder devices. */
export interface EnterpriseRecorderListRequest { readonly includeRevoked?: boolean }
/** Runtime source selected for one recorder model capability. */
export type EnterpriseRecorderModelMode = 'local' | 'online'
/** Explicit ASR model configuration with only a Credential reference crossing the browser boundary. */
export interface EnterpriseRecorderAsrConfig {
  readonly mode: EnterpriseRecorderModelMode
  readonly model: string
  readonly endpoint?: string
  readonly credentialRef?: string
}
/** Explicit speaker model configuration. */
export interface EnterpriseRecorderCamConfig {
  readonly enabled: boolean
  readonly mode: EnterpriseRecorderModelMode
  readonly model: string
  readonly endpoint?: string
  readonly credentialRef?: string
  readonly matchThreshold: number
}
/** Saved recorder inference configuration. */
export interface EnterpriseRecorderRuntimeConfig {
  readonly revision: number
  readonly asr: EnterpriseRecorderAsrConfig
  readonly cam: EnterpriseRecorderCamConfig
}
/** Readable runtime status after a real health check. */
export interface EnterpriseRecorderRuntimeView extends EnterpriseRecorderRuntimeConfig {
  /** Revision loaded by the active model process; omitted before the first successful start. */
  readonly activeRevision?: number
  readonly state: 'stopped' | 'starting' | 'running' | 'error'
  readonly asrReady: boolean
  readonly camReady: boolean
  readonly credentialReady: boolean
  readonly error?: string
  readonly checkedAt: number
}
/** Optimistic recorder runtime configuration write. */
export interface EnterpriseRecorderRuntimeSaveRequest {
  readonly expectedRevision: number
  readonly asr: EnterpriseRecorderAsrConfig
  readonly cam: EnterpriseRecorderCamConfig
}
/** Empty recorder runtime lookup/start request. */
export interface EnterpriseRecorderRuntimeRequest {}
/** Bounded recent-run request. */
export interface EnterpriseComputerUseRunListRequest { readonly limit?: number }
/** Bounded recent-action request. */
export interface EnterpriseDeviceActionListRequest { readonly limit?: number }
/** Starts a user-owned run bound to one device, Workspace, and Session. */
export interface EnterpriseComputerUseStartRequest {
  readonly deviceId: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly mode: 'observe' | 'confirm-each' | 'delegated'
}
/** One typed action submitted for policy validation and durable queueing. */
export interface EnterpriseDevicePermitRequest {
  readonly deviceId: string
  readonly runId: string
  readonly operationId: string
  readonly capability: 'browser.observe' | 'browser.control' | 'desktop.observe' | 'desktop.control'
  readonly adapter: EnterpriseDeviceAdapterKind
  readonly operation: EnterpriseDeviceOperation
}
/** Optimistic state transition for a user-owned run. */
export interface EnterpriseComputerUseTransitionRequest {
  readonly runId: string
  readonly state: 'active' | 'paused' | 'stopped'
  readonly expectedRevision: number
}
/** Stable operation lookup owned by the authenticated user. */
export interface EnterpriseDeviceActionLookup { readonly operationId: string }
/** Redacted Computer Use run snapshot returned to the user interface. */
export interface EnterpriseComputerUseRun {
  readonly runId: string
  readonly orgId: string
  readonly userId: string
  readonly deviceId: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly mode: 'observe' | 'confirm-each' | 'delegated'
  readonly status: 'active' | 'paused' | 'stopped' | 'failed'
  readonly revision?: number
  readonly createdAt?: number
  readonly updatedAt?: number
}
/** Readable action state with retained evidence metadata but no screen payload. */
export interface EnterpriseDeviceActionView {
  readonly actionId: string
  readonly operationId: string
  readonly runId: string
  readonly deviceId: string
  readonly capability: 'browser.observe' | 'browser.control' | 'desktop.observe' | 'desktop.control'
  readonly adapter: EnterpriseDeviceAdapterKind
  readonly operation: EnterpriseDeviceOperation
  readonly state: 'pending' | 'claimed' | 'completed' | 'rejected' | 'paused' | 'failed' | 'unknown'
  readonly summary?: string
  readonly evidenceHash?: string
  readonly createdAt: number
  readonly updatedAt: number
}
