import { createHash } from 'node:crypto'
import type { DeviceAction, DeviceActionResult, DeviceAdapter, LocalConfirmator, PermitConsumer } from './protocol.ts'

export class DeviceActionExecutor {
  private readonly aborters = new Map<string, AbortController>()
  constructor(
    private readonly permits: PermitConsumer,
    private readonly adapters: readonly DeviceAdapter[],
    private readonly confirmator: LocalConfirmator,
  ) {}
  async execute(action: DeviceAction): Promise<DeviceActionResult> {
    if (action.capability.endsWith('.control') && !(await this.confirmator.confirm(action))) {
      return { operationId: action.operationId, state: 'rejected', summary: 'Local user declined device control.' }
    }
    if (!(await this.permits.consume(action))) return { operationId: action.operationId, state: 'rejected', summary: 'Operation permit was rejected.' }
    const adapter = this.adapters.find(candidate => candidate.kind === action.adapter)
    if (adapter === undefined) return { operationId: action.operationId, state: 'rejected', summary: 'Requested device adapter is unavailable.' }
    const controller = new AbortController()
    this.aborters.set(action.runId, controller)
    try {
      const result = await adapter.execute(action, controller.signal)
      return result.evidenceHash === undefined
        ? { ...result, evidenceHash: createHash('sha256').update(result.summary).digest('hex') }
        : result
    }
    finally { this.aborters.delete(action.runId) }
  }
  pause(runId: string): void { this.aborters.get(runId)?.abort('paused by user') }
}
