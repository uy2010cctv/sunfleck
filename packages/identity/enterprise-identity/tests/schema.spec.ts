import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  ENTERPRISE_IDENTITY_SCHEMA_VERSION,
  migrateEnterpriseIdentity,
} from '../src/index.ts'

/** Insert the organization and user rows shared by every fixture. */
function seedOrgAndUser(database: DatabaseSync): void {
  database.prepare('INSERT INTO organizations(id, name) VALUES (?, ?)').run('org-1', 'Existing enterprise')
  database.prepare('INSERT INTO users(id, org_id, username, display_name, disabled) VALUES (?, ?, ?, ?, ?)')
    .run('user-1', 'org-1', 'alice', 'Alice', 0)
}

/** Create the pre-existing tables and committed rows the in-place v5 migration must preserve. */
function seedVersion5File(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE enterprise_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE
    ) STRICT;
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      username TEXT NOT NULL,
      display_name TEXT NOT NULL,
      disabled INTEGER NOT NULL CHECK (disabled IN (0, 1)),
      password_verifier TEXT,
      department_revision INTEGER NOT NULL DEFAULT 0,
      UNIQUE(org_id, username)
    ) STRICT;
  `)
  database.prepare("INSERT INTO enterprise_meta(key, value) VALUES ('schema-version', '5')").run()
  seedOrgAndUser(database)
}

/** Insert the organization, user, and employee account rows that inbox and binding rows reference. */
function seedEmployeeGraph(database: DatabaseSync): void {
  seedOrgAndUser(database)
  database.prepare(`INSERT INTO employee_accounts(
      id, org_id, display_name, role_card, active_release_id, state,
      home_workspace_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('employee-1', 'org-1', 'Support', '客服助理', null, 'active', '/managed/employees/support', 1, 1)
}

/** Insert one direct-message surface linking user-1 to employee-1. */
function seedSurface(database: DatabaseSync): void {
  database.prepare(`INSERT INTO surfaces(
      id, org_id, kind, user_id, employee_id, session_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('surface-1', 'org-1', 'dm', 'user-1', 'employee-1', null, 1)
}

describe('migrateEnterpriseIdentity', () => {
  it('migrates a fresh database so the persistent-employee tables are queryable', () => {
    const database = new DatabaseSync(':memory:')
    migrateEnterpriseIdentity(database)

    for (const table of ['employee_accounts', 'surfaces', 'employee_inbox', 'sticky_bindings']) {
      expect(database.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 })
    }
    expect(database.prepare("SELECT value FROM enterprise_meta WHERE key = 'schema-version'").get())
      .toEqual({ value: String(ENTERPRISE_IDENTITY_SCHEMA_VERSION) })
  })

  it('migrates a schema-version 5 file in place without losing organizations or users', () => {
    const database = new DatabaseSync(':memory:')
    seedVersion5File(database)
    migrateEnterpriseIdentity(database)

    expect(database.prepare('SELECT count(*) AS n FROM organizations').get()).toEqual({ n: 1 })
    expect(database.prepare('SELECT count(*) AS n FROM users').get()).toEqual({ n: 1 })
    expect(database.prepare('SELECT count(*) AS n FROM employee_accounts').get()).toEqual({ n: 0 })
    expect(database.prepare("SELECT value FROM enterprise_meta WHERE key = 'schema-version'").get())
      .toEqual({ value: String(ENTERPRISE_IDENTITY_SCHEMA_VERSION) })
  })

  it('rejects employee_inbox rows whose state is outside the queued, delivered, and failed set', () => {
    const database = new DatabaseSync(':memory:')
    migrateEnterpriseIdentity(database)
    seedEmployeeGraph(database)
    seedSurface(database)

    database.prepare(`INSERT INTO employee_inbox(
        id, org_id, employee_id, surface_id, origin_actor, payload_text, state, attempts, created_at, delivered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('inbox-1', 'org-1', 'employee-1', 'surface-1', 'actor-a', '你好', 'queued', 0, 1, null)
    expect(() => database.prepare(`INSERT INTO employee_inbox(
        id, org_id, employee_id, surface_id, origin_actor, payload_text, state, attempts, created_at, delivered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('inbox-2', 'org-1', 'employee-1', 'surface-1', 'actor-a', '你好', 'bogus', 0, 1, null))
      .toThrow(/CHECK constraint failed/i)
  })

  it('rejects surfaces whose kind is not dm', () => {
    const database = new DatabaseSync(':memory:')
    migrateEnterpriseIdentity(database)
    seedEmployeeGraph(database)

    seedSurface(database)
    expect(() => database.prepare(`INSERT INTO surfaces(
        id, org_id, kind, user_id, employee_id, session_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('surface-2', 'org-1', 'group', 'user-1', 'employee-1', null, 1))
      .toThrow(/CHECK constraint failed/i)
  })

  it('rejects a second sticky binding for the same organization and actor key', () => {
    const database = new DatabaseSync(':memory:')
    migrateEnterpriseIdentity(database)
    seedEmployeeGraph(database)

    database.prepare(`INSERT INTO sticky_bindings(org_id, actor_key, employee_id, updated_at)
      VALUES (?, ?, ?, ?)`)
      .run('org-1', 'actor-a', 'employee-1', 1)
    expect(() => database.prepare(`INSERT INTO sticky_bindings(org_id, actor_key, employee_id, updated_at)
      VALUES (?, ?, ?, ?)`)
      .run('org-1', 'actor-a', 'employee-1', 2)).toThrow(/UNIQUE constraint failed/i)
  })
})
