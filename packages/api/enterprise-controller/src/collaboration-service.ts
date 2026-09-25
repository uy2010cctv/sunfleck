/** Shared conversation authorization and routing through the existing native Session runtime. */
import { createHash, randomUUID } from 'node:crypto'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import { CollaborationCreationConflictError } from '@deepseek-ai/dsh-enterprise-postgres'
import type { CollaborationRecord, CollaborationTopic, CollaborationSession,
  PostgresCollaborationRepository } from '@deepseek-ai/dsh-enterprise-postgres'

/** Published employee projection used for routing and the detail panel. */
export interface CollaborationEmployee { readonly employeeId: string
  readonly displayName: string
  readonly releaseId: string }
/** Authenticated conversation details; native ids are returned only after membership and workspace checks. */
export interface CollaborationDetail {
  readonly id: string
  readonly kind: 'group' | 'channel'
  readonly name: string
  readonly memberCount: number
  readonly workspaceId: string
  readonly memberUserIds: readonly string[]
  readonly members: readonly CollaborationEmployee[]
  readonly topics: readonly CollaborationTopic[]
  readonly dutyEmployeeIds: readonly string[]
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
  readonly mentionedEmployeeIds?: readonly string[]
  readonly messageId?: string
  /** Native composer source, set only by the Host. */
  readonly sourceSessionId?: string
}
/** Routing receipt; accepted messages are durable, not necessarily completed by an employee. */
export type CollaborationDelivery =
  | { readonly delivered: true
    readonly targets: readonly { readonly sessionId: string
      readonly employeeId?: string }[]
    readonly topicId?: string }
  | { readonly delivered: false
    readonly reason: string }
/** Existing native services supplied by the controller composition. */
export interface CollaborationRuntime {
  /** Notify the Workspace projection owner after all destination grants have committed.
   * @param workspaceId - Workspace whose native destination became visible.
   */
  refreshWorkspace(workspaceId: string): void
  workspaceVisible(actor: EnterprisePrincipal, workspaceId: string): Promise<boolean>
  memberWorkspaceVisible(orgId: string, userId: string, workspaceId: string): Promise<boolean>
  employee(actor: EnterprisePrincipal, employeeId: string): Promise<CollaborationEmployee | undefined>
  project(actor: EnterprisePrincipal, id: string): Promise<CollaborationDetail['project']>
  team(actor: EnterprisePrincipal, id: string): Promise<CollaborationDetail['team']>
  createSession(actor: EnterprisePrincipal,
    input: { sessionId: string; workspaceId: string; employee: CollaborationEmployee }): Promise<string>
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

  /** List conversations whose membership and workspace remain accessible.
   * @param actor - Authenticated human.
   * @returns Sidebar entries.
   */
  async list(actor: EnterprisePrincipal): Promise<readonly Pick<CollaborationDetail, 'id' | 'kind' | 'name' | 'memberCount'>[]> {
    const rows = await this.store.list(actor.orgId, actor.userId)
    const visible = await Promise.all(rows.map(async row => await this.runtime.workspaceVisible(actor,
      row.workspaceId) ? row : undefined))
    return visible.filter((row): row is CollaborationRecord => row !== undefined).map(row => ({ id: row.id, kind: row.kind,
      name: row.name, memberCount: row.memberEmployeeIds.length }))
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
    const topics = (await this.store.topics(id)).map((topic) => {
      const destinations = sessions.filter(value => value.topicId === topic.id).map(value => ({ sessionId: value.sessionId,
        employeeId: value.employeeId }))
      return { id: topic.id, title: topic.title, state: topic.state, destinations,
        ...(destinations.length === 1 && destinations[0] !== undefined ? { sessionId: destinations[0].sessionId } : {}) }
    })
    return {
      id, kind: row.kind, name: row.name, workspaceId: row.workspaceId, memberUserIds: row.memberUserIds,
      memberCount: row.memberEmployeeIds.length,
      members: employees.filter((value): value is CollaborationEmployee => value !== undefined),
      topics, dutyEmployeeIds: row.dutyEmployeeIds,
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
    if (input.projectId !== undefined && !await this.runtime.project(actor,
      input.projectId)) throw new CollaborationError('project-unavailable', 404)
    if (input.teamDefinitionId !== undefined && !await this.runtime.team(actor,
      input.teamDefinitionId)) throw new CollaborationError('team-unavailable', 404)
    const { idempotencyKey, ...values } = input
    try {
      const row = await this.store.create({ ...values, memberUserIds, memberEmployeeIds: [...new Set(input.memberEmployeeIds)],
        dutyEmployeeIds: [...new Set(input.dutyEmployeeIds)], orgId: actor.orgId },
      idempotencyKey === undefined ? undefined : { creatorUserId: actor.userId, idempotencyKey })
      return await this.detail(actor, row.id)
    } catch (error) {
      if (error instanceof CollaborationCreationConflictError) throw new CollaborationError('idempotency-conflict', 409)
      throw error
    }
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
    const mentions = new Set([...input.text.matchAll(/@([^\s@]+)/gu)].map(match => (match[1] ?? '').replace(/[^\p{L}\p{N}]+$/u, '').toLowerCase()))
    let targets = input.mentionedEmployeeIds === undefined
      ? employees.filter(employee => mentions.has(employee.displayName.toLowerCase())).map(employee => employee.employeeId)
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
      if (existing !== undefined) return existing
      const employee = await this.runtime.employee(actor, employeeId)
      if (employee === undefined) throw new CollaborationError('employee-unavailable', 404)
      const sessionId = await this.runtime.createSession(actor, { sessionId: `session-collaboration-${hash(key)}`,
        workspaceId: row.workspaceId, employee })
      const binding = { surfaceId: row.id, topicId, employeeId, sessionId }
      await this.store.bind(binding)
      this.runtime.refreshWorkspace(row.workspaceId)
      return binding
    }
    const pending = create()
    this.creations.set(key, pending)
    try { return await pending } finally { if (this.creations.get(key) === pending) this.creations.delete(key) }
  }
}

function hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
