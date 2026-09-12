import type { DeviceAction, DeviceActionResult, DeviceAdapter, DeviceOperation } from './protocol.ts'

interface CuaModule {
  CuaDriver: { create(options: undefined): CuaDriver }
  StartSessionInput: { new: (input: { session: string }) => unknown }
}
interface CuaDriver {
  startSession(input: unknown): Promise<void>
  callTool(name: string, argumentsJson: string, options?: { signal: AbortSignal }): Promise<{
    text?: string
    structuredJson?: string
    rawJson?: string
    isError?: boolean
  }>
}
type CuaLoader = (modulePath: string) => Promise<CuaModule>

function toolForOperation(operation: DeviceOperation, session: string): { name: string; args: Record<string, unknown> } {
  switch (operation.kind) {
    case 'desktop.screen-size': return { name: 'get_screen_size', args: { session } }
    case 'desktop.windows': return { name: 'list_windows', args: { on_screen_only: true } }
    case 'desktop.snapshot': return { name: 'get_window_state', args: {
      pid: operation.pid, window_id: operation.windowId, session,
      include_accessibility_tree: true, include_screenshot: false, max_elements: 1_000,
    } }
    case 'desktop.click': return { name: 'click', args: {
      pid: operation.pid, window_id: operation.windowId, session, delivery_mode: 'foreground',
      ...(operation.elementToken === undefined ? { x: operation.x, y: operation.y } : { element_token: operation.elementToken }),
    } }
    case 'desktop.type': return { name: 'type_text', args: {
      pid: operation.pid, window_id: operation.windowId, session, delivery_mode: 'foreground',
      element_token: operation.elementToken, text: operation.text,
    } }
    default: throw new Error('unsupported Cua operation')
  }
}

/** Cua is intentionally loaded at runtime: the local agent owns its SDK and macOS permissions. */
export class CuaAdapter implements DeviceAdapter {
  readonly kind = 'cua' as const
  private runtime: Promise<{ cua: CuaModule; driver: CuaDriver }> | undefined
  private readonly sessions = new Set<string>()
  constructor(
    private readonly modulePath: string,
    private readonly load: CuaLoader = path => import(path) as Promise<CuaModule>,
  ) {}
  async execute(action: DeviceAction, signal: AbortSignal): Promise<DeviceActionResult> {
    if (signal.aborted) return { operationId: action.operationId, state: 'paused', summary: 'Paused before desktop action.' }
    if (this.modulePath === '') return { operationId: action.operationId, state: 'rejected', summary: 'Cua Driver is not configured locally.' }
    try {
      if (!action.operation.kind.startsWith('desktop.')) {
        return { operationId: action.operationId, state: 'rejected', summary: 'Cua action requires explicit local driver routing.' }
      }
      const session = `dsh-${action.runId}`
      const { cua, driver } = await (this.runtime ??= this.load(this.modulePath).then(cua => ({
        cua, driver: cua.CuaDriver.create(undefined),
      })))
      if (!this.sessions.has(session)) {
        await driver.startSession(cua.StartSessionInput.new({ session }))
        this.sessions.add(session)
      }
      const tool = toolForOperation(action.operation, session)
      const result = await driver.callTool(tool.name, JSON.stringify(tool.args), { signal })
      const detail = action.operation.kind === 'desktop.windows'
        ? result.structuredJson || result.text?.trim()
        : result.text?.trim() || result.structuredJson
      const summary = (detail || result.rawJson || 'Cua action completed.').slice(0, 16_384)
      return { operationId: action.operationId, state: result.isError === true ? 'failed' : 'completed', summary }
    } catch (error) {
      return { operationId: action.operationId, state: 'failed', summary: error instanceof Error ? error.message : String(error) }
    }
  }
}
