import { describe, expect, it, vi } from 'vitest'
import { PlaywrightMcpAdapter, playwrightToolForAction } from '../src/playwright-mcp-adapter.ts'

describe('PlaywrightMcpAdapter', () => {
  it('maps typed operations to the Playwright MCP tool contract', () => {
    expect(playwrightToolForAction({ kind: 'browser.open', url: 'https://example.com' }))
      .toEqual({ name: 'browser_navigate', arguments: { url: 'https://example.com' } })
    expect(playwrightToolForAction({ kind: 'browser.snapshot' }))
      .toEqual({ name: 'browser_snapshot', arguments: {} })
  })

  it('returns a bounded summary from the MCP result', async () => {
    const callTool = vi.fn(async () => ({ content: [{ type: 'text', text: 'snapshot ready' }] }))
    const adapter = new PlaywrightMcpAdapter({ callTool })
    const result = await adapter.execute({
      actionId: 'action-1', operationId: 'op-1', runId: 'run-1', deviceId: 'device-1',
      capability: 'browser.observe', adapter: 'playwright-mcp', operation: { kind: 'browser.snapshot' },
    }, new AbortController().signal)
    expect(result).toMatchObject({ state: 'completed', summary: 'snapshot ready' })
    expect(callTool).toHaveBeenCalledWith({ name: 'browser_snapshot', arguments: {} })
  })
})
