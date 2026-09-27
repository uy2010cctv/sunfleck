/** Shared conversation authorization and routing through the existing native Session runtime. */
import { createHash, randomUUID } from 'node:crypto'
import type { RoomAttachmentTag } from './collaboration-identity.ts'
import type { RoomPrefs } from '@deepseek-ai/dsh-enterprise-postgres'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import { CollaborationCreationConflictError } from '@deepseek-ai/dsh-enterprise-postgres'
import type { CollaborationRecord, CollaborationTopic, CollaborationSession, RoomEvent,
  PostgresCollaborationRepository } from '@deepseek-ai/dsh-enterprise-postgres'

/** Published employee projection used for routing and the detail panel. */
export interface CollaborationEmployee { readonly employeeId: string
  readonly displayName: string
  readonly releaseId: string
  /** Deterministic avatar seed from the published profile; absent for legacy releases. */
  readonly avatarSeed?: string }
/** Authenticated conversation details; native ids are returned only after membership and workspace checks. */
export interface CollaborationDetail {
  readonly id: string
  readonly kind: 'group' | 'channel'
  readonly name: string
  readonly memberCount: number
  readonly workspaceId: string
  readonly memberUserIds: readonly string[]
  readonly members: readonly CollaborationEmployee[]
  readonly humanMembers?: readonly { readonly userId: string; readonly displayName: string }[]
  readonly topics: readonly CollaborationTopic[]
  readonly dutyEmployeeIds: readonly string[]
  /** The authenticated human, so clients can distinguish their own posts. */
  readonly viewerUserId: string
  /** Whether the authenticated human administers this group. */
  readonly viewerIsAdmin: boolean
  readonly adminUserId?: string
  readonly announcement?: string
  readonly topicPolicy?: 'thread' | 'command' | 'lane'
  readonly respondPolicy?: 'mention_duty' | 'ingest_only'
  readonly project?: { readonly id: string
    readonly name: string
    readonly goal: string }
  readonly team?: { readonly id: string
    readonly name: string }
}
/** Explicit destination selection; omitted values never choose an arbitrary group employee. */
export interface CollaborationOpenInput { readonly topicId?: string
  readonly employeeId?: string }
/** Native destination or an actionable selection state. */
export type CollaborationOpenResult =
  | { readonly opened: true
    readonly sessionId: string
    readonly employeeId?: string
    readonly topicId?: string }
  | { readonly opened: false
    readonly reason: 'select-employee' | 'select-topic' | 'team-not-started' | 'ingest-only'
    readonly detail: CollaborationDetail }
/** Text-only collaboration dispatch. */
export interface CollaborationMessageInput {
  readonly text: string
  readonly topicId?: string
  readonly threadRoot?: string
  readonly mentionedEmployeeIds?: readonly string[]
  readonly mentionedUserIds?: readonly string[]
  readonly messageId?: string
  /** Uploaded room files referenced by this message; resolved and signed from stored metadata. */
  readonly attachments?: readonly { readonly attachmentId: string }[]
  /** Native composer source, set only by the Host. */
  readonly sourceSessionId?: string
}
/** Upload limits for one room attachment and one message's attachment count. */
export const ROOM_ATTACHMENT_LIMITS = { maxBytes: 20 * 1024 * 1024, maxPerMessage: 8, maxNameLength: 200 } as const
/** Explicit member ids for one group membership change; omitted kinds stay unchanged. */
export interface CollaborationMemberChange {
  readonly employeeIds?: readonly string[]
  readonly userIds?: readonly string[]
}
/** One uploaded room file: stored bytes plus the metadata signed into message events. */
export interface RoomAttachmentRef {
  readonly attachmentId: string
  readonly name: string
  readonly mimeType: string
  readonly size: number
}
/** Routing receipt; accepted messages are durable, not necessarily completed by an employee. */
export type CollaborationDelivery =
  | { readonly delivered: true
    readonly targets: readonly { readonly sessionId: string
      readonly employeeId?: string }[]
    readonly event?: CollaborationRoomEvent
    readonly topicId?: string }
  | { readonly delivered: false
    readonly reason: string }
