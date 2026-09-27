import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEnterprisePostgresComposition } from '../src/index.ts'
import type { EnterprisePostgresComposition } from '../src/index.ts'

const url = process.env.DSH_TEST_POSTGRES_URL
describe.skipIf(url === undefined)('PostgreSQL group administration storage', () => {
  let db: EnterprisePostgresComposition
  let orgId: string
  let workspaceId: string
  let surfaceId: string
  let admin: string
  let member: string
  let newcomer: string
  beforeEach(async () => {
    db = await createEnterprisePostgresComposition({ connectionString: url as string, cursorSigningKey: '0123456789abcdef0123456789abcdef' })
    orgId = randomUUID()
    workspaceId = randomUUID()
    admin = randomUUID()
    member = randomUUID()
    newcomer = randomUUID()
    await db.database.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [orgId, 'Group admin'])
    for (const userId of [admin, member, newcomer]) {
      await db.database.query('INSERT INTO users(id,org_id,username,display_name,disabled) VALUES($1,$2,$1,$1,false)', [userId, orgId])
    }
    await db.identity.saveWorkspaceGrant({ workspaceId, orgId, name: 'Shared', kind: 'personal', ownerUserId: admin,
      rootPath: '/tmp/collaboration-admin', sandboxMode: 'workspace-write', expectedRevision: 0 })
    const row = await db.collaboration.create({ orgId, workspaceId, kind: 'group', name: 'Support',
      memberUserIds: [admin, member], memberEmployeeIds: ['support'], dutyEmployeeIds: [] })
    surfaceId = row.id
  })
  afterEach(async () => {
    await db.database.query('DELETE FROM dsh_enterprise_surface_directory WHERE org_id=$1', [orgId])
    await db.database.query('DELETE FROM enterprise_workspace_grants WHERE workspace_id=$1', [workspaceId])
    await db.database.query('DELETE FROM users WHERE org_id=$1', [orgId])
    await db.database.query('DELETE FROM organizations WHERE id=$1', [orgId])
    await db.close()
  })
  it('renames one conversation inside its organization only', async () => {
    expect(await db.collaboration.rename(orgId, surfaceId, 'Renewed')).toBe(true)
    expect(await db.collaboration.get(orgId, surfaceId)).toMatchObject({ name: 'Renewed' })
    expect(await db.collaboration.rename(randomUUID(), surfaceId, 'Foreign')).toBe(false)
  })
  it('stores and removes the group announcement in the durable configuration', async () => {
    await db.collaboration.setAnnouncement(surfaceId, 'Review Friday')
    expect(await db.collaboration.get(orgId, surfaceId)).toMatchObject({ announcement: 'Review Friday' })
    await db.collaboration.setAnnouncement(surfaceId, undefined)
    expect(await db.collaboration.get(orgId, surfaceId)).not.toHaveProperty('announcement')
  })
  it('adds and removes human and employee members while mirroring the directory count', async () => {
    await db.collaboration.addMembers(surfaceId, { userIds: [newcomer], employeeIds: ['helper', 'support'] })
    expect(await db.collaboration.get(orgId, surfaceId)).toMatchObject({
      memberUserIds: [admin, member, newcomer].sort(), memberEmployeeIds: ['helper', 'support'] })
    await db.collaboration.removeMembers(surfaceId, { userIds: [member], employeeIds: ['support'] })
    const row = await db.collaboration.get(orgId, surfaceId)
    expect(row).toMatchObject({ memberUserIds: [admin, newcomer].sort(), memberEmployeeIds: ['helper'] })
    const count = await db.database.query<{ member_count: number }>(
      'SELECT member_count FROM dsh_enterprise_surface_directory WHERE surface_id=$1', [surfaceId])
    expect(count.rows[0]?.member_count).toBe(1)
  })
})
