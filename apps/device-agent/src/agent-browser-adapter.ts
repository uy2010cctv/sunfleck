import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DeviceAction, DeviceActionResult, DeviceAdapter } from './protocol.ts'

const exec = promisify(execFile)

export class AgentBrowserAdapter implements DeviceAdapter {
  readonly kind = 'agent-browser' as const
  async execute(action: DeviceAction, signal: AbortSignal): Promise<DeviceActionResult> {
    if (signal.aborted) return { operationId: action.operationId, state: 'paused', summary: 'Paused before browser action.' }
    const command = action.payload['command']
    const args = action.payload['args']
    if (typeof command !== 'string' || !Array.isArray(args) || args.some(value => typeof value !== 'string')) {
      return { operationId: action.operationId, state: 'rejected', summary: 'Invalid browser action payload.' }
    }
    try {
      const result = await exec('agent-browser', [command, ...args], { signal })
      return { operationId: action.operationId, state: 'completed', summary: result.stdout.trim() || 'Browser action completed.' }
    } catch (error) {
      return { operationId: action.operationId, state: signal.aborted ? 'paused' : 'failed', summary: error instanceof Error ? error.message : String(error) }
    }
  }
}
