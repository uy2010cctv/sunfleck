/** Native Session and TeamRun adapters for PostgreSQL conversations; no separate employee runtime is created. */
import { randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { hasSessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-experimental-agent-team'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { classifyPrivacyForScope, inspectEnterpriseMemory, memorySourceDigest } from '@deepseek-ai/dsh-enterprise-identity'
import { MEMORY_ANNOUNCEMENT_SUMMARY_CHARS } from '@deepseek-ai/dsh-enterprise-surface'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-schedule'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type { EnterpriseOperationsService, EnterpriseTeamControlService } from '@deepseek-ai/dsh-enterprise-operations'
import { projectId } from '@deepseek-ai/dsh-enterprise-project'
import { RoomEventConflictError, type CollaborationRecord, type CollaborationSession,
  type RoomDispatchClaim, type RoomEvent } from '@deepseek-ai/dsh-enterprise-postgres'
import { CollaborationService, CollaborationError, type CollaborationMessageInput } from './collaboration-service.ts'
import { admitRoomPrompt, roomAttachmentFailureCode } from './collaboration-room-attachments.ts'
import { findCollaborationRequest } from './collaboration-receipt.ts'
import { CollaborationHttpHandler } from './collaboration-http.ts'
import { CollaborationIdentity } from './collaboration-identity.ts'
import { CollaborationRoomOutbox } from './collaboration-room-outbox.ts'
import { CollaborationRoomRecovery } from './collaboration-room-recovery.ts'
import { installCollaborationAgentTools } from './collaboration-agent-tools.ts'
import { GroupRoomSchedules } from './collaboration-group-schedules.ts'
import { releasedRoomEmployee, roomPrompt, roomSourceCursor, roomToolFact, roomTurnPost, roomTurnPostedSource,
  roomTurnScheduleSource, roomTurnTriggers,
  type RoomToolEvent, type RoomTurnEvent } from './collaboration-room-delivery.ts'
import { projectTeamRoomFact, teamTurnSourceIds, type TeamRoomMember,
  type TeamTurnSourceRecord } from './collaboration-team-room.ts'

declare module '@deepseek-ai/dsh-api-session-controller/types' {
  interface UserRpcMessageSource {
    /** Conversation that routed this authenticated message. */
    readonly surfaceId?: string
    /** Authenticated human sender of the collaboration message. */
    readonly originActor?: string
    /** Channel topic selected by the Host. */
    readonly topicId?: string
  }
}

/** Compose authenticated collaboration HTTP and native composer routing.
 * @param ctx - Existing enterprise Host context.
 * @param services - Existing authorized operations and team control services.
 * @returns HTTP handler over the same routing coordinator as native prompts.
 */
export function composeCollaboration(ctx: Context, services: {
  operations: () => EnterpriseOperationsService
  teams: () => EnterpriseTeamControlService
  limits: { readonly roomContextCharacters: number
    readonly roomContextEvents: number
    readonly maxBotHops: number
    readonly roomDispatchPollMs?: number
    readonly roomDispatchLeaseMs?: number }
  roomEventCommitted?: (actor: EnterprisePrincipal, row: CollaborationRecord, event: RoomEvent) => Promise<void>
}): CollaborationHttpHandler {
  if (!Number.isSafeInteger(services.limits.roomContextCharacters) || services.limits.roomContextCharacters < 500
    || !Number.isSafeInteger(services.limits.roomContextEvents) || services.limits.roomContextEvents < 1
    || services.limits.roomContextEvents > 99 || !Number.isSafeInteger(services.limits.maxBotHops)
    || services.limits.maxBotHops < 1 || services.limits.maxBotHops > 8) throw new Error('invalid collaboration room limits')
  const database = ctx.enterprisePostgres
  const security = ctx.enterpriseSecurity
  const store = database.collaboration
  const roomEvents = database.roomEvents
  const roomAvailable = Object.hasOwn(database, 'roomEvents')
  const pollMs = services.limits.roomDispatchPollMs
  const leaseMs = services.limits.roomDispatchLeaseMs
  if (roomAvailable && (!Number.isSafeInteger(pollMs) || pollMs === undefined || pollMs < 100 || pollMs > 60_000
    || !Number.isSafeInteger(leaseMs) || leaseMs === undefined || leaseMs < 1000 || leaseMs > 300_000
    || leaseMs <= pollMs)) throw new Error('invalid collaboration dispatch limits')
  let roomTools: ReturnType<typeof installCollaborationAgentTools> | undefined
  let outbox: CollaborationRoomOutbox | undefined
  const teamMemberRooms = new Map<string, { row: CollaborationRecord; rootSessionId: string; employeeId: string }>()
  type RecoverySnapshot = { readonly events: SessionEvent[]; readonly revision: string | undefined }
  const recoveryReads = new AsyncLocalStorage<Map<string, Promise<RecoverySnapshot>>>()
  const loadSessionEvents = async (sessionId: string): Promise<SessionEvent[]> => {
    let handle: Awaited<ReturnType<typeof ctx.sessionPersistence.open>>
    try {
      handle = await ctx.sessionPersistence.open(brandString<SessionId>(sessionId), 'read')
    } catch (error) {
      // A work Session created for a first mention has no persisted events
      // yet; an empty history is the correct replay baseline for it.
      if (error instanceof SessionPersistenceNotFoundError) return []
      throw error
    }
    try {
      return [...(await handle.read()).events]
    } finally { await handle.close() }
  }
  const sessionRevision = async (sessionId: string) =>
    (await ctx.sessionPersistence.stat(brandString<SessionId>(sessionId)))?.revision
  const loadSessionSnapshot = async (sessionId: string): Promise<RecoverySnapshot> => {
    const revision = await sessionRevision(sessionId)
    return { revision, events: await loadSessionEvents(sessionId) }
  }
  const readSessionSnapshot = (sessionId: string): Promise<RecoverySnapshot> => {
    const reads = recoveryReads.getStore()
    const pending = reads?.get(sessionId) ?? loadSessionSnapshot(sessionId)
    reads?.set(sessionId, pending)
    return pending
  }
  const readSessionEvents = async (sessionId: string): Promise<SessionEvent[]> =>
    (await readSessionSnapshot(sessionId)).events
  const readCurrentSessionEvents = async (sessionId: string): Promise<SessionEvent[]> => {
    let snapshot = await readSessionSnapshot(sessionId)
    if (snapshot.revision !== await sessionRevision(sessionId)) {
      snapshot = await loadSessionSnapshot(sessionId)
      if (snapshot.revision !== await sessionRevision(sessionId)) throw new CollaborationError('room-session-changing', 409)
      recoveryReads.getStore()?.set(sessionId, Promise.resolve(snapshot))
    }
    return snapshot.events
  }
  const durableEmployee = async (sessionId: string) => {
    const selections: Array<
      | { readonly type: 'enterprise-employee/selected'
        readonly data: { readonly orgId: string
          readonly ownerUserId: string
          readonly employeeId: string
          readonly releaseId: string } }
      | { readonly type: 'enterprise-employee/cleared'
        readonly data: object }
    > = []
    for (const event of await readCurrentSessionEvents(sessionId)) {
      if (event.type === 'enterprise-employee/selected') selections.push({ type: event.type, data: event.data })
      if (event.type === 'enterprise-employee/cleared') selections.push({ type: event.type, data: event.data })
    }
    const selected = releasedRoomEmployee(selections)
    if (selected === undefined) return undefined
    const ownerUserId = await database.identity.sessionOwnerUserId(sessionId)
    const grant = await database.identity.sessionWorkspaceGrant(sessionId)
    const release = await database.catalog.getRelease(selected.releaseId, selected.orgId)
    if (ownerUserId !== selected.ownerUserId || grant?.orgId !== selected.orgId
      || release?.presetId !== selected.employeeId) return undefined
    return selected
  }
  const roomEmployeeActor = async (sessionId: string) => {
    const live = ctx.enterpriseWorkController.employeeActor(sessionId)
    if (live !== undefined) return live
    const selected = await durableEmployee(sessionId)
    return selected === undefined ? undefined : {
      orgId: selected.orgId, userId: selected.ownerUserId, employeeId: selected.employeeId,
    }
  }
  const teamRoster = async (row: CollaborationRecord, events: readonly SessionEvent[]): Promise<TeamRoomMember[]> => {
    const members = new Map<string, TeamRoomMember>()
    for (const event of events) {
      if (event.type === 'team/run') {
        const leader = event.data.run.leader
        const employeeId = leader.release.presetId
        if (row.memberEmployeeIds.includes(employeeId)) members.set(String(leader.sessionId), {
          sessionId: String(leader.sessionId), employeeId, name: employeeId,
        })
      }
      if (event.type === 'team/member') {
        const member = event.data.member
        const release = member.release ?? (member.employeeReleaseId === undefined ? undefined
          : await database.catalog.getRelease(member.employeeReleaseId, row.orgId))
        const employeeId = release?.presetId
        if (employeeId !== undefined && row.memberEmployeeIds.includes(employeeId)) members.set(String(member.id), {
          sessionId: String(member.id), employeeId, name: member.name,
        })
      }
    }
    return [...members.values()]
  }
  const rememberTeamMembers = async (row: CollaborationRecord, rootSessionId: string,
    events: readonly SessionEvent[]): Promise<TeamRoomMember[]> => {
    const roster = await teamRoster(row, events)
    for (const member of roster) {
      if (member.sessionId !== rootSessionId) teamMemberRooms.set(member.sessionId, {
        row, rootSessionId, employeeId: member.employeeId,
      })
    }
    return roster
  }
  const roomAllowed = async (actor: EnterprisePrincipal, roomId: string): Promise<boolean> => {
    const row = await store.get(actor.orgId, roomId)
    return row !== undefined && row.archivedAt === undefined && row.memberUserIds.includes(actor.userId)
      && (await security.authorizeApiAsync(actor, 'session.create', { workspaceId: row.workspaceId })).allowed
  }
  const signer = new CollaborationIdentity(ctx.credentials, roomEvents, {
    human: roomAllowed,
    employee: async (orgId, employeeId, sessionId, roomId) => {
      const row = await store.get(orgId, roomId)
      const binding = await store.bySession(sessionId)
      if (row === undefined || row.archivedAt !== undefined || !row.memberEmployeeIds.includes(employeeId)) return false
      const selected = await roomEmployeeActor(sessionId)
      let ownerUserId: string | undefined
      if (binding?.surfaceId === roomId && binding.employeeId === employeeId
        && selected?.orgId === orgId && selected.employeeId === employeeId) {
        ownerUserId = selected.userId
      } else if (binding?.surfaceId === roomId && binding.employeeId === '' && row.teamDefinitionId !== undefined
        && (await teamRoster(row, await readCurrentSessionEvents(sessionId))).some(member => member.employeeId === employeeId)) {
        ownerUserId = await database.identity.sessionOwnerUserId(sessionId)
      } else {
        const member = teamMemberRooms.get(sessionId)
        const root = member === undefined ? undefined : await store.bySession(member.rootSessionId)
        if (member?.row.id !== roomId || member.row.orgId !== orgId || member.employeeId !== employeeId
          || root?.surfaceId !== roomId || root.employeeId !== ''
          || !(await teamRoster(row, await readCurrentSessionEvents(member.rootSessionId)))
            .some(value => value.sessionId === sessionId && value.employeeId === employeeId)) return false
        ownerUserId = await database.identity.sessionOwnerUserId(member.rootSessionId)
      }
      if (ownerUserId === undefined || !row.memberUserIds.includes(ownerUserId)) return false
      const owner = (await database.identity.listUsers(orgId)).find(value => value.id === ownerUserId)
      return owner !== undefined && !owner.disabled
        && (await security.authorizeApiAsync({ orgId, userId: owner.id, roles: owner.roles },
          'session.create', { workspaceId: row.workspaceId })).allowed
    },
    service: async (orgId, serviceId, roomId) => {
      const row = await store.get(orgId, roomId)
      return (serviceId === 'attachment-admission' && row !== undefined)
        || (serviceId === 'team' && row?.teamDefinitionId !== undefined)
    },
  })
  const scoped = <T>(actor: EnterprisePrincipal,
    operation: () => Promise<T>): Promise<T> => ctx.enterpriseRequestContext.run(actor, operation)
  const employee = async (actor: EnterprisePrincipal, id: string) => {
    if (!(await security.authorizeApiAsync(actor, 'enterpriseEmployee.getDraft', { presetId: id })).allowed) return undefined
    const draft = await database.catalog.getDraft(id, actor.orgId)
    if (draft?.status !== 'published') return undefined
    const release = (await database.catalog.listReleases(id, actor.orgId)).toSorted((a, b) => b.version - a.version)[0]
    if (release === undefined) return undefined
    const displayName = draft.profile['displayName'] ?? draft.profile['name'] ?? id
    const avatarSeed = draft.profile['avatarSeed']
    return { employeeId: id, displayName: typeof displayName === 'string' ? displayName : id, releaseId: release.releaseId,
      ...(typeof avatarSeed === 'string' && avatarSeed.trim() !== '' ? { avatarSeed } : {}) }
  }
  const resume = async (actor: EnterprisePrincipal, id: string, row: CollaborationRecord) => {
    const binding = (await store.sessions(row.id)).find(value => value.sessionId === id)
    if (binding === undefined) throw new CollaborationError('session-unavailable', 409)
    if (!await security.sessionAccessibleBy(actor, id)) throw new CollaborationError('session-forbidden', 403)
    await scoped(actor, () => ctx.sessionController.create({ sessionId: brandString<SessionId>(id),
      workspaceId: brandString<WorkspaceId>(row.workspaceId) }))
    const agent = ctx.agents.get(brandString<SessionId>(id))
    if (agent === undefined) throw new CollaborationError('session-unavailable', 503)
    await roomTools?.attach(agent)
    return agent
  }
  const deliver = async (actor: EnterprisePrincipal, id: string, row: CollaborationRecord, input: CollaborationMessageInput,
    run: boolean) => {
    const agent = await resume(actor, id, row)
    const rpcId = brandString<SessionRequestId>(input.messageId ?? randomUUID())
    const landed = () => hasSessionPromptRequest(agent, rpcId)
    if (landed()) return
    const admitted = roomAvailable && input.messageId !== undefined
      ? await admitRoomPrompt(ctx, agent, actor, row, input.messageId, input.text,
        attachmentId => service.attachment(actor, row.id, attachmentId))
      : [{ type: 'text' as const, text: input.text }]
    const message = createUserMessage({ content: admitted, source: {
      kind: 'user', rpcId, surfaceId: row.id, originActor: actor.userId,
      ...(input.topicId === undefined ? {} : { topicId: input.topicId }),
    } })
    if (run) agent.steer(message)
    else agent.session.append('user/message', message, { surfaceOp: 'append' })
    await ctx.sessions.flush(agent.session)
    if (!landed()) throw new CollaborationError('delivery-not-landed', 502)
  }
  const boundTeamRuns = async (actor: EnterprisePrincipal, row: CollaborationRecord, bindings: readonly CollaborationSession[]) => {
    const control = services.teams()
    const runs = await Promise.all(bindings.filter(binding => binding.employeeId === '')
      .map(binding => control.getRun(actor, binding.topicId)))
    return runs.filter(run => run.teamId === row.teamDefinitionId && run.workspaceId === row.workspaceId
      && bindings.some(binding => binding.sessionId === run.rootSessionId))
      .toSorted((a, b) => b.createdAt - a.createdAt || b.runId.localeCompare(a.runId))
  }
  const nativeRoomEvents = (events: readonly SessionEvent[]): RoomTurnEvent[] => {
    const relevant: RoomTurnEvent[] = []
    for (const event of events) {
      if (event.type === 'tool/call' || event.type === 'tool/ptc-dispatch-start') relevant.push({
        type: event.type, seq: event.seq, data: { name: event.data.name } })
      if (event.type === 'turn/start') relevant.push({ type: 'turn/start', seq: event.seq,
        data: { turn: event.data.turn } })
      if (event.type === 'user/message') {
        const source = event.data.source
        relevant.push({ type: 'user/message', seq: event.seq, data: { source: {
          kind: source.kind,
          ...'surfaceId' in source && typeof source.surfaceId === 'string' ? { surfaceId: source.surfaceId } : {},
          ...'originSurfaceId' in source && typeof source.originSurfaceId === 'string'
            ? { surfaceId: source.originSurfaceId } : {},
          ...'rpcId' in source && typeof source.rpcId === 'string' ? { rpcId: source.rpcId } : {},
        } } })
      }
      if (event.type === 'assistant/message') {
        const content = event.data.message.content.map(block => ({ type: block.type,
          ...(block.type === 'text' ? { text: block.text } : {}) }))
        relevant.push({ type: 'assistant/message', seq: event.seq, data: { turn: event.data.turn,
          message: { content } } })
      }
      if (event.type === 'turn/end') {
        relevant.push({ type: 'turn/end', seq: event.seq, data: { turn: event.data.turn,
          reason: { kind: event.data.reason.kind } } })
      }
    }
    return relevant
  }
  const postedChannelBody = async (row: CollaborationRecord, sessionId: string,
    events: readonly RoomTurnEvent[], turn: number): Promise<number | undefined> => row.kind !== 'channel' ? undefined
    : roomTurnPostedSource(events, turn, async sequence =>
      await roomEvents.findBySourceCursor(row.orgId, row.id, sessionId, String(sequence))
        ?? await roomEvents.findBySourceCursor(row.orgId, row.id, sessionId, roomSourceCursor(sessionId, sequence)))
  const projectNativeTurn = async (row: CollaborationRecord, binding: CollaborationSession,
    events: readonly RoomTurnEvent[], turn: number, failed?: () => void): Promise<void> => {
    const result = roomTurnPost(events, turn)
    if (result === undefined) return
    if (await postedChannelBody(row, binding.sessionId, events, turn) !== undefined) return
    const cursor = roomSourceCursor(binding.sessionId, result.sourceSeq)
    let posted = await roomEvents.findBySourceCursor(row.orgId, row.id, binding.sessionId, cursor)
    const deferred = (): void => { if (posted === undefined) failed?.() }
    const triggers = roomTurnTriggers(events, turn, row.id)
    const signedSource = (await Promise.all(triggers.map(id => roomEvents.getByEventId(row.orgId, row.id, id))))
      .some(value => value !== undefined)
    if (!signedSource) {
      if (triggers.length > 0) { deferred(); return }
      if (row.kind !== 'group' || row.teamDefinitionId !== undefined || row.archivedAt !== undefined
        || !roomTurnScheduleSource(events, turn) || !row.memberEmployeeIds.includes(binding.employeeId)) return
      const selected = await durableEmployee(binding.sessionId)
      if (selected?.orgId !== row.orgId || selected.employeeId !== binding.employeeId
        || !row.memberUserIds.includes(selected.ownerUserId)) { deferred(); return }
      const owner = (await database.identity.listUsers(row.orgId))
        .find(user => user.id === selected.ownerUserId && !user.disabled)
      if (owner === undefined || !(await security.authorizeApiAsync({
        orgId: row.orgId, userId: owner.id, roles: owner.roles,
      }, 'session.create', { workspaceId: row.workspaceId })).allowed) { deferred(); return }
    }
    if (posted === undefined) {
      const employeeId = binding.employeeId === '' && row.teamDefinitionId !== undefined
        ? (await teamRoster(row, await readSessionEvents(binding.sessionId)))
          .find(member => member.sessionId === binding.sessionId)?.employeeId
        : binding.employeeId
      if (employeeId === undefined || employeeId === '') { deferred(); return }
      const event = await signer.signEmployee({ orgId: row.orgId, employeeId,
        sessionId: binding.sessionId }, row.id, { type: 'text', content: result.text,
        sourceCursor: cursor,
        ...(!signedSource ? { scheduled: true } : {}),
        .../^[0-9a-f]{64}$/u.test(binding.topicId) ? { threadRoot: binding.topicId } : {} })
      posted = await roomEvents.append({ orgId: row.orgId, surfaceId: row.id, event,
        authorKind: 'employee', authorId: employeeId, sourceSessionId: binding.sessionId,
        sourceEventCursor: cursor,
        .../^[0-9a-f]{64}$/u.test(binding.topicId) ? { threadRoot: binding.topicId } : {} })
    }
    if (services.roomEventCommitted !== undefined) {
      const ownerUserId = ctx.enterpriseWorkController.employeeActor(binding.sessionId)?.userId
        ?? await database.identity.sessionOwnerUserId(binding.sessionId)
      const user = (await database.identity.listUsers(row.orgId)).find(value => value.id === ownerUserId)
      if (user !== undefined && !user.disabled && row.memberUserIds.includes(user.id)) {
        try { await services.roomEventCommitted({ orgId: row.orgId, userId: user.id, roles: user.roles }, row, posted) }
        catch (error: unknown) { failed?.(); ctx.logger.error(`room workflow trigger failed: ${String(error)}`) }
      }
    }
  }
  const projectTeamEvent = async (row: CollaborationRecord, binding: CollaborationSession,
    event: SessionEvent, history: readonly SessionEvent[], failed?: () => void): Promise<void> => {
    if (binding.employeeId !== '' || row.teamDefinitionId === undefined
      || (event.type !== 'team/message/queued' && event.type !== 'team/task'
        && event.type !== 'team/decision' && event.type !== 'team/run')) return
    const cursor = roomSourceCursor(binding.sessionId, event.seq)
    if (await roomEvents.findBySourceCursor(row.orgId, row.id, binding.sessionId, cursor) !== undefined) return
    const fact = projectTeamRoomFact(event, await teamRoster(row, history))
    if (fact === undefined) {
      if (event.type === 'team/message/queued'
        && event.data.message.content.some(block => block.type === 'text' && block.text.trim() !== '')) failed?.()
      return
    }
    const input = { type: 'workflow' as const, content: fact.content, sourceCursor: cursor,
      stepId: `${binding.topicId}:${event.type}:${event.seq}` }
    const signed = fact.authorKind === 'employee'
      ? await signer.signEmployee({ orgId: row.orgId, employeeId: fact.authorId,
        sessionId: binding.sessionId }, row.id, { type: 'text', content: fact.content, sourceCursor: cursor })
      : fact.authorKind === 'human'
        ? await (async () => {
          const user = (await database.identity.listUsers(row.orgId)).find(value => value.id === fact.authorId)
          if (user === undefined || user.disabled) throw new CollaborationError('team-decision-author-unavailable', 409)
          return signer.signHuman({ orgId: row.orgId, userId: user.id, roles: user.roles }, row.id, input)
        })()
        : await signer.signService({ orgId: row.orgId, serviceId: 'team' }, row.id, input)
    await roomEvents.append({ orgId: row.orgId, surfaceId: row.id, event: signed,
      authorKind: fact.authorKind, authorId: fact.authorId, sourceSessionId: binding.sessionId,
      sourceEventCursor: cursor })
  }
  const projectRoomToolEvents = async (row: CollaborationRecord, binding: CollaborationSession,
    history: readonly SessionEvent[], turn: number, sourceEventId?: string, failed?: () => void): Promise<void> => {
    const toolEvents: RoomToolEvent[] = []
    for (const event of history) {
      if (event.type === 'tool/call') toolEvents.push({ type: event.type, seq: event.seq,
        data: { turn: event.data.turn, callId: String(event.data.callId), name: event.data.name } })
      if (event.type === 'tool/result') toolEvents.push({ type: event.type, seq: event.seq,
        data: { turn: event.data.turn, message: { toolCallId: String(event.data.message.toolCallId),
          ...(event.data.message.isError === undefined ? {} : { isError: event.data.message.isError }) },
        ...(event.data.error === undefined ? {} : { error: {} }) } })
    }
    if (!toolEvents.some(event => event.data.turn === turn)) return
    const pendingFacts: NonNullable<ReturnType<typeof roomToolFact>>[] = []
    for (const event of toolEvents) {
      if (event.data.turn !== turn) continue
      const fact = roomToolFact(toolEvents, event)
      if (fact === undefined) continue
      const cursor = roomSourceCursor(binding.sessionId, fact.sourceSeq)
      if (await roomEvents.findBySourceCursor(row.orgId, row.id, binding.sessionId, cursor) === undefined) pendingFacts.push(fact)
    }
    if (pendingFacts.length === 0) return
    const triggers = sourceEventId === undefined
      ? roomTurnTriggers(nativeRoomEvents(history), turn, row.id) : [sourceEventId]
    const source = (await Promise.all(triggers.map(id => roomEvents.getByEventId(row.orgId, row.id, id))))
      .find(value => value !== undefined)
    if (source === undefined) { if (triggers.length > 0) failed?.(); return }
    const threadRoot = row.kind === 'channel'
      ? source.threadRoot ?? (source.event.kind === 9 ? source.event.id : undefined) : undefined
    const employeeId = binding.employeeId === '' && row.teamDefinitionId !== undefined
      ? (await teamRoster(row, history)).find(member => member.sessionId === binding.sessionId)?.employeeId
      : binding.employeeId
    if (employeeId === undefined || employeeId === '') { failed?.(); return }
    for (const fact of pendingFacts) {
      const cursor = roomSourceCursor(binding.sessionId, fact.sourceSeq)
      const signed = await signer.signEmployee({ orgId: row.orgId, employeeId, sessionId: binding.sessionId }, row.id,
        { type: 'workflow', content: fact.content, stepId: `tool:${binding.sessionId}:${fact.sourceSeq}`,
          sourceEventId: source.event.id, sourceCursor: cursor,
          ...(threadRoot === undefined ? {} : { threadRoot }) })
      await roomEvents.append({ orgId: row.orgId, surfaceId: row.id, event: signed,
        authorKind: 'employee', authorId: employeeId, sourceSessionId: binding.sessionId,
        sourceEventCursor: cursor, ...(threadRoot === undefined ? {} : { threadRoot }) })
    }
  }
  const projectTeamMemberTurn = async (memberSessionId: string, turn: number,
    childEvents?: readonly SessionEvent[], leadEvents?: readonly SessionEvent[], failed?: () => void): Promise<void> => {
    const member = teamMemberRooms.get(memberSessionId)
    if (member === undefined) return
    const rootBinding = await store.bySession(member.rootSessionId)
    if (rootBinding?.surfaceId !== member.row.id || rootBinding.employeeId !== '') { failed?.(); return }
    const row = await store.get(member.row.orgId, member.row.id)
    if (row === undefined || !row.memberEmployeeIds.includes(member.employeeId)) return
    const raw = childEvents ?? await readSessionEvents(memberSessionId)
    const turnRecords: TeamTurnSourceRecord[] = []
    for (const event of raw) {
      if (event.type === 'turn/start' || event.type === 'turn/end') turnRecords.push({
        type: event.type, seq: event.seq, data: { turn: event.data.turn },
      })
      if (event.type === 'user/message' && event.data.source.kind === 'team-message') turnRecords.push({
        type: 'user/message', seq: event.seq,
        data: { source: { kind: event.data.source.kind, messageId: String(event.data.source.messageId) } },
      })
    }
    const messageIds = teamTurnSourceIds(turnRecords, turn)
    if (messageIds.length === 0) return
    const rootEvents = leadEvents ?? await readSessionEvents(member.rootSessionId)
    let verifiedSourceEventId: string | undefined
    for (const id of messageIds) {
      const queued = rootEvents.find(event => event.type === 'team/message/queued'
        && String(event.data.message.id) === id && String(event.data.message.targetId) === memberSessionId)
      if (queued === undefined) continue
      await projectTeamEvent(row, rootBinding, queued, rootEvents, failed)
      const posted = await roomEvents.findBySourceCursor(row.orgId, row.id, member.rootSessionId,
        roomSourceCursor(member.rootSessionId, queued.seq))
      verifiedSourceEventId ??= posted?.event.id
    }
    if (verifiedSourceEventId === undefined) { failed?.(); return }
    await projectRoomToolEvents(row, { surfaceId: row.id, topicId: rootBinding.topicId,
      employeeId: member.employeeId, sessionId: memberSessionId }, raw, turn, verifiedSourceEventId, failed)
    const relevant = nativeRoomEvents(raw)
    const reply = roomTurnPost(relevant, turn)
    if (reply === undefined) return
    if (await postedChannelBody(row, memberSessionId, relevant, turn) !== undefined) return
    const cursor = roomSourceCursor(memberSessionId, reply.sourceSeq)
    if (await roomEvents.findBySourceCursor(row.orgId, row.id, memberSessionId, cursor) !== undefined) return
    const signed = await signer.signEmployee({ orgId: row.orgId, employeeId: member.employeeId,
      sessionId: memberSessionId }, row.id, { type: 'text', content: reply.text, sourceCursor: cursor })
    await roomEvents.append({ orgId: row.orgId, surfaceId: row.id, event: signed,
      authorKind: 'employee', authorId: member.employeeId, sourceSessionId: memberSessionId,
      sourceEventCursor: cursor })
  }
  const roomRecovery = new CollaborationRoomRecovery(id => store.sessions(id),
    async id => (await ctx.sessionPersistence.stat(brandString<SessionId>(id)))?.revision,
    async (row, bindings, observeChild) => {
      const reads = new Map<string, Promise<RecoverySnapshot>>()
      try {
        return await recoveryReads.run(reads, async () => {
          let complete = true
          for (const binding of bindings) {
            try {
              if (binding.employeeId === '' && row.teamDefinitionId !== undefined) {
                const raw = await readSessionEvents(binding.sessionId)
                const roster = await rememberTeamMembers(row, binding.sessionId, raw)
                for (const event of raw) {
                  try { await projectTeamEvent(row, binding, event, raw, () => { complete = false }) }
                  catch (error: unknown) { complete = false; ctx.logger.error(`room Team fact recovery failed: ${String(error)}`) }
                }
                const relevant = nativeRoomEvents(raw)
                for (const ending of relevant) {
                  if (ending.type === 'turn/end') {
                    try { await projectRoomToolEvents(row, binding, raw, ending.data.turn, undefined, () => { complete = false }) }
                    catch (error: unknown) { complete = false; ctx.logger.error(`room Team tool recovery failed: ${String(error)}`) }
                    try { await projectNativeTurn(row, binding, relevant, ending.data.turn, () => { complete = false }) }
                    catch (error: unknown) { complete = false; ctx.logger.error(`room Team Lead recovery failed: ${String(error)}`) }
                  }
                }
                for (const member of roster) {
                  if (member.sessionId === binding.sessionId) continue
                  await observeChild(member.sessionId)
                  const child = await readSessionEvents(member.sessionId)
                  for (const event of child) {
                    if (event.type === 'turn/end') {
                      try { await projectTeamMemberTurn(member.sessionId, event.data.turn, child, raw, () => { complete = false }) }
                      catch (error: unknown) { complete = false; ctx.logger.error(`room Team member recovery failed: ${String(error)}`) }
                    }
                  }
                }
                continue
              }
              const raw = await readSessionEvents(binding.sessionId)
              const relevant = nativeRoomEvents(raw)
              for (const ending of relevant) {
                if (ending.type === 'turn/end') {
                  try { await projectRoomToolEvents(row, binding, raw, ending.data.turn, undefined, () => { complete = false }) }
                  catch (error: unknown) { complete = false; ctx.logger.error(`room Bot tool recovery failed: ${String(error)}`) }
                  await projectNativeTurn(row, binding, relevant, ending.data.turn, () => { complete = false })
                }
              }
            } catch (error: unknown) { complete = false; ctx.logger.error(`room Bot post recovery failed: ${String(error)}`) }
          }
          return complete
        })
      } finally { reads.clear() }
    })
  ctx.effect(() => async () => { await roomRecovery.dispose() }, 'collaboration room recovery')
  const service = new CollaborationService(store, {
    attachRoomTools: async (sessionId) => {
      const agent = ctx.agents.get(brandString<SessionId>(sessionId))
      if (agent !== undefined) await roomTools?.attach(agent)
    },
    room: roomAvailable ? {
      appendHuman: async (actor, row, input, dispatch, attachments) => {
        const requestId = input.messageId ?? randomUUID()
        const prior = await roomEvents.findByRequest(row.orgId, row.id, 'human', actor.userId, requestId)
        const signedInput = { type: 'text' as const, content: input.text, requestId,
          ...(input.threadRoot === undefined ? {} : { threadRoot: input.threadRoot }),
          ...(input.mentionedUserIds === undefined ? {} : { mentionedUserIds: input.mentionedUserIds }),
          ...(attachments === undefined || attachments.length === 0 ? {} : { attachments }),
          ...(dispatch.route === undefined ? { targetEmployeeIds: dispatch.targets } : { route: dispatch.route }),
          ...(prior === undefined ? {} : { createdAt: prior.event.created_at }) }
        if (prior !== undefined) {
          const retry = await signer.signHuman(actor, row.id, signedInput)
          if (prior.event.id !== retry.id || prior.threadRoot !== input.threadRoot) throw new CollaborationError('message-id-conflict', 409)
          return prior
        }
        if (input.threadRoot !== undefined) {
          const parent = await roomEvents.getByEventId(row.orgId, row.id, input.threadRoot)
          if (parent === undefined || parent.event.kind !== 9) throw new CollaborationError('thread-not-found', 404)
        }
        const event = await signer.signHuman(actor, row.id, signedInput)
        try { return await roomEvents.append({ orgId: row.orgId, surfaceId: row.id, event,
          authorKind: 'human', authorId: actor.userId, requestId,
          ...(input.threadRoot === undefined ? {} : { threadRoot: input.threadRoot }) }) }
        catch (error) {
          if (error instanceof RoomEventConflictError) throw new CollaborationError('message-id-conflict', 409)
          throw error
        }
      },
      react: async (actor, row, input) => {
        const prior = await roomEvents.findByRequest(row.orgId, row.id, 'human', actor.userId, input.requestId)
        if (prior !== undefined) {
          if (prior.event.kind !== 7 || prior.event.content !== input.emoji
            || !prior.event.tags.some(tag => tag[0] === 'e' && tag[1] === input.eventId)) {
            throw new CollaborationError('message-id-conflict', 409)
          }
          return prior
        }
        const target = await roomEvents.getByEventId(row.orgId, row.id, input.eventId)
        if (target === undefined) throw new CollaborationError('event-not-found', 404)
        let threadRoot = target.threadRoot
        if (threadRoot === undefined && row.kind === 'channel' && row.topicPolicy === 'thread'
          && target.event.kind === 9 && target.authorKind === 'employee' && target.sourceSessionId !== undefined) {
          const binding = await store.bySession(target.sourceSessionId)
          if (binding?.surfaceId === row.id) {
            const parent = await roomEvents.getByEventId(row.orgId, row.id, binding.topicId)
            if (parent?.event.kind === 9 && parent.threadRoot === undefined) threadRoot = parent.event.id
          }
        }
        const event = await signer.signHuman(actor, row.id, { type: 'reaction', content: input.emoji,
          requestId: input.requestId,
          targetEventId: target.event.id,
          ...(threadRoot === undefined ? {} : { threadRoot }) })
        try { return await roomEvents.append({ orgId: row.orgId, surfaceId: row.id, event,
          authorKind: 'human', authorId: actor.userId, requestId: input.requestId,
          ...(threadRoot === undefined ? {} : { threadRoot }) }) }
        catch (error) {
          if (error instanceof RoomEventConflictError) throw new CollaborationError('message-id-conflict', 409)
          throw error
        }
      },
      list: async (row, options) => {
        const threadRoot = options.threadRoot
        if (row.kind !== 'channel' || row.topicPolicy !== 'thread' || threadRoot === undefined) {
          return roomEvents.list(row.orgId, row.id, options)
        }
        const legacySourceSessionIds = (await store.sessions(row.id))
          .filter(binding => binding.topicId === threadRoot).map(binding => binding.sessionId)
        const events = await roomEvents.list(row.orgId, row.id, { ...options, legacySourceSessionIds })
        return events.map(event => event.threadRoot === undefined ? { ...event, threadRoot } : event)
      },
      attention: (row, userId) => roomEvents.attention(row.orgId, row.id, userId),
      markRead: (row, userId, sequence) => roomEvents.markRead(row.orgId, row.id, userId, sequence),
      get: (row, eventId) => roomEvents.getByEventId(row.orgId, row.id, eventId),
      search: (row, query, limit) => roomEvents.search(row.orgId, row.id, query, { limit }),
      present: async (actor, row, value, authors) => {
        const key = JSON.stringify([value.authorKind, value.authorId])
        const resolveName = async () => value.authorKind === 'human'
          ? (await database.identity.findUserById(row.orgId, value.authorId))?.displayName ?? value.authorId
          : value.authorKind === 'employee'
            ? (await employee(actor, value.authorId))?.displayName ?? value.authorId : value.authorId
        const pending = authors?.get(key) ?? resolveName()
        authors?.set(key, pending)
        const displayName = await pending
        return { ...value.event, sequence: value.sequence,
          author: { kind: value.authorKind, id: value.authorId, displayName },
          ...(value.threadRoot === undefined ? {} : { threadRoot: value.threadRoot }),
          ...(value.sourceSessionId === undefined ? {} : { sourceSessionId: value.sourceSessionId }) }
      },
      prompt: async (row, current) => {
        const before = String(BigInt(current.sequence) + 1n)
        const history = await roomEvents.list(row.orgId, row.id, { before, limit: services.limits.roomContextEvents + 1,
          ...(current.threadRoot === undefined ? {} : { threadRoot: current.threadRoot }) })
        const names = new Map<string, string>()
        for (const user of await database.identity.listUsers(row.orgId)) {
          if (row.memberUserIds.includes(user.id)) names.set(`human:${user.id}`, user.displayName)
        }
        for (const employeeId of row.memberEmployeeIds) {
          const draft = await database.catalog.getDraft(employeeId, row.orgId)
          const displayName = draft?.profile['displayName'] ?? draft?.profile['name']
          if (typeof displayName === 'string') names.set(`employee:${employeeId}`, displayName)
        }
        names.set('service:team', row.teamDefinitionId === undefined ? 'Team' : `${row.name} team`)
        return roomPrompt(row.name, history, current, { characters: services.limits.roomContextCharacters,
          events: services.limits.roomContextEvents }, names, row.kind === 'group')
      },
      reconcile: row => roomRecovery.reconcile(row),
      startRecovery: (row) => {
        roomRecovery.start(row, (error) => { ctx.logger.error(`room recovery failed: ${String(error)}`) })
      },
      recoveryPending: row => roomRecovery.isRepairing(row),
      dispatchCommitted: async (_actor, row, event) => {
        if (outbox === undefined || leaseMs === undefined) throw new CollaborationError('room-dispatch-unavailable', 503)
        return { delivered: true, targets: await outbox.immediate(row.orgId, row.id, event.event.id, leaseMs) }
      },
      replayedTargets: async (row, event, dispatch) => {
        const bindings = await store.sessions(row.id)
        if (dispatch.route === 'team') {
          const root = await findCollaborationRequest(bindings.filter(binding => binding.employeeId === ''), {
            surfaceId: row.id, actorUserId: event.authorId, requestId: event.event.id,
          }, async function* (id) {
            for (const entry of await readSessionEvents(id)) yield entry
          })
          return root === undefined ? [] : [{ sessionId: root }]
        }
        const topicId = row.kind === 'channel' ? event.threadRoot ?? event.event.id : ''
        const targets: { sessionId: string; employeeId: string }[] = []
        for (const employeeId of dispatch.targets) {
          const binding = bindings.find(value => value.employeeId === employeeId && value.topicId === topicId)
          if (binding === undefined) continue
          const events = await readSessionEvents(binding.sessionId)
          if (events.some(entry => entry.type === 'user/message' && entry.data.source.kind === 'user'
            && 'rpcId' in entry.data.source && String(entry.data.source.rpcId) === event.event.id
            && 'surfaceId' in entry.data.source && entry.data.source.surfaceId === row.id)) {
            targets.push({ sessionId: binding.sessionId, employeeId })
          }
        }
        return targets
      },
      ...(services.roomEventCommitted === undefined ? {} : { committed: async (actor: EnterprisePrincipal,
        row: CollaborationRecord, event: RoomEvent) => {
        try { await services.roomEventCommitted?.(actor, row, event) }
        catch (error: unknown) { ctx.logger.error(`room workflow trigger failed: ${String(error)}`) }
      } }),
    } : undefined,
    refreshWorkspace: (workspaceId) => { ctx.emit('workspace/visibility-changed', brandString<WorkspaceId>(workspaceId)) },
    workspaceVisible: async (actor, id) => (await security.authorizeApiAsync(actor, 'session.create', { workspaceId: id })).allowed,
    memberWorkspaceVisible: async (orgId, userId, workspaceId) => {
      const user = (await database.identity.listUsers(orgId)).find(candidate => candidate.id === userId)
      return user !== undefined && !user.disabled && (await database.identity.listWorkspaceGrants({ orgId, userId }))
        .some(grant => grant.workspaceId === workspaceId)
    },
    memberOptions: async (actor, workspaceId) => {
      const users = (await database.identity.listUsers(actor.orgId)).filter(user => !user.disabled)
      const people = []
      for (const user of users) {
        if ((await database.identity.listWorkspaceGrants({ orgId: actor.orgId, userId: user.id }))
          .some(grant => grant.workspaceId === workspaceId)) people.push({ id: user.id, name: user.displayName })
      }
      const employees = []
      let cursor: string | undefined
      do {
        const page = await database.catalog.listDrafts({ orgId: actor.orgId, limit: 100,
          ...(actor.roles.includes('administrator') ? { includeAllVisible: true } : { viewerUserId: actor.userId }),
          ...(cursor === undefined ? {} : { cursor }) })
        for (const draft of page.items) {
          const available = await employee(actor, draft.presetId)
          if (available !== undefined) employees.push({ id: available.employeeId, name: available.displayName,
            ...(available.avatarSeed === undefined ? {} : { avatarSeed: available.avatarSeed }) })
        }
        cursor = page.nextCursor
      } while (cursor !== undefined)
      return { people, employees }
    },
    humanMembers: async (_actor, row) => {
      const users = await database.identity.listUsers(row.orgId)
      return row.memberUserIds.map(userId => ({ userId,
        displayName: users.find(user => user.id === userId)?.displayName ?? userId }))
    },
    employee,
    project: async (actor, id) => {
      const project = await database.projects.requireMember(actor.orgId, projectId(id), { userId: actor.userId })
      if (project === undefined) return undefined
      return { id, name: project.name, goal: project.goal }
    },
    projectActive: async (actor, id) => {
      const project = await database.projects.requireMember(actor.orgId, projectId(id), { userId: actor.userId })
      return project?.state === 'active'
    },
    team: async (actor, id) => {
      const team = await services.operations().getTeamDefinition(actor, { teamId: id })
      return team === undefined ? undefined : { id, name: team.name }
    },
    createSession: async (actor, input) => scoped(actor, async () => {
      const value = await ctx.enterpriseWorkController.start({
        objective: input.objective, workspaceId: input.workspaceId,
        preferredEmployeeReleaseId: input.employee.releaseId, idempotencyKey: input.sessionId,
      })
      return value.sessionId
    }),
    prompt: (actor, id, row, input) => deliver(actor, id, row, input, true),
    record: (actor, id, row, input) => deliver(actor, id, row, input, false),
    ingest: async (actor, row, input) => {
      const summary = input.text.trim().slice(0, MEMORY_ANNOUNCEMENT_SUMMARY_CHARS)
      if (summary === '') return { delivered: false, reason: 'invalid-text' }
      if (!classifyPrivacyForScope(inspectEnterpriseMemory(summary).findings,
        'organization').allowed) return { delivered: false, reason: 'privacy-gated' }
      const id = memorySourceDigest(JSON.stringify([row.id, actor.userId, input.messageId ?? summary]))
      const sourceDigest = memorySourceDigest(JSON.stringify([row.id, actor.userId, summary]))
      const storedDigest = async () => (await database.database.query<{ source_digest: string }>(
        'SELECT source_digest FROM enterprise_memories WHERE id=$1 AND org_id=$2', [id, actor.orgId],
      )).rows[0]?.source_digest
      const prior = await storedDigest()
      if (prior !== undefined && prior !== sourceDigest) throw new CollaborationError('message-id-conflict', 409)
      if (prior === undefined) {
        try {
          await database.identity.proposeMemory({ id, orgId: actor.orgId, scope: 'organization', kind: 'business-fact',
            summary, sourceDigest, createdBy: actor.userId })
        } catch (error) {
          // Concurrent retries can commit the same proposal before this insert.
          if (await storedDigest() !== sourceDigest) throw error
        }
      }
      return { delivered: true, targets: [] }
    },
    teamSession: async (actor, row, runId) => {
      if (row.teamDefinitionId === undefined || ctx.get('enterpriseTeamRuntimeDriver') === undefined) return undefined
      const bound = await store.sessions(row.id)
      const runs = await boundTeamRuns(actor, row, bound)
      const selected = runId === undefined
        ? runs.find(run => run.state === 'active' || run.state === 'starting' || run.state === 'waiting-human' || run.state === 'verifying') ?? runs[0]
        : runs.find(run => run.runId === runId)
      return selected === undefined ? undefined : bound.find(value => value.sessionId === selected.rootSessionId)
    },
    teamMessage: async (actor, row, input) => {
      if (row.teamDefinitionId === undefined) throw new CollaborationError('team-required')
      const runtime = ctx.get('enterpriseTeamRuntimeDriver')
      if (runtime === undefined) return { delivered: false, reason: 'team-runtime-unavailable' }
      const bound = await store.sessions(row.id)
      if (input.messageId !== undefined) {
        const priorTarget = await findCollaborationRequest(bound, {
          surfaceId: row.id, actorUserId: actor.userId, requestId: input.messageId,
        }, async function* (id) {
          const handle = await ctx.sessionPersistence.open(brandString<SessionId>(id), 'read')
          try {
            for (let offset = 0; ; offset += 256) {
              const { events } = await handle.read(offset, 256)
              for (const event of events) yield event
              if (events.length < 256) break
            }
          } finally { await handle.close() }
        })
        if (priorTarget !== undefined) {
          if (input.sourceSessionId !== undefined && input.sourceSessionId !== priorTarget) {
            await deliver(actor, input.sourceSessionId, row, input, false)
          }
          return { delivered: true, targets: [{ sessionId: priorTarget }] }
        }
      }
      const definition = await services.operations().getTeamDefinition(actor, { teamId: row.teamDefinitionId })
      if (definition === undefined || definition.state !== 'active') return { delivered: false, reason: 'team-inactive' }
      const control = services.teams()
      const prior = (await boundTeamRuns(actor, row, bound)).find(run =>
        run.state !== 'completed' && run.state !== 'failed' && run.state !== 'cancelled')
      if (prior !== undefined && prior.state !== 'active') return { delivered: false, reason: 'team-run-not-active' }
      const active = prior
      const run = active ?? await control.startRun(actor, { teamId: row.teamDefinitionId,
        expectedTeamRevision: definition.revision, workspaceId: row.workspaceId, prompt: input.text, source: 'channel',
        idempotencyKey: `${row.id}:${input.messageId ?? randomUUID()}`,
        ...(input.messageId === undefined ? {} : { surfaceMessage: { requestId: input.messageId, originSurfaceId: row.id } }) })
      if (run.rootSessionId === undefined) return { delivered: false, reason: 'team-not-started' }
      // startRun submits the first prompt; only reused runs need another input.
      if (active !== undefined) await runtime.submitRunInput(run.runId, { actorUserId: actor.userId, text: input.text,
        originSurfaceId: row.id, ...(input.messageId === undefined ? {} : { requestId: input.messageId }) })
      await store.bind({ surfaceId: row.id, topicId: run.runId, employeeId: '', sessionId: run.rootSessionId })
      if (roomAvailable) await rememberTeamMembers(row, run.rootSessionId, await readSessionEvents(run.rootSessionId))
      ctx.emit('workspace/visibility-changed', brandString<WorkspaceId>(row.workspaceId))
      if (input.sourceSessionId !== undefined && input.sourceSessionId !== run.rootSessionId) {
        await deliver(actor, input.sourceSessionId, row, input, false)
      }
      return { delivered: true, targets: [{ sessionId: run.rootSessionId }] }
    },
  })
  const dispatchEmployeePost = async (row: CollaborationRecord, event: RoomEvent,
    employeeIds: readonly string[]) => {
    if (outbox === undefined || leaseMs === undefined) throw new CollaborationError('room-dispatch-unavailable', 503)
    const claimed = await outbox.immediate(row.orgId, row.id, event.event.id, leaseMs)
    return claimed.filter((value): value is { sessionId: string; employeeId: string } =>
      value.employeeId !== undefined && employeeIds.includes(value.employeeId))
  }
  const dispatchClaim = async (claim: RoomDispatchClaim) => {
    const row = await store.get(claim.orgId, claim.surfaceId)
    if (row === undefined) return { outcome: 'skipped' as const, targets: [] }
    const event = claim.event
    const actorUserId = event.authorKind === 'human' ? event.authorId
      : event.authorKind === 'service' ? claim.requestedByUserId
        : event.sourceSessionId === undefined ? undefined
          : (await durableEmployee(event.sourceSessionId))?.ownerUserId
            ?? await database.identity.sessionOwnerUserId(event.sourceSessionId)
    const user = actorUserId === undefined ? undefined
      : (await database.identity.listUsers(row.orgId)).find(value => value.id === actorUserId)
    if (user === undefined || user.disabled || !row.memberUserIds.includes(user.id)) {
      return { outcome: 'skipped' as const, targets: [] }
    }
    const actor = { orgId: row.orgId, userId: user.id, roles: user.roles }
    if (!await roomAllowed(actor, row.id)) return { outcome: 'skipped' as const, targets: [] }
    try {
      if (claim.targetKind === 'employee') {
        if (!row.memberEmployeeIds.includes(claim.targetId) || await employee(actor, claim.targetId) === undefined) {
          return { outcome: 'skipped' as const, targets: [] }
        }
        const targets = event.authorKind === 'human'
          ? [await service.dispatchHumanPost(actor, row, event, claim.targetId)]
          : event.authorKind === 'employee'
            ? await service.dispatchEmployeePost(actor, row, event, [claim.targetId])
            : [await service.dispatchServicePost(actor, row, event, claim.targetId)]
        return { outcome: 'delivered' as const, targets }
      }
      if (claim.targetKind === 'team') {
        if (row.teamDefinitionId === undefined || event.authorKind !== 'human') {
          return { outcome: 'skipped' as const, targets: [] }
        }
        const receipt = await service.dispatchTeamPost(actor, row, event)
        if (!receipt.delivered) {
          if (receipt.reason === 'team-runtime-unavailable') throw new CollaborationError(receipt.reason, 503)
          return { outcome: 'skipped' as const, targets: [] }
        }
        return { outcome: 'delivered' as const, targets: receipt.targets }
      }
      if (row.respondPolicy !== 'ingest_only' || event.authorKind !== 'human') {
        return { outcome: 'skipped' as const, targets: [] }
      }
      const receipt = await service.dispatchIngestPost(actor, row, event)
      return { outcome: receipt.delivered ? 'delivered' as const : 'skipped' as const, targets: [] }
    } catch (error) {
      const attachmentFailure = roomAttachmentFailureCode(error)
      if (attachmentFailure !== undefined && event.event.tags.some(tag => tag[0] === 'attachment')) {
        const serviceId = 'attachment-admission'
        const requestId = `attachment-failure:${claim.eventId}:${claim.targetKind}:${claim.targetId}`
        if (await roomEvents.findByRequest(row.orgId, row.id, 'service', serviceId, requestId) === undefined) {
          const threadRoot = row.kind === 'channel' ? event.threadRoot ?? event.event.id : undefined
          const signed = await signer.signService({ orgId: row.orgId, serviceId }, row.id, {
            type: 'workflow', content: `Attachment delivery failed for ${claim.targetId}: ${attachmentFailure}.`,
            stepId: requestId, sourceEventId: event.event.id, createdAt: event.event.created_at,
            attachmentFailure: { code: attachmentFailure, targetKind: claim.targetKind, targetId: claim.targetId },
            ...(threadRoot === undefined ? {} : { threadRoot }),
          })
          await roomEvents.append({ orgId: row.orgId, surfaceId: row.id, event: signed,
            authorKind: 'service', authorId: serviceId, requestId,
            ...(threadRoot === undefined ? {} : { threadRoot }),
          })
        }
        return { outcome: 'skipped' as const, targets: [] }
      }
      if (error instanceof CollaborationError && (error.status === 403 || error.status === 404)) {
        return { outcome: 'skipped' as const, targets: [] }
      }
      throw error
    }
  }
  if (roomAvailable) {
    if (leaseMs === undefined || pollMs === undefined) throw new Error('collaboration dispatch limits required')
    outbox = new CollaborationRoomOutbox(roomEvents, async (claim) => {
      try { return await dispatchClaim(claim) }
      catch (error: unknown) {
        ctx.logger.error(`room dispatch ${claim.eventId} to ${claim.targetKind}:${claim.targetId} failed: ${String(error)}`)
        throw error
      }
    })
    ctx.effect(() => {
      let stopped = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const tick = async (): Promise<void> => {
        try { await outbox?.poll(leaseMs) }
        catch (error: unknown) { ctx.logger.error(`room dispatch recovery failed: ${String(error)}`) }
        if (!stopped) timer = setTimeout(() => { void tick() }, pollMs)
      }
      timer = setTimeout(() => { void tick() }, 0)
      return () => { stopped = true; if (timer !== undefined) clearTimeout(timer) }
    }, 'collaboration signed room dispatch recovery')
  }
  if (roomAvailable) roomTools = installCollaborationAgentTools(ctx, {
    roomEvents, identity: signer, maxHops: services.limits.maxBotHops, dispatchEmployeePost,
    groupSchedules: () => ctx.get('schedule') !== undefined,
    memberEmployees: async row => Promise.all(row.memberEmployeeIds.map(async (employeeId) => {
      const draft = await database.catalog.getDraft(employeeId, row.orgId)
      const displayName = draft?.profile['displayName'] ?? draft?.profile['name']
      return { employeeId, displayName: typeof displayName === 'string' ? displayName : employeeId }
    })),
    resolveAgentRoom: async (agent) => {
      const sessionId = String(agent.id)
      const binding = await store.bySession(sessionId)
      const selected = await roomEmployeeActor(sessionId)
      if (binding === undefined || selected === undefined || selected.employeeId !== binding.employeeId) return undefined
      const row = await store.get(selected.orgId, binding.surfaceId)
      if (row === undefined || row.archivedAt !== undefined || !row.memberEmployeeIds.includes(binding.employeeId)) return undefined
      const owner = (await database.identity.listUsers(row.orgId)).find(value => value.id === selected.userId)
      if (owner === undefined || owner.disabled || !row.memberUserIds.includes(owner.id)) return undefined
      if (!(await security.authorizeApiAsync({ orgId: row.orgId, userId: owner.id, roles: owner.roles },
        'session.create', { workspaceId: row.workspaceId })).allowed) return undefined
      return { room: row, employeeId: binding.employeeId }
    },
  })
  ctx.on('session/event', (session, event) => {
    if (!roomAvailable || (event.type !== 'turn/end' && event.type !== 'team/message/queued'
      && event.type !== 'team/task' && event.type !== 'team/decision' && event.type !== 'team/run'
      && event.type !== 'team/member')) return
    void (async () => {
      const binding = await store.bySession(String(session.id))
      if (binding === undefined) {
        if (event.type === 'turn/end') {
          await ctx.sessions.flush(session)
          await projectTeamMemberTurn(String(session.id), event.data.turn)
        }
        return
      }
      const orgId = ctx.enterpriseWorkController.employeeActor(String(session.id))?.orgId
        ?? (await database.identity.sessionWorkspaceGrant(String(session.id)))?.orgId
      const row = orgId === undefined ? undefined : await store.get(orgId, binding.surfaceId)
      if (row === undefined) return
      await ctx.sessions.flush(session)
      if (event.type === 'turn/end') {
        const raw = await readSessionEvents(String(session.id))
        try { await projectRoomToolEvents(row, binding, raw, event.data.turn) }
        catch (error: unknown) { ctx.logger.error(`room Bot tool projection failed: ${String(error)}`) }
        await projectNativeTurn(row, binding, nativeRoomEvents(raw), event.data.turn)
      } else if (binding.employeeId === '' && row.teamDefinitionId !== undefined) {
        const raw = await readSessionEvents(String(session.id))
        await rememberTeamMembers(row, String(session.id), raw)
        await projectTeamEvent(row, binding, event, raw)
      }
    })().catch((error: unknown) => { ctx.logger.error(`room Bot post projection failed: ${String(error)}`) })
  })
  ctx.on('api/session-prompt', async (request, next) => {
    const binding = await store.bySession(request.sessionId)
    if (binding === undefined) return next()
    const actor = ctx.enterpriseRequestContext.requirePrincipal()
    if (request.content.some(part => part.type !== 'text')) throw new CollaborationError('text-only-collaboration')
    const text = request.content.map(part => part.type === 'text' ? part.text : '').join('\n')
    const result = await service.message(actor, binding.surfaceId, {
      text, messageId: request.requestId, sourceSessionId: request.sessionId,
      ...(binding.topicId === '' ? {} : { topicId: binding.topicId }),
    })
    if (!result.delivered) throw new CollaborationError(result.reason, 409)
    return { accepted: true, routedSessionIds: result.targets.map(target => brandString<SessionId>(target.sessionId)) }
  })
  const schedule = () => {
    const value = ctx.get('schedule')
    if (value === undefined) throw new CollaborationError('schedules-unavailable', 503)
    return value
  }
  const groupSchedules = new GroupRoomSchedules({
    detail: (actor, id) => service.detail(actor, id),
    sessions: id => store.sessions(id),
    list: request => schedule().list(request),
    delete: request => schedule().delete(request),
  })
  return new CollaborationHttpHandler(service, security, groupSchedules)
}
