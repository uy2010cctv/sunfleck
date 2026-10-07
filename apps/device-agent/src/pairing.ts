import type { LocalDeviceStatus } from './status.ts'

/** Public identity and connection persistence for one configured DSH origin. */
export interface LocalPairingOptions {
  readonly serverOrigin: string
  readonly publicKey: string
  readonly deviceName: string
  readonly platform: 'macos' | 'windows' | 'linux'
  readonly challenge: string
  readonly complete: (deviceId: string) => Promise<void>
  readonly status?: () => Promise<LocalDeviceStatus>
}

/** Origin-restricted loopback pairing with idempotent completion for one device. */
export class LocalPairingHandler {
  private completion: { readonly deviceId: string; readonly result: Promise<boolean> } | undefined
  constructor(private readonly options: LocalPairingOptions) {}

  /**
   * Complete matching requests once; failed persistence remains retryable.
   * @param request Loopback identity, preflight, or pairing completion request.
   * @returns CORS response restricted to the configured server origin.
   */
  async fetch(request: Request): Promise<Response> {
    const origin = request.headers.get('origin')
    if (origin !== this.options.serverOrigin) return new Response(null, { status: 403 })
    const headers = {
      'access-control-allow-origin': this.options.serverOrigin,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-private-network': 'true',
      'vary': 'Origin',
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    const path = new URL(request.url).pathname
    if (request.method === 'GET' && path === '/v1/status') {
      try {
        if (this.options.status !== undefined) return Response.json(await this.options.status(), { headers })
      } catch (error) {
        // Diagnostics never return native errors, local paths, or identity material.
        void error
      }
      return Response.json({ error: 'diagnostics_unavailable' }, { status: 503, headers })
    }
    if (request.method === 'GET' && path === '/v1/identity') {
      return Response.json({
        publicKey: this.options.publicKey, deviceName: this.options.deviceName,
        platform: this.options.platform, challenge: this.options.challenge,
      }, { headers })
    }
    if (request.method === 'POST' && path === '/v1/complete') {
      if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
        return new Response(null, { status: 415, headers })
      }
      let value: unknown
      try { value = await request.json() } catch { return new Response(null, { status: 400, headers }) }
      if (typeof value !== 'object' || value === null) return new Response(null, { status: 400, headers })
      const record = value as Record<string, unknown>
      if (record['challenge'] !== this.options.challenge || typeof record['deviceId'] !== 'string') {
        return new Response(null, { status: 400, headers })
      }
      const deviceId = record['deviceId']
      if (this.completion !== undefined && this.completion.deviceId !== deviceId) {
        return Response.json({ error: 'pairing_device_conflict' }, { status: 409, headers })
      }
      const completion = this.completion ?? {
        deviceId,
        result: Promise.resolve().then(() => this.options.complete(deviceId)).then(
          () => true,
          () => false,
        ),
      }
      this.completion = completion
      if (await completion.result) return new Response(null, { status: 204, headers })
      if (this.completion === completion) this.completion = undefined
      return Response.json({ error: 'pairing_completion_failed' }, { status: 503, headers })
    }
    return new Response(null, { status: 404, headers })
  }
}
