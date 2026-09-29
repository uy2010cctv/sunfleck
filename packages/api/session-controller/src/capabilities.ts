/** Read-only scoped tool inventory and metadata-only historical fold. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-tools'
import { SessionQueryError } from '@deepseek-ai/dsh-session-query'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import type { SessionCapabilityCatalog, SessionCapabilityTool, SessionCapabilitiesRequest, SessionCapabilitiesValue } from './types.ts'

const catalogSchema: z.ZodType<SessionCapabilityCatalog> = z.object({
  catalogAt: z.number().nullable(),
  tools: z.array(z.object({
    name: z.string(), description: z.string(), availability: z.enum(['registered', 'last-request', 'observed']),
    calls: z.number().int().nonnegative(), lastUsedAt: z.number().nullable(),
  })),
})

/** Pure fold retaining only names, descriptions and attempt counters. */
export const capabilityProjection = {
  key: 'capabilityCatalog',
  stateSchema: catalogSchema,
  stateVersion: 1,
  init: (): SessionCapabilityCatalog => ({ catalogAt: null, tools: [] }),
  apply(state: SessionCapabilityCatalog, event: SessionEvent): SessionCapabilityCatalog {
    if (event.type === 'request/header') {
      const offered = new Map((event.data.header.tools ?? []).map(tool => [tool.name, tool.description]))
      const tools: SessionCapabilityTool[] = state.tools.filter(tool => tool.calls > 0 || offered.has(tool.name)).map(tool => ({
        ...tool, description: offered.get(tool.name) ?? tool.description,
        availability: offered.has(tool.name) ? 'last-request' : 'observed',
      }))
      for (const [name, description] of offered) {
        if (!tools.some(tool => tool.name === name)) tools.push({ name, description, availability: 'last-request', calls: 0, lastUsedAt: null })
      }
      return { catalogAt: event.time, tools }
    }
    if (event.type !== 'tool/call' && event.type !== 'tool/ptc-dispatch-start') return state
    const name = event.data.name
    const previous = state.tools.find(tool => tool.name === name)
    const tool: SessionCapabilityTool = previous === undefined
      ? { name, description: '', availability: 'observed', calls: 1, lastUsedAt: event.time }
      : { ...previous, calls: previous.calls + 1, lastUsedAt: event.time }
    return { ...state,
      tools: previous === undefined ? [...state.tools, tool] : state.tools.map(value => value.name === name ? tool : value),
    }
  },
  wire: { viewSchema: catalogSchema, view: (state: SessionCapabilityCatalog) => state },
} satisfies ProjectionDefinition<'capabilityCatalog'>

/**
 * Read one existing Session's scoped registrations and recorded attempts without Agent activation.
 * @param ctx - Session Controller context.
 * @param request - existing Session identity.
 * @param signal - caller cancellation for cold persistence reads.
 * @returns metadata-only inventory; registered means offered, not connected.
 */
export async function readSessionCapabilities(
  ctx: Context, request: SessionCapabilitiesRequest, signal: AbortSignal,
): Promise<SessionCapabilitiesValue> {
  if (request.sessionId.length === 0) throw new RemoteError('gateway/bad-request', 'sessionId must not be empty', {})
  try {
    using observation = await ctx.sessionQuery.observeSession(request.sessionId, { signal })
    const catalog = observation.projections?.values.capabilityCatalog
    if (catalog === undefined) throw new RemoteError('session/projections-unavailable', 'Session capability projection is unavailable', {})
    const agent = ctx.agents.get(request.sessionId)
    if (agent === undefined) return { sessionId: request.sessionId, live: false, ...catalog }
    const offered = ctx.tools.schemas(agent)
    const tools: SessionCapabilityTool[] = offered.map((schema) => {
      const recorded = catalog.tools.find(tool => tool.name === schema.name)
      const integration = ctx.tools.get(schema.name, agent)?.integration
      return { name: schema.name, description: schema.description, availability: 'registered', calls: recorded?.calls ?? 0, lastUsedAt: recorded?.lastUsedAt ?? null,
        ...(integration === undefined ? {} : { integration: { ...integration } }),
      }
    })
    for (const recorded of catalog.tools) {
      if (recorded.calls > 0 && !tools.some(tool => tool.name === recorded.name)) tools.push({ ...recorded, availability: 'observed' })
    }
    return { sessionId: request.sessionId, live: true, catalogAt: catalog.catalogAt, tools }
  } catch (error: unknown) {
    if (signal.aborted || (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_ABORTED')) throw new RemoteError('gateway/cancelled', 'Session capability read was cancelled', {}, { cause: error })
    if (error instanceof SessionQueryError && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') throw new RemoteError('session/not-found', 'Session does not exist', { sessionId: request.sessionId })
    if (error instanceof RemoteError) throw error
    throw new RemoteError('gateway/internal', 'Session capability read failed', {}, { cause: error })
  }
}
