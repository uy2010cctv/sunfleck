import { describe, expect, it } from 'vitest'
import { createEnterprisePostgresComposition } from '../src/index.ts'

const url = process.env.DSH_TEST_POSTGRES_URL

describe.skipIf(url === undefined)('enterprise PostgreSQL production composition', () => {
  it('initializes every enterprise schema on one shared pool', async () => {
    const composition = await createEnterprisePostgresComposition({
      connectionString: url as string, cursorSigningKey: 'composition-postgres-test-key',
    })
    try {
      const result = await composition.database.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_name IN ('organizations', 'dsh_session_headers', 'dsh_enterprise_employee_drafts',
           'dsh_enterprise_work_records', 'dsh_knowledge_documents') ORDER BY table_name`,
      )
      expect(result.rows.map(row => row.table_name)).toEqual([
        'dsh_enterprise_employee_drafts', 'dsh_enterprise_work_records', 'dsh_knowledge_documents',
        'dsh_session_headers', 'organizations',
      ])
      await expect(composition.database.health()).resolves.toMatchObject({ ok: true })
    } finally {
      await composition.close()
    }
  })
})
