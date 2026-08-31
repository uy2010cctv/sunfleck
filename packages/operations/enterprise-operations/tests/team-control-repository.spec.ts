import { describe, expect, it } from 'vitest'
import {
  ENTERPRISE_OPERATIONS_SCHEMA_VERSION,
  EnterpriseTeamControlRepository,
  migrateEnterpriseOperations,
  type PostgresDatabase,
  type PostgresQueryResult,
} from '../src/index.ts'

const viewer = { userId: 'viewer-a', isAdministrator: false }

function runRow(runId: string, createdAt: number): Record<string, unknown> {
  return {
    run_id: runId, org_id: 'org-a', team_id: 'team-a', team_definition_revision: 4,
    workspace_id: 'workspace-a', root_session_id: 'session-a', roster_snapshot_json: [],
    created_by: 'owner-a', source: 'console', state: 'active', runtime_revision: 2,
    source_event_seq: 7, failure_json: null, revision: 2, created_at: createdAt, updated_at: createdAt,
  }
}

class TraceDatabase implements PostgresDatabase {
  readonly statements: string[] = []
  readonly values: readonly unknown[][] = []
  meta?: string
  rows: Record<string, unknown>[] = []
  async transaction<T>(operation: (database: PostgresDatabase) => Promise<T>): Promise<T> { return operation(this) }
  async query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<PostgresQueryResult<Row>> {
    this.statements.push(text); (this.values as unknown[][]).push([...values])
    if (text.startsWith('SELECT value FROM dsh_enterprise_operations_meta'))
      return { rows: (this.meta === undefined ? [] : [{ value: this.meta }]) as Row[], rowCount: this.meta === undefined ? 0 : 1 }
    if (text.startsWith('INSERT INTO dsh_enterprise_operations_meta') || text.startsWith('UPDATE dsh_enterprise_operations_meta')) {
      this.meta = String(values[0]); return { rows: [], rowCount: 0 }
    }
    if (text.includes('FROM dsh_enterprise_team_runs') || text.includes('INSERT INTO dsh_enterprise_team_runs')
      || text.includes('UPDATE dsh_enterprise_team_runs')) return { rows: this.rows as Row[], rowCount: this.rows.length }
    return { rows: [], rowCount: 0 }
  }
}

