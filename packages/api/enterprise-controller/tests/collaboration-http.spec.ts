import { describe, expect, it } from 'vitest'
import { CollaborationHttpHandler } from '../src/collaboration-http.ts'

// HTTP input rejection must precede runtime dispatch, even for an authenticated member.
describe('collaboration HTTP request validation', () => {
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
})
