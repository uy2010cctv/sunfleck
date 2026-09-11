import type { DeviceAction, DeviceActionResult, DeviceAdapter } from './protocol.ts'

interface CuaModule {
  CuaDriver: { create(options: undefined): CuaDriver }
  StartSessionInput: { new(input: { session: string }): unknown }
  GetScreenSizeInput: { new(input: { session: string }): unknown }
  EndSessionInput: { new(input: { session: string }): unknown }
}
interface CuaDriver {
  startSession(input: unknown): Promise<void>
  getScreenSize(input: unknown): Promise<{ structuredJson?: unknown; rawJson?: unknown }>
  endSession(input: unknown): Promise<void>
  shutdown(): Promise<void>
  uniffiDestroy?: () => void
}

/** Cua is intentionally loaded at runtime: the local agent owns its SDK and macOS permissions. */
export class CuaAdapter implements DeviceAdapter {
  readonly kind = 'cua' as const
  async execute(action: DeviceAction, signal: AbortSignal): Promise<DeviceActionResult> {
    if (signal.aborted) return { operationId: action.operationId, state: 'paused', summary: 'Paused before desktop action.' }
    const modulePath = action.payload['driverModulePath']
    if (typeof modulePath !== 'string' || modulePath === '') return { operationId: action.operationId, state: 'rejected', summary: 'Cua Driver is not configured locally.' }
    try {
      const cua = await import(modulePath) as unknown as CuaModule
      if (action.capability !== 'desktop.observe' || action.payload['command'] !== 'screen-size') {
        return { operationId: action.operationId, state: 'rejected', summary: 'Cua action requires explicit local driver routing.' }
      }
      const session = `dsh-${action.runId}`
      const driver = cua.CuaDriver.create(undefined)
      try {
        await driver.startSession(cua.StartSessionInput.new({ session }))
        const result = await driver.getScreenSize(cua.GetScreenSizeInput.new({ session }))
        return { operationId: action.operationId, state: 'completed', summary: String(result.structuredJson ?? result.rawJson) }
      } finally {
        await driver.endSession(cua.EndSessionInput.new({ session })).catch(() => {})
        await driver.shutdown()
        if (typeof driver.uniffiDestroy === 'function') driver.uniffiDestroy()
      }
    } catch (error) {
      return { operationId: action.operationId, state: 'failed', summary: error instanceof Error ? error.message : String(error) }
    }
  }
}
