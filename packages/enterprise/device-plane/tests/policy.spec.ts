import { describe, expect, it } from 'vitest'
import { validateQueuedDeviceAction } from '../src/policy.ts'

describe('Device Plane action policy', () => {
  it('accepts matching browser observation and rejects capability or adapter escalation', () => {
    expect(() => validateQueuedDeviceAction({
      mode: 'observe', capability: 'browser.observe', adapter: 'agent-browser',
      operation: { kind: 'browser.snapshot' },
    })).not.toThrow()
    expect(() => validateQueuedDeviceAction({
      mode: 'observe', capability: 'browser.control', adapter: 'agent-browser',
      operation: { kind: 'browser.click', selector: '@e1' },
    })).toThrow(/observe Run/)
    expect(() => validateQueuedDeviceAction({
      mode: 'delegated', capability: 'desktop.observe', adapter: 'agent-browser',
      operation: { kind: 'desktop.screen-size' },
    })).toThrow(/adapter/)
  })

  it('routes native window observation and control only through Cua', () => {
    expect(() => validateQueuedDeviceAction({
      mode: 'confirm-each', capability: 'desktop.observe', adapter: 'cua',
      operation: { kind: 'desktop.windows' },
    })).not.toThrow()
    expect(() => validateQueuedDeviceAction({
      mode: 'confirm-each', capability: 'desktop.observe', adapter: 'cua',
      operation: { kind: 'desktop.snapshot', pid: 42, windowId: 7 },
    })).not.toThrow()
    expect(() => validateQueuedDeviceAction({
      mode: 'confirm-each', capability: 'desktop.control', adapter: 'cua',
      operation: { kind: 'desktop.click', pid: 42, windowId: 7, elementToken: 'token-1' },
    })).not.toThrow()
    expect(() => validateQueuedDeviceAction({
      mode: 'observe', capability: 'desktop.control', adapter: 'cua',
      operation: { kind: 'desktop.click', pid: 42, windowId: 7, x: 10, y: 20 },
    })).toThrow(/observe Run/)
  })
})
