import { describe, expect, it, vi } from 'vitest'
import { CollaborationController } from '../src/client/collaboration-store.ts'

const surface = { id: 'group-1', kind: 'group', name: 'Renewal', memberCount: 2 }
const detail = { ...surface, workspaceId: 'workspace', members: [{ employeeId: 'analyst', displayName: 'Analyst' }], memberUserIds: ['me'], topics: [], dutyEmployeeIds: [] }
function fetcher(...responses: Response[]) {
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    const response = responses.shift()
    if (response === undefined) throw new Error('unexpected request')
    return response
  })
}

describe('collaboration navigation', () => {
  it('loads stored rows and opens the returned native Session without creating another client chat', async () => {
    const request = fetcher(Response.json([surface]), Response.json(detail), Response.json({ opened: true, sessionId: 'session' }))
    const open = vi.fn()
    const c = new CollaborationController(request, open, vi.fn())
    await c.refresh()
    await c.select('group-1')
    expect(c.state.getSnapshot().surfaces).toEqual([surface])
    expect(open).toHaveBeenCalledWith('session', expect.any(AbortSignal))
    expect(request.mock.calls.map(args => args[0])).toEqual(['/enterprise/surfaces', '/enterprise/surfaces/group-1', '/enterprise/surfaces/group-1/open'])
    c.dispose()
  })

  it('shows the actual preflight selection when a group has no live entry Session', async () => {
    const setup = vi.fn()
    const c = new CollaborationController(fetcher(Response.json(detail), Response.json({ opened: false, reason: 'select-employee', detail })), vi.fn(), setup)
    await c.select('group-1')
    expect(setup).toHaveBeenCalledOnce()
    expect(c.state.getSnapshot().selection?.reason).toBe('select-employee')
    c.dispose()
  })

  it('does not navigate from a superseded selection response', async () => {
    let resolve!: (value: Response) => void
    const request = vi.fn(() => new Promise<Response>((r) => { resolve = r }))
    const open = vi.fn()
    const c = new CollaborationController(request, open, vi.fn())
    const pending = c.select('group-1')
    c.clearSelection()
    resolve(Response.json(detail))
    await pending
    expect(open).not.toHaveBeenCalled()
    expect(c.state.getSnapshot().selection).toBeNull()
    c.dispose()
  })

  it('retains the roster on load failure and clears it when permission is withdrawn', async () => {
    const c = new CollaborationController(fetcher(Response.json([surface]), new Response('', { status: 500 }), new Response('', { status: 403 })), vi.fn(), vi.fn())
    await c.refresh()
    await c.refresh()
    expect(c.state.getSnapshot()).toMatchObject({ phase: 'error', surfaces: [surface] })
    await c.refresh()
    expect(c.state.getSnapshot()).toMatchObject({ phase: 'unavailable', surfaces: [] })
    c.dispose()
  })

  it('does not report delivery or clear the draft when routing found no recipient', async () => {
    const c = new CollaborationController(fetcher(Response.json(detail), Response.json({ opened: false, reason: 'select-employee', detail }), Response.json({ delivered: false, reason: 'no-target' })), vi.fn(), vi.fn())
    await c.select('group-1')
    expect(await c.send('hello')).toBe(false)
    expect(c.state.getSnapshot().error).toBe('no-target')
    c.dispose()
  })

  it('restores group context from an existing Session and clears it for a private Session', async () => {
    const c = new CollaborationController(fetcher(Response.json({ detail, employeeId: 'analyst' }), new Response('', { status: 404 })), vi.fn(), vi.fn())
    await c.restore('session')
    expect(c.state.getSnapshot().selection?.detail.id).toBe('group-1')
    await c.restore('private-session')
    expect(c.state.getSnapshot().selection).toBeNull()
    c.dispose()
  })
  it('reuses the first-message identity after an ambiguous transport failure', async () => {
    const ids: string[] = []
    let sends = 0
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/open')) return Response.json({ opened: false, reason: 'select-employee', detail })
      if (!url.endsWith('/messages')) return Response.json(detail)
      ids.push((JSON.parse(String(init?.body)) as { messageId: string }).messageId)
      if (++sends === 1) throw new Error('connection lost after admission')
      return Response.json({ delivered: true, targets: [] })
    })
    const c = new CollaborationController(request, vi.fn(), vi.fn())
    await c.select('group-1')
    expect(await c.send('@Analyst hello')).toBe(false)
    expect(await c.send('@Analyst hello')).toBe(true)
    expect(ids[0]).toBe(ids[1])
    c.dispose()
  })

  it('does not open a routed reply after the user selected a global panel', async () => {
    const open = vi.fn()
    const c = new CollaborationController(fetcher(Response.json({ detail })), open, vi.fn())
    await c.restore('session')
    c.setMainPanel('plugins')
    await c.openRouted('session', ['response'])
    expect(open).not.toHaveBeenCalled()
    c.dispose()
  })

  it('reuses a creation identity after a lost response', async () => {
    const keys: string[] = []
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/groups')) {
        keys.push((JSON.parse(String(init?.body)) as { idempotencyKey: string }).idempotencyKey)
        if (keys.length === 1) throw new Error('lost response')
        return Response.json(surface)
      }
      if (url === '/enterprise/surfaces') return Response.json([surface])
      if (url.endsWith('/open')) return Response.json({ opened: false, reason: 'select-employee', detail })
      return Response.json(detail)
    })
    const c = new CollaborationController(request, vi.fn(), vi.fn())
    const input = { kind: 'group' as const, name: 'Renewal', workspaceId: 'w', memberEmployeeIds: ['a'], memberUserIds: [] }
    expect(await c.create(input)).toBe(false)
    expect(await c.create(input)).toBe(true)
    expect(keys[0]).toBe(keys[1])
    c.dispose()
  })

})
