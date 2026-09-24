import { describe, expect, it } from 'vitest'
import {
  migrateEnterpriseCordis,
  PostgresEnterpriseCordisRepository,
  type EnterpriseCordisPostgresDatabase,
  type EnterpriseCordisPostgresResult,
} from '../src/index.ts'

interface Query { text: string; values: readonly unknown[] }

class RecordingDatabase implements EnterpriseCordisPostgresDatabase {
  readonly queries: Query[] = []

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<EnterpriseCordisPostgresResult<Row>> {
    this.queries.push({ text, values })
    return { rows: [], rowCount: 1 }
  }

  async transaction<T>(operation: (database: EnterpriseCordisPostgresDatabase) => Promise<T>): Promise<T> {
    return operation(this)
  }
}

describe('enterprise Cordis PostgreSQL adapter', () => {
  it('creates versioned package, review, binding, command, audit, and manager tables', async () => {
    const database = new RecordingDatabase()
    await migrateEnterpriseCordis(database)
    const sql = database.queries.map(query => query.text).join('\n')

    for (const table of [
      'dsh_enterprise_cordis_packages', 'dsh_enterprise_cordis_reviews',
      'dsh_enterprise_cordis_bindings', 'dsh_enterprise_cordis_commands',
      'dsh_enterprise_cordis_archives',
      'dsh_enterprise_cordis_audit', 'dsh_enterprise_cordis_artifacts',
      'dsh_enterprise_cordis_validation_reports', 'dsh_enterprise_department_managers',
      'dsh_enterprise_department_manager_sets', 'dsh_enterprise_cordis_session_generations',
    ]) expect(sql).toContain(table)
    expect(sql).toContain('UNIQUE(org_id, scope_key, plugin_id)')
    expect(sql).toContain('UNIQUE(org_id, plugin_id, version)')
  })

  it('stores a private archive and binding stop in one PostgreSQL transaction', async () => {
    const database = new RecordingDatabase()
    const repository = new PostgresEnterpriseCordisRepository(database)
    await repository.putArchive({
      orgId: 'org-a', scope: { type: 'personal-workspace', workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      pluginId: 'helper-1', archived: true, revision: 1, updatedBy: 'user-1', updatedAt: 10,
    }, 0, { binding: {
      bindingId: 'binding-1', orgId: 'org-a', pluginId: 'helper-1', activePackageId: 'package-1',
      scope: { type: 'personal-workspace', workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      generation: 1, revision: 2, activatedBy: 'user-1', disabled: true,
      trustLevel: 'isolated', updatedAt: 10,
    }, expectedRevision: 1 })
    expect(database.queries.map(query => query.text)).toEqual([
      expect.stringContaining('UPDATE dsh_enterprise_cordis_bindings'),
      expect.stringContaining('INSERT INTO dsh_enterprise_cordis_archives'),
    ])
  })

  it('uses parameterized writes for immutable Cordis source and manifests', async () => {
    const database = new RecordingDatabase()
    const repository = new PostgresEnterpriseCordisRepository(database)
    await repository.putPackage({
      packageId: 'package-1', orgId: 'org-a', pluginId: 'orders-1', dynamicPackageId: 'runtime-1',
      version: 1, scope: { type: 'personal-workspace', workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      name: 'Orders', purpose: 'Validate orders', hostCode: "return process.env['SECRET']",
      manifest: {
        apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm',
        provides: ['tool:orders'], capabilities: ['workspace.read'],
      },
      artifactRef: 'artifact://orders/1', validationReportRef: 'report://orders/1',
      authoredBy: 'user-1', sourceDigest: 'a'.repeat(64), createdAt: 1,
    })

    expect(database.queries).toHaveLength(1)
    expect(database.queries[0]?.text).not.toContain('process.env')
    expect(database.queries[0]?.values).toContain("return process.env['SECRET']")
    expect(database.queries[0]?.values).toContain('artifact://orders/1')
  })
})
