import { expect, it, vi } from 'vitest'
import type { CollaborationRecord, CollaborationSession } from '@deepseek-ai/dsh-enterprise-postgres'
import { CollaborationRoomRecovery } from '../src/collaboration-room-recovery.ts'

const row = { id: 'room', orgId: 'org', kind: 'group', name: 'Room', workspaceId: 'workspace',
  memberUserIds: ['alice'], memberEmployeeIds: ['employee'], dutyEmployeeIds: [] } satisfies CollaborationRecord
const bindings = [{ surfaceId: row.id, topicId: '', employeeId: 'employee', sessionId: 'root' }] satisfies CollaborationSession[]

it('coalesces asynchronous repair and awaits it before disposal rejects new work', async () => {
  let release: () => void = () => { throw new Error('repair gate not initialized') }
  let entered: () => void = () => { throw new Error('entry gate not initialized') }
  const gate = new Promise<void>((resolve) => { release = resolve })
  const entry = new Promise<void>((resolve) => { entered = resolve })
  const failed = vi.fn()
  const recover = vi.fn(async () => { entered(); await gate; return true })
  const recovery = new CollaborationRoomRecovery(async () => bindings, async () => '1', recover)
  recovery.start(row, failed)
  recovery.start(row, failed)
  await entry
  expect(recover).toHaveBeenCalledOnce()
  expect(recovery.isPending(row)).toBe(true)
  recovery.clear()
  let disposed = false
  const disposal = recovery.dispose().then(() => { disposed = true })
  try {
    await Promise.resolve()
    expect(recovery.isPending(row)).toBe(true)
    expect(disposed).toBe(false)
    expect(() => { recovery.start(row, failed) }).toThrow('disposed')
    await expect(recovery.reconcile(row)).rejects.toThrow('disposed')
  } finally { release(); await disposal }
  expect(recovery.isPending(row)).toBe(false)
  expect(failed).not.toHaveBeenCalled()
})

it('reports asynchronous repair errors and retries on a later authorized request', async () => {
  let rejected: () => void = () => { throw new Error('failure gate not initialized') }
  const failure = new Promise<void>((resolve) => { rejected = resolve })
  const failed = vi.fn(() => { rejected() })
  const recover = vi.fn(async () => true).mockRejectedValueOnce(new Error('temporarily unavailable'))
  const recovery = new CollaborationRoomRecovery(async () => bindings, async () => '1', recover)
  recovery.start(row, failed)
  await failure
  await new Promise<void>(resolve => setImmediate(resolve))
  recovery.start(row, failed)
  await recovery.dispose()
  expect(failed).toHaveBeenCalledOnce()
  expect(recover).toHaveBeenCalledTimes(2)
})

it('contains a throwing asynchronous repair diagnostic and remains retryable', async () => {
  const failed = vi.fn(() => { throw new Error('diagnostic unavailable') })
  const recover = vi.fn(async () => true).mockRejectedValueOnce(new Error('repair unavailable'))
  const recovery = new CollaborationRoomRecovery(async () => bindings, async () => '1', recover)
  recovery.start(row, failed)
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(failed).toHaveBeenCalledOnce()
  recovery.start(row, failed)
  await recovery.dispose()
  expect(recover).toHaveBeenCalledTimes(2)
})

it('recovers once per revision, including child changes and room membership changes', async () => {
  const revisions = new Map([['root', '1'], ['child', '1']])
  const recover = vi.fn(async (_row: CollaborationRecord, _bindings: readonly CollaborationSession[],
    child: (id: string) => Promise<void>) => {
    await child('child')
    return true
  })
  const recovery = new CollaborationRoomRecovery(async () => bindings, async id => revisions.get(id), recover)
  await Promise.all([recovery.reconcile(row), recovery.reconcile(row)])
  expect(recover).toHaveBeenCalledOnce()
  revisions.set('child', '2')
  await recovery.reconcile(row)
  expect(recover).toHaveBeenCalledTimes(2)
  await recovery.reconcile({ ...row, memberUserIds: ['alice', 'bob'] })
  expect(recover).toHaveBeenCalledTimes(3)
  recovery.clear()
  await recovery.reconcile(row)
  expect(recover).toHaveBeenCalledTimes(4)
})

it('retries failed projections and logs that change during recovery', async () => {
  let revision = '1'
  const recover = vi.fn(async () => false)
  const recovery = new CollaborationRoomRecovery(async () => bindings, async () => revision, recover)
  await recovery.reconcile(row)
  await recovery.reconcile(row)
  expect(recover).toHaveBeenCalledTimes(2)
  recover.mockImplementationOnce(async () => { revision = '2'; return true })
  await recovery.reconcile(row)
  recover.mockImplementation(async () => true)
  await recovery.reconcile(row)
  await recovery.reconcile(row)
  expect(recover).toHaveBeenCalledTimes(4)
})
