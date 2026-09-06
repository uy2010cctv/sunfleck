// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConnectionRecovery } from '../src/connection-recovery.ts'

afterEach(() => { document.body.innerHTML = '' })

describe('ConnectionRecovery', () => {
  it('keeps the mounted application in place and reconnects on an explicit retry', () => {
    const state: { value: 'connected' | 'disconnected' | 'connecting' | undefined } = { value: undefined }
    const listeners = new Set<() => void>()
    const reconnect = vi.fn()
    const app = document.createElement('main')
    app.textContent = 'selected workspace and draft'
    document.body.append(app)
    const recovery = new ConnectionRecovery({
      reconnect,
      state: {
        getSnapshot: () => state.value,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    })

    state.value = 'disconnected'
    for (const listener of listeners) listener()

    expect(app.textContent).toBe('selected workspace and draft')
    const button = document.querySelector<HTMLButtonElement>('[data-dsh-connection-retry]')
    expect(document.body.textContent).toContain('Connection lost')
    button?.click()
    expect(reconnect).toHaveBeenCalledOnce()
    recovery.dispose()
    expect(document.querySelector('[data-dsh-connection-recovery]')).toBeNull()
  })
})