/** Signed NIP-01 event plus authorization-scoped room presentation. */
export type CollaborationRoomEvent = RoomEvent['event'] & {
  readonly sequence: string
  readonly author: { readonly kind: RoomEvent['authorKind']; readonly id: string; readonly displayName: string }
  readonly threadRoot?: string
  readonly sourceSessionId?: string
}
/** Room persistence and signing; the service performs current membership checks first. */
export interface CollaborationRoomRuntime {
  appendHuman(actor: EnterprisePrincipal, row: CollaborationRecord,
    input: CollaborationMessageInput, dispatch: { readonly targets: readonly string[]
      readonly route?: 'team' | 'ingest' }, attachments?: readonly RoomAttachmentTag[]): Promise<RoomEvent>
  react(actor: EnterprisePrincipal, row: CollaborationRecord,
    input: { readonly eventId: string
      readonly emoji: string
      readonly requestId: string }): Promise<RoomEvent>
  list(row: CollaborationRecord, options: { readonly after?: string
    readonly before?: string
    readonly limit?: number
    readonly threadRoot?: string }): Promise<readonly RoomEvent[]>
  get(row: CollaborationRecord, eventId: string): Promise<RoomEvent | undefined>
  search(row: CollaborationRecord, query: string, limit: number): Promise<readonly RoomEvent[]>
  attention(row: CollaborationRecord, userId: string): Promise<{
    readonly newMessages: boolean
    readonly mentions: boolean
    readonly unread: number
  }>
  markRead(row: CollaborationRecord, userId: string, sequence: string): Promise<boolean>
  present(actor: EnterprisePrincipal, row: CollaborationRecord, event: RoomEvent): Promise<CollaborationRoomEvent>
  prompt(row: CollaborationRecord, current: RoomEvent): Promise<string>
  dispatchCommitted?(actor: EnterprisePrincipal, row: CollaborationRecord,
    event: RoomEvent): Promise<CollaborationDelivery>
  replayedTargets?(row: CollaborationRecord, event: RoomEvent,
    dispatch: { readonly targets: readonly string[]; readonly route?: 'team' | 'ingest' }): Promise<readonly {
    readonly sessionId: string
    readonly employeeId?: string }[]>
  committed?(actor: EnterprisePrincipal, row: CollaborationRecord, event: RoomEvent): Promise<void>
  reconcile?(row: CollaborationRecord): Promise<void>
}
/** Existing native services supplied by the controller composition. */
export interface CollaborationRuntime {
  readonly room?: CollaborationRoomRuntime | undefined
  attachRoomTools?(sessionId: string): Promise<void>
  /** Notify the Workspace projection owner after all destination grants have committed.
   * @param workspaceId - Workspace whose native destination became visible.
   */
  refreshWorkspace(workspaceId: string): void
  workspaceVisible(actor: EnterprisePrincipal, workspaceId: string): Promise<boolean>
  memberWorkspaceVisible(orgId: string, userId: string, workspaceId: string): Promise<boolean>
  employee(actor: EnterprisePrincipal, employeeId: string): Promise<CollaborationEmployee | undefined>
  project(actor: EnterprisePrincipal, id: string): Promise<CollaborationDetail['project']>
  /** A new room may join only a member-visible active project. */
  projectActive(actor: EnterprisePrincipal, id: string): Promise<boolean>
  team(actor: EnterprisePrincipal, id: string): Promise<CollaborationDetail['team']>
  humanMembers?(actor: EnterprisePrincipal, row: CollaborationRecord): Promise<readonly {
    readonly userId: string
    readonly displayName: string
  }[]>
  createSession(actor: EnterprisePrincipal,
    input: { sessionId: string; workspaceId: string; employee: CollaborationEmployee; objective: string }): Promise<string>
  prompt(actor: EnterprisePrincipal, sessionId: string, record: CollaborationRecord, input: CollaborationMessageInput): Promise<void>
  record(actor: EnterprisePrincipal, sessionId: string, record: CollaborationRecord, input: CollaborationMessageInput): Promise<void>
  ingest(actor: EnterprisePrincipal, record: CollaborationRecord, input: CollaborationMessageInput): Promise<CollaborationDelivery>
  teamSession(actor: EnterprisePrincipal, record: CollaborationRecord, runId?: string): Promise<CollaborationSession | undefined>
  teamMessage(actor: EnterprisePrincipal, record: CollaborationRecord, input: CollaborationMessageInput): Promise<CollaborationDelivery>
}
/** Transport-neutral failure with an intentional HTTP status. */
export class CollaborationError extends Error {
  /** @param code - Stable client error. @param status - HTTP status. */
  constructor(readonly code: string, readonly status = 400) { super(code) }
}

/** Conversation coordinator; native Session creation is serialized per durable destination. */
export class CollaborationService {
  private readonly creations = new Map<string, Promise<CollaborationSession>>()
  /** @param store - PostgreSQL persistence. @param runtime - Native authorized execution services. */
  constructor(readonly store: PostgresCollaborationRepository, private readonly runtime: CollaborationRuntime) {}

  /** Read one membership-scoped room page.
   * @param actor - Authenticated human.
   * @param id - Room identity.
   * @param options - Bounded cursor and thread selection.
   * @returns Signed room events and the next incremental cursor.
   */
  async events(actor: EnterprisePrincipal, id: string, options: { readonly after?: string
    readonly before?: string
    readonly limit?: number
    readonly threadRoot?: string }): Promise<{ items: readonly CollaborationRoomEvent[]
    nextCursor: string | null
    prevCursor: string | null }> {
    const row = await this.authorized(actor, id)
    const room = this.requireRoom()
    await room.reconcile?.(row)
    const events = await room.list(row, options)
    return { items: await Promise.all(events.map(event => room.present(actor, row, event))),
      nextCursor: events.at(-1)?.sequence ?? null, prevCursor: events[0]?.sequence ?? null }
  }

  /** Advance this human's room cursor to an exact event from the displayed room page.
   * @param actor - Authenticated human.
   * @param id - Room identity.
   * @param sequence - Last displayed signed event sequence.
   */
  async markRead(actor: EnterprisePrincipal, id: string, sequence: string): Promise<void> {
    const row = await this.authorized(actor, id)
    if (!/^[1-9][0-9]*$/u.test(sequence) || BigInt(sequence) > 9_223_372_036_854_775_807n) {
      throw new CollaborationError('invalid-room-read-cursor')
    }
    if (!await this.requireRoom().markRead(row, actor.userId, sequence)) {
      throw new CollaborationError('room-read-event-not-found', 404)
    }
  }

  /** Search signed room history after current membership validation.
   * @param actor - Authenticated human.
   * @param id - Room identity.
   * @param query - Search text.
   * @returns Bounded signed matches.
   */
  async search(actor: EnterprisePrincipal, id: string, query: string): Promise<{ items: readonly CollaborationRoomEvent[] }> {
    const row = await this.authorized(actor, id)
    if (query.trim() === '' || query.length > 200) throw new CollaborationError('invalid-search')
    const room = this.requireRoom()
    return { items: await Promise.all((await room.search(row, query, 50)).map(event => room.present(actor, row, event))) }
  }

  /** Add one authenticated reaction to an event in the same room.
   * @param actor - Authenticated human.
   * @param id - Room identity.
   * @param input - Target and stable request id.
   * @returns The signed reaction event.
   */
  async react(actor: EnterprisePrincipal, id: string, input: { readonly eventId: string
    readonly emoji: string
    readonly requestId: string }): Promise<{ event: CollaborationRoomEvent }> {
    const row = await this.authorized(actor, id)
    if (input.emoji.length > 32 || input.requestId.length > 200) throw new CollaborationError('invalid-reaction')
    const room = this.requireRoom()
    const event = await room.react(actor, row, input)
    await room.committed?.(actor, row, event)
    return { event: await room.present(actor, row, event) }
  }

