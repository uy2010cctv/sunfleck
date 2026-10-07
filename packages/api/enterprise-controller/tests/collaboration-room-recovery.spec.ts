import { expect, it, vi } from 'vitest'
import type { CollaborationRecord, CollaborationSession } from '@deepseek-ai/dsh-enterprise-postgres'
import { CollaborationRoomRecovery } from '../src/collaboration-room-recovery.ts'

const row = { id: 'room', orgId: 'org', kind: 'group', name: 'Room', workspaceId: 'workspace',
  memberUserIds: ['alice'], memberEmployeeIds: ['employee'], dutyEmployeeIds: [] } satisfies CollaborationRecord
const bindings = [{ surfaceId: row.id, topicId: '', employeeId: 'employee', sessionId: 'root' }] satisfies CollaborationSession[]

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
