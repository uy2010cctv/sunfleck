import { describe, expect, it, vi } from 'vitest'
import { LocalPairingHandler } from '../src/pairing.ts'

describe('LocalPairingHandler', () => {
  it('exposes only the public identity to the configured DSH origin', async () => {
    const complete = vi.fn(async () => {})
    const handler = new LocalPairingHandler({
      serverOrigin: 'http://dsh.example', publicKey: 'public-key', deviceName: 'Kris Mac',
      platform: 'macos', challenge: 'challenge-12345678', complete,
    })
    const denied = await handler.fetch(new Request('http://127.0.0.1:47631/v1/identity', {
      headers: { origin: 'http://evil.example' },
    }))
    expect(denied.status).toBe(403)
    const response = await handler.fetch(new Request('http://127.0.0.1:47631/v1/identity', {
      headers: { origin: 'http://dsh.example' },
    }))
    expect(response.headers.get('access-control-allow-private-network')).toBe('true')
    expect(await response.json()).toEqual({
      publicKey: 'public-key', deviceName: 'Kris Mac', platform: 'macos', challenge: 'challenge-12345678',
    })
  })

  it('accepts one matching pairing completion', async () => {
    const complete = vi.fn(async () => {})
    const handler = new LocalPairingHandler({
      serverOrigin: 'http://dsh.example', publicKey: 'public-key', deviceName: 'Kris Mac',
      platform: 'macos', challenge: 'challenge-12345678', complete,
    })
    const request = (challenge: string) => new Request('http://127.0.0.1:47631/v1/complete', {
      method: 'POST', headers: { origin: 'http://dsh.example', 'content-type': 'application/json' },
      body: JSON.stringify({ challenge, deviceId: 'device-1' }),
    })
    expect((await handler.fetch(request('wrong-challenge'))).status).toBe(400)
    expect((await handler.fetch(request('challenge-12345678'))).status).toBe(204)
    expect((await handler.fetch(request('challenge-12345678'))).status).toBe(409)
    expect(complete).toHaveBeenCalledOnce()
  })
})
