import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { DeviceAgentClient } from '../src/client.ts'

describe('DeviceAgentClient', () => {
  it('signs heartbeat requests without a user cookie', async () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const fetch = vi.fn(async () => new Response(null, { status: 204 }))
    const client = new DeviceAgentClient({
      server: 'https://dsh.example', deviceId: 'device-1',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      fetch, now: () => 1_000, nonce: () => 'nonce-12345678',
    })
    await client.heartbeat()
    const request = fetch.mock.calls[0]?.[0] as Request
    expect(request.url).toBe('https://dsh.example/device-agent/v1/heartbeat')
    expect(request.headers.get('cookie')).toBeNull()
    expect(request.headers.get('x-dsh-device-id')).toBe('device-1')
    expect(request.headers.get('x-dsh-device-signature')).toMatch(/^[A-Za-z0-9_-]+$/u)
  })

  it('claims one queued action and reports its result', async () => {
    const { privateKey } = generateKeyPairSync('ed25519')
    const action = {
      actionId: 'action-1', operationId: 'op-1', runId: 'run-1', deviceId: 'device-1',
      capability: 'browser.observe', adapter: 'agent-browser', operation: { kind: 'browser.snapshot' },
    }
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json(action))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = new DeviceAgentClient({
      server: 'https://dsh.example', deviceId: 'device-1',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), fetch,
    })
    await expect(client.claimAction()).resolves.toEqual(action)
    await client.completeAction({ operationId: 'op-1', state: 'completed', summary: 'Observed.', runId: 'run-1' })
    expect((fetch.mock.calls[0]?.[0] as Request).url).toContain('/action/claim')
    expect((fetch.mock.calls[1]?.[0] as Request).url).toContain('/action/result')
  })
})
