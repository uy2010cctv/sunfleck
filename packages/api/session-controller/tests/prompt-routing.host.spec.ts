import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SessionCommandController } from '../src/commands.ts'
import type { ApiSessionAgentController } from '../src/agent.ts'
import type { SessionPromptRequest, SessionRequestId } from '../src/types.ts'

const request: SessionPromptRequest = { sessionId: SessionId('collaboration'), requestId: brandString<SessionRequestId>('request-1'), content: [{ type: 'text', text: '@Analyst investigate' }], mode: 'queue' }

describe('Session prompt routing', () => {
  it('routes before native Agent admission and restores native delegation on disposal', async () => {
    const ctx = new Context()
    const native = vi.fn(() => Promise.reject(new Error('native admission')))
    const commands = new SessionCommandController(ctx, { resolveAgent: native } as never as ApiSessionAgentController, '/workspace')
    const route = vi.fn(async () => ({ accepted: true as const }))
    const off = ctx.on('api/session-prompt', route)
    await expect(commands.prompt(request)).resolves.toEqual({ accepted: true })
    expect(route).toHaveBeenCalledOnce()
    expect(native).not.toHaveBeenCalled()
    off()
    await expect(commands.prompt(request)).rejects.toThrow('native admission')
    expect(native).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })

  it('keeps native delegation and routing denial distinct', async () => {
    const ctx = new Context()
    const native = vi.fn(() => Promise.reject(new Error('native admission')))
    const commands = new SessionCommandController(ctx, { resolveAgent: native } as never as ApiSessionAgentController, '/workspace')
    const off = ctx.on('api/session-prompt', (_request, next) => next())
    await expect(commands.prompt(request)).rejects.toThrow('native admission')
    off()
    ctx.on('api/session-prompt', () => Promise.reject(new Error('membership required')))
    await expect(commands.prompt(request)).rejects.toThrow('membership required')
    expect(native).toHaveBeenCalledOnce()
    await ctx.fiber.dispose()
  })
})
