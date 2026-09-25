/** Same-origin collaboration navigation over authorized native Sessions. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Sidebar row returned by the collaboration directory. */
export interface CollaborationSurface {
  readonly id: string
  readonly kind: 'group' | 'channel'
  readonly name: string
  readonly memberCount: number
}

/** Authorized conversation metadata shown in the native right sidebar. */
export interface CollaborationDetail extends CollaborationSurface {
  readonly workspaceId: string
  readonly members: readonly { employeeId: string; displayName: string }[]
  readonly memberUserIds: readonly string[]
  readonly topics: readonly { id: string; title: string; state: 'open' | 'settled'; sessionId?: string; destinations?: readonly { sessionId: string; employeeId: string }[] }[]
  readonly dutyEmployeeIds: readonly string[]
  readonly project?: { id: string; name: string; goal: string }
  readonly team?: { id: string; name: string }
  readonly topicPolicy?: 'thread' | 'command' | 'lane'
  readonly respondPolicy?: 'mention_duty' | 'ingest_only'
}

/** Persisted selection recovered from the Host rather than a client-only chat identity. */
export interface CollaborationSelection {
  readonly detail: CollaborationDetail
  readonly sessionId?: string
  readonly employeeId?: string
  readonly topicId?: string
  readonly reason?: string
}

/** Root navigation state; errors retain readable previously loaded rows. */
export interface CollaborationState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  readonly surfaces: readonly CollaborationSurface[]
  readonly selection: CollaborationSelection | null
  readonly busy: boolean
  readonly creation: 'group' | 'channel' | null
  readonly error: string | null
}

/** Values supplied by the creation form; the server resolves actor and organization. */
export interface CreateCollaboration {
  readonly kind: 'group' | 'channel'
  readonly name: string
  readonly workspaceId: string
  readonly memberEmployeeIds: readonly string[]
  readonly memberUserIds: readonly string[]
  readonly teamDefinitionId?: string
  readonly projectId?: string
  readonly topicPolicy?: 'thread' | 'command' | 'lane'
  readonly respondPolicy?: 'mention_duty' | 'ingest_only'
  readonly dutyEmployeeIds?: readonly string[]
}

/** Fetch signature injectable without global browser state. */
export type CollaborationFetch = (url: string, init?: RequestInit) => Promise<Response>

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-response')
  return value as Record<string, unknown>
}
function string(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid-response')
  return value
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('invalid-response')
  return value
}
function surface(value: unknown): CollaborationSurface {
  const row = record(value)
  if ((row['kind'] !== 'group' && row['kind'] !== 'channel') || typeof row['memberCount'] !== 'number') throw new Error('invalid-response')
  return { id: string(row['id']), kind: row['kind'], name: string(row['name']), memberCount: row['memberCount'] }
}
function detail(value: unknown): CollaborationDetail {
  const row = record(value)
  const topicPolicy = row['topicPolicy']
  const respondPolicy = row['respondPolicy']
  if (topicPolicy !== undefined && topicPolicy !== 'thread' && topicPolicy !== 'command' && topicPolicy !== 'lane') throw new Error('invalid-response')
  if (respondPolicy !== undefined && respondPolicy !== 'mention_duty' && respondPolicy !== 'ingest_only') throw new Error('invalid-response')
  const project = row['project'] === undefined ? undefined : record(row['project'])
  const team = row['team'] === undefined ? undefined : record(row['team'])
  return {
    ...surface(row), workspaceId: string(row['workspaceId']),
    members: array(row['members']).map((value) => { const member = record(value); return { employeeId: string(member['employeeId']), displayName: string(member['displayName']) } }),
    memberUserIds: array(row['memberUserIds']).map(string),
    dutyEmployeeIds: array(row['dutyEmployeeIds']).map(string),
    topics: array(row['topics']).map((value) => {
      const topic = record(value)
      const state = topic['state']
      if (state !== 'open' && state !== 'settled') throw new Error('invalid-response')
      return { id: string(topic['id']), title: string(topic['title']), state, ...(topic['destinations'] === undefined ? {} : { destinations: array(topic['destinations']).map((value) => { const target = record(value); return { sessionId: string(target['sessionId']), employeeId: string(target['employeeId']) } }) }), ...(topic['sessionId'] === undefined ? {} : { sessionId: string(topic['sessionId']) }) }
    }),
    ...(project === undefined ? {} : { project: { id: string(project['id']), name: string(project['name']), goal: string(project['goal']) } }),
    ...(team === undefined ? {} : { team: { id: string(team['id']), name: string(team['name']) } }),
    ...(topicPolicy === undefined ? {} : { topicPolicy }),
    ...(respondPolicy === undefined ? {} : { respondPolicy }),
  }
}
class HttpFailure extends Error {
  constructor(readonly status: number) { super(status === 401 || status === 403 ? 'forbidden' : status === 503 ? 'unavailable' : 'request-failed') }
}