describe('enterprise TeamRun projection schema', () => {
  it('creates runtime-revisioned TeamRun, TeamDecision, and explicit autonomy-grant tables idempotently', async () => {
    const database = new TraceDatabase()
    await migrateEnterpriseOperations(database)
    await migrateEnterpriseOperations(database)
    const sql = database.statements.join('\n')
    expect(ENTERPRISE_OPERATIONS_SCHEMA_VERSION).toBe(11)
    expect(sql).toContain('dsh_enterprise_team_runs')
    expect(sql).toContain('dsh_enterprise_team_decisions')
    expect(sql).toContain('dsh_enterprise_team_autonomy_grants')
    expect(sql).toMatch(/runtime_revision/)
    expect(sql).toMatch(/source_event_seq/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS dsh_enterprise_team_runs_created_page_idx/)
    expect(database.meta).toBe('11')
  })

  it('rejects invalid limits before querying a projection page', async () => {
    const database = new TraceDatabase()
    const repository = new EnterpriseTeamControlRepository(database, {
      cursorSigningKey: '0123456789abcdef0123456789abcdef',
    })
    await expect(repository.listTeamRuns({ orgId: 'org-a', readScope: viewer, limit: 0 })).rejects.toThrow(/1 to 100/)
    await expect(repository.listDecisions({ orgId: 'org-a', readScope: viewer, limit: 101 })).rejects.toThrow(/1 to 100/)
    await expect(repository.listAutonomyGrants({ orgId: 'org-a', readScope: viewer, limit: 1.5 })).rejects.toThrow(/1 to 100/)
  })

  it('maps organization-scoped run projections without accepting browser runtime fields', async () => {
    const database = new TraceDatabase()
    database.meta = '11'
    database.rows = [{
      run_id: 'run-a', org_id: 'org-a', team_id: 'team-a', team_definition_revision: 4,
      workspace_id: 'workspace-a', root_session_id: 'session-a', roster_snapshot_json: [],
      created_by: 'owner-a', source: 'console', state: 'active', runtime_revision: 2,
      source_event_seq: 7, failure_json: null, revision: 2, created_at: 10, updated_at: 11,
    }]
    const repository = new EnterpriseTeamControlRepository(database, {
      cursorSigningKey: '0123456789abcdef0123456789abcdef',
    })
    await expect(repository.getTeamRun('org-a', 'run-a')).resolves.toEqual({
      runId: 'run-a', orgId: 'org-a', teamId: 'team-a', teamDefinitionRevision: 4,
      workspaceId: 'workspace-a', rootSessionId: 'session-a', rosterSnapshot: [], createdBy: 'owner-a',
      source: 'console', state: 'active', runtimeRevision: 2, sourceEventSeq: 7,
      revision: 2, createdAt: 10, updatedAt: 11,
    })
    expect(database.values.at(-1)).toEqual(['org-a', 'run-a'])
  })

  it('signs stable projection cursors and binds them to organization, viewer, and filters', async () => {
    const database = new TraceDatabase()
    database.meta = '11'
    database.rows = [runRow('run-b', 20), runRow('run-a', 10)]
    const repository = new EnterpriseTeamControlRepository(database, {
      cursorSigningKey: '0123456789abcdef0123456789abcdef',
    })
    const first = await repository.listTeamRuns({
      orgId: 'org-a', readScope: viewer, state: 'active', limit: 1,
    })
    expect(first.items.map(item => item.runId)).toEqual(['run-b'])
    expect(first.nextCursor).toBeTypeOf('string')
    database.rows = [runRow('run-a', 10)]
    await expect(repository.listTeamRuns({
      orgId: 'org-a', readScope: viewer, state: 'active', limit: 1, cursor: first.nextCursor,
    })).resolves.toMatchObject({ items: [{ runId: 'run-a' }] })
    const cursor = first.nextCursor!
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('a') ? 'b' : 'a'}`
    await expect(repository.listTeamRuns({
      orgId: 'org-a', readScope: viewer, state: 'active', limit: 1, cursor: tampered,
    })).rejects.toMatchObject({ code: 'cursor-invalid' })
    for (const changed of [
      { orgId: 'org-b', readScope: viewer, state: 'active' as const },
      { orgId: 'org-a', readScope: { userId: 'viewer-b', isAdministrator: false }, state: 'active' as const },
      { orgId: 'org-a', readScope: viewer, state: 'failed' as const },
    ]) {
      await expect(repository.listTeamRuns({ ...changed, limit: 1, cursor }))
        .rejects.toMatchObject({ code: 'cursor-invalid' })
    }
  })

  it('pushes run, decision, and grant visibility into SQL before limit with minimal read scope', async () => {
    const database = new TraceDatabase()
    database.meta = '11'
    const repository = new EnterpriseTeamControlRepository(database, {
      cursorSigningKey: '0123456789abcdef0123456789abcdef',
    })
    await repository.listTeamRuns({ orgId: 'org-a', readScope: viewer, limit: 10 })
    await repository.listDecisions({ orgId: 'org-a', readScope: viewer, limit: 10 })
    await repository.listAutonomyGrants({ orgId: 'org-a', readScope: viewer, limit: 10 })
    const projectionSql = database.statements.filter(statement =>
      statement.startsWith('SELECT run.*') || statement.startsWith('SELECT decision.*')
      || statement.startsWith('SELECT autonomy.*'))
    expect(projectionSql).toHaveLength(3)
    for (const sql of projectionSql) {
      expect(sql).toContain('JOIN dsh_enterprise_team_definitions definition')
      expect(sql.indexOf('definition.visibility')).toBeLessThan(sql.indexOf('LIMIT'))
    }
    expect(database.values.slice(-3)).toEqual([
      ['org-a', 'viewer-a', false, 11],
      ['org-a', 'viewer-a', false, 11],
      ['org-a', 'viewer-a', false, 11],
    ])
    database.rows = [runRow('run-visible', 30)]
    await repository.getTeamRun('org-a', 'run-visible', viewer)
    expect(database.statements.at(-1)).toContain('JOIN dsh_enterprise_team_definitions definition')
    expect(database.values.at(-1)).toEqual(['org-a', 'run-visible', 'viewer-a', false])
  })
})
