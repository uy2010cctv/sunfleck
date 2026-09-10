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
    source_event_seq: 7, failure_json: null, definition_snapshot_json: null,
    revision: 2, created_at: createdAt, updated_at: createdAt,
  }
}

function definitionRow(): Record<string, unknown> {
  return {
    org_id: 'org-a', team_id: 'team-a', name: 'Finance', north_star: 'Close.', owner_user_id: 'owner-a',
    department_id: null, visibility: 'organization', allowed_user_ids_json: null, leader_release_id: 'release-a',
    roster_json: [
      { actor: { kind: 'human', userId: 'owner-a' }, roleId: 'lead' },
      { actor: { kind: 'agent', employeeReleaseId: 'release-a' }, roleId: 'lead' },
    ],
    roles_json: [{ roleId: 'lead', name: 'Lead', responsibility: 'Lead.' }],
    verification_policy_json: {}, attention_policy_json: {}, approval_policy_json: {},
    state: 'active', revision: 4, created_at: 1, updated_at: 1,
  }
}

function grantRow(taskType: string, createdAt: number): Record<string, unknown> {
  return {
    org_id: 'org-a', team_id: 'team-a', employee_release_id: 'release-a', task_type: taskType,
    capability_scope: 'ledger.read', level: 'observe', granted_by: 'owner-a', evidence_refs_json: [],
    state: 'active', revision: 1, created_at: createdAt, updated_at: createdAt,
  }
}

function decisionRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    decision_id: 'decision-a', org_id: 'org-a', run_id: 'run-a', kind: 'approval', question: 'Proceed?',
    options_json: ['yes', 'no'], recommendation: null, context_digest: 'digest', assignee_user_id: 'member-a',
    state: 'open', answer: null, runtime_revision: 2, source_event_seq: 7, revision: 1,
    created_at: 10, updated_at: 10, response_operation_id: null, response_request_digest: null,
    response_idempotency_key: null, ...overrides,
  }
}

class TraceDatabase implements PostgresDatabase {
  readonly statements: string[] = []
  readonly values: readonly unknown[][] = []
  meta?: string
  rows: Record<string, unknown>[] = []
  definitionRows: Record<string, unknown>[] = []
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
    if (text.includes('FROM dsh_enterprise_team_autonomy_grants'))
      return { rows: this.rows as Row[], rowCount: this.rows.length }
    if (text.includes('FROM dsh_enterprise_team_decisions') || text.startsWith('UPDATE dsh_enterprise_team_decisions'))
      return { rows: this.rows as Row[], rowCount: this.rows.length }
    if (text.includes('FROM dsh_enterprise_team_definitions'))
      return { rows: this.definitionRows as Row[], rowCount: this.definitionRows.length }
    return { rows: [], rowCount: 0 }
  }
}

