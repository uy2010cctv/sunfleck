import type { DeviceAction, DeviceActionResult, DeviceAdapter, DeviceOperation } from './protocol.ts'

interface McpToolRequest { readonly name: string; readonly arguments: Readonly<Record<string, unknown>> }
interface McpToolResult { readonly content?: readonly { readonly type: string; readonly text?: string }[]; readonly isError?: boolean }
type CallTool = (request: McpToolRequest) => Promise<McpToolResult>

export function playwrightToolForAction(operation: DeviceOperation): McpToolRequest {
  switch (operation.kind) {
    case 'browser.open': return { name: 'browser_navigate', arguments: { url: operation.url } }
    case 'browser.snapshot': return { name: 'browser_snapshot', arguments: {} }
    case 'browser.click': return {
      name: 'browser_click', arguments: { element: 'approved page element', ref: operation.selector.replace(/^@/u, '') },
    }
    case 'browser.fill': return {
      name: 'browser_type', arguments: {
        element: 'approved page field', ref: operation.selector.replace(/^@/u, ''),
        text: operation.value, slowly: false, submit: false,
      },
    }
    default: throw new Error('unsupported Playwright MCP operation')
  }
}

export class PlaywrightMcpAdapter implements DeviceAdapter {
  readonly kind = 'playwright-mcp' as const
  private callTool: CallTool | undefined
  constructor(options: { readonly callTool?: CallTool } = {}) { this.callTool = options.callTool }

  async execute(action: DeviceAction, signal: AbortSignal): Promise<DeviceActionResult> {
    if (signal.aborted) return { operationId: action.operationId, state: 'paused', summary: 'Paused before browser action.' }
    try {
      const result = await (await this.caller())(playwrightToolForAction(action.operation))
      if (signal.aborted) return { operationId: action.operationId, state: 'paused', summary: 'Browser action paused.' }
      const summary = (result.content ?? []).flatMap(item => item.type === 'text' && item.text !== undefined ? [item.text] : [])
        .join('\n').slice(0, 4096) || 'Playwright MCP action completed.'
      return { operationId: action.operationId, state: result.isError === true ? 'failed' : 'completed', summary }
    } catch (error) {
      return { operationId: action.operationId, state: signal.aborted ? 'paused' : 'failed',
        summary: error instanceof Error ? error.message : String(error) }
    }
  }

  private async caller(): Promise<CallTool> {
    if (this.callTool !== undefined) return this.callTool
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js'),
    ])
    const client = new Client({ name: 'dsh-device-agent', version: '0.1.0' })
    await client.connect(new StdioClientTransport({ command: 'playwright-mcp', args: ['--headless', '--isolated'] }))
    this.callTool = request => client.callTool(request) as Promise<McpToolResult>
    return this.callTool
  }
}
