import { verifyDeviceSignature } from '@deepseek-ai/dsh-enterprise-device-plane'
import type { Device, OperationPermit, QueuedDeviceAction } from '@deepseek-ai/dsh-enterprise-device-plane'

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
}

const MAX_BODY_BYTES = 64 * 1024

function error(status: number, code: string): Response {
  return Response.json({ error: code }, { status })
}

/** Signed HTTP boundary used only by paired local Device Agents. */
export class DeviceAgentHttpHandler {
  constructor(private readonly repository: DeviceAgentRepository, private readonly now: () => number = Date.now) {}

  /**
   * Authenticate, replay-protect, and dispatch one Device Agent request.
   * @param request - Signed HTTP request from a paired local Agent.
   * @returns Bounded protocol response without secret device material.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return error(405, 'method-not-allowed')
    const body = await request.text()
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) return error(413, 'payload-too-large')
    const deviceId = request.headers.get('x-dsh-device-id') ?? ''
    const nonce = request.headers.get('x-dsh-device-nonce') ?? ''
    const signature = request.headers.get('x-dsh-device-signature') ?? ''
    const timestamp = Number(request.headers.get('x-dsh-device-timestamp'))
    const device = await this.repository.device(deviceId)
    if (device === undefined || device.status === 'revoked') return error(401, 'device-authentication-failed')
    const path = new URL(request.url).pathname
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
}
