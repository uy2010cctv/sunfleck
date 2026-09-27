/** Authorized shared group and channel timelines in the native SUNFLECK shell. */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'

/** Sidebar row returned by the collaboration directory. */
export interface CollaborationSurface {
  readonly id: string
  readonly kind: 'group' | 'channel'
  readonly name: string
  readonly memberCount: number
  /** Current human's server-authorized unread room facts. */
  readonly attention?: { readonly newMessages: boolean; readonly mentions: boolean; readonly unread?: number }
  /** This member's sidebar preferences for the room. */
  readonly prefs?: { readonly pinned: boolean; readonly starred: boolean; readonly muted: boolean }
  /** Native Sessions kept for Bot execution and hidden from Workspace browsing. */
  readonly executionSessionIds?: readonly string[]
  readonly workspaceId?: string
  readonly projectId?: string
  readonly teamDefinitionId?: string
}

/** Authorized room metadata. Execution Sessions are destinations, not the conversation. */
export interface CollaborationDetail extends CollaborationSurface {
  readonly workspaceId: string
  readonly members: readonly { employeeId: string; displayName: string; avatarSeed?: string }[]
  readonly memberUserIds: readonly string[]
  readonly humanMembers?: readonly { userId: string; displayName: string }[]
  readonly topics: readonly { id: string; title: string; state: 'open' | 'settled'; sessionId?: string; destinations?: readonly { sessionId: string; employeeId: string }[] }[]
  readonly dutyEmployeeIds: readonly string[]
  /** The signed-in human, so the room can right-align their own posts. */
  readonly viewerUserId: string
  /** Whether the signed-in human administers this group. */
  readonly viewerIsAdmin: boolean
  readonly adminUserId?: string
  readonly announcement?: string
  readonly project?: { id: string; name: string; goal: string }
  readonly team?: { id: string; name: string }
  readonly topicPolicy?: 'thread' | 'command' | 'lane'
  readonly respondPolicy?: 'mention_duty' | 'ingest_only'
}

/** One signed room event with server-authorized actor attribution. Sequence is an opaque PostgreSQL bigint cursor. */
export interface RoomEvent {
  readonly sequence: string
  readonly id: string
  readonly pubkey: string
  readonly created_at: number
  readonly kind: number
  readonly tags: readonly (readonly string[])[]
  readonly content: string
  readonly sig: string
  readonly author: { readonly kind: 'human' | 'employee' | 'service'; readonly id: string; readonly displayName: string }
  readonly threadRoot?: string
  readonly delivery?: 'pending' | 'delivered' | 'failed'
  readonly sourceSessionId?: string
  /** Files signed into this message, resolved from stored room attachments. */
  readonly attachments?: readonly { attachmentId: string; name: string; mimeType: string; size: number }[]
}

/** Selected room and its optional focused thread. */
export interface CollaborationSelection {
  readonly detail: CollaborationDetail
  readonly threadRoot?: string
  /** Present only when a historical employee execution Session is inspected. */
  readonly sessionId?: string
}

