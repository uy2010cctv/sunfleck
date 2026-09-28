import { expect, it } from 'vitest'
import type { RoomEvent, RoomPresentedFile } from '../src/client/collaboration-store.ts'
import { filesForRoomReply } from '../src/client/room-presented-files.ts'

const reply: RoomEvent = { id: 'earlier', sequence: '2', pubkey: 'key', sig: 'sig', created_at: 1,
  kind: 9, content: 'Complete', tags: [['dsh-source', 'work:15']],
  sourceSessionId: 'work', author: { kind: 'employee', id: 'writer', displayName: 'Writer' } }
const later = { ...reply, id: 'later', sequence: '4', tags: [['dsh-source', 'work:45']] }
const earlierFile: RoomPresentedFile = { path: '/workspace/first.txt', seq: 10, index: 0, replySourceSeq: 15, downloadUrl: '/first' }
const laterFile: RoomPresentedFile = { path: '/workspace/second.txt', seq: 40, index: 0, replySourceSeq: 45, downloadUrl: '/second' }

it('keeps a later delivery off the earlier reply and excludes prior-turn files from a later reply', () => {
  const events = [reply, later]
  const files = [earlierFile, laterFile]
  expect(filesForRoomReply(events, reply, files)).toEqual([earlierFile])
  expect(filesForRoomReply(events, later, files)).toEqual([laterFile])
})

it('shows legacy Session deliveries once on its latest reply despite thread ordering', () => {
  const first = { ...reply, tags: [] }
  const last = { ...later, tags: [] }
  expect(filesForRoomReply([last, first], first, [laterFile])).toEqual([])
  expect(filesForRoomReply([last, first], last, [laterFile])).toEqual([laterFile])
})

it('uses full-log reply ownership when a preceding native turn is outside the loaded page', () => {
  expect(filesForRoomReply([later], later, [earlierFile, laterFile])).toEqual([laterFile])
  const ambiguous = { path: '/workspace/old.txt', seq: 10, index: 0, downloadUrl: '/old' }
  expect(filesForRoomReply([later], later, [ambiguous])).toEqual([])
})

it('keeps declared files off workflow events sharing the same source Session', () => {
  expect(filesForRoomReply([later], { ...later, kind: 41000 }, [laterFile])).toEqual([])
})
