import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DeviceAdapterKind, DeviceCapability, DeviceOperation } from '@deepseek-ai/dsh-enterprise-device-plane'
import type {} from '@deepseek-ai/dsh-enterprise-postgres'

export const name = 'tool-computer-use'
export const inject = ['tools', 'enterprisePostgres']

/** Model-facing Computer Use tool configuration. */
export interface Config {
  /** Maximum time to wait for the local device to persist a terminal action result. */
  readonly resultTimeoutMs?: number
}
export const Config: z<Config> = z.object({ resultTimeoutMs: z.number().step(1).min(1_000).max(60_000).default(30_000) })

type OperationName = 'screen_size' | 'browser_open' | 'browser_snapshot' | 'browser_click' | 'browser_fill'
interface OperationArgs {
  readonly operation: OperationName
  readonly url?: string
  readonly selector?: string
  readonly value?: string
  readonly engine?: 'agent-browser' | 'playwright-mcp'
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
  ctx.tools.register(defineTool({
    name: 'computer_use',
    description: 'Use the authenticated user\'s paired computer. Browser or desktop control remains subject to the user\'s local confirmation and enterprise policy.',
    parameters: {
      operation: { type: 'string', required: true, enum: ['screen_size', 'browser_open', 'browser_snapshot', 'browser_click', 'browser_fill'] },
      url: { type: 'string', description: 'Required for browser_open.' },
      selector: { type: 'string', description: 'Snapshot reference required for browser_click/browser_fill.' },
      value: { type: 'string', description: 'Required for browser_fill.' },
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
        workspaceId: workspace.workspaceId, sessionId, mode: 'confirm-each', status: 'active',
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
