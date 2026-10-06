/** Agent-scoped signed room posting and compare-and-swap task handoff. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CollaborationRecord, PostgresRoomEventRepository, RoomEvent } from '@deepseek-ai/dsh-enterprise-postgres'
import type { CollaborationIdentity, RoomSigningInput } from './collaboration-identity.ts'
import { roomMentionTargets } from './collaboration-room-delivery.ts'

/** Current authorized native employee destination. */
export interface RoomAgentBinding {
  readonly room: CollaborationRecord
  readonly employeeId: string
}
/** Host services used by room tools; all dispatch goes through the ordinary logged room bridge. */
export interface CollaborationAgentToolOptions {
  readonly roomEvents: Pick<PostgresRoomEventRepository, 'append' | 'getByEventId' | 'findByRequest' | 'ensureTaskOwner' | 'transferOwner'>
  readonly identity: Pick<CollaborationIdentity, 'signEmployee'>
  readonly maxHops: number
  readonly resolveAgentRoom: (agent: Agent) => Promise<RoomAgentBinding | undefined>
  readonly memberEmployees: (room: CollaborationRecord) => Promise<readonly { readonly employeeId: string
    readonly displayName: string }[]>
  readonly dispatchEmployeePost: (room: CollaborationRecord, event: RoomEvent,
    employeeIds: readonly string[]) => Promise<readonly { sessionId: string; employeeId: string }[]>
}

const messageParameters = {
  content: { type: 'string', required: true, description: 'Self-contained room message or handoff request.' },
  sourceEventId: { type: 'string', description: 'Signed room event id of the latest received room input. Omit only in a group Schedule turn.' },
  idempotencyKey: { type: 'string', required: true, description: 'Stable logical action key. Reuse it unchanged when retrying this action.' },
} as const

function requireText(value: string): void {
  if (value.trim() === '') throw new Error('room-tool-empty-input')
}

function sourceHop(event: RoomEvent): number {
  const tags = event.event.tags.filter(tag => tag[0] === 'dsh-hop')
  if (tags.length === 0 && event.authorKind !== 'employee') return 0
  if (tags.length !== 1 || !/^\d+$/u.test(tags[0]?.[1] ?? '')) throw new Error('room-tool-invalid-hop')
  const hop = Number(tags[0]?.[1])
  if (!Number.isSafeInteger(hop) || hop < 0 || hop > 8) throw new Error('room-tool-invalid-hop')
  return hop
}

/** Install room tool lifecycle hooks and return the post-binding attach operation.
 * @param ctx - Plugin lifecycle owner.
 * @param options - Authorized identities, persistence, dispatch, and chain limit.
 * @returns Attach operation for a native Session whose room binding committed after creation.
 */
