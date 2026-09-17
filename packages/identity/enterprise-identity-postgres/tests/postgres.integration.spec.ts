import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Pool, type PoolClient, type QueryResult } from 'pg'
import {
  PgEnterpriseIdentityRepository,
  migrateEnterpriseIdentityPostgres,
  type PostgresDatabase,
  type PostgresQueryResult,
} from '../src/index.ts'

const url = process.env.DSH_TEST_POSTGRES_URL

class PgDatabase implements PostgresDatabase {
  constructor(private readonly client: PoolClient) {}
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    const result: QueryResult<Row> = await this.client.query<Row>(text, [...values])
    return { rows: result.rows, rowCount: result.rowCount }
  }
  async connect(): Promise<PostgresDatabase> { return this }
  release(): void {}
}

describe.skipIf(url === undefined)('enterprise identity PostgreSQL directory integration', () => {
  let pool: Pool
  let client: PoolClient
  let repository: PgEnterpriseIdentityRepository
  let schema: string

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 2 })
    client = await pool.connect()
    schema = `dsh_identity_test_${Date.now().toString(36)}`
    await client.query(`CREATE SCHEMA "${schema}"`)
    await client.query(`SET search_path TO "${schema}", public`)
    await migrateEnterpriseIdentityPostgres(new PgDatabase(client))
    repository = new PgEnterpriseIdentityRepository(new PgDatabase(client), { now: () => 1_700_000_000_000 })
    await repository.createOrganization({ id: 'org-a', name: 'Org A' })
    await repository.createUser({ id: 'user-1', orgId: 'org-a', username: 'alice', displayName: 'Alice', disabled: false })
  })

  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    client.release()
    await pool.end()
  })

  it('stores department membership and filters workspace grants', async () => {
    await repository.createUser({ id: 'user-2', orgId: 'org-a', username: 'bob', displayName: 'Bob', disabled: false })
    await repository.saveDepartment({ id: 'dept-ops', orgId: 'org-a', name: 'Operations', parentId: null, sortOrder: 0, expectedRevision: 0 })
    await repository.setUserDepartments({
      orgId: 'org-a', userId: 'user-1', departmentIds: ['dept-ops'], primaryDepartmentId: 'dept-ops', expectedRevision: 0,
    })
    await repository.saveWorkspaceGrant({
      workspaceId: 'workspace-alice', orgId: 'org-a', name: 'Alice workspace', kind: 'personal', ownerUserId: 'user-1',
      rootPath: '/managed/users/alice', sandboxMode: 'workspace-write', expectedRevision: 0,
    })
    await repository.saveWorkspaceGrant({
      workspaceId: 'workspace-ops', orgId: 'org-a', name: 'Operations shared', kind: 'department', departmentId: 'dept-ops',
      rootPath: '/managed/departments/ops', sandboxMode: 'read-only', expectedRevision: 0,
    })

    await expect(repository.listWorkspaceGrants({ orgId: 'org-a', userId: 'user-1' }))
      .resolves.toEqual([expect.objectContaining({ workspaceId: 'workspace-alice' }), expect.objectContaining({ workspaceId: 'workspace-ops' })])
    await expect(repository.listWorkspaceGrants({ orgId: 'org-a', userId: 'user-2' })).resolves.toEqual([])
    await repository.bindSessionWorkspace({
      sessionId: 'session-pg', workspaceId: 'workspace-alice', orgId: 'org-a', ownerUserId: 'user-1',
    })
    await expect(repository.sessionWorkspaceGrant('session-pg'))
      .resolves.toMatchObject({ workspaceId: 'workspace-alice', ownerUserId: 'user-1' })
    await expect(repository.sessionOwnerUserId('session-pg')).resolves.toBe('user-1')
  })

  it('renames an organization without changing its durable id', async () => {
    await repository.updateOrganization('org-a', 'Renamed Org A')

    await expect(repository.listOrganizations()).resolves.toContainEqual({ id: 'org-a', name: 'Renamed Org A' })
  })

  it('stores only reviewed enterprise memory in scoped queries', async () => {
    const proposed = await repository.proposeMemory({
      id: 'memory-pg', orgId: 'org-a', scope: 'organization', kind: 'business-fact',
      summary: '合同归档使用统一编号。', sourceDigest: 'c'.repeat(64), createdBy: 'user-1',
    })
    await expect(repository.listMemories({ orgId: 'org-a', statuses: ['approved'] })).resolves.toEqual([])
    await repository.reviewMemory({
      id: proposed.id, orgId: 'org-a', decision: 'approved', reviewedBy: 'user-1',
      reason: '制度已核验', expectedRevision: proposed.revision,
    })
    await expect(repository.listMemories({ orgId: 'org-a', statuses: ['approved'] }))
      .resolves.toEqual([expect.objectContaining({ id: 'memory-pg', sourceDigest: 'c'.repeat(64) })])
  })
})