  private requireRoom(): CollaborationRoomRuntime {
    if (this.runtime.room === undefined) throw new CollaborationError('room-unavailable', 503)
    return this.runtime.room
  }

  /** Claim native delivery for a committed signed event, including workflow Bot requests.
   * @param actor - Authenticated current room member.
   * @param id - Room identity.
   * @param eventId - Signed event identity.
   * @returns Native targets claimed by this request.
   */
  async dispatchSignedEvent(actor: EnterprisePrincipal, id: string, eventId: string): Promise<CollaborationDelivery> {
    const row = await this.authorized(actor, id)
    const room = this.requireRoom()
    const event = await room.get(row, eventId)
    if (event === undefined || room.dispatchCommitted === undefined) throw new CollaborationError('room-event-not-found', 404)
    return room.dispatchCommitted(actor, row, event)
  }

  /** Dispatch an already signed and committed employee post to addressed room members.
   * @param actor - Current owner of the source employee Session.
   * @param row - Room containing the signed post.
   * @param event - Persisted employee post.
   * @param employeeIds - Explicit destination members.
   * @returns Native execution targets.
   */
  async dispatchEmployeePost(actor: EnterprisePrincipal, row: CollaborationRecord, event: RoomEvent,
    employeeIds: readonly string[]): Promise<readonly { sessionId: string; employeeId: string }[]> {
    const current = await this.authorized(actor, row.id)
    if (event.orgId !== current.orgId || event.surfaceId !== current.id || event.authorKind !== 'employee'
      || event.sourceSessionId === undefined) throw new CollaborationError('room-event-forbidden', 403)
    const source = await this.store.bySession(event.sourceSessionId)
    if (source?.surfaceId !== current.id || source.employeeId !== event.authorId) {
      throw new CollaborationError('room-event-forbidden', 403)
    }
    const room = this.requireRoom()
    const prompt = await room.prompt(current, event)
    const destinations: { sessionId: string; employeeId: string }[] = []
    for (const employeeId of new Set(employeeIds)) {
      if (!current.memberEmployeeIds.includes(employeeId) || employeeId === event.authorId) {
        throw new CollaborationError('employee-not-member', 404)
      }
      const topicId = current.kind === 'channel' ? event.threadRoot ?? event.event.id : ''
      if (topicId !== '') await this.store.ensureTopic(current.id, topicId, event.event.content.slice(0, 40))
      const target = await this.destination(actor, current, employeeId, topicId)
      await this.runtime.prompt(actor, target.sessionId, current, { text: prompt, messageId: event.event.id,
        ...(topicId === '' ? {} : { topicId }) })
      destinations.push({ sessionId: target.sessionId, employeeId })
    }
    return destinations
  }

  /** Deliver one already signed human event to one current room Bot member.
   * @param actor - Authenticated original human author.
   * @param row - Current room.
   * @param event - Committed human room event.
   * @param employeeId - Claimed outbox target.
   * @returns Native target after its request id lands.
   */
  async dispatchHumanPost(actor: EnterprisePrincipal, row: CollaborationRecord, event: RoomEvent,
    employeeId: string): Promise<{ sessionId: string; employeeId: string }> {
    const current = await this.authorized(actor, row.id)
    if (event.orgId !== current.orgId || event.surfaceId !== current.id || event.authorKind !== 'human'
      || event.authorId !== actor.userId || event.event.kind !== 9 || !current.memberEmployeeIds.includes(employeeId)) {
      throw new CollaborationError('room-event-forbidden', 403)
    }
    const topicId = current.kind === 'channel' ? event.threadRoot ?? event.event.id : ''
    if (topicId !== '') await this.store.ensureTopic(current.id, topicId, event.event.content.slice(0, 40))
    const target = await this.destination(actor, current, employeeId, topicId)
    await this.runtime.prompt(actor, target.sessionId, current, {
      text: await this.requireRoom().prompt(current, event), messageId: event.event.id,
      ...(topicId === '' ? {} : { topicId }),
    })
    return { sessionId: target.sessionId, employeeId }
  }

  /** Deliver a committed charter route through the existing TeamRun runtime.
   * @param actor - Current human author.
   * @param row - Charter group.
   * @param event - Signed room input.
   * @returns Native TeamRun receipt.
   */
  async dispatchTeamPost(actor: EnterprisePrincipal, row: CollaborationRecord,
    event: RoomEvent): Promise<CollaborationDelivery> {
    const current = await this.authorized(actor, row.id)
    if (current.teamDefinitionId === undefined || event.orgId !== current.orgId
      || event.surfaceId !== current.id || event.authorKind !== 'human' || event.authorId !== actor.userId) {
      throw new CollaborationError('room-event-forbidden', 403)
    }
    return this.runtime.teamMessage(actor, current, {
      text: await this.requireRoom().prompt(current, event), messageId: event.event.id,
    })
  }

  /** Intake a signed announcement after current authorization is rechecked.
   * @param actor - Current human author.
   * @param row - Ingest-only channel.
   * @param event - Signed announcement.
   * @returns Proposal receipt or privacy rejection.
   */
  async dispatchIngestPost(actor: EnterprisePrincipal, row: CollaborationRecord,
    event: RoomEvent): Promise<CollaborationDelivery> {
    const current = await this.authorized(actor, row.id)
    if (current.respondPolicy !== 'ingest_only' || event.orgId !== current.orgId
      || event.surfaceId !== current.id || event.authorKind !== 'human' || event.authorId !== actor.userId) {
      throw new CollaborationError('room-event-forbidden', 403)
    }
    return this.runtime.ingest(actor, current, { text: event.event.content, messageId: event.event.id })
  }

