/** Client-safe payloads and event declarations owned by the agent-preset domain. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
/**
 * Enterprise presentation carried by one preset without changing its runtime identity.
 *
 * Populated only by enterprise deployments that augment their preset declarations;
 * upstream declarations leave it unset.
 */
export interface EmployeeMetadata {
  /** Immutable release selected by new sessions using this declaration. */
  readonly releaseId?: string
  readonly releaseVersion?: number
  /** Human-facing position in the enterprise roster. */
  readonly position?: string
  /** Human-facing department in the enterprise roster. */
  readonly department?: string
  /** Bounded capability labels derived from the preset's real composition. */
  readonly capabilities?: readonly string[]
  /** Deterministic avatar seed from the published profile; absent for legacy releases. */
  readonly avatarSeed?: string
}

/**
 * One declared preset as a client reads it.
 */
export interface AgentPresetRow {
  /** Stable identifier; also the label's fallback. */
  readonly id: string
  /** Employee declarations are separately governed by the enterprise catalog. */
  readonly kind?: 'mode' | 'employee'
  /** Whether a session naming no preset composes this one. */
  readonly isDefault: boolean
  /** Display name the preset published. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
  /** Optional enterprise roster presentation. */
  readonly employee?: EmployeeMetadata
  /** Why this preset cannot compose a session; absent when it can. */
  readonly broken?: string
}

/** The roster one deployment currently supplies. */
export interface AgentPresetRoster {
  /** Every current declaration, including activation failures. */
  readonly presets: readonly AgentPresetRow[]
  /** Whether visible mode selection is enabled for unnamed new sessions. */
  readonly modeSelectionEnabled: boolean
}

/** One preset's declared composition, rendered for reading. */
export interface AgentPresetDocument {
  /** The preset the composition belongs to. */
  readonly agentPreset: string
  /** The declared child plugin list as entry-list YAML, `!!js` expressions included. */
  readonly content: string
  /** Display name the preset published. */
  readonly name?: string
  /** One sentence on what this preset is for. */
  readonly description?: string
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** No declaration supplies the requested identity. */
    'agent-preset/not-found': { readonly agentPreset: string; readonly available: readonly string[] }
    /** The id is unusable, already taken, or its composition cannot be installed. */
    'agent-preset/invalid': { readonly agentPreset: string; readonly reason: string }
    /** The session's conversation has started, so its composition is fixed. */
    'agent-preset/locked': { readonly sessionId: SessionId; readonly agentPreset: string }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    agentPreset: string | null
  }
  interface SessionProjectionMap {
    /** Preset the Session runs, or null when the deployment composes none. */
    agentPreset: string | null
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One session committed a different agent preset to its durable log.
     * Consumers invalidate only state derived from that session's composition.
     * @mode emit
     * @param sessionId - the session whose composition changed.
     * @param agentPreset - the preset recorded by the committed selection.
     */
    'agent-preset/selected'(sessionId: SessionId, agentPreset: string): void
  }
}

export {}
