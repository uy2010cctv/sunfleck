import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { composeCollaboration } from '../src/collaboration-runtime.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller'

const actor = { orgId: 'org', userId: 'alice', roles: ['administrator'] as const }

function setup(state: 'completed' | 'waiting-human') {
  const ctx = new Context()
  const operations = vi.fn(() => { throw new Error('receipt replay must precede charter lookup') })
  const teams = vi.fn(() => { throw new Error('receipt replay must precede lifecycle routing') })
  const binding = { surfaceId: 'group', topicId: 'run-old', employeeId: '', sessionId: 'original-root' }
  const close = vi.fn(async () => {})
  ctx.provide('enterprisePostgres' as never, {
    collaboration: {
      get: async () => ({ id: 'group', orgId: 'org', name: 'Team', kind: 'group', workspaceId: 'shared',
        memberUserIds: ['alice'], memberEmployeeIds: [], dutyEmployeeIds: [], teamDefinitionId: 'team-a' }),
      sessions: async () => [binding], bySession: async () => binding,
    },

  } as never)
  ctx.provide('sessionPersistence' as never, { open: async () => ({
    read: async () => ({ events: [
      { type: 'user/message', data: { source: { kind: 'user', rpcId: 'followup-1',
        runId: 'run-old', originSurfaceId: 'group', actorUserId: 'alice' } } },
      { type: 'team/run', data: { state } },
    ] }), close,
  }) } as never)
  ctx.provide('enterpriseSecurity' as never, {
    authenticateCookieAsync: async () => actor,
    authorizeResourceAsync: async () => ({ allowed: true, reason: 'role' }),
    authorizeApiAsync: async () => ({ allowed: true, reason: 'role' }),
    auditApiResourceAsync: async () => {},
  } as never)
  ctx.provide('enterpriseRequestContext' as never, { requirePrincipal: () => actor } as never)
  ctx.provide('enterpriseTeamRuntimeDriver' as never, {} as never)
  return { ctx, handler: composeCollaboration(ctx, { operations, teams }), operations, teams, close }
}

describe('collaboration native runtime receipts', () => {
  it.each(['completed', 'waiting-human'] as const)('replays the original target after a delivered run becomes %s', async (state) => {
    const app = setup(state)
    try {
      const response = await app.handler.fetch(new Request('https://dsh/enterprise/surfaces/group/messages', {
        method: 'POST', body: JSON.stringify({ text: 'Delivered follow-up', messageId: 'followup-1' }),
      }))
      expect(await response.json()).toEqual({ delivered: true, targets: [{ sessionId: 'original-root' }] })
      expect(app.operations).not.toHaveBeenCalled()
      expect(app.teams).not.toHaveBeenCalled()
      expect(app.close).toHaveBeenCalledOnce()
    } finally { await app.ctx.fiber.dispose() }
  })

  it('returns the authorized native response target to the original composer on retry', async () => {
    const app = setup('completed')
    try {
      const request: SessionPromptRequest = { sessionId: SessionId('original-root'), requestId: brandString<SessionRequestId>('followup-1'), mode: 'steer',
        content: [{ type: 'text', text: 'Delivered follow-up' }] }
      const result = await app.ctx.waterfall('api/session-prompt', request, async () => { throw new Error('must route collaboration') })
      expect(result).toEqual({ accepted: true, routedSessionIds: ['original-root'] })
      expect(app.teams).not.toHaveBeenCalled()
    } finally { await app.ctx.fiber.dispose() }
  })
})
