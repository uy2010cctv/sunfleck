import { createHash, createHmac, randomBytes } from 'node:crypto'
import { timingSafeTokenMatches } from './http.ts'
import { verifyDeviceSignature } from '@deepseek-ai/dsh-enterprise-device-plane'
import type {
  Device, OperationPermit, QueuedDeviceAction, RecorderDevice, RecorderPairingChallenge,
} from '@deepseek-ai/dsh-enterprise-device-plane'

interface DeviceAgentRepository {
  device(deviceId: string): Promise<Device | undefined>
  claimNonce(deviceId: string, nonce: string, expiresAt: number): Promise<boolean>
  heartbeat(device: Device): Promise<void>
  consumePermit(input: Pick<OperationPermit, 'orgId' | 'userId' | 'deviceId' | 'runId' | 'operationId'>): Promise<boolean>
  claimAction(device: Device): Promise<QueuedDeviceAction | undefined>
  completeAction(input: {
    device: Device
    runId: string
    operationId: string
    state: 'completed' | 'rejected' | 'paused' | 'failed'
    summary: string
    evidenceHash?: string
  }): Promise<boolean>
  consumeRecorderPairing?(pairingId: string, codeHash: string): Promise<RecorderPairingChallenge | undefined>
  pairRecorder?(recorder: RecorderDevice, serialHash: string, credentialHash: string): Promise<RecorderDevice | undefined>
}

const MAX_BODY_BYTES = 64 * 1024

function error(status: number, code: string): Response {
  return Response.json({ error: code }, { status })
}

interface RecorderBindingOptions {
  readonly recorderBindingToken: string | undefined
  readonly serialHmacKey: string | undefined
  readonly credentialHmacKey: string | undefined
}

/** Signed HTTP boundary used only by paired local Device Agents. */
export class DeviceAgentHttpHandler {
  constructor(
    private readonly repository: DeviceAgentRepository,
    private readonly now: () => number = Date.now,
    private readonly recorder: RecorderBindingOptions = {
      recorderBindingToken: process.env['DSH_RECORDER_BINDING_TOKEN'],
      serialHmacKey: process.env['DSH_RECORDER_SERIAL_HMAC_KEY'],
      credentialHmacKey: process.env['DSH_RECORDER_CREDENTIAL_HMAC_KEY'],
    },
  ) {}