  /** Send an already committed workflow event to one authorized member Bot.
   * @param actor - Authenticated workflow initiator with current room access.
   * @param row - Workflow room.
   * @param event - Signed service event in this room.
   * @param employeeId - Explicit receiving member.
   * @returns Native execution target.
   */
  async dispatchServicePost(actor: EnterprisePrincipal, row: CollaborationRecord, event: RoomEvent,
    employeeId: string): Promise<{ sessionId: string; employeeId: string }> {
    const current = await this.authorized(actor, row.id)
    if (event.orgId !== current.orgId || event.surfaceId !== current.id || event.authorKind !== 'service'
      || event.event.kind !== 41000 || !current.memberEmployeeIds.includes(employeeId)) {
      throw new CollaborationError('room-event-forbidden', 403)
    }
    const prompt = await this.requireRoom().prompt(current, event)
    const topicId = current.kind === 'channel' ? event.event.id : ''
    if (topicId !== '') await this.store.ensureTopic(current.id, topicId, event.event.content.slice(0, 40))
    const target = await this.destination(actor, current, employeeId, topicId)
    await this.runtime.prompt(actor, target.sessionId, current, { text: prompt, messageId: event.event.id,
      ...(topicId === '' ? {} : { topicId }) })
    return { sessionId: target.sessionId, employeeId }
  }

  /** List conversations whose membership and workspace remain accessible.
   * @param actor - Authenticated human.
   * @returns Sidebar entries with attention, unread count, and this member's preferences.
   */
  async list(actor: EnterprisePrincipal): Promise<readonly (Pick<CollaborationDetail, 'id' | 'kind' | 'name' | 'memberCount' | 'workspaceId'>
    & { readonly projectId?: string
      readonly teamDefinitionId?: string
      readonly executionSessionIds: readonly string[]
      readonly prefs: RoomPrefs })[]> {
    const rows = await this.store.list(actor.orgId, actor.userId)
    const visible = await Promise.all(rows.map(async row => await this.runtime.workspaceVisible(actor,
      row.workspaceId) ? row : undefined))
    const members = visible.filter((row): row is CollaborationRecord => row !== undefined)
    const prefs = await this.store.roomPrefs(actor.userId, members.map(row => row.id))
    const noPrefs: RoomPrefs = { pinned: false, starred: false, muted: false }
    return Promise.all(members.map(async row => ({
      id: row.id, kind: row.kind,
      name: row.name, memberCount: row.memberEmployeeIds.length + row.memberUserIds.length,
      workspaceId: row.workspaceId,
      attention: this.runtime.room === undefined ? { newMessages: false, mentions: false, unread: 0 }
        : await this.runtime.room.attention(row, actor.userId),
      prefs: prefs.get(row.id) ?? noPrefs,
      executionSessionIds: (await this.store.sessions(row.id)).map(binding => binding.sessionId),
      ...(row.projectId === undefined ? {} : { projectId: row.projectId }),
      ...(row.teamDefinitionId === undefined ? {} : { teamDefinitionId: row.teamDefinitionId }) })))
  }

  /** Merge this member's sidebar preferences for one authorized conversation.
   * @param actor - Authenticated room member.
   * @param id - Room identity.
   * @param patch - Flags to change; omitted flags keep their stored value.
   * @returns The merged stored preferences.
   */
  async setPrefs(actor: EnterprisePrincipal, id: string,
    patch: { readonly pinned?: boolean; readonly starred?: boolean; readonly muted?: boolean }): Promise<RoomPrefs> {
    await this.authorized(actor, id)
    for (const value of [patch.pinned, patch.starred, patch.muted]) {
      if (value !== undefined && typeof value !== 'boolean') throw new CollaborationError('invalid-prefs')
    }
    return this.store.setRoomPrefs(id, actor.userId, patch)
  }

  /** Resolve an authorized native composer to its conversation.
   * @param actor - Authenticated human.
   * @param sessionId - Native Session identity.
   * @returns Its conversation and destination, or undefined for ordinary Sessions.
   */
  async bySession(actor: EnterprisePrincipal,
    sessionId: string): Promise<{ detail: CollaborationDetail; employeeId?: string; topicId?: string } | undefined> {
    const binding = await this.store.bySession(sessionId)
    if (binding === undefined) return undefined
    return { detail: await this.detail(actor, binding.surfaceId),
      ...(binding.employeeId === '' ? {} : { employeeId: binding.employeeId }),
      ...(binding.topicId === '' ? {} : { topicId: binding.topicId }) }
  }

  /** Read current authorized employee, project, team, and topic data.
   * @param actor - Authenticated human.
   * @param id - Conversation identity.
   * @returns Detail panel data.
   */
  async detail(actor: EnterprisePrincipal, id: string): Promise<CollaborationDetail> {
    const row = await this.authorized(actor, id)
    const employees = await Promise.all(row.memberEmployeeIds.map(employee => this.runtime.employee(actor, employee)))
    const project = row.projectId === undefined ? undefined : await this.runtime.project(actor, row.projectId)
    const team = row.teamDefinitionId === undefined ? undefined : await this.runtime.team(actor, row.teamDefinitionId)
    const sessions = await this.store.sessions(id)
    const humanMembers = await this.runtime.humanMembers?.(actor, row)
    const topics = (await this.store.topics(id)).map((topic) => {
      const destinations = sessions.filter(value => value.topicId === topic.id).map(value => ({ sessionId: value.sessionId,
        employeeId: value.employeeId }))
      return { id: topic.id, title: topic.title, state: topic.state, destinations,
        ...(destinations.length === 1 && destinations[0] !== undefined ? { sessionId: destinations[0].sessionId } : {}) }
    })
    return {
      id, kind: row.kind, name: row.name, workspaceId: row.workspaceId, memberUserIds: row.memberUserIds,
      memberCount: row.memberEmployeeIds.length + row.memberUserIds.length,
      members: employees.filter((value): value is CollaborationEmployee => value !== undefined),
      ...(humanMembers === undefined ? {} : { humanMembers }),
      topics, dutyEmployeeIds: row.dutyEmployeeIds,
      viewerUserId: actor.userId,
      viewerIsAdmin: row.adminUserId === actor.userId,
      ...(row.adminUserId === undefined ? {} : { adminUserId: row.adminUserId }),
      ...(row.announcement === undefined ? {} : { announcement: row.announcement }),
      ...(row.topicPolicy === undefined ? {} : { topicPolicy: row.topicPolicy }),
      ...(row.respondPolicy === undefined ? {} : { respondPolicy: row.respondPolicy }),
      ...(project === undefined ? {} : { project }), ...(team === undefined ? {} : { team }),
    }
  }

