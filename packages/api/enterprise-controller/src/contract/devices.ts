/** Authenticated Device Plane Remote contracts. */
export interface EnterpriseDevicePairRequest {
  readonly deviceName: string
  readonly platform: 'macos' | 'windows' | 'linux'
  readonly publicKey: string
}
export interface EnterpriseComputerUseStartRequest {
  readonly deviceId: string
  readonly workspaceId: string
  readonly sessionId: string
  readonly mode: 'observe' | 'confirm-each' | 'delegated'
}
export interface EnterpriseDevicePermitRequest {
  readonly deviceId: string
  readonly runId: string
  readonly operationId: string
  readonly capability: 'browser.observe' | 'browser.control' | 'desktop.observe' | 'desktop.control'
}
