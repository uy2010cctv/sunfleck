import { randomUUID } from 'node:crypto'

export type DeviceCapability = 'browser.observe' | 'browser.control' | 'desktop.observe' | 'desktop.control'
export type ComputerUseMode = 'observe' | 'confirm-each' | 'delegated'
export interface Device {
  deviceId: string
  orgId: string
  userId: string
  deviceName: string
  platform: 'macos'
  publicKey: string
  status: 'online' | 'offline'
}
export interface ComputerUseRun {
  runId: string
  orgId: string
  userId: string
  deviceId: string
  workspaceId: string
  sessionId: string
  mode: ComputerUseMode
  status: 'active' | 'paused' | 'stopped'
}
export interface OperationPermit {
  permitId: string
  orgId: string
  userId: string
  deviceId: string
  runId: string
  operationId: string
  capability: DeviceCapability
  consumed: boolean
}

export class InMemoryDevicePlaneRepository {
  readonly devices = new Map<string, Device>()
  readonly runs = new Map<string, ComputerUseRun>()
  readonly permits = new Map<string, OperationPermit>()
}

export class DevicePlaneService {
  constructor(private readonly repository: InMemoryDevicePlaneRepository, private readonly now: () => number = Date.now) {}
  async pair(input: Omit<Device, 'deviceId' | 'status'>): Promise<Device> {
    const value: Device = { ...input, deviceId: `device-${randomUUID()}`, status: 'online' }
    this.repository.devices.set(value.deviceId, value)
    return value
  }
  async start(input: Omit<ComputerUseRun, 'runId' | 'status'>): Promise<ComputerUseRun> {
    const device = this.repository.devices.get(input.deviceId)
    if (device === undefined || device.orgId !== input.orgId || device.userId !== input.userId) throw new Error('device principal mismatch')
    const value: ComputerUseRun = { ...input, runId: `computer-use-${randomUUID()}`, status: 'active' }
    this.repository.runs.set(value.runId, value)
    return value
  }
  async issuePermit(input: Omit<OperationPermit, 'permitId' | 'consumed'>): Promise<OperationPermit> {
    const run = this.requireRun(input)
    if (run.status !== 'active') throw new Error('computer use run is not active')
    const value: OperationPermit = { ...input, permitId: `permit-${this.now()}-${randomUUID()}`, consumed: false }
    this.repository.permits.set(value.operationId, value)
    return value
  }
  async consumePermit(input: Pick<OperationPermit, 'orgId' | 'userId' | 'deviceId' | 'runId' | 'operationId'>): Promise<void> {
    const permit = this.repository.permits.get(input.operationId)
    if (permit === undefined) throw new Error('operation permit is missing')
    if (permit.orgId !== input.orgId || permit.userId !== input.userId || permit.deviceId !== input.deviceId || permit.runId !== input.runId) throw new Error('operation permit principal mismatch')
    if (permit.consumed) throw new Error('operation permit is already consumed')
    permit.consumed = true
  }
  private requireRun(input: Pick<OperationPermit, 'orgId' | 'userId' | 'deviceId' | 'runId'>): ComputerUseRun {
    const run = this.repository.runs.get(input.runId)
    if (run === undefined || run.orgId !== input.orgId || run.userId !== input.userId || run.deviceId !== input.deviceId) throw new Error('computer use run principal mismatch')
    return run
  }
}
