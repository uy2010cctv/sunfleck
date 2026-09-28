import { expect, it } from 'vitest'
import { channelThreadEvents, threadReplyItems } from '../src/client/channel-threads.ts'
import type { CollaborationDetail, RoomEvent } from '../src/client/collaboration-store.ts'

const root: RoomEvent = { id: 'root', sequence: '1', pubkey: 'key', created_at: 1, kind: 9, tags: [], content: 'Question', sig: 'sig',
  author: { kind: 'human', id: 'user', displayName: 'User' } }
const reply: RoomEvent = { ...root, id: 'reply', sequence: '2', sourceSessionId: 'work',
  author: { kind: 'employee', id: 'bot', displayName: 'Bot' } }
const detail: CollaborationDetail = { id: 'channel', kind: 'channel', name: 'Channel', memberCount: 2,
  workspaceId: 'workspace', members: [], memberUserIds: ['user'], topics: [{ id: root.id, title: 'Question', state: 'open',
    destinations: [{ employeeId: 'bot', sessionId: 'work' }] }], dutyEmployeeIds: [], topicPolicy: 'thread',
  viewerUserId: 'user', viewerIsAdmin: true }

it('projects persisted destinations without modifying signed input records', () => {
  const projected = channelThreadEvents([root, reply], detail)
  expect(projected[1]?.threadRoot).toBe(root.id)
  expect(reply.threadRoot).toBeUndefined()
  expect(projected[1]?.tags).toBe(reply.tags)
  expect(projected[1]?.sig).toBe(reply.sig)
})

it('keeps independent signed text replies and folds only execution facts', () => {
  const next = { ...reply, id: 'next', sequence: '4' }
  const tool = { ...reply, id: 'tool', sequence: '3', kind: 41000 }
  const items = threadReplyItems([reply, tool, next])
  expect(items.map(item => item.event.id)).toEqual(['reply', 'next'])
  expect(items[0]?.details.map(item => item.id)).toEqual(['tool'])
})

it('leaves group facts and independent channel root posts unchanged', () => {
  expect(channelThreadEvents([reply], { ...detail, kind: 'group' })[0]).toBe(reply)
  expect(channelThreadEvents([{ ...reply, id: root.id }], detail)[0]?.threadRoot).toBeUndefined()
})
