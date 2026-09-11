import { randomUUID } from 'node:crypto'

export { PostgresDevicePlaneRepository } from './postgres.ts'
export { canonicalDeviceRequest, normalizeDevicePublicKey, verifyDeviceSignature } from './signature.ts'
export type { DeviceRequestContent } from './signature.ts'
export { validateQueuedDeviceAction } from './policy.ts'

/** Capability checked independently for each queued action. */
export type DeviceCapability = 'browser.observe' | 'browser.control' | 'desktop.observe' | 'desktop.control'
/** Local adapter selected for one fixed operation. */
export type DeviceAdapterKind = 'cua' | 'agent-browser' | 'playwright-mcp'
/** Closed, serializable operation vocabulary accepted by the Device Agent. */
export type DeviceOperation =
  | { readonly kind: 'browser.open'; readonly url: string }
  | { readonly kind: 'browser.snapshot' }
  | { readonly kind: 'browser.click'; readonly selector: string }
  | { readonly kind: 'browser.fill'; readonly selector: string; readonly value: string }
  | { readonly kind: 'desktop.screen-size' }
/** User-visible confirmation policy fixed for a Computer Use run. */
export type ComputerUseMode = 'observe' | 'confirm-each' | 'delegated'
/** Server-owned paired device record containing only its public identity. */
export interface Device {
  deviceId: string
  orgId: string
  userId: string
  deviceName: string
  platform: 'macos' | 'windows' | 'linux'
  publicKey: string
  status: 'online' | 'offline' | 'revoked'
  lastHeartbeatAt?: number
  createdAt?: number
  updatedAt?: number
}
/** Governed execution scope binding a user device to a Workspace and Session. */
export interface ComputerUseRun {
  runId: string
  orgId: string
  userId: string
  deviceId: string
  workspaceId: string
  sessionId: string
  mode: ComputerUseMode
  status: 'active' | 'paused' | 'stopped' | 'failed'
  revision?: number
  createdAt?: number
  updatedAt?: number
}
/** Single-use authorization for one typed operation. */
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
/** Durable action payload claimed by exactly one local Device Agent. */
export interface QueuedDeviceAction {
  readonly actionId: string
  readonly operationId: string
  readonly runId: string
  readonly deviceId: string
  readonly capability: DeviceCapability
  readonly adapter: DeviceAdapterKind
  readonly operation: DeviceOperation
}
/** Durable action projection safe for user-facing history and audit. */
export interface DeviceActionView extends QueuedDeviceAction {
  readonly state: 'pending' | 'claimed' | 'completed' | 'rejected' | 'paused' | 'failed' | 'unknown'
  readonly summary?: string
  readonly evidenceHash?: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** Minimal repository used by unit tests for core permit invariants. */
export class InMemoryDevicePlaneRepository {
  /** Paired devices keyed by server-assigned identity. */
  readonly devices = new Map<string, Device>()
  /** Computer Use runs keyed by run identity. */
  readonly runs = new Map<string, ComputerUseRun>()
  /** Operation permits keyed by permit identity. */
  readonly permits = new Map<string, OperationPermit>()
}

/** Core in-memory service used to validate pairing and permit ownership rules. */
export class DevicePlaneService {
  constructor(private readonly repository: InMemoryDevicePlaneRepository, private readonly now: () => number = Date.now) {}
  /** Pair one public device identity and return its server-owned record.
   * @param input - Owner scope, display name, platform, and public key.
   * @returns paired server-owned device.
   */
  async pair(input: Omit<Device, 'deviceId' | 'status'>): Promise<Device> {
    const value: Device = { ...input, deviceId: `device-${randomUUID()}`, status: 'online' }
    this.repository.devices.set(value.deviceId, value)
    return value
  }
  /** Start one run after verifying device ownership.
   * @param input - Device, Workspace, Session, user, and confirmation mode.
   * @returns active scoped run.
   */
  async start(input: Omit<ComputerUseRun, 'runId' | 'status'>): Promise<ComputerUseRun> {
    const device = this.repository.devices.get(input.deviceId)
    if (device === undefined || device.orgId !== input.orgId || device.userId !== input.userId) throw new Error('device principal mismatch')
    const value: ComputerUseRun = { ...input, runId: `computer-use-${randomUUID()}`, status: 'active' }
    this.repository.runs.set(value.runId, value)
    return value
  }
  /** Issue one unconsumed permit bound to the supplied run and operation.
   * @param input - Run ownership and requested capability tuple.
   * @returns newly issued permit.
   */
  async issuePermit(input: Omit<OperationPermit, 'permitId' | 'consumed'>): Promise<OperationPermit> {
    const run = this.requireRun(input)
    if (run.status !== 'active') throw new Error('computer use run is not active')
    const value: OperationPermit = { ...input, permitId: `permit-${this.now()}-${randomUUID()}`, consumed: false }
    this.repository.permits.set(value.operationId, value)
    return value
  }
  /** Consume one permit once when every ownership field matches.
   * @param input - Exact operation ownership tuple.
   */
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
