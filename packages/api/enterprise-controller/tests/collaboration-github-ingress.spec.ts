import { createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { ChannelGitHubIngress } from '../src/collaboration-github-ingress.ts'

const body = JSON.stringify({ ref: 'refs/tags/v1.2', repository: { full_name: 'company/product' } })
function request(secret: string, payload = body): Request {
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  return new Request('http://localhost/enterprise/channel-workflows/github', { method: 'POST',
    headers: { 'content-type': 'application/json', 'x-github-event': 'push',
      'x-github-delivery': 'delivery-1', 'x-hub-signature-256': `sha256=${signature}` }, body: payload })
}

describe('durable GitHub channel ingress', () => {
  it('waits for the signed room ingress before acknowledging the provider', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const handle = vi.fn(async () => { await gate; return 1 })
    const ingress = new ChannelGitHubIngress({ resolveSecret: async () => 'test-secret',
      source: 'primary-github', maxBodyBytes: 4096, handle })
    let settled = false
    const response = ingress.fetch(request('test-secret')).then((value) => { settled = true; return value })
    await vi.waitFor(() => { expect(handle).toHaveBeenCalledOnce() })
    expect(settled).toBe(false)
    release?.()
    expect((await response).status).toBe(202)
  })

  it('rejects invalid signature and makes a failed persistence retryable', async () => {
    const handle = vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce(1)
    const ingress = new ChannelGitHubIngress({ resolveSecret: async () => 'test-secret',
      source: 'primary-github', maxBodyBytes: 4096, handle })
    expect((await ingress.fetch(request('wrong-secret'))).status).toBe(401)
    expect(handle).not.toHaveBeenCalled()
    expect((await ingress.fetch(request('test-secret'))).status).toBe(503)
    expect((await ingress.fetch(request('test-secret'))).status).toBe(202)
    expect(handle).toHaveBeenCalledTimes(2)
  })
})
