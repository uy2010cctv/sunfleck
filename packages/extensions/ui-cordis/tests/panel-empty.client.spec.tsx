// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CordisDynamicPluginId } from '@deepseek-ai/dsh-api-remotes/client'
import { CordisPanel } from '../src/client/CordisPanel.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const useValue = <T,>(value: T) => <Selected,>(select: (snapshot: T) => Selected): Selected => select(value)
const t = ((key: keyof typeof zh) => zh[key]) as Parameters<typeof CordisPanel>[0]['t']

describe('Cordis panel without process-local plugins', () => {
  it('keeps the entry available after a server restart and explains the empty runtime', () => {
    const view = render(<CordisPanel {...{
      wide: true,
      t,
      useSessions: useValue({ byId: {} }),
      useInventory: useValue({ rows: [], removed: new Set<CordisDynamicPluginId>(), read: true }),
      useActiveRuns: useValue(new Map()),
      useRunErrors: useValue(new Map()),
      useLoaded: useValue([]),
      useRenderFailures: useValue(new Map()),
      onApprove: vi.fn(), onDecline: vi.fn(), onRun: vi.fn(), onStop: vi.fn(), onRemove: vi.fn(),
      onRefresh: vi.fn(),
    } as Parameters<typeof CordisPanel>[0]} />)

    expect(view.getByRole('button', { name: 'Cordis 插件' })).toBeTruthy()
    expect(view.container.querySelector('[data-cordis-badge="0"]')).not.toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Cordis 插件' }))
    expect(view.getByText(/当前没有运行中的会话插件/)).toBeTruthy()
  })
})
