import { describe, expect, it, vi } from 'vitest'
import { CollaborationController, type RoomEvent } from '../src/client/collaboration-store.ts'

const surface = { id: 'group-1', kind: 'group', name: 'Renewal', memberCount: 4 }
const detail = { ...surface, workspaceId: 'workspace', members: [{ employeeId: 'analyst', displayName: 'Analyst' }], memberUserIds: ['me', 'other'], topics: [], dutyEmployeeIds: [] }
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
