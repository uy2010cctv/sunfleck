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
})
