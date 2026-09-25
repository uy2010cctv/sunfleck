import { describe, expect, it } from 'vitest'
import { createEnterprisePostgresComposition } from '../src/index.ts'

const url = process.env.DSH_TEST_POSTGRES_URL

describe.skipIf(url === undefined)('enterprise PostgreSQL production composition', () => {
  it('lists stored surfaces only within the requested organization', async () => {
    const composition = await createEnterprisePostgresComposition({
      connectionString: url as string,
      cursorSigningKey: Buffer.from('0123456789abcdef0123456789abcdef'),
    })
    try {
      await composition.database.query(
        "INSERT INTO organizations(id,name) VALUES ('surface-org-a','Surface A'),('surface-org-b','Surface B') ON CONFLICT (id) DO NOTHING",
      )
      await composition.database.query(
        `INSERT INTO dsh_enterprise_surface_directory(surface_id,org_id,kind,name,member_count,created_at)
         VALUES ('surface-a','surface-org-a','group','Group A',2,1),
                ('surface-b','surface-org-b','channel','Channel B',3,2)`,
      )
      expect(await composition.surfaceDirectory.list('surface-org-a')).toEqual([
        { id: 'surface-a', kind: 'group', name: 'Group A', memberCount: 2 },
      ])
      expect(await composition.surfaceDirectory.list('surface-org-a', 'channel')).toEqual([])
      expect(await composition.surfaceDirectory.list('surface-org-b')).toEqual([
        { id: 'surface-b', kind: 'channel', name: 'Channel B', memberCount: 3 },
      ])
    } finally {
      await composition.database.query("DELETE FROM dsh_enterprise_surface_directory WHERE surface_id IN ('surface-a','surface-b')")
      await composition.database.query("DELETE FROM organizations WHERE id IN ('surface-org-a','surface-org-b')")
      await composition.close()
    }
  })

  it('initializes every enterprise schema on one shared pool', async () => {
    const composition = await createEnterprisePostgresComposition({
      connectionString: url as string,
      cursorSigningKey: Buffer.from('0123456789abcdef0123456789abcdef'),
      poolMax: 1,
      connectionTimeoutMs: 500,
    })
    let createdProjectId: string | undefined
    try {
      await expect(composition.projects.list('resolver-org')).resolves.toEqual([])
      const result = await composition.database.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = current_schema()
           AND table_name IN ('organizations', 'dsh_session_headers', 'dsh_enterprise_employee_drafts',
           'dsh_enterprise_work_records', 'dsh_knowledge_documents',
           'dsh_enterprise_cordis_packages', 'projects', 'project_members') ORDER BY table_name`,
      )
      expect(result.rows.map(row => row.table_name)).toEqual([
        'dsh_enterprise_cordis_packages', 'dsh_enterprise_employee_drafts', 'dsh_enterprise_work_records',
        'dsh_knowledge_documents', 'dsh_session_headers', 'organizations', 'project_members', 'projects',
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
      await composition.database.query(
        `INSERT INTO users(id,org_id,username,display_name,disabled)
         VALUES ('resolver-owner','resolver-org','resolver-owner','Resolver Owner',false) ON CONFLICT (id) DO NOTHING`,
      )
      await composition.database.query(
        `INSERT INTO enterprise_workspace_grants(workspace_id,org_id,name,kind,owner_user_id,root_path,sandbox_mode,revision,created_at,updated_at)
         VALUES ('resolver-workspace','resolver-org','Resolver','personal','resolver-owner','/managed/resolver','workspace-write',1,1,1)
         ON CONFLICT (workspace_id) DO NOTHING`,
      )
      const createdProject = await composition.projects.create({
        orgId: 'resolver-org', name: 'Resolver Project', goal: 'Verify persistence',
        workspacePath: '/managed/resolver-project', createdBy: 'resolver-owner',
      })
      createdProjectId = createdProject.projectId
      expect((await composition.projects.list('resolver-org')).map(project => project.projectId))
        .toEqual([createdProject.projectId])
      expect(await composition.projects.list('other-org')).toEqual([])
      await expect(composition.operations.upsertWorkRecord({
        orgId: 'resolver-org', sessionId: 'resolver-session', employeeReleaseId: 'resolver-release',
        source: 'console', businessState: 'active', sourceReferences: {}, expectedRevision: 0, idempotencyKey: 'resolver-no-policy',
      })).rejects.toThrow(/was not found/)
      await composition.database.query(
        `INSERT INTO enterprise_session_workspaces(session_id,workspace_id,org_id,owner_user_id)
         VALUES ($1,'resolver-workspace','other-org','resolver-owner')`, ['resolver-session'],
      )
      await expect(composition.operations.upsertWorkRecord({
        orgId: 'resolver-org', sessionId: 'resolver-session', employeeReleaseId: 'resolver-release',
        source: 'console', businessState: 'active', sourceReferences: {}, expectedRevision: 0, idempotencyKey: 'resolver-cross-org',
      })).rejects.toThrow(/was not found/)
      await composition.database.query(
        "UPDATE enterprise_session_workspaces SET org_id = 'resolver-org' WHERE session_id = $1", ['resolver-session'],
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
          `INSERT INTO enterprise_session_workspaces(session_id,workspace_id,org_id,owner_user_id)
           VALUES ($1,'resolver-workspace','resolver-org','resolver-owner') ON CONFLICT (session_id) DO NOTHING`,
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
      if (createdProjectId !== undefined) {
        await composition.database.query('DELETE FROM projects WHERE project_id=$1', [createdProjectId])
      }
      await composition.database.query("DELETE FROM dsh_enterprise_operations_idempotency WHERE org_id = 'resolver-org'")
      await composition.database.query("DELETE FROM dsh_enterprise_work_records WHERE org_id = 'resolver-org'")
      await composition.database.query("DELETE FROM dsh_enterprise_employee_releases WHERE release_id IN ('resolver-release','resolver-release-a','resolver-release-b')")
      await composition.database.query("DELETE FROM enterprise_session_workspaces WHERE session_id IN ('resolver-session','resolver-session-a','resolver-session-b')")
      await composition.database.query("DELETE FROM dsh_session_headers WHERE id IN ('resolver-session','resolver-session-a','resolver-session-b')")
      await composition.database.query("DELETE FROM enterprise_workspace_grants WHERE workspace_id = 'resolver-workspace'")
      await composition.database.query("DELETE FROM users WHERE id = 'resolver-owner'")
      await composition.database.query("DELETE FROM organizations WHERE id IN ('resolver-org','other-org')")
      await composition.close()
    }
  })
})
