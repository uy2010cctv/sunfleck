import { randomUUID } from 'node:crypto'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEnterprisePostgresComposition } from '../src/index.ts'
import type { EnterprisePostgresComposition } from '../src/index.ts'
import { migrateChannelWorkflows, PostgresChannelWorkflowLedger } from '../src/collaboration-workflows.ts'

const url = process.env.DSH_TEST_POSTGRES_URL
describe.skipIf(url === undefined)('PostgreSQL channel workflow receipts', () => {
  let db: EnterprisePostgresComposition
  let orgId: string
  let surfaceId: string
  let workspaceId: string
  let userId: string

  beforeEach(async () => {
    db = await createEnterprisePostgresComposition({ connectionString: url as string,
      cursorSigningKey: '0123456789abcdef0123456789abcdef' })
    await migrateChannelWorkflows(db.database)
    orgId = randomUUID(); workspaceId = randomUUID(); userId = randomUUID()
    await db.database.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [orgId, 'Channel workflows'])
    await db.database.query('INSERT INTO users(id,org_id,username,display_name,disabled) VALUES($1,$2,$1,$1,false)',
      [userId, orgId])
    await db.identity.saveWorkspaceGrant({ workspaceId, orgId, name: 'Shared', kind: 'personal',
      ownerUserId: userId, rootPath: '/tmp/channel-workflows', sandboxMode: 'workspace-write', expectedRevision: 0 })
    surfaceId = (await db.collaboration.create({ orgId, workspaceId, kind: 'channel', name: 'Releases',
      memberUserIds: [userId], memberEmployeeIds: [], dutyEmployeeIds: [], topicPolicy: 'thread',
      respondPolicy: 'ingest_only' })).id
  })

  afterEach(async () => {
    await db.database.query('DELETE FROM dsh_enterprise_approval_requests WHERE org_id=$1', [orgId])
    await db.database.query('DELETE FROM dsh_enterprise_surface_directory WHERE surface_id=$1', [surfaceId])
    await db.database.query('DELETE FROM enterprise_workspace_grants WHERE workspace_id=$1', [workspaceId])
    await db.database.query('DELETE FROM users WHERE id=$1', [userId])
    await db.database.query('DELETE FROM organizations WHERE id=$1', [orgId])
    await db.close()
  })

  it('saves revisions, reserves one trigger, and takes a decision exactly once', async () => {
    const ledger = new PostgresChannelWorkflowLedger(db.database, orgId)
    const first = await ledger.save({ channelId: surfaceId, id: 'release', yaml: 'version: 1',
      expectedRevision: 0, createdBy: userId })
    expect(first.revision).toBe(1)
    await expect(ledger.save({ channelId: surfaceId, id: 'release', yaml: 'changed',
      expectedRevision: 0, createdBy: userId })).rejects.toThrow('revision')
    expect((await ledger.list(surfaceId)).map(row => row.yaml)).toEqual(['version: 1'])
    await ledger.save({ channelId: surfaceId, id: 'release', yaml: 'version: 2',
      expectedRevision: 1, createdBy: userId })
    const run = { channelId: surfaceId, workflowId: 'release', revision: 2, sourceEventId: 'tag-1' }
    const decisionId = randomUUID()
    const leaseToken = await ledger.reserve(run, 60_000)
    expect(leaseToken).toBeTypeOf('string')
    expect(await ledger.state(run)).toBe('reserved')
    expect(await ledger.reserve(run, 60_000)).toBeUndefined()
    if (leaseToken === undefined) throw new Error('workflow run not reserved')
    await ledger.record({ ...run, leaseToken }, { state: 'waiting-human', decisionId, nextStep: 2 })
    expect(await ledger.state(run)).toBe('waiting-human')
    await db.operations.createApprovalRequest({ approvalId: decisionId, orgId, kind: 'business',
      subjectType: 'channel-workflow', subjectId: surfaceId, requestedBy: userId,
      idempotencyKey: `create-${decisionId}` })
    expect(await ledger.pendingDecisions(surfaceId)).toEqual([expect.objectContaining({
      approvalId: decisionId, revision: 1, workflowRevision: 2, yaml: 'version: 2', nextStep: 2,
      requestedBy: userId, state: 'pending',
    })])
    await db.operations.transitionApproval({ approvalId: decisionId, orgId, state: 'approved',
      reviewerUserId: userId, expectedRevision: 1, idempotencyKey: `approve-${decisionId}` })
    expect(await PostgresChannelWorkflowLedger.decisionsReady(db.database, 10)).toContainEqual(
      expect.objectContaining({ orgId, channelId: surfaceId, approvalId: decisionId,
        state: 'approved', reviewerUserId: userId }))
    const claimedDecision = await ledger.takeDecision(surfaceId, decisionId, 60_000)
    expect(claimedDecision).toMatchObject({ run, nextStep: 2 })
    expect(await ledger.takeDecision(surfaceId, decisionId, 60_000)).toBeUndefined()
    if (claimedDecision === undefined) throw new Error('decision not claimed')
    await ledger.releaseDecision(claimedDecision.run)
    const resumed = await ledger.takeDecision(surfaceId, decisionId, 60_000)
    expect(resumed).toMatchObject({ run, nextStep: 2 })
    if (resumed === undefined) throw new Error('decision not resumed')
    await ledger.record(resumed.run, { state: 'completed' })
    expect((await PostgresChannelWorkflowLedger.decisionsReady(db.database, 10))
      .some(value => value.approvalId === decisionId)).toBe(false)
    expect(await ledger.reserve(run, 60_000)).toBeUndefined()
  })

  it('keeps workflow reads scoped to their organization', async () => {
    const ledger = new PostgresChannelWorkflowLedger(db.database, orgId)
    await ledger.save({ channelId: surfaceId, id: 'release', yaml: 'version: 1',
      expectedRevision: 0, createdBy: userId })
    const foreign = new PostgresChannelWorkflowLedger(db.database, randomUUID())
    expect(await foreign.list(surfaceId)).toEqual([])
    await expect(foreign.save({ channelId: surfaceId, id: 'other', yaml: 'version: 1',
      expectedRevision: 0, createdBy: userId })).rejects.toThrow('channel')
    expect(await PostgresChannelWorkflowLedger.gitSubscriptions(db.database)).toContainEqual({
      orgId, channelId: surfaceId, workflowId: 'release', revision: 1,
      yaml: 'version: 1', createdBy: userId,
    })
  })

  it('uses the latest saved editor for future scheduled and Git actions', async () => {
    const ledger = new PostgresChannelWorkflowLedger(db.database, orgId)
    const replacement = randomUUID()
    await db.database.query('INSERT INTO users(id,org_id,username,display_name,disabled) VALUES($1,$2,$1,$1,false)',
      [replacement, orgId])
    await ledger.save({ channelId: surfaceId, id: 'release', yaml: 'version: 1',
      expectedRevision: 0, createdBy: userId })
    await ledger.save({ channelId: surfaceId, id: 'release', yaml: 'version: 2',
      expectedRevision: 1, createdBy: replacement })
    expect((await PostgresChannelWorkflowLedger.gitSubscriptions(db.database))
      .find(value => value.channelId === surfaceId && value.workflowId === 'release')?.createdBy).toBe(replacement)
  })

  it('fences a worker whose reservation expired before another worker claimed it', async () => {
    const ledger = new PostgresChannelWorkflowLedger(db.database, orgId)
    await ledger.save({ channelId: surfaceId, id: 'release', yaml: 'version: 1',
      expectedRevision: 0, createdBy: userId })
    const run = { channelId: surfaceId, workflowId: 'release', revision: 1, sourceEventId: randomUUID() }
    const stale = await ledger.reserve(run, 60_000)
    if (stale === undefined) throw new Error('first reservation missing')
    await db.database.query(`UPDATE dsh_enterprise_channel_workflow_runs SET lease_until=0
      WHERE surface_id=$1 AND workflow_id=$2`, [surfaceId, 'release'])
    const current = await ledger.reserve(run, 60_000)
    expect(current).toBeTypeOf('string')
    expect(current).not.toBe(stale)
    await expect(ledger.record({ ...run, leaseToken: stale }, { state: 'completed' })).rejects.toThrow('lease')
    expect(await ledger.state(run)).toBe('reserved')
    if (current === undefined) throw new Error('new reservation missing')
    await ledger.record({ ...run, leaseToken: current }, { state: 'completed' })
    expect(await ledger.state(run)).toBe('completed')
  })

  it('retains a due occurrence across process restart until acknowledged', async () => {
    const ledger = new PostgresChannelWorkflowLedger(db.database, orgId)
    const now = Date.now()
    await ledger.save({ channelId: surfaceId, id: 'overnight', yaml: 'version: 1',
      expectedRevision: 0, createdBy: userId, schedules: [{ triggerIndex: 0, scheduleId: 'nightly',
        nextDueAt: now - 1000, intervalSeconds: 86400 }] })
    expect(await PostgresChannelWorkflowLedger.dueOrganizations(db.database, now)).toContain(orgId)
    expect(await ledger.stageDue(now, 10)).toBe(1)
    const first = await ledger.takeDue(now, 10)
    expect(first).toHaveLength(1)
    expect(first[0]).toMatchObject({ channelId: surfaceId, workflowId: 'overnight',
      revision: 1, scheduleId: 'nightly', createdBy: userId })
    expect(first[0]?.sourceEventId).toMatch(/^[0-9a-f]{64}$/u)
    expect(await ledger.takeDue(now, 10)).toEqual([])
    const reopened = new PostgresChannelWorkflowLedger(db.database, orgId)
    expect((await reopened.takeDue(now + 61_000, 10)).map(value => value.sourceEventId))
      .toEqual(first.map(value => value.sourceEventId))
    await reopened.completeDue(first[0]!.sourceEventId)
    expect(await reopened.takeDue(now + 122_000, 10)).toEqual([])
  })

  it('queues a signed human message trigger atomically with its room event', async () => {
    const ledger = new PostgresChannelWorkflowLedger(db.database, orgId)
    await ledger.save({ channelId: surfaceId, id: 'review',
      yaml: 'version: 1\nname: Review\non:\n  - type: message\n    contains: release\nsteps:\n  - type: room_post\n    text: Received',
      expectedRevision: 0, createdBy: userId })
    const secret = generateSecretKey()
    await db.roomEvents.ensureRoomActorKey({ orgId, actorKind: 'human', actorId: userId,
      pubkey: getPublicKey(secret) })
    const signed = finalizeEvent({ kind: 9, created_at: Math.floor(Date.now() / 1000),
      tags: [['h', surfaceId]], content: 'Please review this release' }, secret)
    const saved = await db.roomEvents.append({ orgId, surfaceId, authorKind: 'human', authorId: userId,
      event: { id: signed.id, pubkey: signed.pubkey, created_at: signed.created_at, kind: signed.kind,
        tags: signed.tags, content: signed.content, sig: signed.sig } })
    await ledger.save({ channelId: surfaceId, id: 'review',
      yaml: 'version: 1\nname: Changed\non:\n  - type: message\n    contains: release\nsteps:\n  - type: room_post\n    text: New action',
      expectedRevision: 1, createdBy: userId })
    const first = await PostgresChannelWorkflowLedger.claimRoomTriggerForEvent(db.database,
      orgId, surfaceId, saved.event.id, Date.now(), 60_000)
    expect(first).toMatchObject({ orgId, channelId: surfaceId, eventId: saved.event.id, authorId: userId,
      revisions: [{ id: 'review', revision: 1 }] })
    expect((await ledger.listRevisions(surfaceId, first!.revisions)).map(value => value.yaml))
      .toEqual(['version: 1\nname: Review\non:\n  - type: message\n    contains: release\nsteps:\n  - type: room_post\n    text: Received'])
    expect(await PostgresChannelWorkflowLedger.claimRoomTriggerForEvent(db.database,
      orgId, surfaceId, saved.event.id, Date.now(), 60_000)).toBeUndefined()
    await PostgresChannelWorkflowLedger.releaseRoomTrigger(db.database, first!)
    const replay = await PostgresChannelWorkflowLedger.claimRoomTriggers(db.database, Date.now(), 10, 60_000)
    expect(replay.map(value => value.eventId)).toContain(saved.event.id)
    const recovered = replay.find(value => value.eventId === saved.event.id)
    if (recovered === undefined) throw new Error('room trigger missing')
    await PostgresChannelWorkflowLedger.completeRoomTrigger(db.database, recovered)
    expect((await PostgresChannelWorkflowLedger.claimRoomTriggers(db.database, Date.now(), 10, 60_000))
      .some(value => value.eventId === saved.event.id)).toBe(false)
  })
})
