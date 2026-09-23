/* eslint-disable typescript/no-base-to-string -- SQL test-double stringifies primitive query parameters. */
/**
 * Transactional in-memory PostgreSQL double for the enterprise project
 * repository and service suites. It mirrors the statement surface of
 * `src/repository.ts` and `src/schema.ts` exactly; an unmatched statement
 * throws so schema drift fails loudly.
 */

import type { PostgresDatabase, PostgresQueryResult } from '../src/index.ts'

/** Mutable mirror of one `projects` row. */
export interface SeededProjectRow extends Record<string, unknown> {
  project_id: string
  org_id: string
  name: string
  goal: string
  workspace_path: string
  team_definition_id: string | null
  state: string
  visibility: string
  allowed_user_ids: string
  created_by: string
  created_at: number
  archived_at: number | null
}

/** Mutable mirror of one `project_members` row. */
export interface SeededMemberRow extends Record<string, unknown> {
  project_id: string
  principal_type: string
  principal_id: string
  added_by: string
  added_at: number
}

/** One valid stored project row that individual tests may override. */
export function projectRow(overrides: Partial<SeededProjectRow> = {}): SeededProjectRow {
  return {
    project_id: 'project-a', org_id: 'org-a', name: 'Support', goal: 'Ship support.',
    workspace_path: '/managed/projects/support', team_definition_id: null, state: 'active',
    visibility: 'organization', allowed_user_ids: '[]', created_by: 'owner-a',
    created_at: 10, archived_at: null, ...overrides,
  }
}

/** One valid stored member row that individual tests may override. */
export function memberRow(overrides: Partial<SeededMemberRow> = {}): SeededMemberRow {
  return {
    project_id: 'project-a', principal_type: 'user', principal_id: 'owner-a',
    added_by: 'owner-a', added_at: 10, ...overrides,
  }
}

/** Serializing in-memory database double keyed on the package's SQL statements. */
export class MemoryProjectDatabase implements PostgresDatabase {
  private readonly meta = new Map<string, string>()
  private readonly projects = new Map<string, SeededProjectRow>()
  private readonly members = new Map<string, SeededMemberRow>()
  private tail: Promise<unknown> = Promise.resolve()
  /** When set, the next project INSERT or archive UPDATE returns no row, like a storage failure. */
  failNextProjectWrite = false

  constructor(schemaVersion?: string) {
    if (schemaVersion !== undefined) this.meta.set('schema-version', schemaVersion)
  }

  /** The stamped schema version, for migration assertions. */
  get schemaVersion(): string | undefined { return this.meta.get('schema-version') }

  /** Insert one raw project row directly, bypassing the repository, for row-parse tests. */
  seedProject(row: SeededProjectRow): void { this.projects.set(row.project_id, structuredClone(row)) }

  /** Insert one raw member row directly, bypassing the repository, for row-parse tests. */
  seedMember(row: SeededMemberRow): void {
    this.members.set(`${row.project_id}:${row.principal_type}:${row.principal_id}`, structuredClone(row))
  }

