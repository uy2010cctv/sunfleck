import { describe, expect, it } from 'vitest'
import { verifyEvent } from 'nostr-tools/pure'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { CollaborationIdentity } from '../src/collaboration-identity.ts'

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


const alice = { orgId: 'org-a', userId: 'alice', roles: ['member'] as const }
const bob = { orgId: 'org-a', userId: 'bob', roles: ['member'] as const }

function fixture() {
  const records = new Map<CredentialKey, CredentialRecord>()
  const bindings = new Map<string, string>()
  const credentials = {
    readRecord: async (key: CredentialKey) => records.get(key),
    modifyRecord: async (key: CredentialKey,
      update: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>) => {
      const next = await update(records.get(key))
      if (next !== undefined) records.set(key, next)
      return records.get(key)
    },
  }
  const keys = {
    getRoomActorKey: async (orgId: string, actorKind: string, actorId: string) =>
      bindings.get(JSON.stringify([orgId, actorKind, actorId])),
    ensureRoomActorKey: async (input: { orgId: string; actorKind: string; actorId: string; pubkey: string }) => {
      const address = JSON.stringify([input.orgId, input.actorKind, input.actorId])
      const current = bindings.get(address)
      if (current !== undefined && current !== input.pubkey) throw new Error('actor-key-conflict')
      bindings.set(address, input.pubkey)
      return input.pubkey
    },
  }
  const authorize = {
    human: async (principal: typeof alice, roomId: string) =>
      principal.orgId === 'org-a' && roomId === 'room-1' && ['alice', 'bob'].includes(principal.userId),
    employee: async (orgId: string, employeeId: string, sessionId: string, roomId: string) =>
      orgId === 'org-a' && employeeId === 'research' && sessionId === 'bound-session' && roomId === 'room-1',
    service: async (orgId: string, serviceId: string, roomId: string) =>
      orgId === 'org-a' && serviceId === 'git-webhook' && roomId === 'room-1',
  }
  const identity = () => new CollaborationIdentity(credentials, keys, authorize)
  return { records, bindings, identity }
}

