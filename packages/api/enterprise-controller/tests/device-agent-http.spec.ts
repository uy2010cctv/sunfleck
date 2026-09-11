import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { canonicalDeviceRequest } from '@deepseek-ai/dsh-enterprise-device-plane'
import { DeviceAgentHttpHandler } from '../src/device-agent-http.ts'
import { DeviceAgentClient } from '../../../../apps/device-agent/src/client.ts'

describe('DeviceAgentHttpHandler', () => {
  it('accepts one signed heartbeat without a user cookie and rejects its replay', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const device = {
      deviceId: 'device-1', orgId: 'org-a', userId: 'user-a', deviceName: 'Mac', platform: 'macos' as const,
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), status: 'online' as const,
    }
    const claimNonce = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const heartbeat = vi.fn().mockResolvedValue(undefined)
    const repository = {
      device: vi.fn().mockResolvedValue(device), claimNonce, heartbeat,
      consumePermit: vi.fn(), claimAction: vi.fn(), completeAction: vi.fn(),
    }
    const handler = new DeviceAgentHttpHandler(repository, () => 1_000)
    const path = '/device-agent/v1/heartbeat'
    const nonce = 'nonce-12345678'
    const canonical = canonicalDeviceRequest({ method: 'POST', path, timestamp: 1_000, nonce, body: '' })
    const signature = sign(null, Buffer.from(canonical), privateKey).toString('base64url')
    const request = () => new Request(`http://dsh.local${path}`, { method: 'POST', headers: {
      'x-dsh-device-id': device.deviceId, 'x-dsh-device-timestamp': '1000',
      'x-dsh-device-nonce': nonce, 'x-dsh-device-signature': signature,
    } })

    expect((await handler.fetch(request())).status).toBe(204)
    expect((await handler.fetch(request())).status).toBe(401)
    expect(heartbeat).toHaveBeenCalledOnce()
  })

  it('lets the signed device claim and complete one queued action', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const device = {
      deviceId: 'device-1', orgId: 'org-a', userId: 'user-a', deviceName: 'Mac', platform: 'macos' as const,
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), status: 'online' as const,
    }
    const action = {
      actionId: 'action-1', operationId: 'op-1', runId: 'run-1', deviceId: 'device-1',
      capability: 'browser.observe' as const, adapter: 'agent-browser' as const,
      operation: { kind: 'browser.snapshot' as const },
    }
    const completeAction = vi.fn().mockResolvedValue(true)
    const handler = new DeviceAgentHttpHandler({
      device: vi.fn().mockResolvedValue(device), claimNonce: vi.fn().mockResolvedValue(true),
      heartbeat: vi.fn(), consumePermit: vi.fn(), claimAction: vi.fn().mockResolvedValue(action), completeAction,
    }, () => 1_000)
    let nonce = 0
    const client = new DeviceAgentClient({
      server: 'http://dsh.local', deviceId: device.deviceId,
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      now: () => 1_000, nonce: () => `nonce-1234567${String(++nonce)}`,
      fetch: request => handler.fetch(request as Request),
    })
    await expect(client.claimAction()).resolves.toEqual(action)
    await client.completeAction({ runId: 'run-1', operationId: 'op-1', state: 'completed', summary: 'Observed.' })
    expect(completeAction).toHaveBeenCalledWith(expect.objectContaining({
      device, runId: 'run-1', operationId: 'op-1', state: 'completed',
    }))
  })
})
