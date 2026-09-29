/** Metadata-only capability fold behavior. */
import { describe, expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { capabilityProjection } from '../src/capabilities.ts'

function event(value: SessionEvent): SessionEvent { return value }

describe('capability projection', () => {
  it('counts native and nested attempts without counting settlement or retaining arguments', () => {
    let state = capabilityProjection.init()
    state = capabilityProjection.apply(state, event({ seq: SessionSeq(0), time: 10, type: 'tool/call', data: { turn: 0, step: 0, callId: ToolCallId('root'), name: 'run_code', arguments: 'secret' } }))
    state = capabilityProjection.apply(state, event({ seq: SessionSeq(1), time: 20, type: 'tool/ptc-dispatch-start', data: { rootCallId: ToolCallId('root'), parentCallId: ToolCallId('root'), subCallId: ToolCallId('nested'), name: 'lookup', arguments: { secret: true } } }))
    state = capabilityProjection.apply(state, event({ seq: SessionSeq(2), time: 30, type: 'tool/ptc-dispatch', data: { rootCallId: ToolCallId('root'), parentCallId: ToolCallId('root'), subCallId: ToolCallId('nested'), name: 'lookup', arguments: {}, isError: true, content: [] } }))
    expect(state.tools).toEqual([
      { name: 'run_code', description: '', availability: 'observed', calls: 1, lastUsedAt: 10 },
      { name: 'lookup', description: '', availability: 'observed', calls: 1, lastUsedAt: 20 },
    ])
    expect(JSON.stringify(state)).not.toContain('secret')
  })
})

import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { SessionQueryError, type SessionObservation } from '@deepseek-ai/dsh-session-query'
import { vi } from 'vitest'
import { readSessionCapabilities } from '../src/capabilities.ts'

async function inventoryContext(live: boolean) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  const sessionId = SessionId('capabilities')
  const session = ctx.sessions.create(sessionId)
  if (live) await ctx.agents.register({ id: sessionId, session, status: 'idle', ctx } as Agent)
  const recorded = { catalogAt: 1, tools: [
    { name: 'visible', description: 'old', availability: 'last-request' as const, calls: 2, lastUsedAt: 3 },
    { name: 'removed', description: 'removed tool', availability: 'observed' as const, calls: 1, lastUsedAt: 2 },
    { name: 'no-longer-offered', description: '', availability: 'last-request' as const, calls: 0, lastUsedAt: null },
  ] }
  const lease: SessionObservation = {
    source: 'prepared', header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 1, isSeeded: false },
    inheritedEventCount: SessionLogOffset(0), cursor: -1,
    get events(): readonly SessionEvent[] { throw new Error('inventory must not access events') },
    projections: { asOfSeq: -1, values: { capabilityCatalog: recorded } },
    retain: () => lease, [Symbol.dispose]: vi.fn(),
  }
  const observeSession = vi.fn(() => Promise.resolve(lease))
  ctx.provide('sessionQuery', { observeSession } as never)
  return { ctx, sessionId, lease, observeSession, recorded }
}

describe('readSessionCapabilities', () => {
  it('reads cold projection evidence without waking an Agent or reading event arguments', async () => {
    const { ctx, sessionId, recorded, lease } = await inventoryContext(false)
    try {
      const resume = vi.spyOn(ctx.agents, 'resume')
      expect(await readSessionCapabilities(ctx, { sessionId }, new AbortController().signal))
        .toEqual({ sessionId, live: false, ...recorded })
      expect(resume).not.toHaveBeenCalled()
      expect(lease[Symbol.dispose]).toHaveBeenCalledOnce()
    } finally { await ctx.fiber.dispose() }
  })

  it('uses the Agent-scoped offered schemas and exact integration metadata', async () => {
    const { ctx, sessionId } = await inventoryContext(true)
    try {
      const agent = ctx.agents.get(sessionId)
      const schemas = vi.fn(() => [{ name: 'visible', description: 'current', parameters: { secret: true } }])
      const integration = { kind: 'mcp' as const, name: 'server__with_parts', rawName: 'raw/name__parts' }
      const get = vi.fn(() => ({ integration }))
      ctx.provide('tools', { schemas, get } as never)
      const result = await readSessionCapabilities(ctx, { sessionId }, new AbortController().signal)
      expect(schemas).toHaveBeenCalledWith(agent)
      expect(get).toHaveBeenCalledWith('visible', agent)
      expect(result.tools).toEqual([
        { name: 'visible', description: 'current', availability: 'registered', calls: 2, lastUsedAt: 3, integration },
        { name: 'removed', description: 'removed tool', availability: 'observed', calls: 1, lastUsedAt: 2 },
      ])
      expect(JSON.stringify(result)).not.toContain('secret')
      get.mockReturnValue({ integration: { kind: 'subagent', name: 'configured', protocol: 'acp' } } as never)
      expect((await readSessionCapabilities(ctx, { sessionId }, new AbortController().signal)).tools[0]?.integration).toEqual({ kind: 'subagent', name: 'configured', protocol: 'acp' })
    } finally { await ctx.fiber.dispose() }
  })

  it('maps missing, cancelled and failed observations without resuming', async () => {
    const { ctx, sessionId, observeSession } = await inventoryContext(false)
    try {
      observeSession.mockRejectedValueOnce(new SessionQueryError('missing', 'SESSION_QUERY_SESSION_NOT_FOUND'))
      await expect(readSessionCapabilities(ctx, { sessionId }, new AbortController().signal)).rejects.toMatchObject({ code: 'session/not-found' })
      observeSession.mockRejectedValueOnce(new SessionQueryError('cancelled', 'SESSION_QUERY_ABORTED'))
      await expect(readSessionCapabilities(ctx, { sessionId }, new AbortController().signal)).rejects.toMatchObject({ code: 'gateway/cancelled' })
      observeSession.mockRejectedValueOnce(new Error('failed'))
      await expect(readSessionCapabilities(ctx, { sessionId }, new AbortController().signal)).rejects.toMatchObject({ code: 'gateway/internal' })
    } finally { await ctx.fiber.dispose() }
  })
})

it('replaces request inventory while preserving observed tools after removal', () => {
  const call = event({ seq: SessionSeq(0), time: 2, type: 'tool/call', data: { turn: 0, step: 0, callId: ToolCallId('call'), name: 'removed', arguments: '{}' } })
  const state = capabilityProjection.apply(capabilityProjection.init(), call)
  const updated = capabilityProjection.apply(state, event({ seq: SessionSeq(1), time: 5, type: 'request/header', data: {
    reason: 'initial', header: { config: { provider: 'fixture', model: 'fixture' }, tools: [{ name: 'new', description: 'New tool', parameters: { secretSchema: true } }] },
  } }))
  expect(updated).toEqual({ catalogAt: 5, tools: [
    { name: 'removed', description: '', availability: 'observed', calls: 1, lastUsedAt: 2 },
    { name: 'new', description: 'New tool', availability: 'last-request', calls: 0, lastUsedAt: null },
  ] })
  expect(JSON.stringify(updated)).not.toContain('secretSchema')
  expect(capabilityProjection.apply(updated, event({ seq: SessionSeq(2), time: 6, type: 'request/header', data: { reason: 'change', header: { config: { provider: 'fixture', model: 'fixture' } } } })).tools).toEqual([updated.tools[0]])
})
