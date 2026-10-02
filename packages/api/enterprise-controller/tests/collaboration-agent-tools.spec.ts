import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-schedule'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { CollaborationRecord, RoomEvent, RoomEventAppend } from '@deepseek-ai/dsh-enterprise-postgres'
import { verifyEvent } from 'nostr-tools/pure'
import { CollaborationIdentity } from '../src/collaboration-identity.ts'
import { installCollaborationAgentTools } from '../src/collaboration-agent-tools.ts'

/** nostr-tools accepts mutable tag arrays; signed room events keep them readonly. */
const verifiedSignature = (event: {
  readonly id: string
  readonly pubkey: string
  readonly created_at: number
  readonly kind: number
  readonly content: string
  readonly sig: string
  readonly tags: readonly (readonly string[])[]
}): boolean => verifyEvent({ ...event, tags: event.tags.map(tag => [...tag]) })


const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function setup(maxHops = 2, initiallyBound = true, kind: CollaborationRecord['kind'] = 'group') {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const agent = await ctx.agentLoop.create(SessionId('room-bot-a'), { provider: 'mock', model: 'mock' })
  const other = await ctx.agentLoop.create(SessionId('private-bot'), { provider: 'mock', model: 'mock' })
  const room: CollaborationRecord = { id: 'room-a', orgId: 'org-a', kind, name: 'Review', workspaceId: 'workspace',
    memberUserIds: ['alice'], memberEmployeeIds: ['bot-a', 'bot-b', 'bot-c'], dutyEmployeeIds: [] }
  let bound = initiallyBound
  const records = new Map<CredentialKey, CredentialRecord>(), keys = new Map<string, string>()
  const events: RoomEvent[] = [], delivered: string[][] = []
  const owners = new Map<string, { owner: string; source: string }>()
  const identity = new CollaborationIdentity({
    readRecord: async key => records.get(key),
    modifyRecord: async (key, update) => {
      const next = await update(records.get(key))
      if (next !== undefined) records.set(key, next)
      return records.get(key)
    },
  }, {
    getRoomActorKey: async (org, kind, id) => keys.get(`${org}:${kind}:${id}`),
    ensureRoomActorKey: async (input) => { keys.set(`${input.orgId}:${input.actorKind}:${input.actorId}`, input.pubkey); return input.pubkey },
  }, { human: async () => true, employee: async () => bound })
  const initial = await identity.signHuman({ orgId: 'org-a', userId: 'alice', roles: ['member'] }, room.id,
    { type: 'text', content: 'Review the draft.' })
  events.push({ orgId: room.orgId, surfaceId: room.id, event: initial, authorKind: 'human', authorId: 'alice', sequence: '1' })
  agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: initial.content }], source: {
    kind: 'user', rpcId: brandString<SessionRequestId>(initial.id), surfaceId: room.id,
  } }), { surfaceOp: 'append' })
  const roomEvents = {
    getByEventId: async (org: string, surface: string, id: string) =>
      events.find(e => e.orgId === org && e.surfaceId === surface && e.event.id === id),
    findByRequest: async (org: string, surface: string, kind: string, author: string, request: string) =>
      events.find(e => e.orgId === org && e.surfaceId === surface && e.authorKind === kind && e.authorId === author
        && e.requestId === request),
    append: async (input: RoomEventAppend) => {
      if (events.some(event => event.requestId === input.requestId && event.authorId === input.authorId)) {
        throw new Error('room event idempotency conflict')
      }
      const row = { ...input, sequence: String(events.length + 1) }
      events.push(row)
      return row
    },
    ensureTaskOwner: async (_org: string, _surface: string, task: string, owner: string, source: string) => {
      if (!owners.has(task)) owners.set(task, { owner, source })
      return owners.get(task)?.owner
    },
    transferOwner: async (_org: string, _surface: string, task: string, expected: string, target: string, source: string) => {
      const current = owners.get(task)
      if (current?.owner === expected) { owners.set(task, { owner: target, source }); return true }
      return current?.owner === target && current.source === source
    },
  }
  const tools = installCollaborationAgentTools(ctx, {
    roomEvents, identity, maxHops,
    resolveAgentRoom: async candidate => bound && candidate === agent ? { room, employeeId: 'bot-a' } : undefined,
    memberEmployees: async () => [
      { employeeId: 'bot-a', displayName: 'Research' },
      { employeeId: 'bot-b', displayName: 'Data' },
      { employeeId: 'bot-c', displayName: 'Editor' },
    ],
    dispatchEmployeePost: async (_room, event, targets) => {
      expect(events.some(item => item.event.id === event.event.id)).toBe(true)
      delivered.push([...targets]); return targets.map(employeeId => ({ sessionId: `session-${employeeId}`, employeeId }))
    },
  })
  await tools.attach(agent)
  await tools.attach(other)
  let calls = 0
  const call = (name: string, args: unknown, caller = agent) => {
    const callId = ToolCallId(`tool-${++calls}`)
    caller.session.append('tool/call', { turn: 1, step: 1, callId, name, arguments: JSON.stringify(args) })
    return ctx.tools.execute({ agent: caller, name, arguments: args, callId, signal: new AbortController().signal })
  }
  return { ctx, agent, other, room, initial, events, owners, delivered, identity, tools, call,
    revoke: () => { bound = false }, rebind: () => { bound = true } }
}