  /** Create a conversation only from explicit accessible humans, workspace, and published employees.
   * @param actor - Authenticated creator.
   * @param input - Parsed creation values.
   * @returns Stored detail.
   */
  async create(actor: EnterprisePrincipal, input: Omit<CollaborationRecord, 'id' | 'orgId'> & { readonly idempotencyKey?: string }): Promise<CollaborationDetail> {
    if (!await this.runtime.workspaceVisible(actor, input.workspaceId)) throw new CollaborationError('workspace-forbidden', 403)
    const memberUserIds = [...new Set([...input.memberUserIds, actor.userId])]
    for (const userId of memberUserIds) {
      if (!await this.runtime.memberWorkspaceVisible(actor.orgId, userId,
        input.workspaceId)) throw new CollaborationError('member-workspace-forbidden', 403)
    }
    if (input.memberEmployeeIds.length === 0 && input.teamDefinitionId === undefined && input.respondPolicy !== 'ingest_only') throw new CollaborationError('employee-required')
    for (const id of [...input.memberEmployeeIds, ...input.dutyEmployeeIds]) {
      if (!await this.runtime.employee(actor, id)) throw new CollaborationError('employee-unavailable', 404)
    }
    if (input.dutyEmployeeIds.some(id => !input.memberEmployeeIds.includes(id))) throw new CollaborationError('duty-not-member')
    if (input.projectId !== undefined && !await this.runtime.projectActive(actor,
      input.projectId)) throw new CollaborationError('project-unavailable', 404)
    if (input.teamDefinitionId !== undefined && !await this.runtime.team(actor,
      input.teamDefinitionId)) throw new CollaborationError('team-unavailable', 404)
    const { idempotencyKey, announcement: _omitted, ...values } = input
    try {
      const row = await this.store.create({ ...values, memberUserIds, memberEmployeeIds: [...new Set(input.memberEmployeeIds)],
        dutyEmployeeIds: [...new Set(input.dutyEmployeeIds)], orgId: actor.orgId, adminUserId: actor.userId },
      idempotencyKey === undefined ? undefined : { creatorUserId: actor.userId, idempotencyKey })
      return await this.detail(actor, row.id)
    } catch (error) {
      if (error instanceof CollaborationCreationConflictError) throw new CollaborationError('idempotency-conflict', 409)
      throw error
    }
  }

  /** Rename a group as its creating administrator.
   * @param actor - Authenticated group administrator.
   * @param id - Group identity.
   * @param name - New stored name.
   * @returns Refreshed detail.
   */
  async rename(actor: EnterprisePrincipal, id: string, name: string): Promise<CollaborationDetail> {
    await this.requireGroupAdmin(actor, id)
    const trimmed = name.trim()
    if (trimmed === '' || trimmed.length > 120) throw new CollaborationError('invalid-name')
    if (!await this.store.rename(actor.orgId, id, trimmed)) throw new CollaborationError('not-found', 404)
    return this.detail(actor, id)
  }

  /** Replace the group announcement as its creating administrator; empty text removes the notice.
   * @param actor - Authenticated group administrator.
   * @param id - Group identity.
   * @param text - Announcement text.
   * @returns Refreshed detail.
   */
  async setAnnouncement(actor: EnterprisePrincipal, id: string, text: string): Promise<CollaborationDetail> {
    await this.requireGroupAdmin(actor, id)
    const trimmed = text.trim()
    if (trimmed.length > 2000) throw new CollaborationError('invalid-announcement')
    await this.store.setAnnouncement(id, trimmed === '' ? undefined : trimmed)
    return this.detail(actor, id)
  }

  /** Add human and employee members to a group as its creating administrator.
   * @param actor - Authenticated group administrator.
   * @param id - Group identity.
   * @param input - Explicit human and published employee ids.
   * @returns Refreshed detail.
   */
  async addMembers(actor: EnterprisePrincipal, id: string,
    input: CollaborationMemberChange): Promise<CollaborationDetail> {
    const row = await this.requireGroupAdmin(actor, id)
    const employeeIds = [...new Set(input.employeeIds ?? [])], userIds = [...new Set(input.userIds ?? [])]
    if (employeeIds.length === 0 && userIds.length === 0) throw new CollaborationError('invalid-members')
    for (const employeeId of employeeIds) {
      if (!await this.runtime.employee(actor, employeeId)) throw new CollaborationError('employee-unavailable', 404)
    }
    for (const userId of userIds) {
      if (!await this.runtime.memberWorkspaceVisible(actor.orgId, userId, row.workspaceId)) {
        throw new CollaborationError('member-workspace-forbidden', 403)
      }
    }
    await this.store.addMembers(id, { employeeIds, userIds })
    return this.detail(actor, id)
  }

