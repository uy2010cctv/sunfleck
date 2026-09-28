import { describe, expect, it, vi } from 'vitest'
import { CollaborationController, type RoomEvent } from '../src/client/collaboration-store.ts'

const surface = { id: 'group-1', kind: 'group', name: 'Renewal', memberCount: 4 }
const detail = { ...surface, workspaceId: 'workspace', members: [{ employeeId: 'analyst', displayName: 'Analyst' }], memberUserIds: ['me', 'other'], topics: [], dutyEmployeeIds: [], viewerUserId: 'me', viewerIsAdmin: true, adminUserId: 'me' }
const human: RoomEvent = { sequence: '9007199254740993', id: 'human-1', pubkey: 'human-public-key', created_at: 1, kind: 9, tags: [['h', 'group-1']], content: 'Please research', sig: 'signed-human-event', author: { kind: 'human', id: 'me', displayName: 'Director' } }
const bot: RoomEvent = { ...human, sequence: '9007199254740994', id: 'bot-1', pubkey: 'bot-public-key', content: 'I will hand this to Data Bot', sig: 'signed-bot-event', author: { kind: 'employee', id: 'analyst', displayName: 'Research Bot' }, sourceSessionId: 'execution' }
function fetcher(...responses: Response[]) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/read')) {
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '') as { sequence: string }
      return Response.json({ sequence: body.sequence })
    }
    const response = responses.shift()
    if (response === undefined) throw new Error('unexpected request')
    return response
  })
}
function controller(request: ReturnType<typeof fetcher>) {
  const openRoom = vi.fn()
  const inspect = vi.fn()
  return { value: new CollaborationController(request, inspect, openRoom), openRoom, inspect }
}