describe('shared room agent tools', () => {
  it('keeps a channel root post and reply-to-reply under the signed original parent', async () => {
    const app = await setup(2, true, 'channel')
    const first = await app.call('room_post', { content: 'First reply', sourceEventId: app.initial.id,
      idempotencyKey: 'root-reply' })
    expect(first.isError).toBeFalsy()
    const reply = app.events[1]!
    expect(reply.threadRoot).toBe(app.initial.id)
    expect(reply.event.tags).toContainEqual(['e', app.initial.id, '', 'root'])
    expect(verifiedSignature(reply.event)).toBe(true)
    app.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: reply.event.content }], source: {
      kind: 'user', rpcId: brandString<SessionRequestId>(reply.event.id), surfaceId: app.room.id,
    } }), { surfaceOp: 'append' })
    const second = await app.call('room_post', { content: 'Second reply', sourceEventId: reply.event.id,
      idempotencyKey: 'nested-reply' })
    expect(second.isError).toBeFalsy()
    expect(app.events[2]?.threadRoot).toBe(app.initial.id)
    expect(app.events[2]?.event.tags).toContainEqual(['e', app.initial.id, '', 'root'])
    expect(verifiedSignature(app.events[2]!.event)).toBe(true)
  })

  it('publishes a verifiable Bot post before dispatch and exposes tools only in the bound Agent scope', async () => {
    const app = await setup()
    const result = await app.call('room_post', { content: 'Please check the draft.', sourceEventId: app.initial.id,
      idempotencyKey: 'post-1', targetEmployeeIds: ['bot-b'] })
    expect(result.isError).toBeFalsy()
    expect(app.events).toHaveLength(2)
    expect(verifiedSignature(app.events[1]!.event)).toBe(true)
    expect(app.events[1]!.event.tags).toContainEqual(['dsh-hop', '1'])
    expect(app.events[1]?.threadRoot).toBeUndefined()
    expect(app.events[1]!.event.tags.some(tag => tag[3] === 'root')).toBe(false)
    const source = app.agent.session.snapshotEvents().find(event => event.type === 'tool/call')
    expect(app.events[1]!.event.tags).toContainEqual(['dsh-source', `${app.agent.id}:${source?.seq}`])
    expect(app.events[1]?.sourceEventCursor).toBe(String(source?.seq))
    expect(app.delivered).toEqual([['bot-b']])
    expect((await app.call('room_post', {}, app.other)).isError).toBe(true)
  })
  it('wakes current colleagues addressed by name or ALL in an employee post', async () => {
    const app = await setup()
    const result = await app.call('room_post', { content: '@ALL Please share ideas. @Data prepare the numbers.',
      sourceEventId: app.initial.id, idempotencyKey: 'brainstorm' })
    expect(result.isError).toBeFalsy()
    expect(app.events[1]?.event.tags).toContainEqual(['dsh-target', 'bot-b'])
    expect(app.events[1]?.event.tags).toContainEqual(['dsh-target', 'bot-c'])
    expect(app.events[1]?.event.tags).not.toContainEqual(['dsh-target', 'bot-a'])
    expect(app.delivered).toEqual([['bot-b', 'bot-c']])
  })
  it('does not infer destinations from ordinary colleague names', async () => {
    const app = await setup()
    const result = await app.call('room_post', { content: 'Data and Editor will review later.',
      sourceEventId: app.initial.id, idempotencyKey: 'status' })
    expect(result.isError).toBeFalsy()
    expect(app.delivered).toEqual([])
  })
  it('wakes only the explicitly named current Bot member', async () => {
    const app = await setup()
    const result = await app.call('room_post', { content: '@Data, please bring the metrics.',
      sourceEventId: app.initial.id, idempotencyKey: 'metrics' })
    expect(result.isError).toBeFalsy()
    expect(app.delivered).toEqual([['bot-b']])
  })
  it('wakes current colleagues addressed in Chinese assignment lines', async () => {
    const app = await setup()
    const result = await app.call('room_post', {
      content: '📍 给 Data（分析）：请给一条结论。\n📍 给 Editor（编辑）：请给一条建议。',
      sourceEventId: app.initial.id, idempotencyKey: 'brainstorm-assignments',
    })
    expect(result.isError).toBeFalsy()
    expect(app.events[1]?.event.tags).toContainEqual(['dsh-target', 'bot-b'])
    expect(app.events[1]?.event.tags).toContainEqual(['dsh-target', 'bot-c'])
    expect(app.delivered).toEqual([['bot-b', 'bot-c']])
  })
  it('lets an explicit empty target list suppress textual mentions', async () => {
    const app = await setup()
    const result = await app.call('room_post', { content: '@ALL Status only.', sourceEventId: app.initial.id,
      idempotencyKey: 'status-all', targetEmployeeIds: [] })
    expect(result.isError).toBeFalsy()
    expect(app.delivered).toEqual([])
  })
  it('rejects a removed caller, a nonmember target, and a forged source before posting', async () => {
    const app = await setup()
    for (const args of [
      { content: 'Request', sourceEventId: app.initial.id, idempotencyKey: 'bad-target', targetEmployeeIds: ['outsider'] },
      { content: 'Request', sourceEventId: '0'.repeat(64), idempotencyKey: 'bad-source', targetEmployeeIds: ['bot-b'] },
    ]) expect((await app.call('room_post', args)).isError).toBe(true)
    app.revoke()
    expect((await app.call('room_post', { content: 'Request', sourceEventId: app.initial.id,
      idempotencyKey: 'revoked', targetEmployeeIds: ['bot-b'] })).isError).toBe(true)
    expect(app.events).toHaveLength(1)
  })
  it('rejects a stale room source after the Host Schedule service starts a new turn', async () => {
    const app = await setup()
    app.agent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'Scheduled work is due' }], source: { kind: 'schedule' },
    }), { surfaceOp: 'append' })
    const result = await app.call('room_post', { content: 'Scheduled reply', sourceEventId: app.initial.id,
      idempotencyKey: 'stale-source' })
    expect(result.isError).toBe(true)
    expect(app.events).toHaveLength(1)
  })
  it('signs Bot mentions of current human members and rejects an outsider', async () => {
    const app = await setup()
    const result = await app.call('room_post', { content: 'Alice, review is ready.', sourceEventId: app.initial.id,
      idempotencyKey: 'mention-alice', mentionedUserIds: ['alice'] })
    expect(result.isError).toBeFalsy()
    expect(app.events[1]?.event.tags).toContainEqual(['dsh-mention', 'alice'])
    expect(verifiedSignature(app.events[1]!.event)).toBe(true)
    const rejected = await app.call('room_post', { content: 'Private ping', sourceEventId: app.initial.id,
      idempotencyKey: 'mention-outsider', mentionedUserIds: ['outsider'] })
    expect(rejected.isError).toBe(true)
    expect(app.events).toHaveLength(2)
  })
  it('transfers task ownership with a signed handoff and rejects a competing owner', async () => {
    const app = await setup()
    const result = await app.call('room_handoff', { content: 'Take the review.', sourceEventId: app.initial.id,
      idempotencyKey: 'handoff-1', taskId: 'task-1', targetEmployeeId: 'bot-b' })
    expect(result.isError).toBeFalsy()
    expect(app.owners.get('task-1')?.owner).toBe('bot-b')
    expect(app.events[1]?.event.kind).toBe(41001)
    expect(app.delivered).toEqual([['bot-b']])
    const conflict = await app.call('room_handoff', { content: 'Competing transfer', sourceEventId: app.initial.id,
      idempotencyKey: 'handoff-2', taskId: 'task-1', targetEmployeeId: 'bot-c' })
    expect(conflict.value).toMatchObject({ transferred: false, ownerEmployeeId: 'bot-b' })
    expect(app.delivered).toHaveLength(1)
  })
  it('reuses a signed action on retry and rejects changed content or targets under its key', async () => {
    const app = await setup()
    const args = { content: 'Review', sourceEventId: app.initial.id, idempotencyKey: 'retry', targetEmployeeIds: ['bot-b'] }
    const first = await app.call('room_post', args)
    const retried = await app.call('room_post', args)
    expect(retried.value).toEqual(first.value)
    expect(app.events).toHaveLength(2)
    for (const changed of [{ ...args, content: 'Different' }, { ...args, targetEmployeeIds: ['bot-c'] }]) {
      expect((await app.call('room_post', changed)).isError).toBe(true)
    }
    expect(app.events).toHaveLength(2)
  })
  it('converges concurrent tool retries on the committed source event', async () => {
    const app = await setup()
    await app.identity.signEmployee({ orgId: 'org-a', employeeId: 'bot-a', sessionId: String(app.agent.id) }, app.room.id,
      { type: 'text', content: 'Prepare credential' })
    const args = { content: 'Review', sourceEventId: app.initial.id, idempotencyKey: 'parallel', targetEmployeeIds: ['bot-b'] }
    const [first, second] = await Promise.all([app.call('room_post', args), app.call('room_post', args)])
    expect(first?.isError).toBeFalsy()
    expect(second?.isError).toBeFalsy()
    expect(first?.value).toEqual(second?.value)
    expect(app.events).toHaveLength(2)
  })
  it('enforces the signed hop limit and prevents resetting it to an older human source', async () => {
    const app = await setup(2)
    const event = await app.identity.signEmployee({ orgId: 'org-a', employeeId: 'bot-a', sessionId: String(app.agent.id) }, app.room.id,
      { type: 'text', content: 'Second hop', sourceEventId: app.initial.id, hop: 2 })
    app.events.push({ orgId: 'org-a', surfaceId: app.room.id, event, authorKind: 'employee', authorId: 'bot-a', sequence: '2' })
    app.agent.session.append('user/message', createUserMessage({ content: [{ type: 'text', text: event.content }], source: {
      kind: 'user', rpcId: brandString<SessionRequestId>(event.id), surfaceId: app.room.id,
    } }), { surfaceOp: 'append' })
    for (const sourceEventId of [event.id, app.initial.id]) {
      expect((await app.call('room_post', { content: 'Continue', sourceEventId,
        idempotencyKey: sourceEventId, targetEmployeeIds: ['bot-b'] })).isError).toBe(true)
    }
    expect(app.events).toHaveLength(2)
    expect(app.delivered).toEqual([])
  })
  it('only dispatches the winning concurrent task handoff', async () => {
    const app = await setup()
    await app.identity.signEmployee({ orgId: 'org-a', employeeId: 'bot-a', sessionId: String(app.agent.id) }, app.room.id,
      { type: 'text', content: 'Prepare credential' })
    const results = await Promise.all(['bot-b', 'bot-c'].map(targetEmployeeId => app.call('room_handoff', {
      content: 'Take review', sourceEventId: app.initial.id, idempotencyKey: targetEmployeeId, taskId: 'task-race', targetEmployeeId,
    })))
    const values = results.map(result => result.value)
    expect(values.filter(value => typeof value === 'object' && value !== null && 'transferred' in value && value.transferred)).toHaveLength(1)
    expect(app.delivered).toHaveLength(1)
  })

  it('keeps one tool registration per bound Agent across concurrent attach calls', async () => {
    const app = await setup()
    await Promise.all([app.tools.attach(app.agent), app.tools.attach(app.agent)])
    expect(app.agent.ctx.tools.schemas(app.agent).filter(tool => tool.name === 'room_post')).toHaveLength(1)
    expect(app.agent.ctx.tools.schemas(app.agent).filter(tool => tool.name === 'room_handoff')).toHaveLength(1)
    expect(app.other.ctx.tools.schemas(app.other).some(tool => tool.name.startsWith('room_'))).toBe(false)
  })
  it('replays the committed handoff after ownership moved without creating another event', async () => {
    const app = await setup()
    const args = { content: 'Take review', sourceEventId: app.initial.id, idempotencyKey: 'handoff-retry',
      taskId: 'task-1', targetEmployeeId: 'bot-b' }
    const first = await app.call('room_handoff', args)
    const second = await app.call('room_handoff', args)
    expect(second.value).toEqual(first.value)
    expect(second.value).toMatchObject({ transferred: true, ownerEmployeeId: 'bot-b' })
    expect(app.events).toHaveLength(2)
  })

  it('signs separate native tool calls distinctly even with identical content in the same second', async () => {
    const app = await setup()
    const args = { content: 'Same text', sourceEventId: app.initial.id, targetEmployeeIds: [] }
    const first = await app.call('room_post', { ...args, idempotencyKey: 'first' })
    const second = await app.call('room_post', { ...args, idempotencyKey: 'second' })
    expect(first.isError).toBeFalsy()
    expect(second.isError).toBeFalsy()
    expect(app.events[1]?.event.id).not.toBe(app.events[2]?.event.id)
  })

  it('recovers a replayed native tool cursor through bounded persisted event reads', async () => {
    const app = await setup(2, false)
    const callId = ToolCallId('replayed-call')
    const args = { content: 'Replay request', sourceEventId: app.initial.id, idempotencyKey: 'replayed', targetEmployeeIds: [] }
    const call = app.agent.session.append('tool/call', { turn: 1, step: 1, callId, name: 'room_post', arguments: JSON.stringify(args) })
    let reads = 0, closed = false
    app.ctx.provide('sessionPersistence' as never, { open: async () => ({
      read: async (offset: number, length: number) => {
        reads++
        return { events: app.agent.session.snapshotEvents().slice(offset, offset + length) }
      },
      close: async () => { closed = true },
    }) } as never)
    app.rebind()
    await app.tools.attach(app.agent)
    const result = await app.ctx.tools.execute({ agent: app.agent, name: 'room_post', arguments: args,
      callId, signal: new AbortController().signal })
    expect(result.isError).toBeFalsy()
    expect(app.events[1]?.event.tags).toContainEqual(['dsh-source', `${app.agent.id}:${call.seq}`])
    expect(reads).toBe(1)
    expect(closed).toBe(true)
  })

})
