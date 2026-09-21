import { describe, expect, it } from 'vitest'
import { DevicePlaneService, InMemoryDevicePlaneRepository } from '../src/index.ts'

describe('DevicePlaneService', () => {
  it('binds a paired device and one-time operation permit to the requesting principal and run', async () => {
    const service = new DevicePlaneService(new InMemoryDevicePlaneRepository(), () => 1_700_000_000_000)
    const paired = await service.pair({ orgId: 'org-a', userId: 'user-a', deviceName: 'Kris Mac', platform: 'macos', publicKey: 'pk' })
    const run = await service.start({ orgId: 'org-a', userId: 'user-a', deviceId: paired.deviceId, workspaceId: 'ws-a', sessionId: 's-a', mode: 'observe' })
    const permit = await service.issuePermit({ orgId: 'org-a', userId: 'user-a', deviceId: paired.deviceId, runId: run.runId, operationId: 'op-a', capability: 'browser.observe' })

    expect(permit).toMatchObject({ orgId: 'org-a', userId: 'user-a', deviceId: paired.deviceId, runId: run.runId, operationId: 'op-a', consumed: false })
    await expect(service.consumePermit({ orgId: 'org-a', userId: 'user-b', deviceId: paired.deviceId, runId: run.runId, operationId: 'op-a' }))
      .rejects.toThrow(/principal/)
    await service.consumePermit({ orgId: 'org-a', userId: 'user-a', deviceId: paired.deviceId, runId: run.runId, operationId: 'op-a' })
    await expect(service.consumePermit({ orgId: 'org-a', userId: 'user-a', deviceId: paired.deviceId, runId: run.runId, operationId: 'op-a' }))
      .rejects.toThrow(/consumed/)
  })

  it('binds a recorder through one owner-scoped single-use code', async () => {
    const repository = new InMemoryDevicePlaneRepository()
    const service = new DevicePlaneService(repository, () => 1_000, () => '482913')
    const challenge = await service.createRecorderPairing({ orgId: 'org-a', userId: 'user-a' })

    await expect(service.bindRecorder({
      pairingId: challenge.pairingId, code: '000000', recorderSerial: 'SD-1',
      relayPublicKey: 'relay-pk', deviceName: '随身录音卡',
    })).rejects.toThrow(/code/)
    const bound = await service.bindRecorder({
      pairingId: challenge.pairingId, code: challenge.code, recorderSerial: 'SD-1',
      relayPublicKey: 'relay-pk', deviceName: '随身录音卡',
    })
    expect(bound).toMatchObject({ orgId: 'org-a', userId: 'user-a', recorderSerial: 'SD-1', status: 'active' })
    await expect(service.bindRecorder({
      pairingId: challenge.pairingId, code: challenge.code, recorderSerial: 'SD-1',
      relayPublicKey: 'relay-pk', deviceName: '随身录音卡',
    })).rejects.toThrow(/consumed/)
  })

  it('rejects expired codes and cross-user recorder reassignment', async () => {
    let now = 1_000
    const repository = new InMemoryDevicePlaneRepository()
    const service = new DevicePlaneService(repository, () => now, () => '482913')
    const expired = await service.createRecorderPairing({ orgId: 'org-a', userId: 'user-a' })
    now = expired.expiresAt + 1
    await expect(service.bindRecorder({
      pairingId: expired.pairingId, code: expired.code, recorderSerial: 'SD-1',
      relayPublicKey: 'relay-a', deviceName: '录音卡',
    })).rejects.toThrow(/expired/)

    now = 2_000
    const alice = await service.createRecorderPairing({ orgId: 'org-a', userId: 'user-a' })
    await service.bindRecorder({ pairingId: alice.pairingId, code: alice.code, recorderSerial: 'SD-1', relayPublicKey: 'relay-a', deviceName: '录音卡' })
    const bob = await service.createRecorderPairing({ orgId: 'org-a', userId: 'user-b' })
    await expect(service.bindRecorder({
      pairingId: bob.pairingId, code: bob.code, recorderSerial: 'SD-1',
      relayPublicKey: 'relay-b', deviceName: '录音卡',
    })).rejects.toThrow(/another user/)
  })

  it('returns the existing recorder for the same owner and serial', async () => {
    const repository = new InMemoryDevicePlaneRepository()
    const codes = ['111111', '222222']
    const service = new DevicePlaneService(repository, () => 1_000, () => codes.shift() ?? '999999')
    const firstChallenge = await service.createRecorderPairing({ orgId: 'org-a', userId: 'user-a' })
    const first = await service.bindRecorder({ pairingId: firstChallenge.pairingId, code: firstChallenge.code, recorderSerial: 'SD-1', relayPublicKey: 'relay-a', deviceName: '录音卡' })
    const secondChallenge = await service.createRecorderPairing({ orgId: 'org-a', userId: 'user-a' })
    const second = await service.bindRecorder({ pairingId: secondChallenge.pairingId, code: secondChallenge.code, recorderSerial: 'SD-1', relayPublicKey: 'relay-a', deviceName: '录音卡' })
    expect(second.recorderId).toBe(first.recorderId)
    expect(repository.recorders).toHaveLength(1)
  })
})
