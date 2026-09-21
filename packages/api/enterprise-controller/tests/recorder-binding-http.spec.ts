import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { DeviceAgentHttpHandler } from '../src/device-agent-http.ts'

describe('recorder binding HTTP', () => {
  it('consumes the owner-scoped code and returns a device credential once', async () => {
    const consumeRecorderPairing = vi.fn(async () => ({
      pairingId: 'pair-1', orgId: 'org-a', userId: 'user-a', codeHash: createHash('sha256').update('482913').digest('hex'), expiresAt: 10_000,
    }))
    const pairRecorder = vi.fn(async recorder => recorder)
    const handler = new DeviceAgentHttpHandler({ consumeRecorderPairing, pairRecorder } as never, () => 1_000, {
      recorderBindingToken: 'bridge-secret', serialHmacKey: 'serial-secret', credentialHmacKey: 'credential-secret',
    })
    const response = await handler.fetch(new Request('http://dsh/device-agent/v1/recorder/bind', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-recorder-binding-token': 'bridge-secret' },
      body: JSON.stringify({ pairingId: 'pair-1', code: '482913', recorderSerial: 'SD-1', relayPublicKey: 'relay-pk', deviceName: '随身录音卡' }),
    }))
    expect(response.status).toBe(200)
    const body = await response.json() as Record<string, unknown>
    expect(body['credential']).toMatch(/^[A-Za-z0-9_-]{32,}$/u)
    expect(pairRecorder).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-a', userId: 'user-a' }),
      createHmac('sha256', 'serial-secret').update('SD-1').digest('hex'), expect.any(String))
  })

  it('rejects the bind before consuming a code when the bridge token is wrong', async () => {
    const consumeRecorderPairing = vi.fn()
    const handler = new DeviceAgentHttpHandler({ consumeRecorderPairing } as never, () => 1_000, {
      recorderBindingToken: 'bridge-secret', serialHmacKey: 'serial-secret', credentialHmacKey: 'credential-secret',
    })
    const response = await handler.fetch(new Request('http://dsh/device-agent/v1/recorder/bind', {
      method: 'POST', headers: { 'x-dsh-recorder-binding-token': 'wrong' }, body: '{}',
    }))
    expect(response.status).toBe(401)
    expect(consumeRecorderPairing).not.toHaveBeenCalled()
  })
})
