import { generateKeyPairSync } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import { EnterpriseRequestContext } from '@deepseek-ai/dsh-enterprise-auth-web'
import { describe, expect, it, vi } from 'vitest'
import { EnterpriseDeviceController } from '../src/index.ts'

const principal = { orgId: 'org-a', userId: 'user-a', roles: ['member'] as const }

function bench() {
  const listDevices = vi.fn(async () => [{
    deviceId: 'device-1', orgId: 'org-a', userId: 'user-a', deviceName: 'Kris Mac', platform: 'macos',
    publicKey: 'pk', status: 'online', lastHeartbeatAt: 10,
  }])
  const transitionRun = vi.fn(async () => ({
    runId: 'run-1', orgId: 'org-a', userId: 'user-a', deviceId: 'device-1', workspaceId: 'ws-1',
    sessionId: 'session-1', mode: 'confirm-each', status: 'paused', revision: 2,
  }))
  const listRuns = vi.fn(async () => [])
  const listActions = vi.fn(async () => [])
  const pairDevice = vi.fn(async () => ({
    deviceId: 'device-existing', orgId: 'org-a', userId: 'user-a', deviceName: 'Kris Mac', platform: 'macos',
    publicKey: 'normalized-key', status: 'online',
  }))
  const saveRecorderPairing = vi.fn(async () => {})
  const listRecorders = vi.fn(async () => [{
    recorderId: 'recorder-1', orgId: 'org-a', userId: 'user-a', deviceName: '随身录音卡',
    recorderSerial: 'serial-hash', relayPublicKey: 'relay-pk', status: 'active' as const, lastSeenAt: 10,
  }])
  const ctx = new Context()
  const requestContext = new EnterpriseRequestContext()
  ctx.provide('enterprisePostgres' as never, {
    devicePlane: { listDevices, listRuns, listActions, transitionRun, pairDevice, saveRecorderPairing, listRecorders },
  } as never)
  ctx.provide('enterpriseRequestContext' as never, requestContext as never)
  ctx.provide('enterpriseSecurity' as never, {
    authorizeApiAsync: vi.fn(async () => ({ allowed: true, reason: 'role' })), auditApiAsync: vi.fn(),
  } as never)
  return {
    controller: new EnterpriseDeviceController(ctx), requestContext,
    listDevices, listRuns, listActions, transitionRun, pairDevice, saveRecorderPairing, listRecorders,
  }
}

describe('EnterpriseDeviceController', () => {
  it('lists only the authenticated user devices', async () => {
    const b = bench()
    const items = await b.requestContext.run(principal, () => b.controller.list({}))
    expect(items).toEqual([expect.objectContaining({ deviceId: 'device-1', deviceName: 'Kris Mac' })])
    expect(b.listDevices).toHaveBeenCalledWith('org-a', 'user-a')
  })

  it('transitions only the authenticated user run with CAS', async () => {
    const b = bench()
    const value = await b.requestContext.run(principal, () => b.controller.transitionRun({
      runId: 'run-1', state: 'paused', expectedRevision: 1,
    }))
    expect(value).toMatchObject({ runId: 'run-1', status: 'paused', revision: 2 })
    expect(b.transitionRun).toHaveBeenCalledWith({
      orgId: 'org-a', userId: 'user-a', runId: 'run-1', state: 'paused', expectedRevision: 1,
    })
  })

  it('lists recent runs and actions for the authenticated user', async () => {
    const b = bench()
    await b.requestContext.run(principal, () => b.controller.listRuns({}))
    await b.requestContext.run(principal, () => b.controller.listActions({ limit: 8 }))
    expect(b.listRuns).toHaveBeenCalledWith('org-a', 'user-a', 20)
    expect(b.listActions).toHaveBeenCalledWith('org-a', 'user-a', 8)
  })

  it('returns the existing device when pairing is repeated', async () => {
    const b = bench()
    const { publicKey } = generateKeyPairSync('ed25519')
    const result = await b.requestContext.run(principal, () => b.controller.pair({
      deviceName: 'Kris Mac', platform: 'macos',
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }))
    expect(result).toEqual({ deviceId: 'device-existing' })
    expect(b.pairDevice).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-a', userId: 'user-a', deviceName: 'Kris Mac', status: 'online',
    }))
  })

  it('creates a recorder pairing code under the authenticated user', async () => {
    const b = bench()
    const result = await b.requestContext.run(principal, () => b.controller.createRecorderPairing({}))
    expect(result.code).toMatch(/^\d{6}$/u)
    expect(result.expiresAt).toBeGreaterThan(Date.now())
    expect(b.saveRecorderPairing).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 'org-a', userId: 'user-a', codeHash: expect.stringMatching(/^[a-f\d]{64}$/u),
    }))
  })

  it('lists recorder devices only for the authenticated user', async () => {
    const b = bench()
    const values = await b.requestContext.run(principal, () => b.controller.listRecorders({}))
    expect(values).toEqual([expect.objectContaining({ recorderId: 'recorder-1', deviceName: '随身录音卡' })])
    expect(b.listRecorders).toHaveBeenCalledWith('org-a', 'user-a')
  })
})
