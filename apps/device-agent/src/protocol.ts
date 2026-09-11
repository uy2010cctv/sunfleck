import type {
  DeviceAdapterKind as AdapterKind, DeviceOperation, QueuedDeviceAction,
} from '@deepseek-ai/dsh-enterprise-device-plane'

export type { AdapterKind, DeviceOperation }
export interface DeviceAction extends QueuedDeviceAction {}
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
export interface LocalConfirmator {
  confirm(action: DeviceAction): Promise<boolean>
}
