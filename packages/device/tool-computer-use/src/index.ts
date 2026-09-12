import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ComputerUseMode, DeviceAdapterKind, DeviceCapability, DeviceOperation } from '@deepseek-ai/dsh-enterprise-device-plane'
import type {} from '@deepseek-ai/dsh-enterprise-postgres'

export const name = 'tool-computer-use'
export const inject = ['tools', 'enterprisePostgres']

/** Model-facing Computer Use tool configuration. */
export interface Config {
  /** Maximum time to wait for the local device to persist a terminal action result. */
  readonly resultTimeoutMs?: number
  /** Default local confirmation policy. Delegated skips per-action prompts but keeps Server permits and audit. */
  readonly confirmationMode?: Exclude<ComputerUseMode, 'observe'>
}
export const Config: z<Config> = z.object({
  resultTimeoutMs: z.number().step(1).min(1_000).max(60_000).default(30_000),
  confirmationMode: z.union(['delegated', 'confirm-each'] as const).default('delegated'),
})

/** Resolve the run confirmation mode, including the zero-config product default.
 * @param config - Plugin configuration supplied by the deployment.
 * @returns delegated by default, or the explicitly configured per-action confirmation mode.
 */
export function computerUseRunMode(config: Config): Exclude<ComputerUseMode, 'observe'> {
  return config.confirmationMode ?? 'delegated'
}

type OperationName = 'desktop_windows' | 'desktop_snapshot' | 'desktop_click' | 'desktop_type'
  | 'screen_size' | 'browser_open' | 'browser_snapshot' | 'browser_click' | 'browser_fill'
interface OperationArgs {
  readonly operation: OperationName
  readonly url?: string
  readonly selector?: string
  readonly value?: string
  readonly pid?: number
  readonly windowId?: number
  readonly x?: number
  readonly y?: number
  readonly engine?: 'agent-browser' | 'playwright-mcp'
}

function exactWindow(args: OperationArgs): { pid: number; windowId: number } {
  if (!Number.isSafeInteger(args.pid) || (args.pid ?? 0) < 1) throw new Error('desktop operation requires a positive pid')
  if (!Number.isSafeInteger(args.windowId) || (args.windowId ?? 0) < 1) {
    throw new Error('desktop operation requires a positive windowId')
  }
  return { pid: args.pid as number, windowId: args.windowId as number }
}

/** Map a model-visible operation to one fixed adapter, capability, and wire action.
 * @param args - Validated model tool arguments.
 * @returns fixed Device Plane routing tuple.
 */
