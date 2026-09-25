import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { createEnterprisePostgresComposition, PostgresRoomEventRepository } from '../src/index.ts'
import type { EnterprisePostgresComposition, RoomEventAppend, RoomNostrEvent } from '../src/index.ts'

const url = process.env.DSH_TEST_POSTGRES_URL
describe.skipIf(url === undefined)('PostgreSQL signed room events', () => {
  let db: EnterprisePostgresComposition
  let orgId: string
  let otherOrgId: string
  let surfaceId: string
  let otherSurfaceId: string
  let actorId: string
  let pubkey: string
  let secretKey: Uint8Array
  let workspaceId: string

  beforeEach(async () => {
    db = await createEnterprisePostgresComposition({ connectionString: url as string,
      cursorSigningKey: '0123456789abcdef0123456789abcdef' })
    orgId = randomUUID()
    otherOrgId = randomUUID()
    actorId = randomUUID()
    workspaceId = randomUUID()
    secretKey = generateSecretKey()
    pubkey = getPublicKey(secretKey)
    await db.database.query('INSERT INTO organizations(id,name) VALUES($1,$2),($3,$4)',
      [orgId, 'Room events', otherOrgId, 'Other room org'])
    await db.database.query('INSERT INTO users(id,org_id,username,display_name,disabled) VALUES($1,$2,$1,$1,false)',
      [actorId, orgId])
    await db.identity.saveWorkspaceGrant({ workspaceId, orgId, name: 'Shared', kind: 'personal',
      ownerUserId: actorId, rootPath: '/tmp/room-events', sandboxMode: 'workspace-write', expectedRevision: 0 })
    const room = { orgId, workspaceId, kind: 'group' as const, name: 'Room', memberUserIds: [actorId],
      memberEmployeeIds: [], dutyEmployeeIds: [] }
    surfaceId = (await db.collaboration.create(room)).id
    otherSurfaceId = (await db.collaboration.create({ ...room, name: 'Other room' })).id
    await db.roomEvents.ensureRoomActorKey({ orgId, actorKind: 'human', actorId, pubkey })
  })

  afterEach(async () => {
    await db.database.query('DELETE FROM dsh_enterprise_surface_directory WHERE org_id=$1', [orgId])
    await db.database.query('DELETE FROM enterprise_workspace_grants WHERE workspace_id=$1', [workspaceId])
    await db.database.query('DELETE FROM users WHERE org_id=$1', [orgId])
    await db.database.query('DELETE FROM organizations WHERE id IN ($1,$2)', [orgId, otherOrgId])
    await db.close()
  })

  function event(content: string, roomId = surfaceId, tags: string[][] = []): RoomNostrEvent {
    const signed = finalizeEvent({ created_at: Math.floor(Date.now() / 1000), kind: 9,
      tags: [['h', roomId], ...tags], content }, secretKey)
    return { id: signed.id, pubkey: signed.pubkey, created_at: signed.created_at,
      kind: signed.kind, tags: signed.tags, content: signed.content, sig: signed.sig }
  }

  function input(content: string, requestId?: string): RoomEventAppend {
    return { orgId, surfaceId, event: event(content, surfaceId,
      requestId === undefined ? [] : [['dsh-request', requestId]]), authorKind: 'human', authorId: actorId,
    ...(requestId === undefined ? {} : { requestId }) }
  }

  it('keeps rooms and native destinations readable with the version 2 event schema', async () => {
    const version = await db.database.query<{ version: number }>('SELECT version FROM dsh_enterprise_collaboration_meta')
    expect(version.rows).toEqual([{ version: 3 }])
    await db.collaboration.bind({ surfaceId, topicId: '', employeeId: 'helper', sessionId: randomUUID() })
    const resumed = new PostgresRoomEventRepository(db.database)
    expect(await db.collaboration.get(orgId, surfaceId)).toBeDefined()
    expect(await db.collaboration.sessions(surfaceId)).toHaveLength(1)
    expect(await resumed.getRoomActorKey(orgId, 'human', actorId)).toBe(pubkey)
  })

  it('converges concurrent same-request re-signing and rejects changed retry', async () => {
    const first = input('Prepare the draft', 'message-1')
    const second = { ...first, event: event('Prepare the draft', surfaceId, [['dsh-request', 'message-1']]) }
    const committed = await Promise.all([db.roomEvents.append(first), db.roomEvents.append(second)])
    expect(committed[0]).toEqual(committed[1])
    expect([first.event.id, second.event.id]).toContain(committed[0]?.event.id)
    expect(await db.roomEvents.findByRequest(orgId, surfaceId, 'human', actorId, 'message-1'))
      .toEqual(committed[0])
    await expect(db.roomEvents.append(input('Changed draft', 'message-1'))).rejects.toThrow('idempotency')
    expect(await db.roomEvents.list(orgId, surfaceId)).toHaveLength(1)
  })

  it('pages by full precision sequence and enforces organization, surface and thread scope', async () => {
    const root = await db.roomEvents.append(input('Main research'))
    const reply = await db.roomEvents.append({ ...input('Source links'), threadRoot: root.event.id })
    const third = await db.roomEvents.append(input('Other topic'))
    expect((await db.roomEvents.list(orgId, surfaceId, { limit: 2 })).map(row => row.event.content))
      .toEqual(['Source links', 'Other topic'])
    expect((await db.roomEvents.list(orgId, surfaceId, { before: third.sequence, limit: 2 })).map(row => row.event.content))
      .toEqual(['Main research', 'Source links'])
    expect((await db.roomEvents.list(orgId, surfaceId, { after: reply.sequence })).map(row => row.event.content))
      .toEqual(['Other topic'])
    expect((await db.roomEvents.list(orgId, surfaceId, { threadRoot: root.event.id })).map(row => row.event.id))
      .toEqual([reply.event.id])
    expect(await db.roomEvents.getByEventId(otherOrgId, surfaceId, root.event.id)).toBeUndefined()
    expect(await db.roomEvents.getByEventId(orgId, otherSurfaceId, root.event.id)).toBeUndefined()
    expect(await db.roomEvents.list(otherOrgId, surfaceId)).toEqual([])
    expect(await db.roomEvents.list(orgId, otherSurfaceId)).toEqual([])
    expect(BigInt(third.sequence)).toBeGreaterThan(BigInt(reply.sequence))
  })

  it('searches only this room and deduplicates a native source cursor', async () => {
    const source = { sourceSessionId: randomUUID(), sourceEventCursor: '42' }
    const stored = await db.roomEvents.append({ ...input('Official release sources'), ...source })
    await db.roomEvents.append(input('Sales data'))
    const chinese = await db.roomEvents.append(input('张总要求对账结论'))
    expect((await db.roomEvents.search(orgId, surfaceId, 'release')).map(row => row.event.id))
      .toEqual([stored.event.id])
    expect((await db.roomEvents.search(orgId, surfaceId, '对账')).map(row => row.event.id))
      .toEqual([chinese.event.id])
    expect(await db.roomEvents.search(otherOrgId, surfaceId, 'release')).toEqual([])
    expect(await db.roomEvents.search(orgId, otherSurfaceId, 'release')).toEqual([])
    expect(await db.roomEvents.findBySourceCursor(orgId, surfaceId, source.sourceSessionId, source.sourceEventCursor))
      .toEqual(stored)
    const changed = { ...input('Other sources'), ...source }
    await expect(db.roomEvents.append(changed)).rejects.toThrow('idempotency')
  })

  it('requires the actor key and never replaces its original binding', async () => {
    await expect(db.roomEvents.ensureRoomActorKey({ orgId, actorKind: 'human', actorId,
      pubkey: randomBytes(32).toString('hex') })).rejects.toThrow('public key conflict')
    expect(await db.roomEvents.getRoomActorKey(orgId, 'human', actorId)).toBe(pubkey)
    await expect(db.roomEvents.append({ ...input('Forged'), event: { ...event('Forged'),
      pubkey: randomBytes(32).toString('hex') } })).rejects.toThrow('signature')
    expect(await db.roomEvents.list(orgId, surfaceId)).toEqual([])
  })

  it('rejects an event signed for another room and an out-of-range cursor', async () => {
    const wrongRoom = { ...input('Cross-room text'), event: event('Cross-room text', otherSurfaceId) }
    await expect(db.roomEvents.append(wrongRoom)).rejects.toThrow('room tag')
    await expect(db.roomEvents.list(orgId, surfaceId, { after: '9223372036854775808' })).rejects.toThrow('cursor')
  })

  it('moves task ownership once from a signed same-room handoff', async () => {
    const created = await db.roomEvents.append(input('Draft task assigned'))
    expect(await db.roomEvents.ensureTaskOwner(orgId, surfaceId, 'draft', 'research-bot', created.event.id))
      .toBe('research-bot')
    const botKey = generateSecretKey()
    await db.roomEvents.ensureRoomActorKey({ orgId, actorKind: 'employee', actorId: 'research-bot',
      pubkey: getPublicKey(botKey) })
    const handoffEvent = (target: string) => {
      const signed = finalizeEvent({ created_at: Math.floor(Date.now() / 1000), kind: 41001,
        tags: [['h', surfaceId], ['dsh', 'handoff'], ['task', 'draft'], ['target', target]],
        content: `Research to ${target} handoff` }, botKey)
      return { id: signed.id, pubkey: signed.pubkey, created_at: signed.created_at,
        kind: signed.kind, tags: signed.tags, content: signed.content, sig: signed.sig }
    }
    const handoff = await db.roomEvents.append({ orgId, surfaceId, event: handoffEvent('editor-bot'),
      authorKind: 'employee', authorId: 'research-bot' })
    const competing = await db.roomEvents.append({ orgId, surfaceId, event: handoffEvent('data-bot'),
      authorKind: 'employee', authorId: 'research-bot' })
    expect(await db.roomEvents.claimEventDispatch(orgId, surfaceId, handoff.event.id, Date.now(), 1000)).toEqual([])
    const moves = await Promise.all([
      db.roomEvents.transferOwner(orgId, surfaceId, 'draft', 'research-bot', 'editor-bot', handoff.event.id),
      db.roomEvents.transferOwner(orgId, surfaceId, 'draft', 'research-bot', 'data-bot', competing.event.id),
    ])
    expect(moves).toContain(true)
    expect(moves).toContain(false)
    const accepted = moves[0] ? handoff : competing
    const owner = moves[0] ? 'editor-bot' : 'data-bot'
    const rejected = moves[0] ? competing : handoff
    const claims = await db.roomEvents.claimEventDispatch(orgId, surfaceId, accepted.event.id, Date.now(), 1000)
    expect(claims.map(claim => claim.targetId)).toEqual([owner])
    expect(await db.roomEvents.claimEventDispatch(orgId, surfaceId, rejected.event.id, Date.now(), 1000)).toEqual([])
    expect(await db.roomEvents.transferOwner(orgId, surfaceId, 'draft', 'research-bot', owner, accepted.event.id)).toBe(true)
    expect(await db.roomEvents.transferOwner(orgId, otherSurfaceId, 'draft', owner, 'wrong-room', accepted.event.id)).toBe(false)
    expect(await db.roomEvents.ensureTaskOwner(orgId, surfaceId, 'draft', 'overwriter', created.event.id)).toBe(owner)
  })

  it('persists Bot targets with the event and recovers unacknowledged routes after restart', async () => {
    const signed = event('Please check', surfaceId, [['dsh-target', 'data-bot'], ['dsh-target', 'editor-bot'],
      ['dsh-request', 'multi-target']])
    const saved = await db.roomEvents.append({ ...input('Please check', 'multi-target'), event: signed })
    const first = await db.roomEvents.claimEventDispatch(orgId, surfaceId, saved.event.id, Date.now(), 1000)
    expect(first.map(claim => claim.targetId)).toEqual(['data-bot', 'editor-bot'])
    expect(first.every(claim => claim.event.event.id === saved.event.id && claim.leaseToken !== '')).toBe(true)
    const reopened = new PostgresRoomEventRepository(db.database)
    expect(await reopened.claimDispatch(Date.now(), 100, 1000)).toEqual([])
    expect(await reopened.completeDispatch(first[0]!)).toBe(true)
    expect(await reopened.releaseDispatch(first[1]!)).toBe(true)
    const retried = await reopened.claimDispatch(Date.now(), 100, 1000)
    expect(retried.map(claim => claim.targetId)).toEqual(['editor-bot'])
    expect(await reopened.completeDispatch(first[1]!)).toBe(false)
    expect(await reopened.completeDispatch(retried[0]!)).toBe(true)
    expect(await reopened.claimDispatch(Date.now() + 2000, 100, 1000)).toEqual([])
  })

  it('fences expired claims and prevents concurrent workers from owning one route', async () => {
    const saved = await db.roomEvents.append({ ...input('Review', 'review-1'),
      event: event('Review', surfaceId, [['dsh-target', 'editor-bot'], ['dsh-request', 'review-1']]) })
    const now = Date.now()
    const raced = await Promise.all([
      db.roomEvents.claimEventDispatch(orgId, surfaceId, saved.event.id, now, 1000),
      db.roomEvents.claimDispatch(now, 100, 1000),
    ])
    expect(raced.flat()).toHaveLength(1)
    const old = raced.flat()[0]!
    const recovered = await db.roomEvents.claimDispatch(now + 1001, 100, 1000)
    expect(recovered).toHaveLength(1)
    expect(recovered[0]?.leaseToken).not.toBe(old.leaseToken)
    expect(await db.roomEvents.completeDispatch(old)).toBe(false)
    expect(await db.roomEvents.releaseDispatch(old)).toBe(false)
    expect(await db.roomEvents.completeDispatch(recovered[0]!)).toBe(true)
  })

  it('rejects changed or ambiguous signed routes without adding dispatch rows', async () => {
    const first = await db.roomEvents.append({ ...input('Send to data', 'same-request'),
      event: event('Send to data', surfaceId, [['dsh-target', 'data-bot'], ['dsh-request', 'same-request']]) })
    await expect(db.roomEvents.append({ ...input('Send to data', 'same-request'),
      event: event('Send to data', surfaceId, [['dsh-target', 'editor-bot'], ['dsh-request', 'same-request']]) }))
      .rejects.toThrow('idempotency')
    const claims = await db.roomEvents.claimEventDispatch(orgId, surfaceId, first.event.id, Date.now(), 1000)
    expect(claims.map(claim => claim.targetId)).toEqual(['data-bot'])
    await expect(db.roomEvents.append({ ...input('Mixed'),
      event: event('Mixed', surfaceId, [['dsh-target', 'data-bot'], ['dsh-route', 'team']]) }))
      .rejects.toThrow('ambiguous')
    await expect(db.roomEvents.append({ ...input('Duplicate'),
      event: event('Duplicate', surfaceId, [['dsh-target', 'data-bot'], ['dsh-target', 'data-bot']]) }))
      .rejects.toThrow('target')
  })

  it('records signed Team and ingest routes and requires a member requester for service Bot routing', async () => {
    const team = await db.roomEvents.append({ ...input('Start charter'),
      event: event('Start charter', surfaceId, [['dsh-route', 'team']]) })
    const ingest = await db.roomEvents.append({ ...input('Announcement'),
      event: event('Announcement', surfaceId, [['dsh-route', 'ingest']]) })
    expect((await db.roomEvents.claimEventDispatch(orgId, surfaceId, team.event.id, Date.now(), 1000))[0])
      .toMatchObject({ targetKind: 'team', targetId: 'team' })
    expect((await db.roomEvents.claimEventDispatch(orgId, surfaceId, ingest.event.id, Date.now(), 1000))[0])
      .toMatchObject({ targetKind: 'ingest', targetId: 'ingest' })
    const serviceKey = generateSecretKey()
    await db.roomEvents.ensureRoomActorKey({ orgId, actorKind: 'service', actorId: 'channel-workflow',
      pubkey: getPublicKey(serviceKey) })
    const signed = finalizeEvent({ created_at: Math.floor(Date.now() / 1000), kind: 41000,
      tags: [['h', surfaceId], ['dsh', 'workflow'], ['step', 'bot-1'], ['dsh-target', 'editor-bot']],
      content: 'Draft release' }, serviceKey)
    const requested = { orgId, surfaceId, authorKind: 'service' as const, authorId: 'channel-workflow',
      event: { id: signed.id, pubkey: signed.pubkey, created_at: signed.created_at,
        kind: signed.kind, tags: signed.tags, content: signed.content, sig: signed.sig } }
    await expect(db.roomEvents.append(requested)).rejects.toThrow('requester')
    await expect(db.roomEvents.append({ ...requested, requestedByUserId: 'outsider' })).rejects.toThrow('unavailable')
    const stored = await db.roomEvents.append({ ...requested, requestedByUserId: actorId })
    expect((await db.roomEvents.claimEventDispatch(orgId, surfaceId, stored.event.id, Date.now(), 1000))[0])
      .toMatchObject({ targetKind: 'employee', targetId: 'editor-bot', requestedByUserId: actorId })
  })

  it('rejects forged append and altered persisted content before displaying it', async () => {
    const original = input('Approved release note')
    await expect(db.roomEvents.append({ ...original, event: { ...original.event,
      content: 'Changed after signing' } })).rejects.toThrow('signature')
    const stored = await db.roomEvents.append(original)
    await db.database.query(`UPDATE dsh_enterprise_collaboration_events
      SET event_json=jsonb_set(event_json,'{content}','"Changed after storage"') WHERE event_id=$1`, [stored.event.id])
    await expect(db.roomEvents.list(orgId, surfaceId)).rejects.toThrow('signature')
  })
  it('rejects request metadata that disagrees with the signed request tag', async () => {
    await expect(db.roomEvents.append({ ...input('Approve this', 'request-1'),
      requestId: 'request-2' })).rejects.toThrow('request')
  })
})