  /**
   * Authenticate, replay-protect, and dispatch one Device Agent request.
   * @param request - Signed HTTP request from a paired local Agent.
   * @returns Bounded protocol response without secret device material.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return error(405, 'method-not-allowed')
    const body = await request.text()
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return error(413, 'payload-too-large')
    const path = new URL(request.url).pathname
    if (path === '/device-agent/v1/recorder/bind') return this.bindRecorder(request, body)
    const deviceId = request.headers.get('x-dsh-device-id') ?? ''
    const nonce = request.headers.get('x-dsh-device-nonce') ?? ''
    const signature = request.headers.get('x-dsh-device-signature') ?? ''
    const timestamp = Number(request.headers.get('x-dsh-device-timestamp'))
    const device = await this.repository.device(deviceId)
    if (device === undefined || device.status === 'revoked') return error(401, 'device-authentication-failed')
    if (!verifyDeviceSignature({
      method: request.method, path, timestamp, nonce, body,
      publicKey: device.publicKey, signature, now: this.now(),
    })) return error(401, 'device-authentication-failed')
    if (!(await this.repository.claimNonce(deviceId, nonce, this.now() + 120_000))) {
      return error(401, 'device-request-replayed')
    }
    if (path === '/device-agent/v1/heartbeat') {
      await this.repository.heartbeat({ ...device, status: 'online' })
      return new Response(null, { status: 204 })
    }
    if (path === '/device-agent/v1/permit/consume') {
      let payload: unknown
      try { payload = JSON.parse(body) } catch { return error(400, 'invalid-json') }
      if (typeof payload !== 'object' || payload === null) return error(400, 'invalid-payload')
      const record = payload as Record<string, unknown>
      if (typeof record['runId'] !== 'string' || typeof record['operationId'] !== 'string') {
        return error(400, 'invalid-payload')
      }
      const consumed = await this.repository.consumePermit({
        orgId: device.orgId, userId: device.userId, deviceId,
        runId: record['runId'], operationId: record['operationId'],
      })
      return consumed ? new Response(null, { status: 204 }) : error(409, 'permit-unavailable')
    }
    if (path === '/device-agent/v1/action/claim') {
      const action = await this.repository.claimAction(device)
      return action === undefined ? new Response(null, { status: 204 }) : Response.json(action)
    }
    if (path === '/device-agent/v1/action/result') {
      let payload: unknown
      try { payload = JSON.parse(body) } catch { return error(400, 'invalid-json') }
      if (typeof payload !== 'object' || payload === null) return error(400, 'invalid-payload')
      const record = payload as Record<string, unknown>
      const state = record['state']
      const evidenceHash = record['evidenceHash']
      if (typeof record['runId'] !== 'string' || typeof record['operationId'] !== 'string'
        || typeof record['summary'] !== 'string' || record['summary'].length > 4096
        || !['completed', 'rejected', 'paused', 'failed'].includes(String(state))
        || (evidenceHash !== undefined && (typeof evidenceHash !== 'string' || !/^[a-f\d]{64}$/u.test(evidenceHash)))) {
        return error(400, 'invalid-payload')
      }
      const completed = await this.repository.completeAction({
        device, runId: record['runId'], operationId: record['operationId'],
        state: state as 'completed' | 'rejected' | 'paused' | 'failed', summary: record['summary'],
        ...(typeof evidenceHash === 'string' ? { evidenceHash } : {}),
      })
      return completed ? new Response(null, { status: 204 }) : error(409, 'action-not-claimed')
    }
    return error(404, 'not-found')
  }

  private async bindRecorder(request: Request, body: string): Promise<Response> {
    if (!timingSafeTokenMatches(request.headers.get('x-dsh-recorder-binding-token'), this.recorder.recorderBindingToken)) {
      return error(401, 'recorder-binding-authentication-failed')
    }
    if (!this.recorder.serialHmacKey || !this.recorder.credentialHmacKey
      || this.repository.consumeRecorderPairing === undefined || this.repository.pairRecorder === undefined) {
      return error(503, 'recorder-binding-unavailable')
    }
    let payload: unknown
    try { payload = JSON.parse(body) } catch { return error(400, 'invalid-json') }
    if (typeof payload !== 'object' || payload === null) return error(400, 'invalid-payload')
    const value = payload as Record<string, unknown>
    const code = typeof value['code'] === 'string' ? value['code'].trim() : ''
    const recorderSerial = typeof value['recorderSerial'] === 'string' ? value['recorderSerial'].trim().toUpperCase() : ''
    const relayPublicKey = typeof value['relayPublicKey'] === 'string' ? value['relayPublicKey'].trim() : ''
    const deviceName = typeof value['deviceName'] === 'string' ? value['deviceName'].trim() : ''
    if (!/^\d{6}$/u.test(code) || !recorderSerial || recorderSerial.length > 200
      || !relayPublicKey || relayPublicKey.length > 4096 || !deviceName || deviceName.length > 120) {
      return error(400, 'invalid-payload')
    }
    const codeHash = createHash('sha256').update(code).digest('hex')
    const challenge = await this.repository.consumeRecorderPairing('', codeHash)
    if (challenge === undefined) return error(409, 'recorder-pairing-unavailable')
    const credential = randomBytes(32).toString('base64url')
    const serialHash = createHmac('sha256', this.recorder.serialHmacKey).update(recorderSerial).digest('hex')
    const credentialHash = createHmac('sha256', this.recorder.credentialHmacKey).update(credential).digest('hex')
    const recorder = await this.repository.pairRecorder({
      recorderId: `recorder-${randomBytes(16).toString('hex')}`,
      orgId: challenge.orgId, userId: challenge.userId, deviceName,
      recorderSerial, relayPublicKey, status: 'active', lastSeenAt: this.now(),
    }, serialHash, credentialHash)
    if (recorder === undefined) return error(409, 'recorder-owned-by-another-user')
    return Response.json({
      recorderId: recorder.recorderId, credential,
      orgId: challenge.orgId, userId: challenge.userId,
    })
  }
}
