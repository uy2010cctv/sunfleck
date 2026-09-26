import { describe, expect, it, vi } from 'vitest'
import { CollaborationHttpHandler } from '../src/collaboration-http.ts'

// HTTP input rejection must precede runtime dispatch, even for an authenticated member.
describe('collaboration HTTP request validation', () => {
  const security = {
    authenticateCookieAsync: async () => ({ orgId: 'org', userId: 'member', roles: ['administrator'] }),
    authorizeResourceAsync: async () => ({ allowed: true, reason: 'administrator' }),
    auditApiResourceAsync: async () => {},
  }
  it('rejects attachments explicitly rather than dropping their content', async () => {
    const handler = new CollaborationHttpHandler({} as never, {
      authenticateCookieAsync: async () => ({ orgId: 'org', userId: 'member', roles: ['administrator'] }),
      authorizeResourceAsync: async () => ({ allowed: true, reason: 'administrator' }),
      auditApiResourceAsync: async () => {},
    } as never)
    const result = await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/messages', {
      method: 'POST', body: JSON.stringify({ text: 'Read this', attachments: [{ id: 'file' }] }),
    }))
    expect(result.status).toBe(400)
    expect(await result.json()).toEqual({ error: 'text-only-collaboration' })
  })

  it('requires one valid cursor direction and routes bounded event pages', async () => {
    const events = vi.fn(async () => ({ items: [], nextCursor: null, prevCursor: null }))
    const handler = new CollaborationHttpHandler({ events } as never, security as never)
    const invalid = await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/events?after=3&before=9'))
    expect(invalid.status).toBe(400)
    expect(events).not.toHaveBeenCalled()
    const response = await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/events?before=9&limit=30'))
    expect(response.status).toBe(200)
    expect(events).toHaveBeenCalledWith(expect.objectContaining({ userId: 'member' }), 'group', { before: '9', limit: 30 })
  })

  it('passes a thread root and signed reaction target through authenticated routes', async () => {
    const events = vi.fn(async () => ({ items: [], nextCursor: null, prevCursor: null }))
    const react = vi.fn(async () => ({ event: { id: 'signed' } }))
    const handler = new CollaborationHttpHandler({ events, react } as never, security as never)
    const page = await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/events?threadRoot=parent'))
    expect(page.status).toBe(200)
    expect(events).toHaveBeenCalledWith(expect.anything(), 'group', { limit: 50, threadRoot: 'parent' })
    const reaction = await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/reactions', {
      method: 'POST', body: JSON.stringify({ eventId: 'signed', emoji: '👍', requestId: 'react-1' }),
    }))
    expect(reaction.status).toBe(200)
    expect(react).toHaveBeenCalledWith(expect.anything(), 'group', { eventId: 'signed', emoji: '👍', requestId: 'react-1' })
  })

  it('accepts an exact room read sequence and explicit human mentions', async () => {
    const markRead = vi.fn(async () => {})
    const message = vi.fn(async () => ({ delivered: true, targets: [] }))
    const handler = new CollaborationHttpHandler({ markRead, message } as never, security as never)
    const invalid = await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/read', {
      method: 'POST', body: JSON.stringify({ sequence: '0' }),
    }))
    expect(invalid.status).toBe(400)
    expect(markRead).not.toHaveBeenCalled()
    const response = await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/read', {
      method: 'POST', body: JSON.stringify({ sequence: '42' }),
    }))
    expect(await response.json()).toEqual({ sequence: '42' })
    expect(markRead).toHaveBeenCalledWith(expect.objectContaining({ userId: 'member' }), 'group', '42')
    await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/messages', {
      method: 'POST', body: JSON.stringify({ text: '@Alice review', mentionedUserIds: ['alice'] }),
    }))
    expect(message).toHaveBeenCalledWith(expect.anything(), 'group', { text: '@Alice review', mentionedUserIds: ['alice'] })
  })
})