export function installCollaborationAgentTools(ctx: Context, options: CollaborationAgentToolOptions): {
  attach: (agent: Agent) => Promise<void>
} {
  if (!Number.isSafeInteger(options.maxHops) || options.maxHops < 1 || options.maxHops > 8) {
    throw new Error('room-tool-max-hops-invalid')
  }
  const installed = new Map<Agent, () => void>()
  const pending = new Map<Agent, Promise<void>>()
  const disposed = new WeakSet<Agent>()
  const callCursors = new Map<string, Map<string, number>>()
  const activeScheduleInputs = new Map<string, string>()
  let closed = false

  const authorized = async (agent: Agent, caller: Agent | undefined, sourceEventId?: string) => {
    if (caller !== agent) throw new Error('room-tool-agent-mismatch')
    const binding = await options.resolveAgentRoom(agent)
    if (binding === undefined) throw new Error('room-tool-membership-required')
    const latest = agent.session.deriveMessages().findLast(message => message.role === 'user'
      && (message.source.kind === 'user' || message.source.kind === 'schedule'))
    const source = latest?.source
    if (source?.kind === 'schedule') {
      if (latest === undefined || sourceEventId !== undefined || binding.room.kind !== 'group' || binding.room.teamDefinitionId !== undefined
        || activeScheduleInputs.get(String(agent.id)) !== latest.id) {
        throw new Error('room-tool-source-mismatch')
      }
      return { ...binding, source: undefined, hop: 1, scheduleInputId: latest.id }
    }
    if (source?.kind !== 'user' || sourceEventId === undefined || !('rpcId' in source)
      || String(source.rpcId) !== sourceEventId || !('surfaceId' in source)
      || source.surfaceId !== binding.room.id) throw new Error('room-tool-source-mismatch')
    const event = await options.roomEvents.getByEventId(binding.room.orgId, binding.room.id, sourceEventId)
    if (event === undefined) throw new Error('room-tool-source-not-found')
    const hop = sourceHop(event) + 1
    if (hop > options.maxHops) throw new Error('room-tool-hop-limit')
    return { ...binding, source: event, hop, scheduleInputId: undefined }
  }

  const targetsFor = (binding: RoomAgentBinding, targets: readonly string[]) => {
    const unique = [...new Set(targets)]
    if (unique.some(id => id === binding.employeeId || !binding.room.memberEmployeeIds.includes(id))) {
      throw new Error('room-tool-target-not-member')
    }
    return unique
  }

  const humansFor = (binding: RoomAgentBinding, mentions: readonly string[]) => {
    const unique = [...new Set(mentions)]
    if (mentions.length > 32 || unique.length !== mentions.length
      || unique.some(id => !binding.room.memberUserIds.includes(id))) {
      throw new Error('room-tool-human-not-member')
    }
    return unique
  }

  const nativeSourceCursor = async (agent: Agent, callId: string): Promise<string> => {
    const observed = callCursors.get(String(agent.id))?.get(callId)
    if (observed !== undefined) return `${agent.id}:${observed}`
    await ctx.sessions.flush(agent.session)
    const handle = await ctx.sessionPersistence.open(agent.id, 'read')
    let last: number | undefined
    try {
      for (let offset = 0; ; offset += 256) {
        const { events } = await handle.read(offset, 256)
        for (const event of events) {
          if ((event.type === 'tool/call' && event.data.callId === callId)
            || (event.type === 'tool/ptc-dispatch-start' && event.data.subCallId === callId)) last = event.seq
        }
        if (events.length < 256) break
      }
    } finally { await handle.close() }
    if (last === undefined) throw new Error('room-tool-source-cursor-missing')
    return `${agent.id}:${last}`
  }

  const signedPost = async (agent: Agent, binding: RoomAgentBinding, requestId: string, callId: string,
    input: Extract<RoomSigningInput, { readonly type: 'text' | 'handoff' }>): Promise<RoomEvent> => {
    const prior = await options.roomEvents.findByRequest(binding.room.orgId, binding.room.id, 'employee', binding.employeeId, requestId)
    const sourceCursor = prior === undefined ? await nativeSourceCursor(agent, callId)
      : prior.event.tags.find(tag => tag[0] === 'dsh-source')?.[1]
    if (sourceCursor === undefined) throw new Error('room-tool-source-cursor-missing')
    const signed = await options.identity.signEmployee({ orgId: binding.room.orgId,
      employeeId: binding.employeeId, sessionId: String(agent.id) }, binding.room.id,
    { ...input, sourceCursor, ...(prior === undefined ? {} : { createdAt: prior.event.created_at }) })
    if (prior !== undefined) {
      if (prior.event.id !== signed.id) throw new Error('room-tool-idempotency-conflict')
      return prior
    }
    try {
      return await options.roomEvents.append({ orgId: binding.room.orgId, surfaceId: binding.room.id,
        event: signed, authorKind: 'employee', authorId: binding.employeeId, requestId,
        sourceSessionId: String(agent.id), sourceEventCursor: sourceCursor.slice(sourceCursor.lastIndexOf(':') + 1),
        ...('threadRoot' in input ? { threadRoot: input.threadRoot } : {}),
      })
    } catch (error) {
      const committed = await options.roomEvents.findByRequest(binding.room.orgId, binding.room.id,
        'employee', binding.employeeId, requestId)
      if (committed === undefined || committed.event.pubkey !== signed.pubkey || committed.event.kind !== signed.kind
        || committed.event.content !== signed.content
        || JSON.stringify(committed.event.tags.filter(tag => tag[0] !== 'dsh-source'))
          !== JSON.stringify(signed.tags.filter(tag => tag[0] !== 'dsh-source'))) throw error
      return committed
    }
  }

  const unavailable = (agent: Agent): boolean => closed || disposed.has(agent)
  const attachNow = async (agent: Agent): Promise<void> => {
    if (unavailable(agent) || installed.has(agent)) return
    if (await options.resolveAgentRoom(agent) === undefined || unavailable(agent)) return
    callCursors.set(String(agent.id), new Map())
    const disposers: Array<() => void> = []
    try {
      disposers.push(agent.ctx.tools.register(defineTool({
        name: 'room_post',
        description: 'Post a signed message to this shared room. @ALL or @member display name wakes current Bot colleagues; targetEmployeeIds can address exact Bot ids. A group Schedule turn may omit sourceEventId to ask a colleague to act. Use mentionedUserIds for human members. Reuse the action key for retries.',
        parameters: {
          ...messageParameters,
          targetEmployeeIds: { type: 'array', items: { type: 'string' }, description: 'Exact Bot member ids to wake. If omitted, @ALL or @display name in content selects current Bot members. Pass [] to post without waking Bots.' },
          mentionedUserIds: { type: 'array', items: { type: 'string' }, description: 'Human room member ids explicitly addressed by this post. Omit when no human is addressed.' },
        },
        output: {
          schema: { type: 'object', additionalProperties: false, properties: {
            eventId: { type: 'string', required: true }, sequence: { type: 'string', required: true },
            deliveredEmployeeIds: { type: 'array', items: { type: 'string' }, required: true },
          } },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        async execute(args, exec) {
          exec.signal.throwIfAborted()
          requireText(args.content); requireText(args.idempotencyKey)
          const binding = await authorized(agent, exec.agent, args.sourceEventId)
          const targets = targetsFor(binding, args.targetEmployeeIds
            ?? roomMentionTargets(args.content, binding.employeeId, binding.room.memberEmployeeIds,
              await options.memberEmployees(binding.room)))
          const mentionedUserIds = humansFor(binding, args.mentionedUserIds ?? [])
          const threadRoot = binding.source?.threadRoot
            ?? (binding.room.kind === 'channel' && binding.source?.event.kind === 9 ? binding.source.event.id : undefined)
          const requestId = `room_post:${binding.scheduleInputId === undefined ? '' : `${binding.scheduleInputId}:`}${args.idempotencyKey}`
          const event = await signedPost(agent, binding, requestId, String(exec.callId), {
            type: 'text', content: args.content,
            ...(binding.source === undefined ? { scheduled: true } : { sourceEventId: binding.source.event.id }),
            hop: binding.hop, targetEmployeeIds: targets,
            ...(mentionedUserIds.length === 0 ? {} : { mentionedUserIds }),
            ...(threadRoot === undefined ? {} : { threadRoot }),
          })
          exec.signal.throwIfAborted()
          const delivered = targets.length === 0 ? [] : await options.dispatchEmployeePost(binding.room, event, targets)
          return { eventId: event.event.id, sequence: event.sequence, deliveredEmployeeIds: delivered.map(target => target.employeeId) }
        },
        presentCall: args => ({ card: 'generic', kind: 'execute', title: 'Post to room', rawInput: args }),
      })))
      disposers.push(agent.ctx.tools.register(defineTool({
        name: 'room_handoff',
        description: 'Propose a signed handoff of a room task to another member employee and atomically transfer ownership only if you still own it. The first claim is tied to the received source event. Check transferred before assuming the target owns the task; reuse the same action key for retries.',
        parameters: {
          ...messageParameters,
          sourceEventId: { type: 'string', required: true, description: 'Signed room event id of the latest received room input.' },
          taskId: { type: 'string', required: true, description: 'Stable task identity from room context; do not rename it during a handoff.' },
          targetEmployeeId: { type: 'string', required: true, description: 'Another current room employee id.' },
        },
        output: {
          schema: { type: 'object', additionalProperties: false, properties: {
            taskId: { type: 'string', required: true }, transferred: { type: 'boolean', required: true },
            ownerEmployeeId: { type: 'string', required: true },
            eventId: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            deliveredEmployeeIds: { type: 'array', items: { type: 'string' }, required: true },
          } },
          render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
        },
        async execute(args, exec) {
          exec.signal.throwIfAborted()
          requireText(args.content); requireText(args.idempotencyKey); requireText(args.taskId)
          const binding = await authorized(agent, exec.agent, args.sourceEventId)
          if (binding.source === undefined) throw new Error('room-tool-source-mismatch')
          targetsFor(binding, [args.targetEmployeeId])
          const requestId = `room_handoff:${args.idempotencyKey}`
          const prior = await options.roomEvents.findByRequest(binding.room.orgId, binding.room.id, 'employee', binding.employeeId, requestId)
          const owner = await options.roomEvents.ensureTaskOwner(binding.room.orgId, binding.room.id,
            args.taskId, binding.employeeId, args.sourceEventId)
          if (owner === undefined) throw new Error('room-tool-task-source-missing')
          if (owner !== binding.employeeId && prior === undefined) {
            return { taskId: args.taskId, transferred: false, ownerEmployeeId: owner, eventId: null, deliveredEmployeeIds: [] }
          }
          const event = await signedPost(agent, binding, requestId, String(exec.callId), {
            type: 'handoff', content: args.content, taskId: args.taskId, targetEmployeeId: args.targetEmployeeId,
            sourceEventId: args.sourceEventId, hop: binding.hop,
          })
          const transferred = await options.roomEvents.transferOwner(binding.room.orgId, binding.room.id,
            args.taskId, binding.employeeId, args.targetEmployeeId, event.event.id)
          if (!transferred) {
            const current = await options.roomEvents.ensureTaskOwner(binding.room.orgId, binding.room.id,
              args.taskId, binding.employeeId, args.sourceEventId)
            return { taskId: args.taskId, transferred: false, ownerEmployeeId: current ?? owner,
              eventId: event.event.id, deliveredEmployeeIds: [] }
          }
          exec.signal.throwIfAborted()
          const delivered = await options.dispatchEmployeePost(binding.room, event, [args.targetEmployeeId])
          return { taskId: args.taskId, transferred: true, ownerEmployeeId: args.targetEmployeeId,
            eventId: event.event.id, deliveredEmployeeIds: delivered.map(target => target.employeeId) }
        },
        presentCall: args => ({ card: 'generic', kind: 'execute', title: `Handoff ${args.taskId}`, rawInput: args }),
      })))
    } catch (error) {
      for (const dispose of disposers.reverse()) dispose()
      throw error
    }
    installed.set(agent, () => { for (const dispose of disposers.reverse()) dispose() })
  }
  const attach = (agent: Agent): Promise<void> => {
    const existing = pending.get(agent)
    if (existing !== undefined) return existing
    const task = attachNow(agent).finally(() => { pending.delete(agent) })
    pending.set(agent, task)
    return task
  }
  ctx.on('session/event', (session, event) => {
    const cursors = callCursors.get(String(session.id))
    if (cursors === undefined) return
    if (event.type === 'turn/start' || event.type === 'turn/end') activeScheduleInputs.delete(String(session.id))
    else if (event.type === 'user/message') {
      if (event.data.source.kind === 'schedule') activeScheduleInputs.set(String(session.id), event.data.id)
      else if (event.data.source.kind === 'user') activeScheduleInputs.delete(String(session.id))
    }
    if (event.type === 'tool/call') cursors.set(String(event.data.callId), event.seq)
    else if (event.type === 'tool/ptc-dispatch-start') cursors.set(String(event.data.subCallId), event.seq)
    else if (event.type === 'tool/result') cursors.delete(String(event.data.message.toolCallId))
    else if (event.type === 'tool/ptc-dispatch') cursors.delete(String(event.data.subCallId))
  })
  ctx.on('agent/created', async ({ agent }) => { await attach(agent); return undefined })
  ctx.on('agent/disposed', ({ agent }) => { disposed.add(agent); installed.get(agent)?.(); installed.delete(agent); callCursors.delete(String(agent.id)); activeScheduleInputs.delete(String(agent.id)) })
  ctx.effect(() => () => {
    closed = true
    for (const dispose of installed.values()) dispose()
    installed.clear()
    callCursors.clear()
    activeScheduleInputs.clear()
  }, 'collaboration room agent tools')
  return { attach }
}
