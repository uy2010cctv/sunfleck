import { describe, expect, it } from 'vitest'
import { CollaborationService, type CollaborationDelivery, type CollaborationMessageInput,
  type CollaborationRuntime } from '../src/collaboration-service.ts'
import type { CollaborationRecord, CollaborationSession, RoomEvent } from '@deepseek-ai/dsh-enterprise-postgres'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'

const alice = { orgId: 'org', userId: 'alice', roles: ['administrator'] as const }
const bob = { ...alice, userId: 'bob' }
const room: CollaborationRecord = { id: 'group', orgId: 'org', kind: 'group', name: 'Research room', workspaceId: 'shared',
  memberUserIds: ['alice', 'bob'], memberEmployeeIds: ['research', 'data'], dutyEmployeeIds: [] }

function fixture(record: CollaborationRecord = room,
  dispatchCommitted?: () => Promise<CollaborationDelivery>) {
  const events: RoomEvent[] = []
  const routes: Array<{ targets: readonly string[]; route?: 'team' | 'ingest' }> = []
  const sessions: CollaborationSession[] = []
  const prompts: Array<{ employeeId: string; text: string; requestId?: string }> = []
  const read = new Map<string, string>()
  let permitted = true
  const service = new CollaborationService({
    get: async () => record, sessions: async () => sessions,
    list: async (_orgId: string, userId: string) => record.memberUserIds.includes(userId) ? [record] : [],
    bySession: async (id: string) => sessions.find(value => value.sessionId === id),
    bind: async (value: CollaborationSession) => { sessions.push(value) },
    roomPrefs: async () => new Map(),
    setRoomPrefs: async (_surfaceId: string, _userId: string,
      patch: { pinned?: boolean; starred?: boolean; muted?: boolean }) =>
      ({ pinned: patch.pinned ?? false, starred: patch.starred ?? false, muted: patch.muted ?? false }),
  } as never, {
    room: {
      appendHuman: async (actor: EnterprisePrincipal, _record: CollaborationRecord, input: CollaborationMessageInput,
        dispatch: { readonly targets: readonly string[]; readonly route?: 'team' | 'ingest' }) => {
        routes.push(dispatch)
        const existing = events.find(value => value.authorId === actor.userId && value.requestId === input.messageId)
        if (existing !== undefined) return existing
        const event: RoomEvent = { orgId: 'org', surfaceId: 'group', sequence: String(events.length + 1),
          authorKind: 'human', authorId: actor.userId, requestId: input.messageId ?? `auto-${events.length}`,
          event: { id: `event-${events.length + 1}`, pubkey: 'key', sig: 'sig', created_at: 1,
            kind: 9, tags: input.mentionedUserIds?.map(userId => ['dsh-mention', userId]) ?? [], content: input.text } }
        events.push(event)
        return event
      },
      list: async () => events,
      get: async (_record: CollaborationRecord, eventId: string) =>
        events.find(value => value.event.id === eventId),
      react: async (_actor: EnterprisePrincipal, _record: CollaborationRecord,
        input: { eventId: string; emoji: string; requestId: string }) => {
        const event: RoomEvent = { orgId: 'org', surfaceId: 'group', sequence: String(events.length + 1),
          authorKind: 'human', authorId: 'alice', requestId: input.requestId,
          event: { id: `event-${events.length + 1}`, pubkey: 'key', sig: 'sig', created_at: 1,
            kind: 9, tags: [], content: input.emoji } }
        events.push(event)
        return event
      },
      attention: async (_record: CollaborationRecord, userId: string) => {
        const unread = events.filter(value => BigInt(value.sequence) > BigInt(read.get(userId) ?? '0')
          && !(value.authorKind === 'human' && value.authorId === userId) && value.event.kind === 9)
        return { newMessages: unread.length > 0, unread: unread.length,
          mentions: unread.some(value => value.event.tags.some(tag => tag[0] === 'dsh-mention' && tag[1] === userId)) }
      },
      markRead: async (_record: CollaborationRecord, userId: string, sequence: string) => { read.set(userId, sequence); return true },
      search: async () => events,
      present: async (_actor: EnterprisePrincipal, _record: CollaborationRecord, event: RoomEvent) => ({
        ...event.event, sequence: event.sequence,
        author: { kind: event.authorKind, id: event.authorId, displayName: event.authorId } }),
      prompt: async (_record: CollaborationRecord, event: RoomEvent) => `Room source [${event.event.id}] ${event.event.content}`,
      ...(dispatchCommitted === undefined ? {} : { dispatchCommitted,
        replayedTargets: async () => [{ sessionId: 'existing-session', employeeId: 'research' }] }),
    },
    refreshWorkspace: () => {}, workspaceVisible: async () => permitted,
    memberWorkspaceVisible: async () => permitted,
    project: async () => undefined, projectActive: async () => true, team: async () => undefined,
    record: async () => {}, teamSession: async () => undefined,
    ingest: async () => ({ delivered: false, reason: 'unused' }),
    teamMessage: async () => ({ delivered: false, reason: 'unused' }),
    employee: async (_actor, id) => ({ employeeId: id, displayName: id === 'research' ? 'Research' : 'Data', releaseId: `release-${id}` }),
    createSession: async (_actor: EnterprisePrincipal, input: { sessionId: string }) => input.sessionId,
    prompt: async (_actor: EnterprisePrincipal, id: string, _record: CollaborationRecord, input: CollaborationMessageInput) => {
      prompts.push({ employeeId: sessions.find(value => value.sessionId === id)?.employeeId ?? '',
        text: input.text, ...(input.messageId === undefined ? {} : { requestId: input.messageId }) })
    },
  } as CollaborationRuntime)
  return { service, events, routes, prompts, revoke: () => { permitted = false } }
}