  /** Remove human and employee members from a group as its creating administrator.
   * @param actor - Authenticated group administrator.
   * @param id - Group identity.
   * @param input - Explicit human and employee ids; absent ids stay absent.
   * @returns Refreshed detail.
   */
  async removeMembers(actor: EnterprisePrincipal, id: string,
    input: CollaborationMemberChange): Promise<CollaborationDetail> {
    const row = await this.requireGroupAdmin(actor, id)
    const employeeIds = [...new Set(input.employeeIds ?? [])], userIds = [...new Set(input.userIds ?? [])]
    if (employeeIds.length === 0 && userIds.length === 0) throw new CollaborationError('invalid-members')
    if (row.adminUserId !== undefined && userIds.includes(row.adminUserId)) throw new CollaborationError('group-admin-removal')
    await this.store.removeMembers(id, { employeeIds, userIds })
    return this.detail(actor, id)
  }

  /** Authorize one group administration request by its recorded creating human. */
  private async requireGroupAdmin(actor: EnterprisePrincipal, id: string): Promise<CollaborationRecord> {
    const row = await this.authorized(actor, id)
    if (row.kind !== 'group') throw new CollaborationError('group-only')
    if (row.adminUserId !== actor.userId) throw new CollaborationError('group-admin-required', 403)
    return row
  }

  /** Open an existing topic or an explicitly selected group employee.
   * @param actor - Authenticated human.
   * @param id - Conversation identity.
   * @param input - Explicit destination choices.
   * @returns Native destination or selection requirements.
   */
  async open(actor: EnterprisePrincipal, id: string, input: CollaborationOpenInput): Promise<CollaborationOpenResult> {
    const row = await this.authorized(actor, id)
    const unavailable = async (reason: Extract<CollaborationOpenResult,
      { opened: false }>['reason']): Promise<CollaborationOpenResult> => ({ opened: false, reason, detail: await this.detail(actor, id) })
    const sessions = await this.store.sessions(id)
    if (row.teamDefinitionId !== undefined) {
      const existing = await this.runtime.teamSession(actor, row, input.topicId)
      if (existing === undefined && input.topicId !== undefined) throw new CollaborationError('team-run-not-found', 404)
      return existing === undefined ? unavailable('team-not-started') : { opened: true, sessionId: existing.sessionId }
    }
    if (row.kind === 'channel') {
      if (row.respondPolicy === 'ingest_only') return unavailable('ingest-only')
      if (input.topicId === undefined) return unavailable('select-topic')
      const topic = (await this.store.topics(id)).find(value => value.id === input.topicId)
      if (topic === undefined) throw new CollaborationError('topic-not-found', 404)
      const destinations = sessions.filter(value => value.topicId === topic.id)
      const existing = input.employeeId === undefined
        ? destinations.length === 1 ? destinations[0] : undefined
        : destinations.find(value => value.employeeId === input.employeeId)
      if (existing === undefined) return unavailable(destinations.length > 1 ? 'select-employee' : 'select-topic')
      return { opened: true, sessionId: existing.sessionId, topicId: topic.id, employeeId: existing.employeeId }
    }
    if (input.employeeId === undefined) return unavailable('select-employee')
    if (!row.memberEmployeeIds.includes(input.employeeId)) throw new CollaborationError('employee-not-member', 404)
    const target = await this.destination(actor, row, input.employeeId, '')
    return { opened: true, sessionId: target.sessionId, employeeId: target.employeeId }
  }

  /** Route a message according to stored mention, charter, and topic policies.
   * @param actor - Authenticated human.
   * @param id - Conversation identity.
   * @param input - Text and optional routing choices.
   * @returns Durable delivery receipt or an explicit inactive state.
   */
  async message(actor: EnterprisePrincipal, id: string, input: CollaborationMessageInput): Promise<CollaborationDelivery> {
    const row = await this.authorized(actor, id)
    if (this.runtime.room !== undefined) return this.roomMessage(actor, row, input, this.runtime.room)
    if (row.teamDefinitionId !== undefined) return this.runtime.teamMessage(actor, row, input)
    if (row.respondPolicy === 'ingest_only') return this.runtime.ingest(actor, row, input)
    if (input.text.trim() === '') throw new CollaborationError('text-required')
    let topicId = ''
    if (row.kind === 'channel') {
      if (input.text.trim() === '/done') {
        if (input.topicId === undefined) return { delivered: false, reason: 'no-topic' }
        const topic = (await this.store.topics(id)).find(value => value.id === input.topicId)
        if (topic === undefined) return { delivered: false, reason: 'no-topic' }
        if (topic.state !== 'open') return { delivered: false, reason: 'already-settled' }
        const bindings = (await this.store.sessions(id)).filter(value => value.topicId === input.topicId)
        for (const binding of bindings) await this.runtime.record(actor, binding.sessionId, row, input)
        if (!await this.store.settle(id, input.topicId)) return { delivered: false, reason: 'already-settled' }
        return { delivered: true, targets: [], topicId: input.topicId }
      }
      const command = /^\/topic\s+(.+)$/su.exec(input.text.trim())
      if (input.text.trim() === '/topic') return { delivered: false, reason: 'invalid-command' }
      topicId = row.topicPolicy === 'lane' ? 'lane' : command === null ? input.topicId ?? '' : ''
      if (topicId === '' && command === null && row.topicPolicy === 'command') return { delivered: false, reason: 'no-topic' }
      if (topicId === '') topicId = input.messageId === undefined ? randomUUID() : `topic-${hash(input.messageId)}`
      const prior = (await this.store.topics(id)).find(topic => topic.id === topicId)
      if (prior?.state === 'settled') return { delivered: false, reason: 'already-settled' }
      if (prior === undefined && input.topicId !== undefined && command === null) return { delivered: false, reason: 'no-topic' }
      await this.store.ensureTopic(id, topicId, row.topicPolicy === 'lane' ? row.name : command?.[1] ?? input.text.slice(0, 40))
    }
    const employees = (await Promise.all(row.memberEmployeeIds.map(employee => this.runtime.employee(actor,
      employee)))).filter((value): value is CollaborationEmployee => value !== undefined)
    let targets = input.mentionedEmployeeIds === undefined
      ? mentionedEmployees(input.text, employees)
      : [...new Set(input.mentionedEmployeeIds)].filter(employee => employees.some(value => value.employeeId === employee))
    if (row.kind === 'channel' && targets.length === 0) targets = row.dutyEmployeeIds.slice(0, 1)
    if (targets.length === 0) {
      if (input.sourceSessionId !== undefined) {
        const binding = (await this.store.sessions(id)).find(value => value.sessionId === input.sourceSessionId)
        if (binding === undefined) throw new CollaborationError('session-not-found', 404)
        await this.runtime.record(actor, binding.sessionId, row, input)
        return { delivered: true, targets: [] }
      }
      return { delivered: false, reason: 'no-target' }
    }
    const deliveries: { sessionId: string; employeeId: string }[] = []
    for (const employee of targets) {
      const target = await this.destination(actor, row, employee, topicId)
      await this.runtime.prompt(actor, target.sessionId, row, { ...input, ...(topicId === '' ? {} : { topicId }) })
      deliveries.push({ sessionId: target.sessionId, employeeId: target.employeeId })
    }
    if (input.sourceSessionId !== undefined && !deliveries.some(target => target.sessionId === input.sourceSessionId)) {
      const source = (await this.store.sessions(id)).find(value => value.sessionId === input.sourceSessionId)
      if (source === undefined) throw new CollaborationError('session-not-found', 404)
      await this.runtime.record(actor, source.sessionId, row, input)
    }
    return { delivered: true, targets: deliveries, ...(topicId === '' ? {} : { topicId }) }
  }