describe('custodial room signing identities', () => {
  it('signs verifiable room messages with separate human and Bot keys', async () => {
    const { identity } = fixture()
    const signer = identity()
    const human = await signer.signHuman(alice, 'room-1', { type: 'text', content: 'Please research this.' })
    const bot = await signer.signEmployee({ orgId: 'org-a', employeeId: 'research', sessionId: 'bound-session' },
      'room-1', { type: 'text', content: 'I found the source.', threadRoot: human.id })
    expect(verifiedSignature(human)).toBe(true)
    expect(verifiedSignature(bot)).toBe(true)
    expect(human.pubkey).not.toBe(bot.pubkey)
    expect(human.kind).toBe(9)
    expect(human.tags).toContainEqual(['h', 'room-1'])
    expect(bot.tags).toContainEqual(['e', human.id, '', 'root'])
    expect(JSON.stringify({ human, bot })).not.toContain('secretHex')
  })

  it('signs a workflow thread parent and rejects an invalid reference', async () => {
    const signer = fixture().identity()
    const root = await signer.signHuman(alice, 'room-1', { type: 'text', content: 'Root request' })
    const event = await signer.signEmployee({ orgId: 'org-a', employeeId: 'research', sessionId: 'bound-session' },
      'room-1', { type: 'workflow', content: 'Tool started.', stepId: 'tool:1', sourceEventId: root.id, threadRoot: root.id })
    expect(event.kind).toBe(41000)
    expect(event.tags).toContainEqual(['e', root.id, '', 'root'])
    expect(event.tags).toContainEqual(['e', root.id])
    expect(verifiedSignature(event)).toBe(true)
    await expect(signer.signEmployee({ orgId: 'org-a', employeeId: 'research', sessionId: 'bound-session' },
      'room-1', { type: 'workflow', content: 'Tool started.', stepId: 'tool:1', threadRoot: 'arbitrary-topic' }))
      .rejects.toThrow('room-event-reference-invalid')
  })

  it('signs attachment rejection codes and targets without requesting Bot dispatch', async () => {
    const signer = fixture().identity()
    const source = await signer.signHuman(alice, 'room-1', { type: 'text', content: 'Inspect image' })
    const failure = await signer.signService({ orgId: 'org-a', serviceId: 'git-webhook' }, 'room-1', {
      type: 'workflow', content: 'Attachment rejected.', stepId: 'attachment-failure', sourceEventId: source.id,
      threadRoot: source.id, attachmentFailure: { code: 'INVALID_IMAGE', targetKind: 'employee', targetId: 'research' },
    })
    expect(verifiedSignature(failure)).toBe(true)
    expect(failure.tags).toContainEqual(['dsh-attachment-error', 'INVALID_IMAGE', 'employee', 'research'])
    expect(failure.tags).toContainEqual(['e', source.id])
    expect(failure.tags).toContainEqual(['e', source.id, '', 'root'])
    expect(failure.tags.some(tag => tag[0] === 'dsh-target')).toBe(false)
  })

  it('signs reactions with an event reference and rejects modified content', async () => {
    const { identity } = fixture()
    const signer = identity()
    const target = await signer.signHuman(alice, 'room-1', { type: 'text', content: 'Draft' })
    const reaction = await signer.signHuman(bob, 'room-1', { type: 'reaction', content: '+', targetEventId: target.id })
    expect(reaction.kind).toBe(7)
    expect(reaction.tags).toContainEqual(['e', target.id])
    expect(verifiedSignature(reaction)).toBe(true)
    const tampered = { id: reaction.id, pubkey: reaction.pubkey, created_at: reaction.created_at,
      kind: reaction.kind, tags: reaction.tags.map(tag => [...tag]), content: '-', sig: reaction.sig }
    expect(verifiedSignature(tampered)).toBe(false)
  })

  it('signs explicit human mentions into the immutable room event', async () => {
    const signed = await fixture().identity().signHuman(alice, 'room-1', {
      type: 'text', content: 'Please review', mentionedUserIds: ['bob'], requestId: 'mention-1',
    })
    expect(signed.tags).toContainEqual(['dsh-mention', 'bob'])
    expect(verifiedSignature(signed)).toBe(true)
  })

  it('refuses a human actor substitution and an unbound employee session', async () => {
    const { identity } = fixture()
    const signer = identity()
    await expect(signer.signHuman({ ...alice, userId: 'mallory' }, 'room-1',
      { type: 'text', content: 'Impersonated' })).rejects.toThrow('room-actor-forbidden')
    await expect(signer.signEmployee({ orgId: 'org-a', employeeId: 'research', sessionId: 'wrong-session' },
      'room-1', { type: 'text', content: 'Impersonated' })).rejects.toThrow('room-actor-forbidden')
    await expect(signer.signHuman({ ...alice, actorType: 'employee' }, 'room-1',
      { type: 'text', content: 'Impersonated' })).rejects.toThrow('room-actor-forbidden')
  })

  it('reuses the same durable key after signer restart and fails closed when it is lost', async () => {
    const state = fixture()
    const first = await state.identity().signHuman(alice, 'room-1', { type: 'text', content: 'Before restart' })
    const second = await state.identity().signHuman(alice, 'room-1', { type: 'text', content: 'After restart' })
    expect(second.pubkey).toBe(first.pubkey)
    state.records.clear()
    await expect(state.identity().signHuman(alice, 'room-1',
      { type: 'text', content: 'Key lost' })).rejects.toThrow('room-signing-key-unavailable')
    expect(state.records.size).toBe(0)
  })

  it('rejects a stored key that no longer matches the public actor binding', async () => {
    const state = fixture()
    await state.identity().signHuman(alice, 'room-1', { type: 'text', content: 'Original' })
    state.bindings.set(JSON.stringify(['org-a', 'human', 'alice']), '0'.repeat(64))
    await expect(state.identity().signHuman(alice, 'room-1',
      { type: 'text', content: 'Changed' })).rejects.toThrow('room-signing-key-mismatch')
  })

  it('signs workflow and handoff facts as their distinct authorized authors', async () => {
    const signer = fixture().identity()
    const workflow = await signer.signService({ orgId: 'org-a', serviceId: 'git-webhook' },
      'room-1', { type: 'workflow', content: 'Tag pushed', stepId: 'release-notes' })
    const handoff = await signer.signEmployee({ orgId: 'org-a', employeeId: 'research', sessionId: 'bound-session' },
      'room-1', { type: 'handoff', content: 'Send source summary to editor', taskId: 'task-1', targetEmployeeId: 'editor' })
    expect(workflow).toMatchObject({ kind: 41000, tags: [['h', 'room-1'], ['dsh', 'workflow'], ['step', 'release-notes']] })
    expect(handoff).toMatchObject({ kind: 41001, tags: [['h', 'room-1'], ['dsh', 'handoff'], ['task', 'task-1'],
      ['target', 'editor']] })
    expect(workflow.pubkey).not.toBe(handoff.pubkey)
    expect(verifiedSignature(workflow)).toBe(true)
    expect(verifiedSignature(handoff)).toBe(true)
    await expect(signer.signService({ orgId: 'org-a', serviceId: 'untrusted' },
      'room-1', { type: 'workflow', content: 'Forged', stepId: 'release-notes' })).rejects.toThrow('room-actor-forbidden')
  })

  it('signs Bot source and bounded hop tags into both text and handoff facts', async () => {
    const signer = fixture().identity()
    const bot = { orgId: 'org-a', employeeId: 'research', sessionId: 'bound-session' }
    const source = 'a'.repeat(64)
    const text = await signer.signEmployee(bot, 'room-1',
      { type: 'text', content: 'Data Bot, please check.', sourceEventId: source, hop: 2 })
    const handoff = await signer.signEmployee(bot, 'room-1',
      { type: 'handoff', content: 'Take ownership', taskId: 'task-1', targetEmployeeId: 'editor',
        sourceEventId: text.id, hop: 3 })
    expect(text.tags).toContainEqual(['e', source])
    expect(text.tags).toContainEqual(['dsh-hop', '2'])
    expect(handoff.tags).toContainEqual(['e', text.id])
    expect(handoff.tags).toContainEqual(['dsh-hop', '3'])
    expect(verifiedSignature(text)).toBe(true)
    expect(verifiedSignature(handoff)).toBe(true)
  })

  it('rejects malformed Bot source ids and hop counts before signing', async () => {
    const signer = fixture().identity()
    const bot = { orgId: 'org-a', employeeId: 'research', sessionId: 'bound-session' }
    await expect(signer.signEmployee(bot, 'room-1',
      { type: 'text', content: 'Bad source', sourceEventId: 'not-hex', hop: 1 }))
      .rejects.toThrow('room-event-reference-invalid')
    await expect(signer.signEmployee(bot, 'room-1',
      { type: 'handoff', content: 'Bad hop', taskId: 'task-1', targetEmployeeId: 'editor', hop: 9 }))
      .rejects.toThrow('room-event-hop-invalid')
    await expect(signer.signEmployee(bot, 'room-1',
      { type: 'text', content: 'Fractional hop', hop: 1.5 }))
      .rejects.toThrow('room-event-hop-invalid')
  })

  it('signs the exact ordered Bot target list so a changed route changes the event id', async () => {
    const signer = fixture().identity()
    const bot = { orgId: 'org-a', employeeId: 'research', sessionId: 'bound-session' }
    const common = { type: 'text' as const, content: 'Please check this', createdAt: 1_700_000_000 }
    const dataFirst = await signer.signEmployee(bot, 'room-1',
      { ...common, targetEmployeeIds: ['data', 'editor'] })
    const editorFirst = await signer.signEmployee(bot, 'room-1',
      { ...common, targetEmployeeIds: ['editor', 'data'] })
    expect(dataFirst.tags).toEqual([['h', 'room-1'], ['dsh-target', 'data'], ['dsh-target', 'editor']])
    expect(editorFirst.tags).toEqual([['h', 'room-1'], ['dsh-target', 'editor'], ['dsh-target', 'data']])
    expect(dataFirst.id).not.toBe(editorFirst.id)
    expect(verifiedSignature(dataFirst)).toBe(true)
    expect(verifiedSignature(editorFirst)).toBe(true)
  })

  it('refuses empty, duplicate, and oversized Bot target lists', async () => {
    const signer = fixture().identity()
    const bot = { orgId: 'org-a', employeeId: 'research', sessionId: 'bound-session' }
    for (const targetEmployeeIds of [[''], [' data '], ['data', 'data'],
      Array.from({ length: 17 }, (_, index) => `employee-${index}`)]) {
      await expect(signer.signEmployee(bot, 'room-1',
        { type: 'text', content: 'Invalid targets', targetEmployeeIds }))
        .rejects.toThrow('room-event-target-invalid')
    }
  })

  it('separates same-second Bot replies by their signed native source cursor', async () => {
    const signer = fixture().identity()
    const bot = { orgId: 'org-a', employeeId: 'research', sessionId: 'bound-session' }
    const common = { type: 'text' as const, content: 'Done', createdAt: 1_700_000_000 }
    const first = await signer.signEmployee(bot, 'room-1', { ...common, sourceCursor: 'bound-session:41' })
    const second = await signer.signEmployee(bot, 'room-1', { ...common, sourceCursor: 'bound-session:42' })
    const replay = await signer.signEmployee(bot, 'room-1', { ...common, sourceCursor: 'bound-session:41' })
    expect(first.tags).toContainEqual(['dsh-source', 'bound-session:41'])
    expect(second.tags).toContainEqual(['dsh-source', 'bound-session:42'])
    expect(first.id).not.toBe(second.id)
    expect(replay.id).toBe(first.id)
    expect(verifiedSignature(first)).toBe(true)
    expect(verifiedSignature(second)).toBe(true)
  })

  it('binds human target and route decisions to the signed event', async () => {
    const signer = fixture().identity()
    const targeted = await signer.signHuman(alice, 'room-1',
      { type: 'text', content: 'Ask both Bots', targetEmployeeIds: ['research', 'editor'] })
    const routed = await signer.signHuman(alice, 'room-1',
      { type: 'text', content: 'Start the team', route: 'team' })
    expect(targeted.tags).toEqual([['h', 'room-1'], ['dsh-target', 'research'], ['dsh-target', 'editor']])
    expect(routed.tags).toEqual([['h', 'room-1'], ['dsh-route', 'team']])
    const tampered = { id: routed.id, pubkey: routed.pubkey, created_at: routed.created_at,
      kind: routed.kind, tags: routed.tags.filter(tag => tag[0] !== 'dsh-route').map(tag => [...tag]),
      content: routed.content, sig: routed.sig }
    expect(verifiedSignature(tampered)).toBe(false)
    await expect(signer.signHuman(alice, 'room-1',
      { type: 'text', content: 'Ambiguous', route: 'team', targetEmployeeIds: ['research'] }))
      .rejects.toThrow('room-event-route-invalid')
  })

  it('signs source cursors for workflow and handoff facts and rejects malformed cursors', async () => {
    const signer = fixture().identity()
    const bot = { orgId: 'org-a', employeeId: 'research', sessionId: 'bound-session' }
    const workflow = await signer.signService({ orgId: 'org-a', serviceId: 'git-webhook' }, 'room-1',
      { type: 'workflow', content: 'Drafted release notes', stepId: 'release-notes', sourceCursor: 'git-run:9',
        targetEmployeeIds: ['research'] })
    const handoff = await signer.signEmployee(bot, 'room-1',
      { type: 'handoff', content: 'Transferred', taskId: 'task-1', targetEmployeeId: 'editor', sourceCursor: 'bound-session:43' })
    expect(workflow.tags).toContainEqual(['dsh-source', 'git-run:9'])
    expect(workflow.tags).toContainEqual(['dsh-target', 'research'])
    expect(handoff.tags).toContainEqual(['dsh-source', 'bound-session:43'])
    expect(handoff.tags).not.toContainEqual(['dsh-target', 'editor'])
    for (const sourceCursor of ['', 'bad', ':4', 'bound-session:', 'bound-session:NaN', 'x'.repeat(257)]) {
      await expect(signer.signEmployee(bot, 'room-1',
        { type: 'text', content: 'Invalid cursor', sourceCursor })).rejects.toThrow('room-event-source-invalid')
    }
  })

  it('distinguishes same-second human messages by signed request id and keeps a retry stable', async () => {
    const signer = fixture().identity()
    const common = { type: 'text' as const, content: 'Same text', createdAt: 1_700_000_000 }
    const first = await signer.signHuman(alice, 'room-1', { ...common, requestId: 'human-request-1' })
    const second = await signer.signHuman(alice, 'room-1', { ...common, requestId: 'human-request-2' })
    const retry = await signer.signHuman(alice, 'room-1', { ...common, requestId: 'human-request-1' })
    expect(first.tags).toContainEqual(['dsh-request', 'human-request-1'])
    expect(second.tags).toContainEqual(['dsh-request', 'human-request-2'])
    expect(first.id).not.toBe(second.id)
    expect(retry.id).toBe(first.id)
  })

  it('signs reaction request ids and rejects malformed request ids', async () => {
    const signer = fixture().identity()
    const reaction = await signer.signHuman(alice, 'room-1',
      { type: 'reaction', content: '+', targetEventId: 'a'.repeat(64), requestId: 'reaction-1' })
    expect(reaction.tags).toContainEqual(['dsh-request', 'reaction-1'])
    for (const requestId of ['', ' blank ', 'line\nbreak', 'x'.repeat(257)]) {
      await expect(signer.signHuman(alice, 'room-1',
        { type: 'text', content: 'Invalid request', requestId })).rejects.toThrow('room-event-request-invalid')
    }
  })
})