describe('one shared room timeline', () => {
  it('accepts two human posts without invoking a Bot', async () => {
    const app = fixture()
    expect(await app.service.message(alice, 'group', { text: 'Good morning', messageId: 'a1' })).toMatchObject({ delivered: true, targets: [] })
    expect(await app.service.message(bob, 'group', { text: 'Morning', messageId: 'b1' })).toMatchObject({ delivered: true, targets: [] })
    expect((await app.service.events(alice, 'group', {})).items.map(value => value.author.id)).toEqual(['alice', 'bob'])
    expect(app.prompts).toHaveLength(0)
    expect(app.routes).toEqual([{ targets: [] }, { targets: [] }])
  })

  it('fans one signed human event into two native employee Sessions and reuses its id on retry', async () => {
    const app = fixture()
    const first = await app.service.message(alice, 'group', { text: '@Research @Data investigate', messageId: 'one' })
    expect(first).toMatchObject({ delivered: true, targets: [{ employeeId: 'research' }, { employeeId: 'data' }] })
    expect(app.prompts).toHaveLength(2)
    expect(app.routes[0]).toEqual({ targets: ['research', 'data'] })
    expect(app.prompts.map(value => value.requestId)).toEqual(['event-1', 'event-1'])
    expect(app.prompts.every(value => value.text.includes('[event-1]'))).toBe(true)
    await app.service.message(alice, 'group', { text: '@Research @Data investigate', messageId: 'one' })
    expect(app.events).toHaveLength(1)
  })

  it('checks current membership and Workspace before reading or sending', async () => {
    const app = fixture()
    await expect(app.service.events({ ...alice, userId: 'eve' }, 'group', {})).rejects.toMatchObject({ code: 'not-found' })
    app.revoke()
    await expect(app.service.message(alice, 'group', { text: 'Secret' })).rejects.toMatchObject({ code: 'not-found' })
    await expect(app.service.search(alice, 'group', 'secret')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('returns signed room attention and refuses read after Workspace access is revoked', async () => {
    const app = fixture()
    await app.service.message(alice, 'group', { text: 'Own post', messageId: 'a1' })
    expect((await app.service.list(alice))[0]?.attention).toEqual({ newMessages: false, mentions: false, unread: 0 })
    await app.service.message(bob, 'group', { text: 'For Alice', messageId: 'b1', mentionedUserIds: ['alice'] })
    expect((await app.service.list(alice))[0]?.attention).toEqual({ newMessages: true, mentions: true, unread: 1 })
    await app.service.markRead(alice, 'group', '2')
    expect((await app.service.list(alice))[0]?.attention).toEqual({ newMessages: false, mentions: false, unread: 0 })
    await expect(app.service.message(bob, 'group', { text: 'Invalid mention', mentionedUserIds: ['eve'] }))
      .rejects.toMatchObject({ code: 'human-not-member' })
    app.revoke()
    await expect(app.service.markRead(alice, 'group', '2')).rejects.toMatchObject({ code: 'not-found' })
  })

  it('returns the signed acceptance receipt on retry without waiting for native dispatch', async () => {
    let calls = 0
    const app = fixture(room, async () => {
      calls++
      return calls === 1 ? { delivered: true, targets: [{ sessionId: 'existing-session', employeeId: 'research' }] }
        : { delivered: true, targets: [] }
    })
    const input = { text: '@Research investigate', messageId: 'retry-one' }
    const first = await app.service.message(alice, 'group', input)
    const second = await app.service.message(alice, 'group', input)
    expect(second).toEqual(first)
    expect(first).toMatchObject({ delivered: true, targets: [], event: { id: 'event-1' } })
    expect(calls).toBe(0)
    expect(app.events).toHaveLength(1)
    await app.service.dispatchSignedEvent(alice, 'group', 'event-1')
    expect(calls).toBe(1)
  })
})