/** Authorized room state. A revoked room is erased immediately. */
export interface CollaborationState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'
  readonly surfaces: readonly CollaborationSurface[]
  readonly selection: CollaborationSelection | null
  readonly roomPhase: 'idle' | 'loading' | 'ready' | 'error'
  readonly events: readonly RoomEvent[]
  /** First loaded sequence while an older room page may exist. */
  readonly olderCursor: string | null
  readonly threadEvents: readonly RoomEvent[]
  readonly threadPhase: 'idle' | 'loading' | 'ready' | 'error'
  readonly searchResults: readonly RoomEvent[]
  readonly searchPhase: 'idle' | 'loading' | 'ready' | 'error'
  readonly busy: boolean
  readonly creation: 'group' | 'channel' | null
  readonly creationProjectId?: string | undefined
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
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('invalid-response')
  return value
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('invalid-response')
  return value
}
function attention(value: unknown): CollaborationSurface['attention'] {
  if (value === undefined) return undefined
  const row = record(value)
  const newMessages = row['newMessages'], mentions = row['mentions']
  if (typeof newMessages !== 'boolean' || typeof mentions !== 'boolean') throw new Error('invalid-response')
  return { newMessages, mentions, ...(row['unread'] === undefined ? {} : { unread: count(row['unread']) }) }
}
function prefs(value: unknown): CollaborationSurface['prefs'] {
  if (value === undefined) return undefined
  const row = record(value)
  const pinned = row['pinned'], starred = row['starred'], muted = row['muted']
  if (typeof pinned !== 'boolean' || typeof starred !== 'boolean' || typeof muted !== 'boolean') throw new Error('invalid-response')
  return { pinned, starred, muted }
}
function surface(value: unknown): CollaborationSurface {
  const row = record(value)
  if ((row['kind'] !== 'group' && row['kind'] !== 'channel') || typeof row['memberCount'] !== 'number') throw new Error('invalid-response')
  const executionSessionIds = row['executionSessionIds']
  if (executionSessionIds !== undefined && (!Array.isArray(executionSessionIds)
    || executionSessionIds.some(value => typeof value !== 'string'))) throw new Error('invalid-response')
  const roomAttention = attention(row['attention'])
  const roomPrefs = prefs(row['prefs'])
  return { id: string(row['id']), kind: row['kind'], name: string(row['name']), memberCount: row['memberCount'],
    ...(roomAttention === undefined ? {} : { attention: roomAttention }),
    ...(roomPrefs === undefined ? {} : { prefs: roomPrefs }),
    ...(executionSessionIds === undefined ? {} : { executionSessionIds: executionSessionIds as string[] }),
    ...(row['workspaceId'] === undefined ? {} : { workspaceId: string(row['workspaceId']) }),
    ...(row['projectId'] === undefined ? {} : { projectId: string(row['projectId']) }),
    ...(row['teamDefinitionId'] === undefined ? {} : { teamDefinitionId: string(row['teamDefinitionId']) }) }
}
function detail(value: unknown): CollaborationDetail {
  const row = record(value)
  const topicPolicy = row['topicPolicy']
  const respondPolicy = row['respondPolicy']
  if (topicPolicy !== undefined && topicPolicy !== 'thread' && topicPolicy !== 'command' && topicPolicy !== 'lane') throw new Error('invalid-response')
  if (respondPolicy !== undefined && respondPolicy !== 'mention_duty' && respondPolicy !== 'ingest_only') throw new Error('invalid-response')
  const project = row['project'] === undefined ? undefined : record(row['project'])
  const team = row['team'] === undefined ? undefined : record(row['team'])
  if (typeof row['viewerIsAdmin'] !== 'boolean' || typeof row['viewerUserId'] !== 'string') throw new Error('invalid-response')
  return {
    ...surface(row), workspaceId: string(row['workspaceId']),
    members: array(row['members']).map((value) => { const member = record(value); return { employeeId: string(member['employeeId']), displayName: string(member['displayName']),
      ...(member['avatarSeed'] === undefined ? {} : { avatarSeed: string(member['avatarSeed']) }) } }),
    memberUserIds: array(row['memberUserIds']).map(string),
    ...(row['humanMembers'] === undefined ? {} : { humanMembers: array(row['humanMembers']).map((value) => {
      const member = record(value)
      return { userId: string(member['userId']), displayName: string(member['displayName']) }
    }) }),
    dutyEmployeeIds: array(row['dutyEmployeeIds']).map(string),
    topics: array(row['topics']).map((value) => {
      const topic = record(value)
      const state = topic['state']
      if (state !== 'open' && state !== 'settled') throw new Error('invalid-response')
      return { id: string(topic['id']), title: string(topic['title']), state, ...(topic['destinations'] === undefined ? {} : { destinations: array(topic['destinations']).map((value) => { const target = record(value); return { sessionId: string(target['sessionId']), employeeId: string(target['employeeId']) } }) }), ...(topic['sessionId'] === undefined ? {} : { sessionId: string(topic['sessionId']) }) }
    }),
    viewerUserId: row['viewerUserId'],
    viewerIsAdmin: row['viewerIsAdmin'],
    ...(row['adminUserId'] === undefined ? {} : { adminUserId: string(row['adminUserId']) }),
    ...(row['announcement'] === undefined ? {} : { announcement: string(row['announcement']) }),
    ...(project === undefined ? {} : { project: { id: string(project['id']), name: string(project['name']), goal: string(project['goal']) } }),
    ...(team === undefined ? {} : { team: { id: string(team['id']), name: string(team['name']) } }),
    ...(topicPolicy === undefined ? {} : { topicPolicy }),
    ...(respondPolicy === undefined ? {} : { respondPolicy }),
  }
}
function roomEvent(value: unknown): RoomEvent {
  const row = record(value)
  const sequence = string(row['sequence'])
  if (!/^(0|[1-9][0-9]*)$/.test(sequence)) throw new Error('invalid-response')
  const author = record(row['author'])
  const kind = author['kind']
  if (kind !== 'human' && kind !== 'employee' && kind !== 'service') throw new Error('invalid-response')
  const delivery = row['delivery']
  if (delivery !== undefined && delivery !== 'pending' && delivery !== 'delivered' && delivery !== 'failed') throw new Error('invalid-response')
  if (typeof row['created_at'] !== 'number' || typeof row['kind'] !== 'number') throw new Error('invalid-response')
  return {
    sequence, id: string(row['id']), pubkey: string(row['pubkey']), created_at: row['created_at'], kind: row['kind'],
    tags: array(row['tags']).map(value => array(value).map(string)), content: string(row['content']), sig: string(row['sig']),
    author: { kind, id: string(author['id']), displayName: string(author['displayName']) },
    ...(row['threadRoot'] === undefined ? {} : { threadRoot: string(row['threadRoot']) }),
    ...(delivery === undefined ? {} : { delivery }),
    ...(row['sourceSessionId'] === undefined ? {} : { sourceSessionId: string(row['sourceSessionId']) }),
    ...(() => {
      const files = array(row['tags']).map(value => array(value).map(string)).flatMap((tag): { attachmentId: string; name: string; mimeType: string; size: number }[] =>
        tag[0] === 'attachment' && tag[1] !== undefined && tag[2] !== undefined && tag[3] !== undefined && tag[4] !== undefined
          ? [{ attachmentId: tag[1], name: tag[2], mimeType: tag[3], size: Number(tag[4]) }] : [])
      return files.length === 0 ? {} : { attachments: files }
    })(),
  }
}
function eventPage(value: unknown): { items: RoomEvent[]; nextCursor: string | null } {
  const row = record(value)
  return { items: array(row['items']).map(roomEvent), nextCursor: row['nextCursor'] === null ? null : string(row['nextCursor']) }
}
function appendUnique(current: readonly RoomEvent[], incoming: readonly RoomEvent[]): RoomEvent[] {
  const seen = new Set(current.map(item => item.id))
  const additions = incoming.filter((item) => { if (seen.has(item.id)) return false; seen.add(item.id); return true })
  return [...current, ...additions].sort((a, b) => a.sequence === b.sequence ? 0 : BigInt(a.sequence) < BigInt(b.sequence) ? -1 : 1)
}
class HttpFailure extends Error {
  constructor(readonly status: number) { super(status === 401 || status === 403 ? 'forbidden' : status === 503 ? 'unavailable' : 'request-failed') }
}

