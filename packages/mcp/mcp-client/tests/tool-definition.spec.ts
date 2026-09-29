import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { createMcpToolDefinition } from '../src/index.ts'

describe('MCP result callback adaptation', () => {
  it('preserves the exact execution, arguments and canonical structured results', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ToolRuntime)
      let execution: ToolExecution | undefined
      ctx.on('tools/execute', (exec, next) => {
        execution = exec
        return next()
      })
      const call = vi.fn(async () => ({
        content: [{ type: 'text', text: 'Observed window.' }],
        structuredContent: { window: 7 },
      }))
      ctx.tools.register(createMcpToolDefinition(ctx, {
        name: 'native_window', serverName: 'server__identity', rawName: 'window', description: 'Read the selected window.',
        inputSchema: { type: 'object', properties: { window: { type: 'integer' } } },
        outputSchema: { type: 'object', properties: { window: { type: 'integer' } }, required: ['window'] },
        call,
      }))
      expect(ctx.tools.get('native_window')?.integration).toEqual({ kind: 'mcp', name: 'server__identity', rawName: 'window' })
      expect(ctx.tools.schemas()[0]).not.toHaveProperty('integration')
      const signal = new AbortController().signal
      const result = await ctx.tools.execute({
        name: 'native_window', callId: ToolCallId('window-call'), arguments: { window: 7 }, signal,
      })
      expect(call).toHaveBeenCalledWith({ window: 7 }, execution)
      expect(execution?.signal).toBe(signal)
      expect(result.isError).toBe(false)
      expect(result.value).toEqual({
        content: [{ type: 'text', text: 'Observed window.' }], structuredContent: { window: 7 },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it.each([null, { content: [42] }, { content: [{ type: 'image' }] }])(
    'rejects invalid external results before exposing content (%j)', async (invalid) => {
      const ctx = new Context()
      try {
        await ctx.plugin(SystemPrompt)
        await ctx.plugin(ToolRuntime)
        ctx.tools.register(createMcpToolDefinition(ctx, {
          name: 'invalid_result', rawName: 'invalid', description: 'External result fixture.',
          inputSchema: { type: 'object' }, call: async () => invalid,
        }))
        const result = await ctx.tools.execute({
          name: 'invalid_result', callId: ToolCallId('invalid-call'), arguments: {},
          signal: new AbortController().signal,
        })
        expect(result.isError).toBe(true)
        expect(result.value).toBeUndefined()
      } finally {
        await ctx.fiber.dispose()
      }
    },
  )
})

it('retains exact MCP names when the public name is normalized or contains separators', async () => {
  const { publicToolName } = await import('../src/tools.ts')
  const ctx = new Context()
  const serverName = 'server__namespace'
  const rawName = 'path/with__separators/' + 'x'.repeat(70)
  const name = publicToolName(serverName, rawName)
  const tool = createMcpToolDefinition(ctx, {
    name, serverName, rawName, description: '', inputSchema: { type: 'object' },
    call: async () => ({ content: [] }),
  })
  expect(name.length).toBeLessThanOrEqual(64)
  expect(tool.integration).toEqual({ kind: 'mcp', name: serverName, rawName })
  await ctx.fiber.dispose()
})
