/** Observable recorder runtime state for the Settings section. */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {
  EnterpriseRecorderMemoryRuntimeSaveRequest, EnterpriseRecorderMemoryRuntimeView,
  EnterpriseRecorderRuntimeRequest, EnterpriseRecorderRuntimeSaveRequest, EnterpriseRecorderRuntimeView,
} from '@deepseek-ai/dsh-api-enterprise-controller/types'

type ApiResult<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } }
type RemoteResult<T> = ApiResult<T> | { readonly result: ApiResult<T> }

/** Recorder runtime Remote face required by this section. */
export interface RecorderRuntimeRemote {
  getRecorderRuntime(request: EnterpriseRecorderRuntimeRequest): Promise<RemoteResult<EnterpriseRecorderRuntimeView>>
  saveRecorderRuntime(request: EnterpriseRecorderRuntimeSaveRequest): Promise<RemoteResult<EnterpriseRecorderRuntimeView>>
  startRecorderRuntime(request: EnterpriseRecorderRuntimeRequest): Promise<RemoteResult<EnterpriseRecorderRuntimeView>>
  getRecorderMemoryRuntime(request: EnterpriseRecorderRuntimeRequest): Promise<RemoteResult<EnterpriseRecorderMemoryRuntimeView>>
  saveRecorderMemoryRuntime(request: EnterpriseRecorderMemoryRuntimeSaveRequest): Promise<RemoteResult<EnterpriseRecorderMemoryRuntimeView>>
}

/** Async page state. */
export interface RecorderSettingsState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'saving' | 'starting' | 'error'
  readonly runtime?: EnterpriseRecorderRuntimeView
  readonly memory?: EnterpriseRecorderMemoryRuntimeView
  readonly error: string | undefined
  readonly saved: boolean
}

function valueOf<T>(response: RemoteResult<T>): T {
  const result = 'result' in response ? response.result : response
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Serializes recorder runtime reads and mutations into one observable snapshot. */
export class RecorderSettingsStore {
  readonly store: SnapshotStore<RecorderSettingsState> = createSnapshotStore({ phase: 'idle', error: undefined, saved: false })
  private generation = 0

  constructor(private readonly remote: RecorderRuntimeRemote) {}

  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.set({ ...this.store.getSnapshot(), phase: 'loading', error: undefined, saved: false })
    try {
      const [runtime, memory] = await Promise.all([
        this.remote.getRecorderRuntime({}).then(valueOf), this.remote.getRecorderMemoryRuntime({}).then(valueOf),
      ])
      if (generation === this.generation) this.store.set({ phase: 'ready', runtime, memory, error: undefined, saved: false })
    } catch (error) {
      if (generation === this.generation) this.store.set({ phase: 'error', error: String(error), saved: false })
    }
  }

  async save(request: EnterpriseRecorderRuntimeSaveRequest): Promise<boolean> {
    const generation = ++this.generation
    this.store.set({ ...this.store.getSnapshot(), phase: 'saving', error: undefined, saved: false })
    try {
      const runtime = valueOf(await this.remote.saveRecorderRuntime(request))
      if (generation === this.generation) this.store.set({ ...this.store.getSnapshot(), phase: 'ready', runtime, error: undefined, saved: true })
      return true
    } catch (error) {
      if (generation === this.generation) this.store.set({ ...this.store.getSnapshot(), phase: 'error', error: String(error), saved: false })
      return false
    }
  }

  async start(): Promise<boolean> {
    const generation = ++this.generation
    this.store.set({ ...this.store.getSnapshot(), phase: 'starting', error: undefined, saved: false })
    try {
      const runtime = valueOf(await this.remote.startRecorderRuntime({}))
      if (generation === this.generation) this.store.set({ ...this.store.getSnapshot(), phase: 'ready', runtime, error: undefined, saved: false })
      return true
    } catch (error) {
      if (generation === this.generation) this.store.set({ ...this.store.getSnapshot(), phase: 'error', error: String(error), saved: false })
      return false
    }
  }

  /** Save the recorder-memory model route independently from ASR/CAM.
   * @param request - Revision-aware memory model selection.
   * @returns Whether the Host persisted and read back the selection.
   */
  async saveMemory(request: EnterpriseRecorderMemoryRuntimeSaveRequest): Promise<boolean> {
    const generation = ++this.generation
    this.store.set({ ...this.store.getSnapshot(), phase: 'saving', error: undefined, saved: false })
    try {
      const memory = valueOf(await this.remote.saveRecorderMemoryRuntime(request))
      if (generation === this.generation) this.store.set({ ...this.store.getSnapshot(), phase: 'ready', memory, error: undefined, saved: true })
      return true
    } catch (error) {
      if (generation === this.generation) this.store.set({ ...this.store.getSnapshot(), phase: 'error', error: String(error), saved: false })
      return false
    }
  }
}
