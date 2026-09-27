import { describe, expect, it, vi } from 'vitest'
import { CollaborationHttpHandler } from '../src/collaboration-http.ts'

// HTTP input rejection must precede runtime dispatch, even for an authenticated member.
interface AttachmentRef { readonly attachmentId: string; readonly name: string; readonly mimeType: string; readonly size: number }

describe('collaboration HTTP request validation', () => {
  const security = {
    authenticateCookieAsync: async () => ({ orgId: 'org', userId: 'member', roles: ['administrator'] }),
    authorizeResourceAsync: async () => ({ allowed: true, reason: 'administrator' }),
    auditApiResourceAsync: async () => {},
  }
  it('rejects a raw content field and malformed attachment references before the service', async () => {
    const handler = new CollaborationHttpHandler({} as never, {
      authenticateCookieAsync: async () => ({ orgId: 'org', userId: 'member', roles: ['administrator'] }),
      authorizeResourceAsync: async () => ({ allowed: true, reason: 'administrator' }),
      auditApiResourceAsync: async () => {},
    } as never)
    const content = await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/messages', {
      method: 'POST', body: JSON.stringify({ text: 'Read this', content: [{ type: 'text', text: 'x' }] }),
    }))
    expect(content.status).toBe(400)
    expect(await content.json()).toEqual({ error: 'text-only-collaboration' })
    const malformed = await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/messages', {
      method: 'POST', body: JSON.stringify({ text: 'Read this', attachments: 'file' }),
    }))
    expect(malformed.status).toBe(400)
    expect(await malformed.json()).toEqual({ error: 'invalid-body' })
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

  it('validates and routes group administrator operations before the service sees them', async () => {
    const rename = vi.fn(async () => ({ id: 'group' }))
    const setAnnouncement = vi.fn(async () => ({ id: 'group' }))
    const addMembers = vi.fn(async () => ({ id: 'group' }))
    const removeMembers = vi.fn(async () => ({ id: 'group' }))
    const handler = new CollaborationHttpHandler({ rename, setAnnouncement, addMembers, removeMembers } as never, security as never)
    const base = 'https://dsh/enterprise/surfaces/group'
    expect((await handler.fetch(new Request(`${base}/rename`, { method: 'POST', body: JSON.stringify({}) }))).status).toBe(400)
    expect(rename).not.toHaveBeenCalled()
    expect((await handler.fetch(new Request(`${base}/rename`, { method: 'POST', body: JSON.stringify({ name: 'New name' }) }))).status).toBe(200)
    expect(rename).toHaveBeenCalledWith(expect.objectContaining({ userId: 'member' }), 'group', 'New name')
    expect((await handler.fetch(new Request(`${base}/announcement`, { method: 'POST', body: JSON.stringify({ text: 'Launch Friday' }) }))).status).toBe(200)
    expect(setAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ userId: 'member' }), 'group', 'Launch Friday')
    expect((await handler.fetch(new Request(`${base}/announcement`, { method: 'POST', body: JSON.stringify({ text: '' }) }))).status).toBe(200)
    expect(setAnnouncement).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'member' }), 'group', '')
    expect((await handler.fetch(new Request(`${base}/members/add`, { method: 'POST', body: JSON.stringify({ memberUserIds: 'alice' }) }))).status).toBe(400)
    expect((await handler.fetch(new Request(`${base}/members/add`, { method: 'POST', body: JSON.stringify({}) }))).status).toBe(400)
    expect(addMembers).not.toHaveBeenCalled()
    expect((await handler.fetch(new Request(`${base}/members/add`, { method: 'POST',
      body: JSON.stringify({ memberEmployeeIds: ['analyst'], memberUserIds: ['alice'] }) }))).status).toBe(200)
    expect(addMembers).toHaveBeenCalledWith(expect.objectContaining({ userId: 'member' }), 'group',
      { employeeIds: ['analyst'], userIds: ['alice'] })
    expect((await handler.fetch(new Request(`${base}/members/remove`, { method: 'POST', body: JSON.stringify({ memberUserIds: ['alice'] }) }))).status).toBe(200)
    expect(removeMembers).toHaveBeenCalledWith(expect.objectContaining({ userId: 'member' }), 'group', { userIds: ['alice'] })
  })

  it('uploads raw attachment bytes and serves them back to room members', async () => {
    const uploadAttachment = vi.fn(async (): Promise<AttachmentRef> => ({ attachmentId: 'att-1', name: '报价.pdf', mimeType: 'application/pdf', size: 5 }))
    const attachment = vi.fn(async (): Promise<AttachmentRef & { readonly data: Buffer }> =>
      ({ attachmentId: 'att-1', name: '报价.pdf', mimeType: 'application/pdf', size: 5, data: Buffer.from('bytes') }))
    const handler = new CollaborationHttpHandler({ uploadAttachment, attachment } as never, security as never)
    const uploaded = await handler.fetch(new Request(
      'https://dsh/enterprise/surfaces/group/attachments?name=%E6%8A%A5%E4%BB%B7.pdf&type=application%2Fpdf',
      { method: 'POST', body: Buffer.from('bytes') }))
    expect(uploaded.status).toBe(201)
    expect(await uploaded.json()).toMatchObject({ attachmentId: 'att-1' })
    const call = uploadAttachment.mock.calls[0]
    expect(call?.[0]).toMatchObject({ userId: 'member' })
    expect(call?.[1]).toBe('group')
    expect((call?.[2] as { name: string; mimeType: string }).name).toBe('报价.pdf')
    expect(call?.[2]).toHaveProperty('data')
    const served = await handler.fetch(new Request('https://dsh/enterprise/surfaces/group/attachments/att-1'))
    expect(served.status).toBe(200)
    expect(served.headers.get('content-type')).toBe('application/pdf')
    expect(await served.text()).toBe('bytes')
  })
})
