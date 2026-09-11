export type AdapterKind = 'cua' | 'agent-browser' | 'playwright-mcp'
export interface DeviceAction {
  readonly operationId: string
  readonly runId: string
  readonly deviceId: string
  readonly capability: 'browser.observe' | 'browser.control' | 'desktop.observe' | 'desktop.control'
  readonly adapter: AdapterKind
  readonly payload: Readonly<Record<string, unknown>>
}
export interface DeviceActionResult {
  readonly operationId: string
  readonly state: 'completed' | 'rejected' | 'paused' | 'failed'
  readonly summary: string
  readonly evidenceHash?: string
}
export interface PermitConsumer {
  consume(action: Pick<DeviceAction, 'operationId' | 'runId' | 'deviceId'>): Promise<boolean>
}
export interface DeviceAdapter {
  readonly kind: AdapterKind
  execute(action: DeviceAction, signal: AbortSignal): Promise<DeviceActionResult>
}