/** Controls the shared room timeline and preserves request identities across uncertain sends. */
export class CollaborationController {
  /** Observable authorized roster and selected room. */
  readonly state = createSnapshotStore<CollaborationState>({ phase: 'idle', surfaces: [], selection: null, roomPhase: 'idle', events: [], olderCursor: null, threadEvents: [], threadPhase: 'idle', searchResults: [], searchPhase: 'idle', busy: false, creation: null, error: null })
  private selectionRequest: AbortController | undefined
  private rosterRequest: AbortController | undefined
  private pollRequest: AbortController | undefined
  private threadRequest: AbortController | undefined
  private searchRequest: AbortController | undefined
  private closed = false
  private mainPanel: string | null = null
  private pendingCreation: { fingerprint: string; id: string } | undefined
  private pendingMessage: { fingerprint: string; id: string } | undefined
  private pendingReaction: { fingerprint: string; id: string } | undefined
  private readonly executionSessionIds = new Set<string>()
  private readonly acknowledgedSequences = new Map<string, string>()

  /** @param fetch - Authenticated same-origin transport.
   * @param inspectSession - Native Session navigation for an execution source link.
   * @param openRoom - Selects the existing native main-panel slot.
   */
  constructor(
    private readonly fetch: CollaborationFetch,
    private readonly inspectSession: (id: string, signal: AbortSignal) => void | Promise<void>,
    private readonly openRoom: () => void,
    private readonly roomCreated?: () => void,
    private readonly executionSessionsChanged?: (ids: readonly string[]) => void,
  ) {}

