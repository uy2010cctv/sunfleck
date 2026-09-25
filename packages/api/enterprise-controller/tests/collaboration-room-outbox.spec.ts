import { describe, expect, it } from 'vitest'
import { CollaborationRoomOutbox } from '../src/collaboration-room-outbox.ts'
import type { RoomDispatchClaim } from '@deepseek-ai/dsh-enterprise-postgres'

const claim: RoomDispatchClaim = { orgId: 'org', surfaceId: 'room', eventId: 'a'.repeat(64),
  targetKind: 'employee', targetId: 'research', leaseToken: 'lease', event: {
    orgId: 'org', surfaceId: 'room', sequence: '1', authorKind: 'human', authorId: 'alice',
    event: { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128), created_at: 1,
      kind: 9, tags: [['h', 'room'], ['dsh-target', 'research']], content: 'Research this' },
  } }

describe('durable room dispatch claims', () => {
  it('acknowledges only after the native target has landed', async () => {
    const calls: string[] = []
    const outbox = new CollaborationRoomOutbox({
      claimDispatch: async () => [claim], claimEventDispatch: async () => [claim],
      completeDispatch: async () => { calls.push('ack'); return true },
      releaseDispatch: async () => { calls.push('release'); return true },
    }, async () => { calls.push('native'); return { outcome: 'delivered', targets: [{ sessionId: 'session-1', employeeId: 'research' }] } })
    expect(await outbox.immediate('org', 'room', claim.eventId, 30_000)).toEqual([{ sessionId: 'session-1', employeeId: 'research' }])
    expect(calls).toEqual(['native', 'ack'])
  })

  it('acks a revoked destination without running an employee', async () => {
    const calls: string[] = []
    const outbox = new CollaborationRoomOutbox({
      claimDispatch: async () => [claim], claimEventDispatch: async () => [claim],
      completeDispatch: async () => { calls.push('ack'); return true },
      releaseDispatch: async () => { calls.push('release'); return true },
    }, async () => ({ outcome: 'skipped', targets: [] }))
    expect(await outbox.poll(30_000)).toEqual([])
    expect(calls).toEqual(['ack'])
  })

  it('releases transient failures so the next worker can retry', async () => {
    const calls: string[] = []
    const outbox = new CollaborationRoomOutbox({
      claimDispatch: async () => [claim], claimEventDispatch: async () => [claim],
      completeDispatch: async () => { calls.push('ack'); return true },
      releaseDispatch: async () => { calls.push('release'); return true },
    }, async () => { throw new Error('database temporarily unavailable') })
    await expect(outbox.immediate('org', 'room', claim.eventId, 30_000)).rejects.toThrow('database temporarily unavailable')
    expect(calls).toEqual(['release'])
  })
})
