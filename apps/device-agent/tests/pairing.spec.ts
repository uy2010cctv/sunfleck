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

  it('repeats a matching pairing completion without reconnecting', async () => {
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
    expect((await handler.fetch(request('challenge-12345678'))).status).toBe(204)
    expect((await handler.fetch(request('wrong-challenge'))).status).toBe(400)
    expect(complete).toHaveBeenCalledOnce()
  })
})

function completionRequest(deviceId = 'device-1', origin = 'http://dsh.example'): Request {
  return new Request('http://127.0.0.1:47631/v1/complete', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ challenge: 'challenge-12345678', deviceId }),
  })
}

function pairingHandler(complete: (deviceId: string) => Promise<void>): LocalPairingHandler {
  return new LocalPairingHandler({
    serverOrigin: 'http://dsh.example', publicKey: 'public-key', deviceName: 'Kris Mac',
    platform: 'macos', challenge: 'challenge-12345678', complete,
  })
}

describe('pairing completion retries', () => {
  it('rejects a different device or origin after completion', async () => {
    const complete = vi.fn(async () => {})
    const handler = pairingHandler(complete)
    expect((await handler.fetch(completionRequest())).status).toBe(204)
    expect((await handler.fetch(completionRequest('device-2'))).status).toBe(409)
    expect((await handler.fetch(completionRequest('device-1', 'http://evil.example'))).status).toBe(403)
    expect(complete).toHaveBeenCalledOnce()
  })

  it('joins simultaneous completions for the same device', async () => {
    let notifyEntered!: () => void
    let release!: () => void
    const entered = new Promise<void>((resolve) => { notifyEntered = resolve })
    const pending = new Promise<void>((resolve) => { release = resolve })
    const complete = vi.fn(async () => { notifyEntered(); await pending })
    const handler = pairingHandler(complete)
    const first = handler.fetch(completionRequest())
    await entered
    const second = handler.fetch(completionRequest())
    const conflicting = handler.fetch(completionRequest('device-2'))
    release()
    expect((await conflicting).status).toBe(409)
    expect((await first).status).toBe(204)
    expect((await second).status).toBe(204)
    expect(complete).toHaveBeenCalledOnce()
  })

  it('returns a retryable error when saving the connection fails', async () => {
    let attempts = 0
    const handler = pairingHandler(async () => {
      attempts++
      if (attempts === 1) throw new Error('private filesystem detail')
    })
    const failed = await handler.fetch(completionRequest())
    expect(failed.status).toBe(503)
    expect(failed.headers.get('access-control-allow-origin')).toBe('http://dsh.example')
    expect(await failed.json()).toEqual({ error: 'pairing_completion_failed' })
    expect((await handler.fetch(completionRequest())).status).toBe(204)
    expect(attempts).toBe(2)
  })
})

describe('local diagnostics', () => {
  it('returns read-only diagnostics only to the configured origin', async () => {
    const status = vi.fn(async () => ({
      protocolVersion: 2 as const, agentVersion: '0.1.0', platform: 'macos' as const,
      serverOrigin: 'http://dsh.example', connectionPresent: true,
      browser: { available: true }, cua: { state: 'ready' as const },
      permissions: { state: 'available' as const, accessibility: false, screenRecording: true },
    }))
    const handler = new LocalPairingHandler({
      serverOrigin: 'http://dsh.example', publicKey: 'public-key', deviceName: 'Kris Mac',
      platform: 'macos', challenge: 'challenge-12345678', complete: async () => {}, status,
    })
    const response = await handler.fetch(new Request('http://127.0.0.1:47631/v1/status', {
      headers: { origin: 'http://dsh.example' },
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(await status())
    const denied = await handler.fetch(new Request('http://127.0.0.1:47631/v1/status', {
      headers: { origin: 'http://evil.example' },
    }))
    expect(denied.status).toBe(403)
    expect(status).toHaveBeenCalledTimes(2)
  })

  it('returns a safe diagnostic failure when the provider is unavailable', async () => {
    const handler = new LocalPairingHandler({
      serverOrigin: 'http://dsh.example', publicKey: 'public-key', deviceName: 'Kris Mac',
      platform: 'macos', challenge: 'challenge-12345678', complete: async () => {},
      status: async () => { throw new Error('private native path') },
    })
    const response = await handler.fetch(new Request('http://127.0.0.1:47631/v1/status', {
      headers: { origin: 'http://dsh.example' },
    }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'diagnostics_unavailable' })
  })
})

it('requires JSON for pairing completion', async () => {
  const complete = vi.fn(async () => {})
  const response = await pairingHandler(complete).fetch(new Request('http://127.0.0.1:47631/v1/complete', {
    method: 'POST', headers: { origin: 'http://dsh.example', 'content-type': 'text/plain' },
    body: JSON.stringify({ challenge: 'challenge-12345678', deviceId: 'device-1' }),
  }))
  expect(response.status).toBe(415)
  expect(complete).not.toHaveBeenCalled()
})
