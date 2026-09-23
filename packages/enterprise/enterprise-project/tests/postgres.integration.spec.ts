import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import {
  EnterpriseProjectRepository,
  ENTERPRISE_PROJECT_SCHEMA_VERSION,
  migrateEnterpriseProject,
  projectId,
  type PostgresDatabase,
  type PostgresQueryResult,
} from '../src/index.ts'

const databaseUrl = process.env.DSH_TEST_POSTGRES_URL

class PgTestDatabase implements PostgresDatabase {
  constructor(private readonly pool: Pool, private readonly client?: PoolClient) {}

  async query<Row extends Record<string, unknown>>(
    text: string, values: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    const result = await (this.client ?? this.pool).query<Row & QueryResultRow>(text, [...values])
    return { rows: result.rows, rowCount: result.rowCount }
  }

  async transaction<T>(operation: (database: PostgresDatabase) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const result = await operation(new PgTestDatabase(this.pool, client))
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
}

const pool = databaseUrl === undefined ? undefined : new Pool({ connectionString: databaseUrl })
const database = pool === undefined ? undefined : new PgTestDatabase(pool)

async function reset(): Promise<void> {
  await database?.query('DROP TABLE IF EXISTS project_members, projects, dsh_enterprise_project_meta CASCADE')
}

describe.skipIf(database === undefined)('enterprise project PostgreSQL', () => {
  beforeEach(async () => {
    await reset()
    // Minimal stand-in for the identity schema's `organizations` FK target; the
    // production composition runs `migrateEnterpriseIdentityPostgres` first.
    await database?.query('CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE)')
    await database?.query("INSERT INTO organizations(id, name) VALUES ('org-a', 'Project org') ON CONFLICT (id) DO NOTHING")
  })
  afterAll(async () => {
    await reset()
    await database?.query('DROP TABLE IF EXISTS organizations CASCADE')
    await pool?.end()
  })

  it('migrates v1 idempotently over a live database', async () => {
    await migrateEnterpriseProject(database!)
    await migrateEnterpriseProject(database!)

    const version = await database!.query<{ value: string }>(
      "SELECT value FROM dsh_enterprise_project_meta WHERE key = 'schema-version'",
    )
    expect(version.rows[0]?.value).toBe(String(ENTERPRISE_PROJECT_SCHEMA_VERSION))
  })

  it('keeps projects and members across a restart and enforces the organization foreign key', async () => {
    let tick = 10
    const first = new EnterpriseProjectRepository(database!, { now: () => { tick += 5; return tick } })
    const created = await first.createProject({
      projectId: projectId('project-pg'), orgId: 'org-a', name: 'Live', goal: 'Prove PG.',
      workspacePath: '/managed/projects/live', visibility: 'restricted', allowedUserIds: ['user-b'],
      createdBy: 'owner-a',
    })
    await first.insertMember(projectId('project-pg'), {
      principalType: 'employee', principalId: 'employee-a', addedBy: 'owner-a',
    })

    const restarted = new EnterpriseProjectRepository(database!)
    await expect(restarted.getProject(projectId('project-pg'))).resolves.toEqual(created)
    await expect(restarted.listMembers(projectId('project-pg'))).resolves.toHaveLength(2)
    await expect(restarted.createProject({
      projectId: projectId('project-orphan'), orgId: 'org-missing', name: 'Orphan', goal: 'No org.',
      workspacePath: '/managed/projects/orphan', visibility: 'organization', allowedUserIds: [],
      createdBy: 'owner-a',
    })).rejects.toThrow(/violates foreign key/)
  })

  it('archives once, guards membership, and cascades deletes from the organization', async () => {
    const projects = new EnterpriseProjectRepository(database!, { now: () => 20 })
    await projects.createProject({
      projectId: projectId('project-cycle'), orgId: 'org-a', name: 'Cycle', goal: 'Guard.',
      workspacePath: '/managed/projects/cycle', visibility: 'organization', allowedUserIds: [],
      createdBy: 'owner-a',
    })

    await expect(projects.insertMember(projectId('project-cycle'), {
      principalType: 'user', principalId: 'owner-a', addedBy: 'owner-a',
    })).rejects.toMatchObject({ code: 'conflict' })
    const archived = await projects.archiveProject(projectId('project-cycle'))
    expect(archived.state).toBe('archived')
    await expect(projects.insertMember(projectId('project-cycle'), {
      principalType: 'user', principalId: 'user-b', addedBy: 'owner-a',
    })).rejects.toMatchObject({ code: 'invalid-state' })

    await database!.query("DELETE FROM organizations WHERE id = 'org-a'")
    await expect(projects.getProject(projectId('project-cycle'))).resolves.toBeUndefined()
  })
})
