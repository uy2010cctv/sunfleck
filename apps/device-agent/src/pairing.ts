export interface LocalPairingOptions {
  readonly serverOrigin: string
  readonly publicKey: string
  readonly deviceName: string
  readonly platform: 'macos' | 'windows' | 'linux'
  readonly challenge: string
  readonly complete: (deviceId: string) => Promise<void>
}

export class LocalPairingHandler {
  private completed = false
  constructor(private readonly options: LocalPairingOptions) {}

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
    if (request.method === 'GET' && path === '/v1/identity') {
      return Response.json({
        publicKey: this.options.publicKey, deviceName: this.options.deviceName,
        platform: this.options.platform, challenge: this.options.challenge,
      }, { headers })
    }
    if (request.method === 'POST' && path === '/v1/complete') {
      if (this.completed) return new Response(null, { status: 409, headers })
      let value: unknown
      try { value = await request.json() } catch { return new Response(null, { status: 400, headers }) }
      if (typeof value !== 'object' || value === null) return new Response(null, { status: 400, headers })
      const record = value as Record<string, unknown>
      if (record['challenge'] !== this.options.challenge || typeof record['deviceId'] !== 'string') {
        return new Response(null, { status: 400, headers })
      }
      await this.options.complete(record['deviceId'])
      this.completed = true
      return new Response(null, { status: 204, headers })
    }
    return new Response(null, { status: 404, headers })
  }
}