  async transaction<T>(operation: (database: PostgresDatabase) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const checkpoint = {
        meta: [...this.meta], projects: [...this.projects], members: [...this.members],
      }
      try {
        return await operation(this)
      } catch (error: unknown) {
        this.restore(checkpoint)
        throw error
      }
    })
    this.tail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    const rows = this.rows(text, values)
    return { rows: rows as Row[], rowCount: rows.length }
  }

  private rows(text: string, values: readonly unknown[]): Record<string, unknown>[] {
    if (text.startsWith('CREATE ') || text.startsWith('SELECT pg_advisory_xact_lock')) return []
    if (text.startsWith('SELECT value FROM dsh_enterprise_project_meta')) {
      const value = this.meta.get('schema-version')
      return value === undefined ? [] : [{ value }]
    }
    if (text.startsWith('INSERT INTO dsh_enterprise_project_meta')) {
      this.meta.set('schema-version', String(values[0]))
      return []
    }
    if (text.startsWith('SELECT project_id FROM projects WHERE project_id=$1 FOR UPDATE')) {
      const row = this.projects.get(String(values[0]))
      return row === undefined ? [] : [{ project_id: row.project_id }]
    }
    if (text.startsWith('SELECT * FROM projects WHERE project_id=$1 FOR UPDATE')) {
      const row = this.projects.get(String(values[0]))
      return row === undefined ? [] : [structuredClone(row)]
    }
    if (text.startsWith('SELECT * FROM projects WHERE project_id=$1')) {
      const row = this.projects.get(String(values[0]))
      return row === undefined ? [] : [structuredClone(row)]
    }
    if (text.startsWith('SELECT * FROM projects WHERE org_id=$1')) {
      return [...this.projects.values()]
        .filter(row => row.org_id === String(values[0]))
        .sort((left, right) => left.created_at - right.created_at || left.project_id.localeCompare(right.project_id))
        .map(row => structuredClone(row))
    }
    if (text.startsWith('SELECT project_id FROM projects WHERE project_id=$1')) {
      const row = this.projects.get(String(values[0]))
      return row === undefined ? [] : [{ project_id: row.project_id }]
    }
    if (text.startsWith('INSERT INTO projects(')) {
      if (this.failNextProjectWrite) {
        this.failNextProjectWrite = false
        return []
      }
      const row: SeededProjectRow = {
        project_id: String(values[0]), org_id: String(values[1]), name: String(values[2]), goal: String(values[3]),
        workspace_path: String(values[4]), team_definition_id: values[5] === null ? null : String(values[5]),
        state: 'active', visibility: String(values[6]), allowed_user_ids: String(values[7]),
        created_by: String(values[8]), created_at: Number(values[9]), archived_at: null,
      }
      if (this.projects.has(row.project_id)) throw new Error(`duplicate project key: ${row.project_id}`)
      this.projects.set(row.project_id, row)
      return [structuredClone(row)]
    }
    if (text.startsWith('UPDATE projects SET state=')) {
      if (this.failNextProjectWrite) {
        this.failNextProjectWrite = false
        return []
      }
      const row = this.projects.get(String(values[0]))
      if (row === undefined) return []
      row.state = 'archived'; row.archived_at = Number(values[1])
      return [structuredClone(row)]
    }
    if (text.startsWith('INSERT INTO project_members(')) {
      if (text.includes('ON CONFLICT')) {
        const row: SeededMemberRow = {
          project_id: String(values[0]), principal_type: String(values[1]), principal_id: String(values[2]),
          added_by: String(values[3]), added_at: Number(values[4]),
        }
        const key = `${row.project_id}:${row.principal_type}:${row.principal_id}`
        if (this.members.has(key)) return []
        this.members.set(key, row)
        return [structuredClone(row)]
      }
      const row: SeededMemberRow = {
        project_id: String(values[0]), principal_type: 'user', principal_id: String(values[1]),
        added_by: String(values[1]), added_at: Number(values[2]),
      }
      this.members.set(`${row.project_id}:${row.principal_type}:${row.principal_id}`, row)
      return []
    }
    if (text.startsWith('DELETE FROM project_members')) {
      const key = `${String(values[0])}:${String(values[1])}:${String(values[2])}`
      const existing = this.members.get(key)
      if (existing === undefined) return []
      this.members.delete(key)
      return [structuredClone(existing)]
    }
    if (text.startsWith('SELECT * FROM project_members WHERE project_id=$1')) {
      return [...this.members.values()]
        .filter(row => row.project_id === String(values[0]))
        .sort((left, right) => left.added_at - right.added_at
          || left.principal_type.localeCompare(right.principal_type)
          || left.principal_id.localeCompare(right.principal_id))
        .map(row => structuredClone(row))
    }
    throw new Error(`unhandled enterprise project test query: ${text}`)
  }

  private restore(checkpoint: {
    meta: [string, string][]
    projects: [string, SeededProjectRow][]
    members: [string, SeededMemberRow][]
  }): void {
    this.meta.clear()
    for (const [key, value] of checkpoint.meta) this.meta.set(key, value)
    this.projects.clear()
    for (const [key, value] of checkpoint.projects) this.projects.set(key, structuredClone(value))
    this.members.clear()
    for (const [key, value] of checkpoint.members) this.members.set(key, structuredClone(value))
  }
}