/** Owns roster refresh and navigation generations; no model or transcript state lives here. */
export class CollaborationController {
  /** Observable authorized roster and selected native destination. */
  readonly state = createSnapshotStore<CollaborationState>({ phase: 'idle', surfaces: [], selection: null, busy: false, creation: null, error: null })
  private selectionRequest: AbortController | undefined
  private rosterRequest: AbortController | undefined
  private closed = false
  private mainPanel: string | null = null
  private pendingCreation: { fingerprint: string; id: string } | undefined
  private pendingMessage: { fingerprint: string; id: string } | undefined

  /** @param fetch - Authenticated same-origin transport.
   * @param openSession - Native Workspace Session navigation.
   * @param openSetup - Native main-panel selection before a Session exists.
   */
  constructor(
    private readonly fetch: CollaborationFetch,
    private readonly openSession: (id: string, signal: AbortSignal) => void | Promise<void>,
    private readonly openSetup: () => void,
  ) {}

  private patch(patch: Partial<CollaborationState>): void {
    if (!this.closed) this.state.set({ ...this.state.getSnapshot(), ...patch })
  }
  private async read(path: string, signal: AbortSignal, body?: object): Promise<unknown> {
    const response = await this.fetch(`/enterprise/surfaces${path}`, {
      credentials: 'same-origin', signal,
      ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new HttpFailure(response.status)
    return response.json()
  }
  private cancelled(request: AbortController): boolean {
    return this.closed || request.signal.aborted
  }
  private begin(): AbortController {
    this.selectionRequest?.abort()
    const request = new AbortController()
    this.selectionRequest = request
    return request
  }

  /** Reload authorized group/channel rows; a revoked permission removes retained rows. */
  async refresh(): Promise<void> {
    this.rosterRequest?.abort()
    const request = new AbortController()
    this.rosterRequest = request
    this.patch({ phase: 'loading' })
    try {
      const rows = array(await this.read('', request.signal)).filter(value => record(value)['kind'] !== 'dm').map(surface)
      if (!this.cancelled(request)) {
        const selected = this.state.getSnapshot().selection
        this.patch({ phase: 'ready', surfaces: rows, ...(selected !== null && !rows.some(row => row.id === selected.detail.id) ? { selection: null } : {}) })
      }
    } catch (error) {
      if (this.cancelled(request)) return
      const unavailable = error instanceof HttpFailure && [401, 403, 404, 503].includes(error.status)
      this.patch({ phase: unavailable ? 'unavailable' : 'error', ...(unavailable ? { surfaces: [], selection: null } : {}) })
    }
  }

  /** Invalidate an outstanding selection when native navigation leaves this conversation. */
  clearSelection(): void {
    this.selectionRequest?.abort()
    this.patch({ selection: null, busy: false, creation: null, error: null })
  }

  /** Observe global panel selection so late conversation results cannot replace another page.
   * @param panelId - Active native main panel, or null for the conversation.
   */
  setMainPanel(panelId: string | null): void {
    this.mainPanel = panelId
    if (panelId !== null && panelId !== 'enterprise-collaboration') {
      this.selectionRequest?.abort()
      this.patch({ busy: false })
    }
  }

  /** Open the creation form without creating a Session.
   * @param kind - Collaboration kind selected from the sidebar.
   */
  beginCreate(kind: 'group' | 'channel'): void {
    this.clearSelection()
    this.patch({ creation: kind })
    this.openSetup()
  }

  /** Open one stored surface, optionally choosing one employee or channel topic.
   * @param id - Durable surface id.
   * @param choice - Topic and/or employee selected by the user.
   */
  async select(id: string, choice: { topicId?: string; employeeId?: string } = {}): Promise<void> {
    const request = this.begin()
    this.patch({ busy: true, creation: null, error: null })
    try {
      const current = detail(await this.read(`/${encodeURIComponent(id)}`, request.signal))
      if (this.cancelled(request)) return
      const opened = record(await this.read(`/${encodeURIComponent(id)}/open`, request.signal, choice))
      if (this.cancelled(request)) return
      const selection = { detail: current, ...choice }
      if (opened['opened'] === true) {
        const sessionId = string(opened['sessionId'])
        this.patch({ selection: { ...selection, sessionId,
          ...(opened['topicId'] === undefined ? {} : { topicId: string(opened['topicId']) }),
          ...(opened['employeeId'] === undefined ? {} : { employeeId: string(opened['employeeId']) }),
        }, busy: false })
        await this.openSession(sessionId, request.signal)
      } else {
        this.patch({ selection: { ...selection, reason: string(opened['reason']) }, busy: false })
        this.openSetup()
      }
    } catch (error) {
      if (!this.cancelled(request)) this.patch({ busy: false, error: error instanceof HttpFailure ? error.message : 'request-failed' })
    }
  }

  /** Recover the collaboration context of an already-selected native Session.
   * @param sessionId - Selected Session, or undefined while no Session is selected.
   * @param force - Refresh metadata even when the same Session remains selected.
   */
  async restore(sessionId: string | undefined, force = false): Promise<void> {
    const existing = this.state.getSnapshot().selection
    if (!force && sessionId !== undefined && existing?.sessionId === sessionId) return
    const request = this.begin()
    this.patch({ selection: force ? existing : null, busy: false, creation: null, error: null })
    if (sessionId === undefined) return
    try {
      const result = record(await this.read(`/by-session/${encodeURIComponent(sessionId)}`, request.signal))
      const selected = detail(result['detail'])
      if (!this.cancelled(request)) this.patch({ selection: { detail: selected, sessionId,
        ...(result['employeeId'] === undefined ? {} : { employeeId: string(result['employeeId']) }),
        ...(result['topicId'] === undefined ? {} : { topicId: string(result['topicId']) }),
      } })
    } catch (error) {
      if (!this.cancelled(request)) this.patch(error instanceof HttpFailure && [401, 403, 404, 503].includes(error.status) ? { selection: null } : { error: 'request-failed' })
    }
  }

  /** Refresh the selected native Session metadata without changing its navigation. */
  async refreshCurrent(): Promise<void> {
    const current = this.state.getSnapshot()
    if (!current.busy && current.selection?.sessionId !== undefined) await this.restore(current.selection.sessionId, true)
  }

  /** Open a routed reply only while its source remains selected.
   * @param sourceSessionId - Native composer that produced the receipt.
   * @param destinations - Authorized response Sessions in routing order.
   */
  async openRouted(sourceSessionId: string, destinations: readonly string[]): Promise<void> {
    if (this.mainPanel !== null || this.state.getSnapshot().selection?.sessionId !== sourceSessionId) return
    const target = destinations[0]
    if (target === undefined || target === sourceSessionId) { await this.refreshCurrent(); return }
    const request = this.begin()
    try { await this.openSession(target, request.signal) }
    catch (_error) { if (!this.cancelled(request)) this.patch({ error: 'request-failed' }) }
  }

  /** Send the first message before a surface has a native Session.
   * @param text - Non-empty user text, passed unchanged to Host routing.
   * @returns True only after the Host confirms delivery.
   */
  async send(text: string): Promise<boolean> {
    const selection = this.state.getSnapshot().selection
    if (selection === null || text.trim() === '' || this.state.getSnapshot().busy) return false
    const request = this.begin()
    const fingerprint = JSON.stringify([selection.detail.id, selection.topicId, text])
    if (this.pendingMessage?.fingerprint !== fingerprint) this.pendingMessage = { fingerprint, id: randomUUID() }
    const messageId = this.pendingMessage.id
    let admitted = false
    this.patch({ busy: true, error: null })
    try {
      const result = record(await this.read(`/${encodeURIComponent(selection.detail.id)}/messages`, request.signal, {
        text, messageId, ...(selection.topicId === undefined ? {} : { topicId: selection.topicId }),
      }))
      if (this.cancelled(request)) return false
      if (result['delivered'] !== true) {
        this.patch({ busy: false, error: typeof result['reason'] === 'string' ? result['reason'] : 'request-failed' })
        return false
      }
      admitted = true
      this.pendingMessage = undefined
      let latest = selection.detail
      try { latest = detail(await this.read(`/${encodeURIComponent(selection.detail.id)}`, request.signal)) }
      catch (_error) { /* The delivery receipt remains authoritative when the following metadata read fails. */ }
      if (this.cancelled(request)) return true
      const targets = result['targets'] === undefined ? [] : array(result['targets'])
      const first = targets[0] === undefined ? undefined : record(targets[0])
      const sessionId = first === undefined ? undefined : string(first['sessionId'])
      this.patch({ busy: false, selection: { ...selection, detail: latest,
        ...(sessionId === undefined ? {} : { sessionId }),
        ...(result['topicId'] === undefined ? {} : { topicId: string(result['topicId']) }),
      } })
      if (sessionId !== undefined) await this.openSession(sessionId, request.signal)
      return true
    } catch (error) {
      if (!this.cancelled(request)) this.patch({ busy: false, error: error instanceof HttpFailure ? error.message : 'request-failed' })
      return admitted
    }
  }

  /** Create one collaboration surface, reload the roster and select it.
   * @param input - User-chosen visible members, workspace, and routing policy.
   * @returns True only once creation succeeds.
   */
  async create(input: CreateCollaboration): Promise<boolean> {
    if (this.state.getSnapshot().busy) return false
    const fingerprint = JSON.stringify(input)
    if (this.pendingCreation?.fingerprint !== fingerprint) this.pendingCreation = { fingerprint, id: randomUUID() }
    const idempotencyKey = this.pendingCreation.id
    const request = this.begin()
    this.patch({ busy: true, error: null })
    try {
      const created = surface(await this.read(input.kind === 'group' ? '/groups' : '/channels', request.signal, { ...input, idempotencyKey }))
      if (this.cancelled(request)) return false
      this.pendingCreation = undefined
      this.patch({ busy: false })
      await this.refresh()
      if (this.cancelled(request)) return true
      await this.select(created.id)
      return true
    } catch (error) {
      if (!this.cancelled(request)) this.patch({ busy: false, error: error instanceof HttpFailure ? error.message : 'request-failed' })
      return false
    }
  }

  /** Abort pending reads so an unloaded plugin cannot publish navigation or state. */
  dispose(): void {
    this.closed = true
    this.selectionRequest?.abort()
    this.rosterRequest?.abort()
  }
}
