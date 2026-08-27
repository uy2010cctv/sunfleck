/**
 * The summary blank bit means "conversation not started" (no turn has run),
 * not "log empty": standalone plugin events — command lifecycle records,
 * plan/mode, permission knob events, session titles — never flip it, so running /plan or /goal on a
 * fresh session keeps it list-hidden and reusable, while the first accepted
 * prompt's turn/start clears it. The host/session-added frame shares the
 * same predicate function (covered by the workspace spec's frame assertion).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { CommandId } from '@deepseek-ai/dsh-commands/brand'
// Side-effect type imports: the knob-event SessionEventMap merges.
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { ApiProxy, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`blank-${String(nextRpc++)}`), payload }
}

async function harness(): Promise<{ ctx: Context; api: ApiProxy; attach: (session: Session) => void }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  return {
    ctx,
    api: createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }),
    attach: (session) => {
      ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
    },
  }
}

/** Append the standalone (non-conversation) event family a fresh session can accumulate. */
function appendStandalone(session: Session): void {
  session.append('command/run', {
    commandId: CommandId('blank-cmd-1'), name: 'plan', args: '', source: { kind: 'user' },
  })
  session.append('plan/mode', { active: true })
  session.append('command/done', { commandId: CommandId('blank-cmd-1'), kind: 'success', text: 'Plan mode on.' })
  session.append('session/title', {
    title: 'standalone title', messageSeqs: [], source: { kind: 'fallback' },
  })
  // The three permission knob events (a /permission switch on a fresh session).
  session.append('permission/preset', { preset: 'danger-full-access' })
  session.append('sandbox/mode', { mode: 'danger-full-access' })
  session.append('approval/policy', { policy: 'never' })
}

async function listBlank(api: ApiProxy, id: string): Promise<boolean | undefined> {
  const response = await api.sessions.list(request({}))
  if (!response.result.ok) throw new Error('list failed')
  return response.result.value.items.find(item => item.sessionId === id)?.blank
}

describe('summary blank = conversation not started', () => {
  it('reports enterprise APIs as unavailable without enterprise composition', async () => {
    const { api } = await harness()
    const response = await api.enterpriseEmployees.list(request({}))
    expect(response.result).toEqual({
      ok: false,
      error: { code: 'internal', message: 'enterprise API is unavailable in this profile', details: {} },
    })
  })

  it('injects the authenticated principal scope into catalog writes and emits after commit', async () => {
    const { ctx, api } = await harness()
    const seen: Record<string, unknown>[] = []
    const events: unknown[] = []
    const catalog = {
      async saveDraft(input: Record<string, unknown>) {
        seen.push(input)
        return { ...input, revision: 1, status: 'draft', updatedAt: 1 }
      },
    }
    ctx.provide('enterprisePostgres' as never, { catalog, operations: {} } as never)
    ctx.provide('enterpriseRequestContext' as never, {
      requirePrincipal: () => ({ userId: 'user-real', orgId: 'org-real', roles: ['administrator'] }),
      current: () => ({ userId: 'user-real', orgId: 'org-real', roles: ['administrator'] }),
    } as never)
    ctx.provide('enterpriseSecurity' as never, {
      authorizeApiAsync: async () => ({ allowed: true, reason: 'administrator' }),
      auditApiAsync: async () => undefined,
    } as never)
    ctx.on('enterprise/employee-updated', (payload) => { events.push(payload) })

    const response = await api.enterpriseEmployees.saveDraft(request({
      presetId: 'employee-1', expectedRevision: 0, idempotencyKey: 'idem-1',
      visibility: 'organization' as const, profile: {}, bindings: [],
    }))

    expect(response.result.ok).toBe(true)
    expect(seen).toEqual([expect.objectContaining({ orgId: 'org-real', ownerUserId: 'user-real' })])
    expect(events).toEqual([{ orgId: 'org-real', resourceId: 'employee-1' }])
  })

  it('filters enterprise host events to the connected principal organization', async () => {
    const { ctx, api } = await harness()
    ctx.provide('enterpriseRequestContext' as never, {
      current: () => ({ userId: 'user-real', orgId: 'org-real', roles: ['administrator'] }),
    } as never)
    ctx.provide('workspaceRegistry' as never, {
      list: () => [], get: () => undefined, archivedSessionIds: [],
    } as never)
    const abort = new AbortController()
    const iterator = api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const next = iterator.next()
    await Promise.resolve()
    ctx.emit('enterprise/asset-updated', { orgId: 'org-other', resourceId: 'asset-hidden' })
    ctx.emit('enterprise/asset-updated', { orgId: 'org-real', resourceId: 'asset-visible' })
    await expect(next).resolves.toMatchObject({
      value: { payload: { type: 'enterprise/event', event: 'enterprise/asset-updated', orgId: 'org-real', resourceId: 'asset-visible' } },
    })
    abort.abort()
    await iterator.return?.()
  })
  it('standalone events (command lifecycle, plan/mode, title) keep the session blank', async () => {
    const { ctx, api, attach } = await harness()
    const session = ctx.sessions.create()
    attach(session)
    expect(await listBlank(api, session.id)).toBe(true)
    appendStandalone(session)
    expect(await listBlank(api, session.id)).toBe(true)
  })

  it('the first turn clears blank', async () => {
    const { ctx, api, attach } = await harness()
    const session = ctx.sessions.create()
    attach(session)
    appendStandalone(session)
    session.append('turn/start', { turn: 0 })
    expect(await listBlank(api, session.id)).toBe(false)
  })
})