  /** Store one uploaded file for a room the actor belongs to.
   * @param actor - Authenticated current room member.
   * @param id - Room identity.
   * @param upload - Raw bytes plus client-supplied name and media type.
   * @returns The stored attachment reference (server-assigned id).
   */
  async uploadAttachment(actor: EnterprisePrincipal, id: string, upload: { readonly name: string
    readonly mimeType: string
    readonly data: Buffer }): Promise<RoomAttachmentRef> {
    await this.authorized(actor, id)
    const name = upload.name.trim()
    if (name === '' || name.length > ROOM_ATTACHMENT_LIMITS.maxNameLength || /[\u0000-\u001f\u007f]/.test(name)) {
      throw new CollaborationError('invalid-attachment')
    }
    const mimeType = upload.mimeType.trim() === '' ? 'application/octet-stream' : upload.mimeType.trim()
    if (mimeType.length > 100 || !/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) throw new CollaborationError('invalid-attachment')
    if (upload.data.length === 0 || upload.data.length > ROOM_ATTACHMENT_LIMITS.maxBytes) {
      throw new CollaborationError('attachment-too-large', 413)
    }
    const attachmentId = randomUUID()
    await this.store.putAttachment({ surfaceId: id, attachmentId, uploaderUserId: actor.userId,
      name, mimeType, data: upload.data })
    return { attachmentId, name, mimeType, size: upload.data.length }
  }

  /** Read one stored room attachment after current membership validation.
   * @param actor - Authenticated current room member.
   * @param id - Room identity.
   * @param attachmentId - Upload identity.
   * @returns Attachment metadata and bytes.
   */
  async attachment(actor: EnterprisePrincipal, id: string, attachmentId: string): Promise<RoomAttachmentRef & { readonly data: Buffer }> {
    await this.authorized(actor, id)
    const stored = await this.store.getAttachment(id, attachmentId)
    if (stored === undefined) throw new CollaborationError('attachment-not-found', 404)
    return stored
  }

  /** Resolve message-attachment references to stored metadata under current membership.
   * @param row - Current room.
   * @param input - Message input carrying at most the per-message attachment budget.
   * @returns Stored references for every referenced id.
   */
  private async resolveAttachments(row: CollaborationRecord,
    input: CollaborationMessageInput): Promise<readonly RoomAttachmentRef[]> {
    const ids = input.attachments?.map(attachment => attachment.attachmentId) ?? []
    if (ids.length === 0) return []
    if (ids.length > ROOM_ATTACHMENT_LIMITS.maxPerMessage
      || ids.some(attachmentId => typeof attachmentId !== 'string' || attachmentId.length === 0 || attachmentId.length > 128)) {
      throw new CollaborationError('invalid-attachment')
    }
    const resolved: RoomAttachmentRef[] = []
    for (const attachmentId of [...new Set(ids)]) {
      const stored = await this.store.getAttachment(row.id, attachmentId)
      if (stored === undefined) throw new CollaborationError('attachment-not-found', 404)
      resolved.push({ attachmentId: stored.attachmentId, name: stored.name, mimeType: stored.mimeType, size: stored.size })
    }
    return resolved
  }