describe('enterprise TeamRun projection schema', () => {
  it('creates runtime-revisioned TeamRun, TeamDecision, and explicit autonomy-grant tables idempotently', async () => {
    const database = new TraceDatabase()
    database.meta = '11'
    await migrateEnterpriseOperations(database)
    await migrateEnterpriseOperations(database)
    const sql = database.statements.join('\n')
    expect(ENTERPRISE_OPERATIONS_SCHEMA_VERSION).toBe(16)
    expect(sql).toContain('dsh_enterprise_team_runs')
    expect(sql).toContain('dsh_enterprise_team_decisions')
    expect(sql).toContain('dsh_enterprise_team_autonomy_grants')
    expect(sql).toMatch(/runtime_revision/)
    expect(sql).toMatch(/source_event_seq/)
    expect(sql).toMatch(/legacy-definition-snapshot-unavailable/)
    expect(sql).toMatch(/definition_snapshot_json SET NOT NULL/)
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS dsh_enterprise_team_runs_created_page_idx/)
    expect(database.meta).toBe('16')
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

  it('treats an identical runtime revision as a no-op and fences divergent payload or root Session', async () => {
    const database = new TraceDatabase()
    database.meta = '12'
    database.rows = [runRow('run-a', 10)]
    const repository = new EnterpriseTeamControlRepository(database)
    await expect(repository.projectTeamRun({
      orgId: 'org-a', runId: 'run-a', expectedRevision: 2, state: 'active',
      rootSessionId: 'session-a', runtimeRevision: 2, sourceEventSeq: 7,
    })).resolves.toMatchObject({ revision: 2, state: 'active' })
    expect(database.statements.filter(statement => statement.startsWith('UPDATE dsh_enterprise_team_runs'))).toHaveLength(0)
    await expect(repository.projectTeamRun({
      orgId: 'org-a', runId: 'run-a', expectedRevision: 2, state: 'failed',
      rootSessionId: 'session-a', runtimeRevision: 2, sourceEventSeq: 7,
    })).rejects.toMatchObject({ code: 'fencing-lost' })
    await expect(repository.projectTeamRun({
      orgId: 'org-a', runId: 'run-a', expectedRevision: 2, state: 'active',
      rootSessionId: 'session-other', runtimeRevision: 3, sourceEventSeq: 8,
    })).rejects.toMatchObject({ code: 'invalid-state' })
  })

  it('locks and revalidates the active definition before freezing a run reservation', async () => {
    const database = new TraceDatabase()
    database.meta = '12'
    database.definitionRows = [definitionRow()]
    database.rows = [{
      ...runRow('run-fenced', 10), state: 'starting', root_session_id: null,
      runtime_revision: 0, source_event_seq: null, revision: 1,
      definition_snapshot_json: definitionRow(), roster_snapshot_json: definitionRow()['roster_json'],
    }]
    const repository = new EnterpriseTeamControlRepository(database)
    await expect(repository.createTeamRunStarting({
      orgId: 'org-a', teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'workspace-a',
      createdBy: 'owner-a', source: 'console', idempotencyKey: 'fenced', idempotencyFingerprint: 'digest',
    }, () => 'run-fenced')).resolves.toMatchObject({
      run: { runId: 'run-fenced', teamDefinitionRevision: 4 },
      definitionSnapshot: {
        revision: 4,
        // oxlint-disable-next-line typescript/no-unsafe-assignment -- Vitest asymmetric matcher.
        roster: expect.any(Array),
      }, created: true,
    })
    const teamLock = database.values.findIndex(values => values[0] === 'team:team-a')
    const definitionRead = database.statements.findIndex(statement =>
      statement.includes('dsh_enterprise_team_definitions') && statement.includes('FOR UPDATE'))
    const insert = database.statements.findIndex(statement => statement.startsWith('INSERT INTO dsh_enterprise_team_runs'))
    expect(teamLock).toBeGreaterThanOrEqual(0)
    expect(definitionRead).toBeGreaterThan(teamLock)
    expect(insert).toBeGreaterThan(definitionRead)
  })

  it('executes the autonomy composite cursor with the correct second-page placeholders', async () => {
    const database = new TraceDatabase()
    database.meta = '12'
    database.rows = [grantRow('newer', 20), grantRow('older', 10)]
    const repository = new EnterpriseTeamControlRepository(database, {
      cursorSigningKey: '0123456789abcdef0123456789abcdef',
    })
    const first = await repository.listAutonomyGrants({ orgId: 'org-a', readScope: viewer, limit: 1 })
    expect(first.nextCursor).toBeTypeOf('string')
    database.rows = [grantRow('older', 10)]
    await expect(repository.listAutonomyGrants({
      orgId: 'org-a', readScope: viewer, limit: 1, cursor: first.nextCursor,
    })).resolves.toMatchObject({ items: [{ taskType: 'older' }] })
    const sql = database.statements.at(-1)!.replace(/\s+/gu, '')
    expect(sql).toContain('<($4,$5,$6,$7,$8)')
    expect(database.values.at(-1)).toEqual([
      'org-a', 'viewer-a', false, 20, 'team-a', 'release-a', 'newer', 'ledger.read', 2,
    ])
  })

  it('requires canonical equality for an equal decision runtime revision and updates a higher revision', async () => {
    const database = new TraceDatabase()
    database.meta = '12'
    database.rows = [decisionRow()]
    const repository = new EnterpriseTeamControlRepository(database)
    const identical = {
      decisionId: 'decision-a', orgId: 'org-a', runId: 'run-a', kind: 'approval' as const,
      question: 'Proceed?', options: ['yes', 'no'], contextDigest: 'digest', assigneeUserId: 'member-a',
      state: 'open' as const, runtimeRevision: 2, sourceEventSeq: 7, revision: 1, createdAt: 10, updatedAt: 10,
    }
    await expect(repository.projectDecision(identical)).resolves.toMatchObject({ revision: 1 })
    expect(database.statements.filter(statement => statement.startsWith('UPDATE dsh_enterprise_team_decisions')))
      .toHaveLength(0)
    await expect(repository.projectDecision({ ...identical, question: 'Different?' }))
      .rejects.toMatchObject({ code: 'conflict' })
    await repository.projectDecision({ ...identical, runtimeRevision: 3, question: 'Updated?' })
    expect(database.statements.some(statement => statement.startsWith('UPDATE dsh_enterprise_team_decisions'))).toBe(true)
  })

  it('requires the answer event runtime revision to increase strictly', async () => {
    const database = new TraceDatabase()
    database.meta = '12'
    database.rows = [decisionRow({
      response_operation_id: 'operation-a', response_request_digest: 'fingerprint-a',
      response_idempotency_key: 'answer-a',
    })]
    const repository = new EnterpriseTeamControlRepository(database)
    await repository.answerDecision({
      orgId: 'org-a', decisionId: 'decision-a', expectedRevision: 1, answer: 'yes', runtimeRevision: 2,
      idempotencyKey: 'answer-a', idempotencyFingerprint: 'fingerprint-a', operationId: 'operation-a',
    })
    const sql = database.statements.find(statement => statement.startsWith('UPDATE dsh_enterprise_team_decisions'))!
    expect(sql).toContain('runtime_revision<$2')
    expect(sql).not.toContain('runtime_revision<=$2')
  })
})
