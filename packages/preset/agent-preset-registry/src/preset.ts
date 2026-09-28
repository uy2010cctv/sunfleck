import type { Volatile } from '@deepseek-ai/cordis'
import type { EmployeeMetadata } from './types.ts'
/** Public preset roster and selection configuration. */
/** One declared preset and its current activation failure, if any. */
export interface AgentPreset {
  readonly id: string
  readonly kind?: 'mode' | 'employee'
  readonly employee?: EmployeeMetadata
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly broken?: string
}

/** Registry selection policy. */
export interface Config {
  /** Deployment default when the caller omits a preset. */
  default: string
  /** User-selected default; edited through Settings. */
  selectedDefault: Volatile<string | undefined>
}
