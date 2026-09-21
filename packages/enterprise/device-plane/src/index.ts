import { createHash, randomInt, randomUUID } from 'node:crypto'

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
  | { readonly kind: 'desktop.windows' }
  | { readonly kind: 'desktop.snapshot'; readonly pid: number; readonly windowId: number }
  | { readonly kind: 'desktop.click'; readonly pid: number; readonly windowId: number; readonly elementToken?: string; readonly x?: number; readonly y?: number }
  | { readonly kind: 'desktop.type'; readonly pid: number; readonly windowId: number; readonly elementToken: string; readonly text: string }
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
/** Short-lived owner scope created by an authenticated user for recorder enrollment. */
export interface RecorderPairingChallenge {
  pairingId: string
  orgId: string
  userId: string
  codeHash: string
  expiresAt: number
  consumedAt?: number
}
/** Recorder identity owned by one enterprise user and authenticated through its Android relay. */
export interface RecorderDevice {
  recorderId: string
  orgId: string
  userId: string
  deviceName: string
  recorderSerial: string
  relayPublicKey: string
  status: 'active' | 'revoked'
  lastSeenAt?: number
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
  /** Run-level local confirmation policy joined by the Server when the Agent claims the action. */
  readonly confirmationMode?: ComputerUseMode
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
  /** Recorder pairing challenges keyed by opaque server identity. */
  readonly recorderPairings = new Map<string, RecorderPairingChallenge>()
  /** Recorder bindings retained separately from Computer Use devices. */
  readonly recorders: RecorderDevice[] = []
}

/** Core in-memory service used to validate pairing and permit ownership rules. */
export class DevicePlaneService {
  constructor(
    private readonly repository: InMemoryDevicePlaneRepository,
    private readonly now: () => number = Date.now,
    private readonly pairingCode: () => string = () => String(randomInt(0, 1_000_000)).padStart(6, '0'),
  ) {}
  /** Pair one public device identity and return its server-owned record.
   * @param input - Owner scope, display name, platform, and public key.
   * @returns paired server-owned device.
   */
  async pair(input: Omit<Device, 'deviceId' | 'status'>): Promise<Device> {
    const value: Device = { ...input, deviceId: `device-${randomUUID()}`, status: 'online' }
    this.repository.devices.set(value.deviceId, value)
    return value
  }
  /** Create one ten-minute recorder binding code scoped to the authenticated owner. */
  async createRecorderPairing(input: { orgId: string; userId: string }): Promise<{
    pairingId: string
    code: string
    expiresAt: number
  }> {
    const code = this.pairingCode()
    if (!/^\d{6}$/u.test(code)) throw new Error('recorder pairing code must contain six digits')
    const pairingId = `recorder-pairing-${randomUUID()}`
    const expiresAt = this.now() + 10 * 60_000
    this.repository.recorderPairings.set(pairingId, {
      pairingId, orgId: input.orgId, userId: input.userId,
      codeHash: createHash('sha256').update(code).digest('hex'), expiresAt,
    })
    return { pairingId, code, expiresAt }
  }
  /** Consume one recorder code and bind the card to the code's server-owned user scope. */
  async bindRecorder(input: {
    pairingId: string
    code: string
    recorderSerial: string
    relayPublicKey: string
    deviceName: string
  }): Promise<RecorderDevice> {
    const challenge = this.repository.recorderPairings.get(input.pairingId)
    if (challenge === undefined) throw new Error('recorder pairing is missing')
    if (challenge.consumedAt !== undefined) throw new Error('recorder pairing is already consumed')
    if (challenge.expiresAt < this.now()) throw new Error('recorder pairing is expired')
    const codeHash = createHash('sha256').update(input.code).digest('hex')
    if (codeHash !== challenge.codeHash) throw new Error('recorder pairing code is invalid')
    const recorderSerial = input.recorderSerial.trim().toUpperCase()
    const relayPublicKey = input.relayPublicKey.trim()
    const deviceName = input.deviceName.trim()
    if (recorderSerial === '' || recorderSerial.length > 200) throw new Error('recorder serial must contain 1 to 200 characters')
    if (relayPublicKey === '') throw new Error('recorder relay public key is required')
    if (deviceName === '' || deviceName.length > 120) throw new Error('recorder name must contain 1 to 120 characters')
    const existing = this.repository.recorders.find(recorder => recorder.recorderSerial === recorderSerial && recorder.status === 'active')
    if (existing !== undefined && (existing.orgId !== challenge.orgId || existing.userId !== challenge.userId)) {
      throw new Error('recorder is already bound to another user')
    }
    challenge.consumedAt = this.now()
    if (existing !== undefined) return existing
    const recorder: RecorderDevice = {
      recorderId: `recorder-${randomUUID()}`, orgId: challenge.orgId, userId: challenge.userId,
      deviceName, recorderSerial, relayPublicKey, status: 'active', lastSeenAt: this.now(),
    }
    this.repository.recorders.push(recorder)
    return recorder
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
