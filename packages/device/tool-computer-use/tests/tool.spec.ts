import { describe, expect, it } from 'vitest'
import { deviceOperation } from '../src/index.ts'

describe('computer_use operation mapping', () => {
  it('maps browser and desktop requests to fixed adapters and capabilities', () => {
    expect(deviceOperation({ operation: 'screen_size' })).toEqual({
      adapter: 'cua', capability: 'desktop.observe', operation: { kind: 'desktop.screen-size' },
    })
    expect(deviceOperation({ operation: 'browser_snapshot' })).toEqual({
      adapter: 'agent-browser', capability: 'browser.observe', operation: { kind: 'browser.snapshot' },
    })
    expect(deviceOperation({ operation: 'browser_open', url: 'https://example.com', engine: 'playwright-mcp' }))
      .toEqual({
        adapter: 'playwright-mcp', capability: 'browser.control',
        operation: { kind: 'browser.open', url: 'https://example.com/' },
      })
  })

  it('rejects missing fields and non-http browser targets', () => {
    expect(() => deviceOperation({ operation: 'browser_open', url: 'file:///etc/passwd' })).toThrow(/http/)
    expect(() => deviceOperation({ operation: 'browser_click' })).toThrow(/selector/)
    expect(() => deviceOperation({ operation: 'browser_fill', selector: '@e1' })).toThrow(/value/)
  })
})
