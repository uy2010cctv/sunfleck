import { describe, expect, it, vi } from 'vitest'
import { RecorderSettingsStore, type RecorderRuntimeRemote } from '../src/client/store.ts'

const runtime = {
  revision: 1,
  asr: { mode: 'local' as const, model: 'paraformer-zh' },
  cam: { enabled: true, mode: 'local' as const, model: 'cam++', matchThreshold: 0.72 },
  state: 'running' as const, asrReady: true, camReady: true, credentialReady: true, checkedAt: 10,
}

function ok<T>(value: T): { readonly ok: true; readonly value: T } { return { ok: true, value } }
function failed(message: string): { readonly ok: false; readonly error: { readonly message: string } } {
  return { ok: false, error: { message } }
}

describe('RecorderSettingsStore', () => {
  it('loads, saves, and starts from Remote readback', async () => {
    const remote: RecorderRuntimeRemote = {
      getRecorderRuntime: vi.fn(async () => ok(runtime)),
      saveRecorderRuntime: vi.fn(async request => ok({ ...runtime, revision: request.expectedRevision + 1 })),
      startRecorderRuntime: vi.fn(async () => ok(runtime)),
    }
    const store = new RecorderSettingsStore(remote)

    await store.load()
    expect(store.store.getSnapshot()).toMatchObject({ phase: 'ready', runtime })
    expect(await store.save({ expectedRevision: 1, asr: runtime.asr, cam: runtime.cam })).toBe(true)
    expect(store.store.getSnapshot()).toMatchObject({ phase: 'ready', saved: true, runtime: { revision: 2 } })
    expect(await store.start()).toBe(true)
    expect(remote.startRecorderRuntime).toHaveBeenCalledWith({})
  })

  it('retains the last runtime when a mutation fails', async () => {
    const remote: RecorderRuntimeRemote = {
      getRecorderRuntime: vi.fn(async () => ok(runtime)),
      saveRecorderRuntime: vi.fn(async () => failed('conflict')),
      startRecorderRuntime: vi.fn(async () => ok(runtime)),
    }
    const store = new RecorderSettingsStore(remote)
    await store.load()

    expect(await store.save({ expectedRevision: 1, asr: runtime.asr, cam: runtime.cam })).toBe(false)
    expect(store.store.getSnapshot()).toMatchObject({ phase: 'error', runtime, error: 'Error: conflict' })
  })
})
