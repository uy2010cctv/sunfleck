import { describe, expect, it, vi } from 'vitest'
import { DeviceActionExecutor } from '../src/executor.ts'
import { commandForAction } from '../src/agent-browser-adapter.ts'
import type { DeviceAction, DeviceAdapter, LocalConfirmator, PermitConsumer } from '../src/protocol.ts'

const observe: DeviceAction = {
  actionId: 'action-1', operationId: 'op-1', runId: 'run-1', deviceId: 'device-1', capability: 'browser.observe',
  adapter: 'agent-browser', operation: { kind: 'browser.snapshot' },
}

describe('DeviceActionExecutor', () => {
  it('maps only typed browser operations to CLI arguments', () => {
    expect(commandForAction({ kind: 'browser.snapshot' })).toEqual(['snapshot', '-i'])
    expect(commandForAction({ kind: 'browser.open', url: 'https://example.com' }))
      .toEqual(['open', 'https://example.com'])
    expect(() => commandForAction({ kind: 'desktop.screen-size' })).toThrow(/browser operation/)
  })
  it('executes an observed action only after consuming its permit', async () => {
    const order: string[] = []
    const permits: PermitConsumer = { consume: vi.fn(async () => { order.push('permit'); return true }) }
    const adapter: DeviceAdapter = {
      kind: 'agent-browser', execute: vi.fn(async (action) => {
        order.push('adapter'); return { operationId: action.operationId, state: 'completed', summary: 'ok' }
      }),
    }
    const confirmator: LocalConfirmator = { confirm: vi.fn(async () => true) }
    const result = await new DeviceActionExecutor(permits, [adapter], confirmator).execute(observe)
    expect(result.state).toBe('completed')
    expect(result.evidenceHash).toMatch(/^[a-f\d]{64}$/u)
    expect(order).toEqual(['permit', 'adapter'])
    expect(confirmator.confirm).not.toHaveBeenCalled()
  })

  it('does not consume a control permit when the local user declines', async () => {
    const permits: PermitConsumer = { consume: vi.fn(async () => true) }
    const adapter: DeviceAdapter = { kind: 'agent-browser', execute: vi.fn() }
    const confirmator: LocalConfirmator = { confirm: vi.fn(async () => false) }
    const result = await new DeviceActionExecutor(permits, [adapter], confirmator).execute({
      ...observe, capability: 'browser.control', operation: { kind: 'browser.click', selector: '@e1' },
    })
    expect(result.state).toBe('rejected')
    expect(permits.consume).not.toHaveBeenCalled()
    expect(adapter.execute).not.toHaveBeenCalled()
  })
})
