import { describe, expect, it, vi } from 'vitest'
import { PlaywrightMcpAdapter, playwrightMcpInvocation, playwrightToolForAction } from '../src/playwright-mcp-adapter.ts'

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

  it('launches the package-local MCP CLI without relying on PATH', () => {
    const invocation = playwrightMcpInvocation('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', false)
    expect(invocation.command).toBe(process.execPath)
    expect(invocation.args[0]).toMatch(/@playwright(?:\/|\\)mcp(?:\/|\\)cli\.js$/u)
    expect(invocation.args.slice(1)).toEqual([
      '--isolated', '--executable-path', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ])
  })

  it('keeps explicit managed headless mode available', () => {
    const invocation = playwrightMcpInvocation('/managed/chrome', true)
    expect(invocation.args.slice(1)).toEqual(['--isolated', '--headless', '--executable-path', '/managed/chrome'])
  })
})
