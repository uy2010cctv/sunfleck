import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { describe, expect, it } from 'vitest'
import { EnterprisePostgresDatabase } from '../src/index.ts'
import { migrateCollaboration } from '../src/collaboration.ts'

const url = process.env.DSH_TEST_POSTGRES_URL

describe.skipIf(url === undefined)('PostgreSQL collaboration bootstrap', () => {
  it('creates room storage and additive preferences on a fresh schema and repeated boot', async () => {
    const schema = `dsh_boot_${randomUUID().replaceAll('-', '')}`
    const admin = new Pool({ connectionString: url, max: 1 })
    await admin.query(`CREATE SCHEMA ${schema}`)
    const database = new EnterprisePostgresDatabase(new Pool({ connectionString: url, max: 1,
      options: `-c search_path=${schema}` }))
    try {
      await database.query('CREATE TABLE organizations(id TEXT PRIMARY KEY)')
      await database.query('CREATE TABLE users(id TEXT PRIMARY KEY)')
      await database.query('CREATE TABLE enterprise_workspace_grants(workspace_id TEXT PRIMARY KEY)')
      await database.query('CREATE TABLE dsh_enterprise_surface_directory(surface_id TEXT PRIMARY KEY,org_id TEXT NOT NULL)')
      await migrateCollaboration(database)
      await migrateCollaboration(database)
      expect((await database.query<{ version: number }>('SELECT version FROM dsh_enterprise_collaboration_meta')).rows)
        .toEqual([{ version: 4 }])
      await database.query("INSERT INTO organizations(id) VALUES('org')")
      await database.query("INSERT INTO users(id) VALUES('user')")
      await database.query("INSERT INTO enterprise_workspace_grants(workspace_id) VALUES('workspace')")
      await database.query("INSERT INTO dsh_enterprise_surface_directory(surface_id,org_id) VALUES('room','org')")
      await database.query(`INSERT INTO dsh_enterprise_collaboration_config(surface_id,workspace_id,config_json)
        VALUES('room','workspace','{}')`)
      await database.query(`INSERT INTO dsh_enterprise_collaboration_room_prefs(surface_id,user_id,updated_at)
        VALUES('room','user',1)`)
      expect((await database.query('SELECT * FROM dsh_enterprise_collaboration_room_prefs')).rows).toHaveLength(1)
    } finally {
      await database.end()
      await admin.query(`DROP SCHEMA ${schema} CASCADE`)
      await admin.end()
    }
  })
})