  private patch(patch: Partial<CollaborationState>): void {
    if (!this.closed) this.state.set({ ...this.state.getSnapshot(), ...patch })
  }
  private rememberExecutionSessions(ids: readonly string[]): void {
    if (this.executionSessionsChanged === undefined) return
    let changed = false
    for (const id of ids) {
      if (this.executionSessionIds.has(id)) continue
      this.executionSessionIds.add(id)
      changed = true
    }
    if (changed) this.executionSessionsChanged([...this.executionSessionIds])
  }
  /** Clear the local execution classification when the authenticated identity changes. */
  clearExecutionSessions(): void {
    this.executionSessionIds.clear()
    this.executionSessionsChanged?.([])
  }
  private async read(path: string, signal: AbortSignal, body?: object): Promise<unknown> {
    const response = await this.fetch(`/enterprise/surfaces${path}`, {
      credentials: 'same-origin', signal,
      ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
    if (!response.ok) throw new HttpFailure(response.status)
    return response.json()
  }
  private cancelled(request: AbortController): boolean { return this.closed || request.signal.aborted }
  /** Mark only the last event committed into the currently visible room view as read. */
  async acknowledgeVisible(): Promise<void> {
    const state = this.state.getSnapshot()
    const id = state.selection?.detail.id
    const sequence = state.events.at(-1)?.sequence
    if (this.mainPanel !== 'enterprise-collaboration' || state.roomPhase !== 'ready'
      || id === undefined || sequence === undefined || this.acknowledgedSequences.get(id) === sequence) return
    try {
      const result = record(await this.read(`/${encodeURIComponent(id)}/read`, new AbortController().signal, { sequence }))
      if (string(result['sequence']) !== sequence) return
      this.acknowledgedSequences.set(id, sequence)
      const current = this.state.getSnapshot()
      if (!this.closed && current.selection?.detail.id === id && current.events.at(-1)?.sequence === sequence) {
        this.patch({ surfaces: current.surfaces.map(row => row.id === id && row.attention !== undefined
          ? { ...row, attention: { newMessages: false, mentions: false } } : row) })
      }
    } catch (error) {
      if (!this.closed && this.state.getSnapshot().selection?.detail.id === id) this.revoke(error)
    }
  }
  private begin(): AbortController {
    this.selectionRequest?.abort()
    this.pollRequest?.abort()
    this.threadRequest?.abort()
    this.searchRequest?.abort()
    const request = new AbortController()
    this.selectionRequest = request
    return request
  }
  private revoke(error: unknown): boolean {
    if (!(error instanceof HttpFailure) || (error.status !== 401 && error.status !== 403 && error.status !== 404)) return false
    this.clearSelection()
    this.patch({ error: 'forbidden' })
    void this.refresh()
    return true
  }

  /** Reload authorized group/channel rows; revoked rows disappear. */
  async refresh(): Promise<void> {
    this.rosterRequest?.abort()
    const request = new AbortController()
    this.rosterRequest = request
    this.patch({ phase: 'loading' })
    try {
      const rows = array(await this.read('', request.signal)).filter(value => record(value)['kind'] !== 'dm').map(surface)
      if (!this.cancelled(request)) {
        this.rememberExecutionSessions(rows.flatMap(row => row.executionSessionIds ?? []))
        const selected = this.state.getSnapshot().selection
        if (selected !== null && !rows.some(row => row.id === selected.detail.id)) this.clearSelection()
        this.patch({ phase: 'ready', surfaces: rows })
      }
    } catch (error) {
      if (this.cancelled(request)) return
      const unavailable = error instanceof HttpFailure && [401, 403, 404, 503].includes(error.status)
      if (unavailable) { this.clearSelection(); this.clearExecutionSessions() }
      this.patch({ phase: unavailable ? 'unavailable' : 'error', ...(unavailable ? { surfaces: [] } : {}) })
    } finally { if (this.rosterRequest === request) this.rosterRequest = undefined }
  }

  /** Poll the room roster without aborting a slower in-flight read. */
  async refreshIfIdle(): Promise<void> {
    if (this.rosterRequest !== undefined) return
    await this.refresh()
  }

  /** Erase selection and room data when leaving or losing access. */
  clearSelection(): void {
    this.begin().abort()
    this.acknowledgedSequences.clear()
    this.patch({ selection: null, roomPhase: 'idle', events: [], olderCursor: null, threadEvents: [], threadPhase: 'idle', searchResults: [], searchPhase: 'idle', busy: false, creation: null, creationProjectId: undefined, error: null })
  }

  /** Observe native main-panel selection so late room responses cannot steal navigation. */
  setMainPanel(panelId: string | null): void {
    this.mainPanel = panelId
    if (panelId !== null && panelId !== 'enterprise-collaboration') {
      this.selectionRequest?.abort()
      this.pollRequest?.abort()
      this.threadRequest?.abort()
      this.searchRequest?.abort()
      this.patch({ busy: false })
    }
  }

  /** Open a room creation form. */
  beginCreate(kind: 'group' | 'channel', projectId?: string): void {
    this.clearSelection()
    this.patch({ creation: kind, ...(projectId === undefined ? {} : { creationProjectId: projectId }) })
    this.openRoom()
  }

  /** Open the same shared timeline for every member and employee. */
  async select(id: string): Promise<void> {
    const request = this.begin()
    this.patch({ busy: true, creation: null, error: null, roomPhase: 'loading', events: [], olderCursor: null, threadEvents: [], threadPhase: 'idle', searchResults: [], searchPhase: 'idle' })
    this.openRoom()
    try {
      const current = detail(await this.read(`/${encodeURIComponent(id)}`, request.signal))
      if (this.cancelled(request)) return
      this.patch({ selection: { detail: current } })
      const page = eventPage(await this.read(`/${encodeURIComponent(id)}/events?limit=100`, request.signal))
      if (this.cancelled(request)) return
      this.rememberExecutionSessions(page.items.flatMap(item => item.sourceSessionId === undefined ? [] : [item.sourceSessionId]))
      this.patch({ events: page.items, olderCursor: page.items.length === 100 ? page.items[0]?.sequence ?? null : null, roomPhase: 'ready', busy: false })
    } catch (error) {
      if (this.cancelled(request)) return
      if (this.revoke(error)) return
      this.patch({ roomPhase: 'error', busy: false, error: error instanceof HttpFailure ? error.message : 'request-failed' })
    }
  }

  /** Inspect a Bot execution in the native Session transcript without replacing the room data. */
  async inspect(id: string): Promise<void> {
    const request = new AbortController()
    try { await this.inspectSession(id, request.signal) }
    catch (_error) { this.patch({ error: 'request-failed' }) }
  }

  /** Refresh selected room metadata after a membership or policy change. */
  async refreshCurrent(): Promise<void> {
    const selected = this.state.getSnapshot().selection
    if (selected === null) return
    const request = new AbortController()
    try {
      const current = detail(await this.read(`/${encodeURIComponent(selected.detail.id)}`, request.signal))
      if (!this.cancelled(request) && this.state.getSnapshot().selection?.detail.id === current.id) {
        this.patch({ selection: { ...selected, detail: current } })
      }
    } catch (error) { if (!this.cancelled(request)) { if (!this.revoke(error)) this.patch({ error: 'request-failed' }) } }
  }

  /** Poll the authenticated room cursor so another member's posts appear without reloading. */
  async poll(): Promise<void> {
    const state = this.state.getSnapshot()
    const id = state.selection?.detail.id
    if (id === undefined || state.roomPhase !== 'ready' || this.pollRequest !== undefined || this.mainPanel !== 'enterprise-collaboration') return
    const request = new AbortController()
    this.pollRequest = request
    const latest = state.events.at(-1)?.sequence
    try {
      const query = latest === undefined ? '?limit=100' : `?after=${encodeURIComponent(latest)}&limit=100`
      const page = eventPage(await this.read(`/${encodeURIComponent(id)}/events${query}`, request.signal))
      if (this.cancelled(request) || this.state.getSnapshot().selection?.detail.id !== id) return
      this.rememberExecutionSessions(page.items.flatMap(item => item.sourceSessionId === undefined ? [] : [item.sourceSessionId]))
      this.patch({ events: appendUnique(this.state.getSnapshot().events, page.items) })
      const selectedThread = this.state.getSnapshot().selection?.threadRoot
      if (selectedThread !== undefined && page.items.some(item => item.threadRoot === selectedThread)) void this.refreshThread()
    } catch (error) { if (!this.cancelled(request)) { if (!this.revoke(error)) this.patch({ error: 'request-failed' }) } }
    finally { if (this.pollRequest === request) this.pollRequest = undefined }
  }

  /** Read the preceding room page without changing the live polling cursor. */
  async loadOlder(): Promise<void> {
    const state = this.state.getSnapshot()
    const id = state.selection?.detail.id
    if (id === undefined || state.olderCursor === null || this.pollRequest !== undefined) return
    const request = new AbortController()
    this.pollRequest = request
    try {
      const page = eventPage(await this.read(`/${encodeURIComponent(id)}/events?before=${encodeURIComponent(state.olderCursor)}&limit=100`, request.signal))
      if (!this.cancelled(request) && this.state.getSnapshot().selection?.detail.id === id) {
        this.patch({
          events: appendUnique(this.state.getSnapshot().events, page.items),
          olderCursor: page.items.length === 100 ? page.items[0]?.sequence ?? null : null,
        })
      }
    } catch (error) { if (!this.cancelled(request)) { if (!this.revoke(error)) this.patch({ error: 'request-failed' }) } }
    finally { if (this.pollRequest === request) this.pollRequest = undefined }
  }

  /** Open a thread and read replies from its exact room event root. */
  async openThread(root: string): Promise<void> {
    const selection = this.state.getSnapshot().selection
    if (selection === null) return
    this.threadRequest?.abort()
    const request = new AbortController()
    this.threadRequest = request
    this.patch({ selection: { ...selection, threadRoot: root }, threadPhase: 'loading', threadEvents: [] })
    await this.refreshThread(request)
  }
  private async refreshThread(provided?: AbortController): Promise<void> {
    const selection = this.state.getSnapshot().selection
    if (selection?.threadRoot === undefined) return
    const request = provided ?? new AbortController()
    if (provided === undefined) { this.threadRequest?.abort(); this.threadRequest = request }
    try {
      const page = eventPage(await this.read(`/${encodeURIComponent(selection.detail.id)}/events?threadRoot=${encodeURIComponent(selection.threadRoot)}&limit=100`, request.signal))
      if (!this.cancelled(request) && this.state.getSnapshot().selection?.threadRoot === selection.threadRoot) this.patch({ threadEvents: page.items, threadPhase: 'ready' })
    } catch (error) { if (!this.cancelled(request)) { if (!this.revoke(error)) this.patch({ threadPhase: 'error' }) } }
  }
  /** Close the thread without changing the shared room timeline. */
  closeThread(): void {
    this.threadRequest?.abort()
    const selected = this.state.getSnapshot().selection
    if (selected !== null) this.patch({ selection: { detail: selected.detail }, threadEvents: [], threadPhase: 'idle' })
  }

  /** Search the authorized room event index. */
  async search(query: string): Promise<void> {
    const selected = this.state.getSnapshot().selection
    this.searchRequest?.abort()
    if (selected === null || query.trim() === '') { this.patch({ searchPhase: 'idle', searchResults: [] }); return }
    const request = new AbortController()
    this.searchRequest = request
    this.patch({ searchPhase: 'loading' })
    try {
      const result = record(await this.read(`/${encodeURIComponent(selected.detail.id)}/search?q=${encodeURIComponent(query.trim())}`, request.signal))
      if (!this.cancelled(request) && this.state.getSnapshot().selection?.detail.id === selected.detail.id) this.patch({ searchResults: array(result['items']).map(roomEvent), searchPhase: 'ready' })
    } catch (error) { if (!this.cancelled(request)) { if (!this.revoke(error)) this.patch({ searchPhase: 'error' }) } }
  }

  /** Commit one human room event; no Bot target is required. Retry reuses its stable message id. */
  async send(text: string, options: {
    threadRoot?: string
    mentionedEmployeeIds?: readonly string[]
    mentionedUserIds?: readonly string[]
    /** Uploaded attachment references committed before the send. */
    attachments?: readonly { attachmentId: string; name: string; mimeType: string; size: number }[]
  } = {}): Promise<boolean> {
    const selected = this.state.getSnapshot().selection
    if (selected === null || (text.trim() === '' && (options.attachments?.length ?? 0) === 0) || this.state.getSnapshot().busy) return false
    const fingerprint = JSON.stringify([selected.detail.id, text, options])
    if (this.pendingMessage?.fingerprint !== fingerprint) this.pendingMessage = { fingerprint, id: randomUUID() }
    const messageId = this.pendingMessage.id
    const request = new AbortController()
    this.patch({ busy: true, error: null })
    try {
      const result = record(await this.read(`/${encodeURIComponent(selected.detail.id)}/messages`, request.signal, {
        text, messageId,
        ...(options.threadRoot === undefined ? {} : { threadRoot: options.threadRoot }),
        ...(options.mentionedEmployeeIds === undefined ? {} : { mentionedEmployeeIds: options.mentionedEmployeeIds }),
        ...(options.mentionedUserIds === undefined ? {} : { mentionedUserIds: options.mentionedUserIds }),
        ...(options.attachments === undefined || options.attachments.length === 0 ? {}
          : { attachments: options.attachments.map(file => ({ attachmentId: file.attachmentId })) }),
      }))
      if (this.cancelled(request)) return false
      if (result['delivered'] !== true) { this.patch({ busy: false, error: typeof result['reason'] === 'string' ? result['reason'] : 'request-failed' }); return false }
      const posted = roomEvent(result['event'])
      if (Array.isArray(result['targets'])) this.rememberExecutionSessions(result['targets'].flatMap((value) => {
        const target = record(value)
        return typeof target['sessionId'] === 'string' ? [target['sessionId']] : []
      }))
      this.pendingMessage = undefined
      if (this.state.getSnapshot().selection?.detail.id === selected.detail.id) {
        this.patch({
          busy: false,
          events: appendUnique(this.state.getSnapshot().events, [posted]),
          ...(options.threadRoot === undefined ? {} : { threadEvents: appendUnique(this.state.getSnapshot().threadEvents, [posted]) }),
        })
      }
      return true
    } catch (error) {
      if (!this.cancelled(request)) { if (!this.revoke(error)) this.patch({ busy: false, error: error instanceof HttpFailure ? error.message : 'request-failed' }) }
      return false
    }
  }

  /** Append one signed reaction; repeat after a lost response with the same request id. */
  async react(eventId: string, emoji: string): Promise<boolean> {
    const selected = this.state.getSnapshot().selection
    if (selected === null || this.state.getSnapshot().busy) return false
    const fingerprint = JSON.stringify([selected.detail.id, eventId, emoji])
    if (this.pendingReaction?.fingerprint !== fingerprint) this.pendingReaction = { fingerprint, id: randomUUID() }
    const requestId = this.pendingReaction.id
    this.patch({ busy: true, error: null })
    try {
      const result = record(await this.read(`/${encodeURIComponent(selected.detail.id)}/reactions`, new AbortController().signal, { eventId, emoji, requestId }))
      const posted = roomEvent(result['event'])
      this.pendingReaction = undefined
      if (this.state.getSnapshot().selection?.detail.id === selected.detail.id) {
        this.patch({ busy: false, events: appendUnique(this.state.getSnapshot().events, [posted]) })
      }
      return true
    } catch (error) { if (!this.revoke(error)) this.patch({ busy: false, error: error instanceof HttpFailure ? error.message : 'request-failed' }); return false }
  }

  /** Apply one administrator change to a group and reload its authorized detail and roster row. */
  private async mutateRoom(id: string, path: string, body: object): Promise<boolean> {
    const request = new AbortController()
    this.patch({ busy: true, error: null })
    try {
      await this.read(`/${encodeURIComponent(id)}${path}`, request.signal, body)
      if (this.cancelled(request)) return false
      this.patch({ busy: false })
      await this.refreshCurrent()
      void this.refresh()
      return true
    } catch (error) {
      if (!this.cancelled(request)) { if (!this.revoke(error)) this.patch({ busy: false, error: error instanceof HttpFailure ? error.message : 'request-failed' }) }
      return false
    }
  }

  /** Rename a group as its creating administrator. */
  rename(id: string, name: string): Promise<boolean> {
    return this.mutateRoom(id, '/rename', { name })
  }

  /** Replace the group announcement as its creating administrator; empty text removes the notice. */
  setAnnouncement(id: string, text: string): Promise<boolean> {
    return this.mutateRoom(id, '/announcement', { text })
  }

  /** Add human and employee members to a group as its creating administrator. */
  addMembers(id: string, memberEmployeeIds: readonly string[], memberUserIds: readonly string[]): Promise<boolean> {
    return this.mutateRoom(id, '/members/add', { memberEmployeeIds: [...memberEmployeeIds], memberUserIds: [...memberUserIds] })
  }

  /** Remove human and employee members from a group as its creating administrator. */
  removeMembers(id: string, memberEmployeeIds: readonly string[], memberUserIds: readonly string[]): Promise<boolean> {
    return this.mutateRoom(id, '/members/remove', { memberEmployeeIds: [...memberEmployeeIds], memberUserIds: [...memberUserIds] })
  }

  /** Create one collaboration room, refresh the roster and open its shared timeline. */
  async create(input: CreateCollaboration): Promise<boolean> {
    if (this.state.getSnapshot().busy) return false
    const fingerprint = JSON.stringify(input)
    if (this.pendingCreation?.fingerprint !== fingerprint) this.pendingCreation = { fingerprint, id: randomUUID() }
    const idempotencyKey = this.pendingCreation.id
    const request = this.begin()
    this.patch({ busy: true, error: null })
    try {
      const created = surface(await this.read(input.kind === 'group' ? '/groups' : '/channels', request.signal, { ...input, idempotencyKey }))
      this.roomCreated?.()
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

  /** Upload one attachment into the selected room; files commit before the message referencing them. */
  async uploadAttachment(roomId: string, file: File): Promise<{ attachmentId: string; name: string; mimeType: string; size: number }> {
    const response = await this.fetch(`/enterprise/surfaces/${encodeURIComponent(roomId)}/attachments?name=${encodeURIComponent(file.name)}&type=${encodeURIComponent(file.type || 'application/octet-stream')}`, {
      credentials: 'same-origin', method: 'POST', body: file,
    })
    if (!response.ok) throw new HttpFailure(response.status)
    const row = record(await response.json())
    return { attachmentId: string(row['attachmentId']), name: string(row['name']), mimeType: string(row['mimeType']), size: Number(row['size']) }
  }

  /** Same-origin download URL for one room attachment. */
  attachmentUrl(roomId: string, attachmentId: string): string {
    return `/enterprise/surfaces/${encodeURIComponent(roomId)}/attachments/${encodeURIComponent(attachmentId)}`
  }

  /** Merge this member's sidebar preferences for one room into the stored row. */
  async setRoomPrefs(id: string,
    patch: { readonly pinned?: boolean; readonly starred?: boolean; readonly muted?: boolean }): Promise<boolean> {
    const request = new AbortController()
    this.patch({ busy: true, error: null })
    try {
      const row = record(await this.read(`/${encodeURIComponent(id)}/prefs`, request.signal, {
        ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
        ...(patch.starred === undefined ? {} : { starred: patch.starred }),
        ...(patch.muted === undefined ? {} : { muted: patch.muted }),
      }))
      const merged = prefs(row)
      if (merged === undefined) throw new Error('invalid-response')
      if (!this.cancelled(request)) {
        const snapshot = this.state.getSnapshot()
        const selection = snapshot.selection
        this.patch({
          surfaces: snapshot.surfaces.map(surface => surface.id === id ? { ...surface, prefs: merged } : surface),
          ...(selection !== null && selection.detail.id === id
            ? { selection: { ...selection, detail: { ...selection.detail, prefs: merged } } }
            : {}),
        })
      }
      this.patch({ busy: false })
      return true
    } catch (error) {
      if (!this.cancelled(request)) { if (!this.revoke(error)) this.patch({ busy: false, error: error instanceof HttpFailure ? error.message : 'request-failed' }) }
      return false
    }
  }

  /** Abort pending reads so an unloaded plugin cannot publish navigation or state. */
  dispose(): void {
    this.closed = true
    this.selectionRequest?.abort()
    this.rosterRequest?.abort()
    this.pollRequest?.abort()
    this.threadRequest?.abort()
    this.searchRequest?.abort()
  }
}
