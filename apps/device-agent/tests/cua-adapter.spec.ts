import { describe, expect, it, vi } from 'vitest'
import { CuaAdapter } from '../src/cua-adapter.ts'
import type { DeviceAction } from '../src/protocol.ts'

function action(operation: DeviceAction['operation'], capability: DeviceAction['capability']): DeviceAction {
  return {
    actionId: 'action-1', operationId: 'operation-1', runId: 'run-1', deviceId: 'device-1',
    adapter: 'cua', capability, operation,
  }
}

describe('CuaAdapter', () => {
  it('uses one run-scoped Cua session for native window snapshots and token clicks', async () => {
    const startSession = vi.fn(async () => undefined)
    const callTool = vi.fn(async (name: string) => ({
      text: name === 'list_windows' ? 'Chrome pid=42 window=7' : name === 'get_window_state' ? 'button Login token-1' : 'clicked',
      structuredJson: name === 'list_windows' ? '{"windows":[{"pid":42,"window_id":7,"title":"Chrome"}]}' : undefined,
      isError: false,
    }))
    const adapter = new CuaAdapter('cua:test', async () => ({
      CuaDriver: { create: () => ({ startSession, callTool, endSession: vi.fn(), shutdown: vi.fn() }) },
      StartSessionInput: { new: (input: unknown) => input },
    } as never))
    const signal = new AbortController().signal

    await expect(adapter.execute(action({ kind: 'desktop.windows' }, 'desktop.observe'), signal))
      .resolves.toMatchObject({
        state: 'completed', summary: '{"windows":[{"pid":42,"window_id":7,"title":"Chrome"}]}',
      })
    await expect(adapter.execute(action({ kind: 'desktop.snapshot', pid: 42, windowId: 7 }, 'desktop.observe'), signal))
      .resolves.toMatchObject({ state: 'completed', summary: 'button Login token-1' })
    await expect(adapter.execute(action({
      kind: 'desktop.click', pid: 42, windowId: 7, elementToken: 'token-1',
    }, 'desktop.control'), signal)).resolves.toMatchObject({ state: 'completed', summary: 'clicked' })

    expect(startSession).toHaveBeenCalledOnce()
    expect(callTool).toHaveBeenNthCalledWith(1, 'list_windows', JSON.stringify({ on_screen_only: true }), { signal })
    expect(callTool).toHaveBeenNthCalledWith(2, 'get_window_state', expect.stringContaining('"include_screenshot":false'), { signal })
    expect(callTool).toHaveBeenNthCalledWith(3, 'click', expect.stringContaining('"element_token":"token-1"'), { signal })
  })

  it('restarts an expired run-scoped session and retries the same action once', async () => {
    const startSession = vi.fn(async () => undefined)
    const callTool = vi.fn()
      .mockResolvedValueOnce({ text: 'desktop session ended', errorCode: 'session_ended', isError: true })
      .mockResolvedValueOnce({ text: 'button Login token-1', isError: false })
    const adapter = new CuaAdapter('cua:test', async () => ({
      CuaDriver: { create: () => ({ startSession, callTool, endSession: vi.fn(), shutdown: vi.fn() }) },
      StartSessionInput: { new: (input: unknown) => input },
    } as never))
    const signal = new AbortController().signal

    await expect(adapter.execute(action({ kind: 'desktop.snapshot', pid: 42, windowId: 7 }, 'desktop.observe'), signal))
      .resolves.toMatchObject({ state: 'completed', summary: 'button Login token-1' })
    expect(startSession).toHaveBeenCalledTimes(2)
    expect(callTool).toHaveBeenCalledTimes(2)
    expect(callTool.mock.calls[1]).toEqual(callTool.mock.calls[0])
  })
})