  private async roomMessage(actor: EnterprisePrincipal, row: CollaborationRecord, input: CollaborationMessageInput,
    room: CollaborationRoomRuntime): Promise<CollaborationDelivery> {
    if ((input.text.trim() === '' && (input.attachments?.length ?? 0) === 0) || input.text.length > 20_000) {
      throw new CollaborationError('invalid-text')
    }
    const attachments = await this.resolveAttachments(row, input)
    if (input.mentionedEmployeeIds?.some(id => !row.memberEmployeeIds.includes(id))) {
      throw new CollaborationError('employee-not-member', 404)
    }
    if ((input.mentionedUserIds?.length ?? 0) > 32
      || new Set(input.mentionedUserIds).size !== (input.mentionedUserIds?.length ?? 0)
      || input.mentionedUserIds?.some(id => !row.memberUserIds.includes(id))) {
      throw new CollaborationError('human-not-member', 404)
    }
    if (input.sourceSessionId !== undefined) {
      const binding = await this.store.bySession(input.sourceSessionId)
      if (binding?.surfaceId !== row.id) throw new CollaborationError('session-not-found', 404)
    }
    let targets: string[] = []
    if (row.teamDefinitionId === undefined && row.respondPolicy !== 'ingest_only') {
      const employees = (await Promise.all(row.memberEmployeeIds.map(employeeId => this.runtime.employee(actor, employeeId))))
        .filter((value): value is CollaborationEmployee => value !== undefined)
      targets = input.mentionedEmployeeIds === undefined
        ? mentionedEmployees(input.text, employees)
        : [...new Set(input.mentionedEmployeeIds)]
      if (row.kind === 'channel' && targets.length === 0) targets = [...row.dutyEmployeeIds]
    }
    const dispatch: { targets: string[]; route?: 'team' | 'ingest' } = { targets,
      ...(row.teamDefinitionId === undefined ? row.respondPolicy === 'ingest_only' ? { route: 'ingest' as const } : {}
        : { route: 'team' as const }) }
    const committed = await room.appendHuman(actor, row, input, dispatch,
      attachments.length === 0 ? undefined : attachments)
    await room.committed?.(actor, row, committed)
    const event = await room.present(actor, row, committed)
    if (room.dispatchCommitted !== undefined) {
      const delivery = await room.dispatchCommitted(actor, row, committed)
      const replayed = dispatch.targets.length > 0 || dispatch.route === 'team'
        ? await room.replayedTargets?.(row, committed, dispatch) ?? [] : []
      const targets = [...new Map([...(delivery.delivered ? delivery.targets : []), ...replayed]
        .map(target => [target.sessionId, target])).values()]
      return { delivered: true, event, targets,
        ...(row.kind === 'channel' && row.respondPolicy !== 'ingest_only'
          ? { topicId: input.threadRoot ?? committed.event.id } : {}) }
    }
    const execution = async (): Promise<CollaborationMessageInput> => ({
      text: await room.prompt(row, committed), messageId: committed.event.id,
      ...(input.sourceSessionId === undefined ? {} : { sourceSessionId: input.sourceSessionId }),
      ...(input.threadRoot === undefined ? {} : { threadRoot: input.threadRoot }),
    })
    if (row.teamDefinitionId !== undefined) {
      const result = await this.runtime.teamMessage(actor, row, await execution())
      return result.delivered ? { ...result, event } : { delivered: true, targets: [], event }
    }
    if (row.respondPolicy === 'ingest_only') {
      await this.runtime.ingest(actor, row, { ...input, messageId: committed.event.id })
      return { delivered: true, targets: [], event }
    }
    if (targets.length === 0) return { delivered: true, targets: [], event }
    const promptInput = await execution()
    const topicId = row.kind === 'channel' ? input.threadRoot ?? committed.event.id : ''
    if (topicId !== '') await this.store.ensureTopic(row.id, topicId, input.text.slice(0, 40))
    const deliveries: { sessionId: string; employeeId: string }[] = []
    for (const employeeId of targets) {
      const target = await this.destination(actor, row, employeeId, topicId)
      await this.runtime.prompt(actor, target.sessionId, row, { ...promptInput,
        ...(topicId === '' ? {} : { topicId }) })
      deliveries.push({ sessionId: target.sessionId, employeeId })
    }
    return { delivered: true, event, targets: deliveries, ...(topicId === '' ? {} : { topicId }) }
  }

  private async authorized(actor: EnterprisePrincipal, id: string): Promise<CollaborationRecord> {
    const row = await this.store.get(actor.orgId, id)
    if (row === undefined || !row.memberUserIds.includes(actor.userId) || !await this.runtime.workspaceVisible(actor,
      row.workspaceId)) throw new CollaborationError('not-found', 404)
    return row
  }

  private async destination(actor: EnterprisePrincipal, row: CollaborationRecord, employeeId: string,
    topicId: string): Promise<CollaborationSession> {
    const key = JSON.stringify([row.id, topicId, employeeId])
    const active = this.creations.get(key)
    if (active !== undefined) return active
    const create = async (): Promise<CollaborationSession> => {
      const existing = (await this.store.sessions(row.id)).find(value => value.topicId === topicId && value.employeeId === employeeId)
      if (existing !== undefined) {
        await this.runtime.attachRoomTools?.(existing.sessionId)
        return existing
      }
      const employee = await this.runtime.employee(actor, employeeId)
      if (employee === undefined) throw new CollaborationError('employee-unavailable', 404)
      const sessionId = await this.runtime.createSession(actor, { sessionId: `session-collaboration-${hash(key)}`,
        workspaceId: row.workspaceId, employee, objective: `${row.name} · ${employee.displayName}` })
      const binding = { surfaceId: row.id, topicId, employeeId, sessionId }
      await this.store.bind(binding)
      await this.runtime.attachRoomTools?.(sessionId)
      this.runtime.refreshWorkspace(row.workspaceId)
      return binding
    }
    const pending = create()
    this.creations.set(key, pending)
    try { return await pending } finally { if (this.creations.get(key) === pending) this.creations.delete(key) }
  }
}

/** Match complete roster names; longer names own an ambiguous shared prefix. */
function mentionedEmployees(text: string, employees: readonly CollaborationEmployee[]): string[] {
  const names = employees.map(employee => ({ employee, name: employee.displayName.toLowerCase() }))
    .filter(value => value.name.length > 0).sort((a, b) => b.name.length - a.name.length)
  const mentioned = new Set<string>()
  for (const token of text.matchAll(/@/gu)) {
    const suffix = text.slice(token.index + 1).toLowerCase()
    const candidates = names.filter(({ name }) => suffix.startsWith(name)
      && (suffix.length === name.length || /^[\s@\p{P}\p{S}]/u.test(suffix.slice(name.length))))
    const longest = candidates[0]?.name.length
    for (const candidate of candidates) {
      if (candidate.name.length === longest) mentioned.add(candidate.employee.employeeId)
    }
  }
  return employees.filter(employee => mentioned.has(employee.employeeId)).map(employee => employee.employeeId)
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