export function deviceOperation(args: OperationArgs): {
  adapter: DeviceAdapterKind
  capability: DeviceCapability
  operation: DeviceOperation
} {
  const adapter = args.engine ?? 'agent-browser'
  switch (args.operation) {
    case 'screen_size': return { adapter: 'cua', capability: 'desktop.observe', operation: { kind: 'desktop.screen-size' } }
    case 'desktop_windows': return { adapter: 'cua', capability: 'desktop.observe', operation: { kind: 'desktop.windows' } }
    case 'desktop_snapshot': return {
      adapter: 'cua', capability: 'desktop.observe', operation: { kind: 'desktop.snapshot', ...exactWindow(args) },
    }
    case 'desktop_click': {
      const target = exactWindow(args)
      const elementToken = args.selector?.trim()
      const x = args.x
      const y = args.y
      const coordinates = typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
      if ((elementToken === undefined || elementToken === '') && !coordinates) {
        throw new Error('desktop_click requires an element token or x/y coordinates')
      }
      return { adapter: 'cua', capability: 'desktop.control', operation: {
        kind: 'desktop.click', ...target,
        ...(elementToken === undefined || elementToken === '' ? { x: x as number, y: y as number } : { elementToken }),
      } }
    }
    case 'desktop_type': {
      const target = exactWindow(args)
      const elementToken = args.selector?.trim()
      if (elementToken === undefined || elementToken === '') throw new Error('desktop_type requires an element token')
      if (args.value === undefined) throw new Error('desktop_type requires a value')
      return { adapter: 'cua', capability: 'desktop.control', operation: {
        kind: 'desktop.type', ...target, elementToken, text: args.value,
      } }
    }
    case 'browser_snapshot': return { adapter, capability: 'browser.observe', operation: { kind: 'browser.snapshot' } }
    case 'browser_open': {
      if (args.url === undefined) throw new Error('browser_open requires an http(s) url')
      const url = new URL(args.url)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('browser_open requires an http(s) url')
      if (url.username !== '' || url.password !== '') throw new Error('browser URL credentials are not allowed')
      return { adapter, capability: 'browser.control', operation: { kind: 'browser.open', url: url.href } }
    }
    case 'browser_click': {
      if (args.selector === undefined || args.selector.trim() === '') throw new Error('browser_click requires a selector')
      return { adapter, capability: 'browser.control', operation: { kind: 'browser.click', selector: args.selector } }
    }
    case 'browser_fill': {
      if (args.selector === undefined || args.selector.trim() === '') throw new Error('browser_fill requires a selector')
      if (args.value === undefined) throw new Error('browser_fill requires a value')
      return { adapter, capability: 'browser.control', operation: { kind: 'browser.fill', selector: args.selector, value: args.value } }
    }
  }
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

export function apply(ctx: Context, config: Config): void {
  const timeoutMs = config.resultTimeoutMs ?? 30_000
  const confirmationMode = computerUseRunMode(config)
  ctx.tools.register(defineTool({
    name: 'computer_use',
    description: 'Use the authenticated user\'s paired computer. Prefer Cua desktop_windows, desktop_snapshot, desktop_click, and desktop_type for visible user-PC work. Use browser_* only to bootstrap or as structured-browser fallback. Control remains subject to enterprise scope, one-time permits, and audit; the deployment may run delegated without per-action local prompts.',
    parameters: {
      operation: { type: 'string', required: true, enum: [
        'desktop_windows', 'desktop_snapshot', 'desktop_click', 'desktop_type',
        'screen_size', 'browser_open', 'browser_snapshot', 'browser_click', 'browser_fill',
      ] },
      url: { type: 'string', description: 'Required for browser_open.' },
      selector: { type: 'string', description: 'Snapshot reference or Cua element token required for click/fill/type.' },
      value: { type: 'string', description: 'Required for browser_fill or desktop_type.' },
      pid: { type: 'number', description: 'Cua process id from desktop_windows.' },
      windowId: { type: 'number', description: 'Cua window id from desktop_windows.' },
      x: { type: 'number', description: 'Optional Cua window screenshot x coordinate.' },
      y: { type: 'number', description: 'Optional Cua window screenshot y coordinate.' },
      engine: { type: 'string', enum: ['agent-browser', 'playwright-mcp'], description: 'Optional browser engine.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        state: { type: 'string', required: true }, summary: { type: 'string', required: true },
        evidenceHash: { type: 'string' }, deviceName: { type: 'string', required: true },
      } },
      render: (_args, value) => [{ type: 'text', text: `${value.deviceName}: ${value.summary}` }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('computer_use requires an owning enterprise Session')
      const sessionId = String(exec.agent.session.id)
      const [userId, workspace] = await Promise.all([
        ctx.enterprisePostgres.identity.sessionOwnerUserId(sessionId),
        ctx.enterprisePostgres.identity.sessionWorkspaceGrant(sessionId),
      ])
      if (userId === undefined || workspace === undefined) throw new Error('computer_use requires an enterprise-bound Session')
      const devices = await ctx.enterprisePostgres.devicePlane.listDevices(workspace.orgId, userId)
      const device = devices.find(candidate => candidate.status === 'online')
      if (device === undefined) throw new Error('No paired computer is online for this user')
      const mapped = deviceOperation(args)
      const runId = `computer-use-${randomUUID()}`
      await ctx.enterprisePostgres.devicePlane.saveRun({
        runId, orgId: workspace.orgId, userId, deviceId: device.deviceId,
        workspaceId: workspace.workspaceId, sessionId, mode: confirmationMode, status: 'active',
      })
      const operationId = `computer-use:${randomUUID()}`
      const permitId = `permit-${randomUUID()}`
      await ctx.enterprisePostgres.devicePlane.enqueueAction({
        permitId, orgId: workspace.orgId, userId, deviceId: device.deviceId, runId, operationId,
        capability: mapped.capability, consumed: false,
      }, Date.now() + 60_000, { adapter: mapped.adapter, operation: mapped.operation })
      const deadline = Date.now() + timeoutMs
      let action = await ctx.enterprisePostgres.devicePlane.action(workspace.orgId, userId, operationId)
      while (action !== undefined && (action.state === 'pending' || action.state === 'claimed') && Date.now() < deadline) {
        await wait(500)
        action = await ctx.enterprisePostgres.devicePlane.action(workspace.orgId, userId, operationId)
      }
      if (action === undefined) throw new Error('computer_use action disappeared')
      if (!['pending', 'claimed'].includes(action.state)) {
        await ctx.enterprisePostgres.devicePlane.transitionRun({
          orgId: workspace.orgId, userId, runId, state: action.state === 'failed' ? 'failed' : 'stopped', expectedRevision: 1,
        })
      }
      return { state: action.state, summary: action.summary ?? 'Computer action is still pending.',
        ...(action.evidenceHash === undefined ? {} : { evidenceHash: action.evidenceHash }), deviceName: device.deviceName }
    },
    presentCall: args => ({ card: 'generic', title: `Use computer: ${args.operation}`, kind: 'other', rawInput: args.operation }),
  }))
}
