/** Authorized employee, project and memory reads for the mounted native Session. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { CollaborationFetch } from './collaboration-store.ts'

/** Memory scopes the Host may authorize for the current user and employee. */
export type ContextMemoryScope = 'organization' | 'department' | 'project' | 'agent' | 'pair'
/** Read-only context returned after Session authorization. */
export interface SessionContext {
  readonly employee?: {
    id: string
    displayName: string
    role: string
    releaseVersion?: number
    capabilities: readonly string[]
    avatarSeed?: string
  }
  readonly project?: { id: string; name: string; goal: string; state: string }
  readonly memories: readonly {
    id: string
    scope: ContextMemoryScope
    summary: string
    status: string
    createdAt: number
    revision: number
  }[]
  readonly memoryAvailable: boolean
}
/** One Session context request and its outcome. */
export interface SessionContextState {
  readonly sessionId: string | undefined
  readonly phase: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error'
  readonly context: SessionContext | null
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-response')
  return value as Record<string, unknown>
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid-response')
  return value
}
function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('invalid-response')
  return value
}
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('invalid-response')
  return value
}
function parse(value: unknown): SessionContext {
  const row = record(value)
  const employee = row['employee'] === undefined ? undefined : record(row['employee'])
  const project = row['project'] === undefined ? undefined : record(row['project'])
  if (typeof row['memoryAvailable'] !== 'boolean') throw new Error('invalid-response')
  return {
    ...(employee === undefined ? {} : { employee: { id: text(employee['id']), displayName: text(employee['displayName']), role: text(employee['role']), capabilities: list(employee['capabilities']).map(text), ...(employee['releaseVersion'] === undefined ? {} : { releaseVersion: number(employee['releaseVersion']) }), ...(employee['avatarSeed'] === undefined ? {} : { avatarSeed: text(employee['avatarSeed']) }) } }),
    ...(project === undefined ? {} : { project: { id: text(project['id']), name: text(project['name']), goal: text(project['goal']), state: text(project['state']) } }),
    memoryAvailable: row['memoryAvailable'],
    memories: list(row['memories']).map((value) => {
      const memory = record(value)
      const scope = memory['scope']
      if (scope !== 'organization' && scope !== 'department' && scope !== 'project' && scope !== 'agent' && scope !== 'pair') throw new Error('invalid-response')
      return { id: text(memory['id']), scope, summary: text(memory['summary']), status: text(memory['status']), createdAt: number(memory['createdAt']), revision: number(memory['revision']) }
    }),
  }
}
/** Aborts replaced reads and discards their responses before publishing context. */
export class SessionContextController {
  /** Mounted Session identity, request status and authorized context. */
  readonly state = createSnapshotStore<SessionContextState>({ sessionId: undefined, phase: 'idle', context: null })
  private request: AbortController | undefined
  private disposed = false
  /** @param fetch - Authenticated same-origin transport. */
  constructor(private readonly fetch: CollaborationFetch) {}
  /** Read context for a mounted Session and immediately remove previous Session data.
   * @param sessionId - Native Session identity, absent when no seat is mounted.
   */
  async load(sessionId: string | undefined): Promise<void> {
    if (this.disposed) return
    this.request?.abort()
    const request = new AbortController()
    this.request = request
    this.state.set({ sessionId, phase: sessionId === undefined ? 'idle' : 'loading', context: null })
    if (sessionId === undefined) return
    try {
      const response = await this.fetch(`/enterprise/session-context/${encodeURIComponent(sessionId)}`, { credentials: 'same-origin', signal: request.signal })
      if (request.signal.aborted) return
      if (!response.ok) {
        this.state.set({ sessionId, phase: [401, 403, 404, 503].includes(response.status) ? 'unavailable' : 'error', context: null })
        return
      }
      const context = parse(await response.json())
      // Response body decoding can outlive the navigation that started this request.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      if (!request.signal.aborted) this.state.set({ sessionId, phase: 'ready', context })
    } catch (_error) {
      if (!request.signal.aborted) this.state.set({ sessionId, phase: 'error', context: null })
    }
  }
  /** Stop in-flight reads when the owning plugin unloads. */
  dispose(): void { this.disposed = true; this.request?.abort() }
}
