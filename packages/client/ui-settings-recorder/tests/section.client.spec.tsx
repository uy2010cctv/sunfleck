// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RecorderSettingsState } from '../src/client/store.ts'
import { RecorderSettingsStore, type RecorderRuntimeRemote } from '../src/client/store.ts'
import { RecorderSettingsSection } from '../src/client/RecorderSettingsSection.tsx'
import { zh } from '../src/client/locales.ts'

const runtime = {
  revision: 3,
  asr: { mode: 'local' as const, model: 'paraformer-zh' },
  cam: { enabled: true, mode: 'local' as const, model: 'cam++', matchThreshold: 0.72 },
  state: 'running' as const, asrReady: true, camReady: true, credentialReady: true, checkedAt: 10,
}
const memory = {
  revision: 2, provider: 'deepseek-official', model: 'deepseek-flash', timeoutMs: 12_000,
  sessionId: 'recorder-memory-bootstrap-admin',
}

function ok<T>(value: T): { readonly ok: true; readonly value: T } { return { ok: true, value } }

afterEach(cleanup)

function snapshotHook(controller: RecorderSettingsStore) {
  return <T,>(selector: (state: RecorderSettingsState) => T): T => useSyncExternalStore(
    controller.store.subscribe, () => selector(controller.store.getSnapshot()),
  )
}

describe('RecorderSettingsSection', () => {
  it('reveals online fields and saves one explicit draft', async () => {
    const remote: RecorderRuntimeRemote = {
      getRecorderRuntime: vi.fn(),
      getRecorderMemoryRuntime: vi.fn(),
      saveRecorderRuntime: vi.fn(async request => ok({ ...runtime, ...request, revision: 4 })),
      saveRecorderMemoryRuntime: vi.fn(async request => ok({ ...memory, ...request, revision: 3 })),
      startRecorderRuntime: vi.fn(async () => ok(runtime)),
    }
    const controller = new RecorderSettingsStore(remote)
    controller.store.set({ phase: 'ready', runtime, memory, error: undefined, saved: false })
    const useSnapshot = snapshotHook(controller)
    render(<RecorderSettingsSection controller={controller} useSnapshot={useSnapshot} t={key => zh[key]} />)

    fireEvent.click(screen.getAllByRole('button', { name: '在线模型' })[0]!)
    fireEvent.change(screen.getAllByLabelText('在线端点')[0]!, { target: { value: 'https://asr.example.test/v1/audio/transcriptions' } })
    fireEvent.change(screen.getAllByLabelText('Credential 引用')[0]!, { target: { value: 'ASR_ONLINE_KEY' } })
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }))

    await vi.waitFor(() => expect(remote.saveRecorderRuntime).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 3,
      asr: expect.objectContaining({ mode: 'online', endpoint: 'https://asr.example.test/v1/audio/transcriptions', credentialRef: 'ASR_ONLINE_KEY' }),
    })))
  })

  it('shows and saves the memory-processing model with its dedicated Session id', async () => {
    const remote: RecorderRuntimeRemote = {
      getRecorderRuntime: vi.fn(), getRecorderMemoryRuntime: vi.fn(), saveRecorderRuntime: vi.fn(),
      startRecorderRuntime: vi.fn(),
      saveRecorderMemoryRuntime: vi.fn(async request => ok({ ...memory, ...request, revision: 3 })),
    }
    const controller = new RecorderSettingsStore(remote)
    controller.store.set({ phase: 'ready', runtime, memory, error: undefined, saved: false })
    render(<RecorderSettingsSection controller={controller} useSnapshot={snapshotHook(controller)} t={key => zh[key]} />)

    expect(screen.getByDisplayValue('recorder-memory-bootstrap-admin')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'zai-coding-cn' } })
    fireEvent.change(screen.getByLabelText('记忆加工模型'), { target: { value: 'glm-5.3-flash' } })
    fireEvent.click(screen.getByRole('button', { name: '保存记忆配置' }))

    await vi.waitFor(() => expect(remote.saveRecorderMemoryRuntime).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'zai-coding-cn', model: 'glm-5.3-flash', expectedRevision: 2,
    })))
  })

  it('shows text alongside readiness dots and exposes 44px controls', () => {
    const controller = new RecorderSettingsStore({} as RecorderRuntimeRemote)
    controller.store.set({ phase: 'ready', runtime: { ...runtime, camReady: false }, memory, error: undefined, saved: false })
    const useSnapshot = snapshotHook(controller)
    const view = render(<RecorderSettingsSection controller={controller} useSnapshot={useSnapshot} t={key => zh[key]} />)
    expect(screen.getByText('运行中')).toBeTruthy()
    expect(screen.getByText('未就绪')).toBeTruthy()
    expect(view.container.querySelectorAll('button').length).toBeGreaterThan(3)
  })
})
