import { createPrivateKey, randomUUID, sign } from 'node:crypto'
import { canonicalDeviceRequest } from '@deepseek-ai/dsh-enterprise-device-plane'
import type { QueuedDeviceAction } from '@deepseek-ai/dsh-enterprise-device-plane'
import type { DeviceActionResult } from './protocol.ts'

export interface DeviceAgentClientOptions {
  readonly server: string
  readonly deviceId: string
  readonly privateKey: string
  readonly fetch?: typeof globalThis.fetch
  readonly now?: () => number
  readonly nonce?: () => string
}

export class DeviceAgentClient {
  private readonly fetch: typeof globalThis.fetch
  private readonly now: () => number
  private readonly nonce: () => string

  constructor(private readonly options: DeviceAgentClientOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
    this.now = options.now ?? Date.now
    this.nonce = options.nonce ?? (() => randomUUID().replaceAll('-', ''))
  }

  async heartbeat(): Promise<void> {
    await this.post('/device-agent/v1/heartbeat', '')
  }

  async consumePermit(input: { runId: string; operationId: string }): Promise<boolean> {
    const response = await this.post('/device-agent/v1/permit/consume', JSON.stringify(input), false)
    return response.status === 204
  }

  consume(input: { runId: string; operationId: string; deviceId: string }): Promise<boolean> {
    return this.consumePermit(input)
  }

  async claimAction(): Promise<QueuedDeviceAction | undefined> {
    const response = await this.post('/device-agent/v1/action/claim', '')
    return response.status === 204 ? undefined : await response.json() as QueuedDeviceAction
  }

  async completeAction(result: DeviceActionResult & { readonly runId: string }): Promise<void> {
    await this.post('/device-agent/v1/action/result', JSON.stringify(result))
  }

  private async post(path: string, body: string, throwOnFailure = true): Promise<Response> {
    const timestamp = this.now()
    const nonce = this.nonce()
    const content = canonicalDeviceRequest({ method: 'POST', path, timestamp, nonce, body })
    const signature = sign(null, Buffer.from(content), createPrivateKey(this.options.privateKey)).toString('base64url')
    const response = await this.fetch(new Request(new URL(path, `${this.options.server.replace(/\/$/u, '')}/`), {
      method: 'POST', ...(body === '' ? {} : { body }),
      headers: {
        'content-type': 'application/json',
        'x-dsh-device-id': this.options.deviceId,
        'x-dsh-device-timestamp': String(timestamp),
        'x-dsh-device-nonce': nonce,
        'x-dsh-device-signature': signature,
      },
    }))
    if (throwOnFailure && !response.ok) throw new Error(`device request failed (${String(response.status)})`)
    return response
  }
}
