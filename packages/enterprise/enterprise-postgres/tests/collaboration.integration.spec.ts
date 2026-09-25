import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createEnterprisePostgresComposition } from '../src/index.ts'

const url = process.env.DSH_TEST_POSTGRES_URL
describe.skipIf(url === undefined)('PostgreSQL collaboration persistence', () => {
  it('persists member-scoped conversations, topics, and shared native authorization across repository instances', async () => {
    const db = await createEnterprisePostgresComposition({ connectionString: url as string, cursorSigningKey: '0123456789abcdef0123456789abcdef' })
    const org = randomUUID(), alice = randomUUID(), bob = randomUUID(), workspace = randomUUID(), session = randomUUID()
    let surface: string | undefined
    try {
      await db.database.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [org, 'Collaboration test'])
      for (const id of [alice, bob]) await db.database.query('INSERT INTO users(id,org_id,username,display_name,disabled) VALUES($1,$2,$1,$1,false)', [id, org])
      await db.identity.saveWorkspaceGrant({ workspaceId: workspace, orgId: org, name: 'Shared', kind: 'personal', ownerUserId: alice, rootPath: '/tmp/collaboration-test', sandboxMode: 'workspace-write', expectedRevision: 0 })
      const row = await db.collaboration.create({ orgId: org, kind: 'channel', name: 'Support', workspaceId: workspace, memberEmployeeIds: ['support'], memberUserIds: [alice, bob], dutyEmployeeIds: ['support'], topicPolicy: 'thread', respondPolicy: 'mention_duty' })
      surface = row.id
      expect(await db.collaboration.list(org, alice)).toEqual([row])
      expect(await db.collaboration.list(org, 'outsider')).toEqual([])
      expect(await db.collaboration.get('foreign', row.id)).toBeUndefined()
      await db.collaboration.ensureTopic(row.id, 'issue', 'Issue')
      await db.collaboration.bind({ surfaceId: row.id, topicId: 'issue', employeeId: 'support', sessionId: session })
      expect(await db.collaboration.topics(row.id))
        .toEqual([{ id: 'issue', title: 'Issue', state: 'open', sessionId: session, destinations: [{ sessionId: session, employeeId: 'support' }] }])
      expect(await db.identity.collaborationSessionAccess({ orgId: org, userId: bob, sessionId: session }))
        .toEqual({ orgId: org, workspaceId: workspace, member: true })
      expect(await db.identity.collaborationSessionAccess({ orgId: 'foreign', userId: bob, sessionId: session }))
        .toEqual({ orgId: org, workspaceId: workspace, member: false })
      expect(await db.identity.collaborationSessionAccess({ orgId: org, userId: 'outsider', sessionId: session }))
        .toEqual({ orgId: org, workspaceId: workspace, member: false })
      expect(await db.collaboration.settle(row.id, 'issue')).toBe(true)
      expect(await db.collaboration.settle(row.id, 'issue')).toBe(false)
      await db.collaboration.ensureTopic(row.id, 'issue', 'Do not reopen')
      expect((await db.collaboration.topics(row.id))[0]?.state).toBe('settled')
      await db.database.query('DELETE FROM dsh_enterprise_collaboration_members WHERE surface_id=$1 AND user_id=$2', [row.id, bob])
      expect(await db.identity.collaborationSessionAccess({ orgId: org, userId: bob, sessionId: session }))
        .toEqual({ orgId: org, workspaceId: workspace, member: false })
    } finally {
      if (surface !== undefined) await db.database.query('DELETE FROM dsh_enterprise_surface_directory WHERE surface_id=$1', [surface])
      await db.database.query('DELETE FROM enterprise_workspace_grants WHERE workspace_id=$1', [workspace])
      await db.database.query('DELETE FROM users WHERE org_id=$1', [org])
      await db.database.query('DELETE FROM organizations WHERE id=$1', [org])
      await db.close()
    }
  })
})
