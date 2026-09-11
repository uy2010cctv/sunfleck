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
})