describe('shared collaboration room', () => {
  it('retains the explicit team attachment rejection for the composer notice', async () => {
    const request = fetcher(Response.json(detail), Response.json({ items: [], nextCursor: null }),
      Response.json({ error: 'team-attachments-unavailable' }, { status: 409 }))
    const { value } = controller(request)
    await value.select(surface.id)
    expect(await value.send('文件', { attachments: [{ attachmentId: 'a', name: 'a.txt', mimeType: 'text/plain', size: 1 }] })).toBe(false)
    expect(value.state.getSnapshot().error).toBe('team-attachments-unavailable')
    value.dispose()
  })
  it('keeps the authorized thread root when it is outside the loaded channel page', async () => {
    const request = fetcher(Response.json(detail), Response.json({ items: [], nextCursor: null }),
      Response.json({ items: [bot], root: human, nextCursor: bot.sequence }))
    const { value } = controller(request)
    await value.select(surface.id)
    await value.openThread(human.id)
    expect(value.state.getSnapshot().threadRootEvent).toEqual(human)
    value.closeThread()
    expect(value.state.getSnapshot().threadRootEvent).toBeUndefined()
    value.dispose()
  })

  it('loads earlier thread replies with an exclusive cursor and retains the live page', async () => {
    const recent = Array.from({ length: 100 }, (_, index) => ({ ...bot, id: `reply-${index}`, sequence: String(200 + index) }))
    const earlier = { ...bot, id: 'earlier-reply', sequence: '199' }
    const request = fetcher(Response.json(detail), Response.json({ items: [], nextCursor: null }),
      Response.json({ items: recent, root: human, nextCursor: '299' }),
      Response.json({ items: [earlier], root: human, nextCursor: '199' }))
    const { value } = controller(request)
    await value.select(surface.id)
    await value.openThread(human.id)
    expect(value.state.getSnapshot().threadOlderCursor).toBe('200')
    await value.loadOlderThread()
    expect(request.mock.calls.at(-1)?.[0]).toContain('before=200')
    expect(value.state.getSnapshot().threadEvents).toHaveLength(101)
    expect(value.state.getSnapshot().threadEvents[0]?.id).toBe(earlier.id)
    expect(value.state.getSnapshot().threadOlderCursor).toBeNull()
    value.dispose()
  })
  it('refreshes delivery metadata when a source Session publishes another reply', async () => {
    const file = { path: '/workspace/test.txt', description: 'Test delivery', seq: 22, index: 0 }
    const request = fetcher(Response.json({ files: [] }), Response.json({ files: [file] }))
    const { value } = controller(request)
    expect(await value.presentedFiles('execution', 'reply-1')).toEqual([])
    expect(await value.presentedFiles('execution', 'reply-1')).toEqual([])
    expect(await value.presentedFiles('execution', 'reply-2')).toMatchObject([file])
    expect(request).toHaveBeenCalledTimes(2)
    value.dispose()
  })
  it('polls the committed cursor while a pending or failed local echo remains visible', async () => {
    const posting = Promise.withResolvers<Response>()
    const request = vi.fn(async (url: string) => {
      if (url.endsWith('/messages')) return posting.promise
      if (url.includes('/events')) return Response.json({ items: [human], nextCursor: human.sequence })
      return Response.json(detail)
    })
    const { value } = controller(request)
    await value.select(surface.id)
    value.setMainPanel('enterprise-collaboration')
    const pending = value.send('Another request')
    try {
      await value.poll()
      expect(request.mock.calls.at(-1)?.[0]).toBe(`/enterprise/surfaces/${surface.id}/events?after=${human.sequence}&limit=100`)
    } finally {
      posting.resolve(new Response(null, { status: 502 }))
      await pending
    }
    await value.poll()
    expect(request.mock.calls.at(-1)?.[0]).toBe(`/enterprise/surfaces/${surface.id}/events?after=${human.sequence}&limit=100`)
    value.dispose()
  })
  it('coalesces background roster refreshes while the previous request is pending', async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    const request = vi.fn(async () => await new Promise<Response>((resolve) => { resolveFirst = resolve }))
    const { value } = controller(request)
    const pending = value.refreshIfIdle()
    await value.refreshIfIdle()
    expect(request).toHaveBeenCalledOnce()
    resolveFirst?.(Response.json([]))
    await pending
    void value.refreshIfIdle()
    expect(request).toHaveBeenCalledTimes(2)
    value.dispose()
  })
  it('acknowledges only after a visible room asks to mark its displayed sequence', async () => {
    const seen = { newMessages: true, mentions: true }
    const requests: { url: string; method: string; body?: unknown }[] = []
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined
      requests.push({ url, method, ...(body === undefined ? {} : { body }) })
      if (url.endsWith('/read')) { seen.newMessages = false; seen.mentions = false
        return Response.json({ sequence: bot.sequence }) }
      if (url.endsWith('/events?limit=100')) return Response.json({ items: [human, bot], nextCursor: null })
      if (url === '/enterprise/surfaces') return Response.json([{ ...surface, attention: { ...seen } }])
      return Response.json(detail)
    })
    const { value } = controller(request)
    await value.refresh()
    expect(value.state.getSnapshot().surfaces[0]?.attention).toEqual({ newMessages: true, mentions: true })
    await value.select(surface.id)
    expect(requests.some(item => item.url.endsWith('/read'))).toBe(false)
    value.setMainPanel('enterprise-collaboration')
    await value.acknowledgeVisible()
    expect(requests).toContainEqual({ url: `/enterprise/surfaces/${surface.id}/read`, method: 'POST',
      body: { sequence: bot.sequence } })
    expect(value.state.getSnapshot().events.map(event => event.id)).toEqual([human.id, bot.id])
    expect(value.state.getSnapshot().surfaces[0]?.attention).toEqual({ newMessages: false, mentions: false })
    value.dispose()
  })
  it('publishes bound execution Session ids and clears them after access loss', async () => {
    const changed = vi.fn()
    const request = fetcher(Response.json([{ ...surface, executionSessionIds: ['native-room-1'] }]),
      new Response('', { status: 403 }))
    const value = new CollaborationController(request, vi.fn(), vi.fn(), undefined, changed)
    await value.refresh()
    expect(changed).toHaveBeenCalledWith(['native-room-1'])
    await value.refresh()
    expect(changed).toHaveBeenLastCalledWith([])
    value.dispose()
  })
  it('opens one group timeline for all human and Bot authors without opening an employee Session', async () => {
    const request = fetcher(Response.json([surface]), Response.json(detail), Response.json({ items: [human, bot], nextCursor: null }))
    const { value, openRoom, inspect } = controller(request)
    await value.refresh()
    await value.select('group-1')
    expect(value.state.getSnapshot().events.map(item => item.author.displayName)).toEqual(['Director', 'Research Bot'])
    expect(openRoom).toHaveBeenCalledOnce()
    expect(inspect).not.toHaveBeenCalled()
    expect(request.mock.calls.map(args => args[0])).toEqual(['/enterprise/surfaces', '/enterprise/surfaces/group-1',
      '/enterprise/surfaces/group-1/events?limit=100'])
    value.dispose()
  })

  it('polls using an opaque bigint cursor, deduplicates and keeps event order', async () => {
    const request = fetcher(
      Response.json(detail), Response.json({ items: [human], nextCursor: null }),
      Response.json({ items: [human, bot], nextCursor: null }),
    )
    const { value } = controller(request)
    await value.select('group-1')
    value.setMainPanel('enterprise-collaboration')
    await value.poll()
    expect(request.mock.calls.some(args => args[0].includes('after=9007199254740993'))).toBe(true)
    expect(value.state.getSnapshot().events.map(item => item.id)).toEqual(['human-1', 'bot-1'])
    value.dispose()
  })

  it('loads older messages before the first current sequence while live polling keeps the newest cursor', async () => {
    const recent = Array.from({ length: 100 }, (_, index) => ({
      ...human, id: `event-${index + 100}`, sequence: String(9007199254741000n + BigInt(index)),
    }))
    const older = { ...human, id: 'older', sequence: '9007199254740999' }
    const newer = { ...bot, sequence: '9007199254741100' }
    const request = fetcher(
      Response.json(detail), Response.json({ items: recent, nextCursor: recent.at(-1)?.sequence }),
      Response.json({ items: [older], nextCursor: older.sequence }),
      Response.json({ items: [newer], nextCursor: newer.sequence }),
    )
    const { value } = controller(request)
    await value.select('group-1')
    expect(value.state.getSnapshot().olderCursor).toBe(recent[0]?.sequence)
    await value.loadOlder()
    expect(request.mock.calls.some(args => args[0].includes(`before=${recent[0]?.sequence}`))).toBe(true)
    expect(value.state.getSnapshot().events[0]?.id).toBe('older')
    expect(value.state.getSnapshot().olderCursor).toBeNull()
    value.setMainPanel('enterprise-collaboration')
    await value.poll()
    expect(request.mock.calls.some(args => args[0].includes(`after=${recent.at(-1)?.sequence}`))).toBe(true)
    value.dispose()
  })

  it('commits an untargeted human message, preserving the id after uncertain transport failure', async () => {
    const ids: string[] = []
    let sends = 0
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/messages')) {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '') as {
          messageId: string
          text: string
          mentionedEmployeeIds?: string[]
        }
        ids.push(body.messageId)
        expect(body).toMatchObject({ text: 'hello room' })
        expect(body.mentionedEmployeeIds).toBeUndefined()
        if (++sends === 1) throw new Error('connection lost after commit')
        return Response.json({ delivered: true, event: human, targets: [] })
      }
      return Response.json(url.endsWith('/events?limit=100') ? { items: [], nextCursor: null } : detail)
    })
    const value = new CollaborationController(request, vi.fn(), vi.fn())
    await value.select('group-1')
    expect(await value.send('hello room')).toBe(false)
    expect(await value.send('hello room')).toBe(true)
    expect(ids[0]).toBe(ids[1])
    expect(value.state.getSnapshot().events).toEqual([human])
    value.dispose()
  })

  it('opens a server-thread and searches one authorized room', async () => {
    const reply = { ...bot, sequence: '9007199254740995', id: 'reply', threadRoot: human.id }
    const request = fetcher(
      Response.json(detail), Response.json({ items: [human], nextCursor: null }),
      Response.json({ items: [reply], nextCursor: null }), Response.json({ items: [human] }),
    )
    const { value } = controller(request)
    await value.select('group-1')
    await value.openThread(human.id)
    await value.search('research')
    expect(value.state.getSnapshot().threadEvents).toEqual([reply])
    expect(value.state.getSnapshot().searchResults).toEqual([human])
    expect(request.mock.calls.some(args => args[0].includes('threadRoot=human-1'))).toBe(true)
    value.dispose()
  })

  it('sends a thread reply to an exact Bot member and appends a signed reaction', async () => {
    const reply = { ...bot, sequence: '9007199254740995', id: 'reply', threadRoot: human.id }
    const reaction = { ...human, sequence: '9007199254740996', id: 'reaction', kind: 7, tags: [['e', human.id]], content: '👍' }
    const bodies: Record<string, unknown>[] = []
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && !url.endsWith('/read')) {
        bodies.push(JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown>)
      }
      if (url.endsWith('/read')) return Response.json({ sequence: human.sequence })
      if (url.endsWith('/messages')) return Response.json({ delivered: true, event: reply, targets: [] })
      if (url.endsWith('/reactions')) return Response.json({ event: reaction })
      return Response.json(url.endsWith('/events?limit=100') ? { items: [human], nextCursor: null } : detail)
    })
    const value = new CollaborationController(request, vi.fn(), vi.fn())
    await value.select('group-1')
    expect(await value.send('请复核', { threadRoot: human.id, mentionedEmployeeIds: ['analyst'] })).toBe(true)
    expect(await value.react(human.id, '👍')).toBe(true)
    expect(bodies[0]).toMatchObject({ text: '请复核', threadRoot: human.id, mentionedEmployeeIds: ['analyst'] })
    expect(bodies[1]).toMatchObject({ eventId: human.id, emoji: '👍' })
    expect(value.state.getSnapshot().events.map(event => event.id)).toEqual([human.id, reply.id, reaction.id])
    value.dispose()
  })

  it('uploads attachments and sends them referenced by id, rendering attachment tags', async () => {
    const detailWithSeed = { ...detail, members: [{ employeeId: 'analyst', displayName: 'Analyst', avatarSeed: 'seed-a' }] }
    const bodies: { url: string; body: Record<string, unknown> }[] = []
    let uploaded: { name: string; type: string } | undefined
    const fileEvent = { ...human, tags: [...human.tags, ['attachment', 'att-1', '报价.pdf', 'application/pdf', String(2048)]] }
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/attachments?name=')) {
        uploaded = { name: decodeURIComponent(url.split('name=')[1] ?? '').split('&')[0] ?? '',
          type: decodeURIComponent(url.split('type=')[1] ?? '') }
        return Response.json({ attachmentId: 'att-1', name: '报价.pdf', mimeType: 'application/pdf', size: 2048 })
      }
      if (init?.method === 'POST' && url.endsWith('/messages')) {
        bodies.push({ url, body: JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown> })
        return Response.json({ delivered: true, event: fileEvent, targets: [] })
      }
      if (url.endsWith('/events?limit=100')) return Response.json({ items: [fileEvent], nextCursor: null })
      return Response.json(detailWithSeed)
    })
    const { value } = controller(request)
    await value.select('group-1')
    const ref = await value.uploadAttachment('group-1', new File(['x'], '报价.pdf', { type: 'application/pdf' }))
    expect(ref).toMatchObject({ attachmentId: 'att-1', name: '报价.pdf', mimeType: 'application/pdf', size: 2048 })
    expect(uploaded).toMatchObject({ name: '报价.pdf', type: 'application/pdf' })
    expect(await value.send('', { attachments: [ref] })).toBe(true)
    expect(bodies[0]?.body).toMatchObject({ text: '', attachments: [{ attachmentId: 'att-1' }] })
    expect(value.state.getSnapshot().events[0]?.attachments).toEqual([
      { attachmentId: 'att-1', name: '报价.pdf', mimeType: 'application/pdf', size: 2048 }])
    value.dispose()
  })

  it('applies group administrator changes and reloads the room and roster', async () => {
    const bodies: { url: string; body: Record<string, unknown> }[] = []
    const renamed = { ...detail, name: 'New name', announcement: 'hello' }
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && (url.endsWith('/rename') || url.endsWith('/announcement')
        || url.endsWith('/members/add') || url.endsWith('/members/remove'))) {
        bodies.push({ url, body: JSON.parse(typeof init.body === 'string' ? init.body : '') as Record<string, unknown> })
        return Response.json(renamed)
      }
      if (url === '/enterprise/surfaces') return Response.json([{ ...surface, name: 'New name' }])
      if (url.endsWith('/events?limit=100')) return Response.json({ items: [], nextCursor: null })
      return Response.json(renamed)
    })
    const { value } = controller(request)
    await value.select('group-1')
    expect(await value.rename('group-1', 'New name')).toBe(true)
    expect(await value.setAnnouncement('group-1', 'hello')).toBe(true)
    expect(await value.addMembers('group-1', ['a'], ['u'])).toBe(true)
    expect(await value.removeMembers('group-1', [], ['u'])).toBe(true)
    expect(bodies.map(row => row['url'])).toEqual(['/enterprise/surfaces/group-1/rename', '/enterprise/surfaces/group-1/announcement',
      '/enterprise/surfaces/group-1/members/add', '/enterprise/surfaces/group-1/members/remove'])
    expect(bodies[0]?.body).toMatchObject({ name: 'New name' })
    expect(bodies[1]?.body).toMatchObject({ text: 'hello' })
    expect(bodies[2]?.body).toMatchObject({ memberEmployeeIds: ['a'], memberUserIds: ['u'] })
    expect(bodies[3]?.body).toMatchObject({ memberUserIds: ['u'] })
    expect(value.state.getSnapshot().selection?.detail.name).toBe('New name')
    expect(value.state.getSnapshot().surfaces[0]?.name).toBe('New name')
    value.dispose()
  })

  it('keeps the selected room after a denied administrator change', async () => {
    const request = fetcher(Response.json(detail), Response.json({ items: [], nextCursor: null }),
      new Response('', { status: 403 }), Response.json([surface]))
    const { value } = controller(request)
    await value.select('group-1')
    expect(await value.rename('group-1', 'Nope')).toBe(false)
    expect(value.state.getSnapshot()).toMatchObject({ error: 'forbidden' })
    value.dispose()
  })

  it('erases a revoked room after a polling denial', async () => {
    const request = fetcher(Response.json(detail), Response.json({ items: [human], nextCursor: null }), new Response('', { status: 403 }), Response.json([]))
    const { value } = controller(request)
    await value.select('group-1')
    value.setMainPanel('enterprise-collaboration')
    await value.poll()
    expect(value.state.getSnapshot()).toMatchObject({ selection: null, events: [], error: 'forbidden' })
    value.dispose()
  })

  it('retains roster on transient failure and erases it after authorization loss', async () => {
    const request = fetcher(Response.json([surface]), new Response('', { status: 500 }), new Response('', { status: 403 }))
    const { value } = controller(request)
    await value.refresh()
    await value.refresh()
    expect(value.state.getSnapshot()).toMatchObject({ phase: 'error', surfaces: [surface] })
    await value.refresh()
    expect(value.state.getSnapshot()).toMatchObject({ phase: 'unavailable', surfaces: [] })
    value.dispose()
  })

  it('reuses a creation identity after a lost response and opens the shared room', async () => {
    const keys: string[] = []
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/groups')) {
        keys.push((JSON.parse(typeof init?.body === 'string' ? init.body : '') as { idempotencyKey: string }).idempotencyKey)
        if (keys.length === 1) throw new Error('lost response')
        return Response.json(surface)
      }
      if (url === '/enterprise/surfaces') return Response.json([surface])
      if (url.endsWith('/events?limit=100')) return Response.json({ items: [], nextCursor: null })
      return Response.json(detail)
    })
    const roomCreated = vi.fn()
    const value = new CollaborationController(request, vi.fn(), vi.fn(), roomCreated)
    const input = { kind: 'group' as const, name: 'Renewal', workspaceId: 'w', memberEmployeeIds: ['a'], memberUserIds: [] }
    expect(await value.create(input)).toBe(false)
    expect(await value.create(input)).toBe(true)
    expect(keys[0]).toBe(keys[1])
    expect(roomCreated).toHaveBeenCalledOnce()
    expect(value.state.getSnapshot().selection?.detail.id).toBe('group-1')
    value.dispose()
  })
})
