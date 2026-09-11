import { describe, expect, it, vi } from 'vitest'
import { MacOSConfirmator } from '../src/macos-confirmator.ts'

describe('MacOSConfirmator', () => {
  it('returns true only when the user presses Allow', async () => {
    const run = vi.fn().mockResolvedValueOnce({ stdout: 'button returned:允许' })
      .mockResolvedValueOnce({ stdout: 'button returned:拒绝' })
    const confirmator = new MacOSConfirmator(run)
    const action = {
      actionId: 'action-1', operationId: 'op-1', runId: 'run-1', deviceId: 'device-1',
      capability: 'browser.control' as const, adapter: 'agent-browser' as const,
      operation: { kind: 'browser.click' as const, selector: '@e1' },
    }
    await expect(confirmator.confirm(action)).resolves.toBe(true)
    await expect(confirmator.confirm(action)).resolves.toBe(false)
    expect(run).toHaveBeenCalledWith(expect.arrayContaining(['DSH 请求操作浏览器：点击页面元素']))
  })
})
