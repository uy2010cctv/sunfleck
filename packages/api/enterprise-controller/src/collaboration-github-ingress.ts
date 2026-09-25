/** GitHub signature verification with durable channel workflow acknowledgement. */
import { Webhooks } from '@octokit/webhooks'

/** Configured, Host-owned GitHub ingress dependencies. */
export interface ChannelGitHubIngressOptions {
  readonly source: string
  readonly maxBodyBytes: number
  resolveSecret(): Promise<string | undefined>
  handle(delivery: { readonly kind: 'github'
    readonly source: string
    readonly deliveryId: string
    readonly event: { readonly name: string
      readonly payload: Record<string, unknown> }
    readonly receivedAt: number }): Promise<number>
}

async function boundedBody(request: Request, maxBytes: number): Promise<string> {
  const reader = request.body?.getReader()
  if (reader === undefined) throw new Error('missing webhook body')
  const parts: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > maxBytes) throw new RangeError('webhook body too large')
      parts.push(next.value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/** Acknowledge only after verified provider content is persisted and routed. */
export class ChannelGitHubIngress {
  /** @param options - Secret reference resolution, raw body bound, and durable bridge. */
  constructor(private readonly options: ChannelGitHubIngressOptions) {
    if (options.source.trim() === '' || !Number.isSafeInteger(options.maxBodyBytes)
      || options.maxBodyBytes < 1) throw new Error('invalid channel GitHub ingress configuration')
  }

  /** Verify a GitHub HTTP request and await the room's durable receipt.
   * @param request - Exact /enterprise/channel-workflows/github request.
   * @returns 202 only after the bridge completes; failure asks the provider to retry.
   */
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { allow: 'POST' } })
    const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
    if (!/^application\/json(?:\s*;|$)/u.test(contentType)) return new Response(null, { status: 415 })
    const signature = request.headers.get('x-hub-signature-256')
    const deliveryId = request.headers.get('x-github-delivery')
    const name = request.headers.get('x-github-event')
    if (signature === null || deliveryId === null || name === null
      || deliveryId.trim() === '' || deliveryId.length > 200 || name.trim() === '' || name.length > 80) {
      return new Response(null, { status: 400 })
    }
    let body: string
    try { body = await boundedBody(request, this.options.maxBodyBytes) }
    catch (error) { return new Response(null, { status: error instanceof RangeError ? 413 : 400 }) }
    let secret: string | undefined
    try { secret = await this.options.resolveSecret() }
    catch { return new Response(null, { status: 503 }) }
    if (secret === undefined || secret === '') return new Response(null, { status: 503 })
    let verified = false
    try { verified = await new Webhooks({ secret }).verify(body, signature) }
    catch { /* Invalid provider signature has no safe response details. */ }
    if (!verified) return new Response(null, { status: 401 })
    let payload: unknown
    try { payload = JSON.parse(body) }
    catch { return new Response(null, { status: 400 }) }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      return new Response(null, { status: 400 })
    }
    try {
      await this.options.handle({ kind: 'github', source: this.options.source, deliveryId,
        event: { name, payload: payload as Record<string, unknown> }, receivedAt: Date.now() })
      return new Response(null, { status: 202 })
    } catch { return new Response(null, { status: 503 }) }
  }
}
