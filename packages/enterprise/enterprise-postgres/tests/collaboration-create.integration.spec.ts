import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEnterprisePostgresComposition } from '../src/index.ts'
import type { EnterprisePostgresComposition, CollaborationRecord } from '../src/index.ts'

const url = process.env.DSH_TEST_POSTGRES_URL
describe.skipIf(url === undefined)('PostgreSQL collaboration creation retries', () => {
  let db: EnterprisePostgresComposition
  let input: Omit<CollaborationRecord, 'id'>
  let actor: string
  beforeEach(async () => {
    db = await createEnterprisePostgresComposition({ connectionString: url as string, cursorSigningKey: '0123456789abcdef0123456789abcdef' })
    const orgId = randomUUID(), workspaceId = randomUUID()
    actor = randomUUID()
    await db.database.query('INSERT INTO organizations(id,name) VALUES($1,$2)', [orgId, 'Create retry'])
    await db.database.query('INSERT INTO users(id,org_id,username,display_name,disabled) VALUES($1,$2,$1,$1,false)', [actor, orgId])
    await db.identity.saveWorkspaceGrant({ workspaceId, orgId, name: 'Shared', kind: 'personal', ownerUserId: actor,
      rootPath: '/tmp/collaboration-create', sandboxMode: 'workspace-write', expectedRevision: 0 })
    input = { orgId, workspaceId, kind: 'group', name: 'Support', memberUserIds: [actor], memberEmployeeIds: ['support'], dutyEmployeeIds: [] }
  })
  afterEach(async () => {
    await db.database.query('DELETE FROM dsh_enterprise_surface_directory WHERE org_id=$1', [input.orgId])
    await db.database.query('DELETE FROM enterprise_workspace_grants WHERE workspace_id=$1', [input.workspaceId])
    await db.database.query('DELETE FROM users WHERE org_id=$1', [input.orgId])
    await db.database.query('DELETE FROM organizations WHERE id=$1', [input.orgId])
    await db.close()
  })
  it('converges concurrent repeats on the same complete stored conversation', async () => {
    const options = { creatorUserId: actor, idempotencyKey: 'create-1' }
    const rows = await Promise.all([db.collaboration.create(input, options), db.collaboration.create(input, options)])
    expect(rows[0]).toEqual(rows[1])
    expect(await db.collaboration.list(input.orgId, actor)).toHaveLength(1)
  })
  it('rejects changed creation values without inserting another row or replacing the original', async () => {
    const options = { creatorUserId: actor, idempotencyKey: 'create-1' }
    const first = await db.collaboration.create(input, options)
    await expect(db.collaboration.create({ ...input, name: 'Changed' }, options)).rejects.toThrow('idempotency')
    expect(await db.collaboration.list(input.orgId, actor)).toEqual([first])
  })
  it('keeps the same key independent for different authenticated creators', async () => {
    const first = await db.collaboration.create(input, { creatorUserId: actor, idempotencyKey: 'create-1' })
    const second = await db.collaboration.create(input, { creatorUserId: 'other-creator', idempotencyKey: 'create-1' })
    expect(first.id).not.toBe(second.id)
  })
})
