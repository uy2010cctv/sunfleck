import { describe, expect, it } from 'vitest'
import { createEnterprisePostgresComposition } from '../src/index.ts'

const url = process.env.DSH_TEST_POSTGRES_URL

describe.skipIf(url === undefined)('enterprise PostgreSQL production composition', () => {
  it('initializes every enterprise schema on one shared pool', async () => {
    const composition = await createEnterprisePostgresComposition({
      connectionString: url as string,
      cursorSigningKey: Buffer.from('0123456789abcdef0123456789abcdef'),
      poolMax: 1,
      connectionTimeoutMs: 500,
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
      await expect(composition.operations.upsertWorkRecord({
        orgId: 'resolver-org', sessionId: 'missing-session', employeeReleaseId: 'missing-release',
        source: 'console', businessState: 'active', sourceReferences: {}, expectedRevision: 0, idempotencyKey: 'resolver-missing',
      })).rejects.toThrow(/was not found/)
      await composition.database.query(
        `INSERT INTO dsh_session_headers(id,header_json,incarnation,revision,created_at)
         VALUES ($1,'{}'::jsonb,'00000000-0000-0000-0000-000000000001',0,1) ON CONFLICT (id) DO NOTHING`, ['resolver-session'],
      )
      await composition.database.query(
        `INSERT INTO dsh_enterprise_employee_releases(
           release_id,preset_id,org_id,version,digest,snapshot_json,published_by,published_at)
         VALUES ($1,$2,$3,1,'digest','{}'::jsonb,'tester',1) ON CONFLICT (release_id) DO NOTHING`,
        ['resolver-release', 'resolver-preset', 'resolver-org'],
      )
      await composition.database.query(
        "INSERT INTO organizations(id,name) VALUES ('resolver-org','Resolver Org'),('other-org','Other Org') ON CONFLICT (id) DO NOTHING",
      )
      await expect(composition.operations.upsertWorkRecord({
        orgId: 'resolver-org', sessionId: 'resolver-session', employeeReleaseId: 'resolver-release',
        source: 'console', businessState: 'active', sourceReferences: {}, expectedRevision: 0, idempotencyKey: 'resolver-no-policy',
      })).rejects.toThrow(/was not found/)
      await composition.database.query(
        `INSERT INTO resource_policies(resource_type,resource_id,org_id,creator_user_id,visibility,allowed_user_ids)
         VALUES ('session',$1,'other-org',NULL,'organization','[]'::jsonb)`, ['resolver-session'],
      )
      await expect(composition.operations.upsertWorkRecord({
        orgId: 'resolver-org', sessionId: 'resolver-session', employeeReleaseId: 'resolver-release',
        source: 'console', businessState: 'active', sourceReferences: {}, expectedRevision: 0, idempotencyKey: 'resolver-cross-org',
      })).rejects.toThrow(/was not found/)
      await composition.database.query(
        "UPDATE resource_policies SET org_id = 'resolver-org' WHERE resource_type = 'session' AND resource_id = $1", ['resolver-session'],
      )
      await expect(composition.operations.upsertWorkRecord({
        orgId: 'resolver-org', sessionId: 'resolver-session', employeeReleaseId: 'resolver-release',
        source: 'console', businessState: 'active', sourceReferences: {}, expectedRevision: 0, idempotencyKey: 'resolver-found',
      })).resolves.toMatchObject({ sessionId: 'resolver-session', employeeReleaseId: 'resolver-release' })
      for (const suffix of ['a', 'b']) {
        await composition.database.query(
          `INSERT INTO dsh_session_headers(id,header_json,incarnation,revision,created_at)
           VALUES ($1,'{}'::jsonb,$2::uuid,0,1) ON CONFLICT (id) DO NOTHING`,
          [`resolver-session-${suffix}`, `00000000-0000-0000-0000-00000000000${suffix === 'a' ? '2' : '3'}`],
        )
        await composition.database.query(
          `INSERT INTO dsh_enterprise_employee_releases(
             release_id,preset_id,org_id,version,digest,snapshot_json,published_by,published_at)
           VALUES ($1,$2,'resolver-org',1,'digest','{}'::jsonb,'tester',1) ON CONFLICT (release_id) DO NOTHING`,
          [`resolver-release-${suffix}`, `resolver-preset-${suffix}`],
        )
        await composition.database.query(
          `INSERT INTO resource_policies(resource_type,resource_id,org_id,creator_user_id,visibility,allowed_user_ids)
           VALUES ('session',$1,'resolver-org',NULL,'organization','[]'::jsonb) ON CONFLICT (resource_type,resource_id) DO NOTHING`,
          [`resolver-session-${suffix}`],
        )
      }
      await expect(Promise.all(['a', 'b'].map(suffix => composition.operations.upsertWorkRecord({
        orgId: 'resolver-org', sessionId: `resolver-session-${suffix}`, employeeReleaseId: `resolver-release-${suffix}`,
        source: 'console', businessState: 'active', sourceReferences: {}, expectedRevision: 0,
        idempotencyKey: `resolver-concurrent-${suffix}`,
      })))).resolves.toHaveLength(2)
      await expect(composition.database.health()).resolves.toMatchObject({ ok: true })
    } finally {
      await composition.database.query("DELETE FROM dsh_enterprise_operations_idempotency WHERE org_id = 'resolver-org'")
      await composition.database.query("DELETE FROM dsh_enterprise_work_records WHERE org_id = 'resolver-org'")
      await composition.database.query("DELETE FROM dsh_enterprise_employee_releases WHERE release_id IN ('resolver-release','resolver-release-a','resolver-release-b')")
      await composition.database.query("DELETE FROM resource_policies WHERE resource_type = 'session' AND resource_id IN ('resolver-session','resolver-session-a','resolver-session-b')")
      await composition.database.query("DELETE FROM dsh_session_headers WHERE id IN ('resolver-session','resolver-session-a','resolver-session-b')")
      await composition.database.query("DELETE FROM organizations WHERE id IN ('resolver-org','other-org')")
      await composition.close()
    }
  })
})
