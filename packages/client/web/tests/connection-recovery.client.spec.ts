// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { COMMON_NS, LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { en, zh } from '../../locale/src/locales/index.ts'
import { ConnectionRecovery } from '../src/connection-recovery.ts'

afterEach(() => { document.body.innerHTML = '' })

function recoveryLocale(): LocaleRuntime {
  const locale = new LocaleRuntime(new Context())
  locale.register(COMMON_NS, { zh, en })
  return locale
}

describe('ConnectionRecovery', () => {
  it('uses the active client locale for recovery copy and refreshes after a language switch', () => {
    const state: { value: 'connected' | 'disconnected' | 'connecting' | undefined } = { value: 'disconnected' }
    const listeners = new Set<() => void>()
    const locale = recoveryLocale()
    const recovery = new ConnectionRecovery({
      reconnect: vi.fn(),
      state: {
        getSnapshot: () => state.value,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    }, locale)

    expect(document.body.textContent).toContain('Connection lost')
    locale.setLocale('zh')

    const root = document.querySelector<HTMLElement>('[data-dsh-connection-recovery]')
    expect(root?.textContent).toContain('连接已中断')
    expect(root?.textContent).toContain('当前页面仍保持打开状态。Host 可用后可重新连接。')
    expect(document.querySelector('[data-dsh-connection-retry]')?.textContent).toBe('重新连接')
    expect(root?.getAttribute('style')).toBeNull()
    recovery.dispose()
  })

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
    }, recoveryLocale())

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
