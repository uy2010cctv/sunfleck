import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { installedBrowserExecutable } from './browser-executable.ts'
import type { DeviceAction, DeviceActionResult, DeviceAdapter, DeviceOperation } from './protocol.ts'

const exec = promisify(execFile)
const agentBrowserCli = fileURLToPath(new URL('./bin/agent-browser.js', import.meta.resolve('agent-browser/package.json')))

export function commandForAction(operation: DeviceOperation): string[] {
  switch (operation.kind) {
    case 'browser.open': return ['open', operation.url]
    case 'browser.snapshot': return ['snapshot', '-i']
    case 'browser.click': return ['click', operation.selector]
    case 'browser.fill': return ['fill', operation.selector, operation.value]
    default: throw new Error('unsupported browser operation')
  }
}

export function agentBrowserInvocation(
  operation: DeviceOperation,
  browserExecutable: string | undefined = installedBrowserExecutable(),
): { readonly command: string; readonly args: string[] } {
  const browserArgs = browserExecutable === undefined ? [] : ['--executable-path', browserExecutable]
  return { command: process.execPath, args: [agentBrowserCli, ...browserArgs, ...commandForAction(operation)] }
}

export class AgentBrowserAdapter implements DeviceAdapter {
  readonly kind = 'agent-browser' as const
  async execute(action: DeviceAction, signal: AbortSignal): Promise<DeviceActionResult> {
    if (signal.aborted) return { operationId: action.operationId, state: 'paused', summary: 'Paused before browser action.' }
    try {
      const invocation = agentBrowserInvocation(action.operation)
      const result = await exec(invocation.command, invocation.args, { signal })
      return { operationId: action.operationId, state: 'completed', summary: result.stdout.trim() || 'Browser action completed.' }
    } catch (error) {
      return { operationId: action.operationId, state: signal.aborted ? 'paused' : 'failed', summary: error instanceof Error ? error.message : String(error) }
    }
  }
}
