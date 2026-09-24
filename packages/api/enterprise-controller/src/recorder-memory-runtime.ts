/** Durable recorder-memory model selection shared with dsh-knowledge. */
import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type {
  EnterpriseRecorderMemoryRuntimeSaveRequest, EnterpriseRecorderMemoryRuntimeView,
} from './contract/devices.ts'

interface StoredRecorderMemoryRuntime {
  readonly schemaVersion: 1
  readonly revision: number
  readonly provider: string
  readonly model: string
  readonly timeoutMs: number
}

function boundedText(value: string, label: string): string {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 200) throw new Error(`recorder memory ${label} must contain 1 to 200 characters`)
  return trimmed
}

function timeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 300_000) {
    throw new Error('recorder memory timeout must be an integer from 1000 to 300000 milliseconds')
  }
  return value
}

function checked(value: Omit<StoredRecorderMemoryRuntime, 'schemaVersion'>): StoredRecorderMemoryRuntime {
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('recorder memory revision is invalid')
  return {
    schemaVersion: 1, revision: value.revision,
    provider: boundedText(value.provider, 'provider'), model: boundedText(value.model, 'model'),
    timeoutMs: timeout(value.timeoutMs),
  }
}

function viewOf(value: StoredRecorderMemoryRuntime, userId: string): EnterpriseRecorderMemoryRuntimeView {
  return {
    revision: value.revision, provider: value.provider, model: value.model, timeoutMs: value.timeoutMs,
    sessionId: `recorder-memory-${userId}`,
  }
}

/** Owner-only JSON store for the recorder-memory LLM route. */
export class RecorderMemoryRuntimeStore {
  constructor(
    private readonly path: string,
    private readonly fallback: { readonly provider: string; readonly model: string; readonly timeoutMs: number },
  ) {}

  private async read(): Promise<StoredRecorderMemoryRuntime> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<StoredRecorderMemoryRuntime>
      if (parsed.schemaVersion !== 1 || parsed.revision === undefined || parsed.provider === undefined
        || parsed.model === undefined || parsed.timeoutMs === undefined) throw new Error('recorder memory runtime file is invalid')
      return checked({ revision: parsed.revision, provider: parsed.provider, model: parsed.model, timeoutMs: parsed.timeoutMs })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return checked({ revision: 0, ...this.fallback })
    }
  }

  /** Read the selected route and derive the authenticated user's dedicated inference Session id.
   * @param userId - Authenticated enterprise user id.
   * @returns Redacted recorder-memory runtime settings.
   */
  async view(userId: string): Promise<EnterpriseRecorderMemoryRuntimeView> {
    const value = await this.read()
    return viewOf(value, userId)
  }

  /** Persist one revision-checked route update.
   * @param request - Candidate model route and expected revision.
   * @param userId - Authenticated enterprise user id used only for the returned Session id.
   * @returns Persisted recorder-memory runtime settings.
   */
  async save(request: EnterpriseRecorderMemoryRuntimeSaveRequest, userId: string): Promise<EnterpriseRecorderMemoryRuntimeView> {
    const current = await this.read()
    if (request.expectedRevision !== current.revision) throw new Error('recorder memory runtime revision conflict')
    const next = checked({
      revision: current.revision + 1, provider: request.provider, model: request.model, timeoutMs: request.timeoutMs,
    })
    await writeFileAtomic(this.path, `${JSON.stringify(next, undefined, 2)}\n`, { mode: 0o600, dirMode: 0o700 })
    return viewOf(next, userId)
  }
}
