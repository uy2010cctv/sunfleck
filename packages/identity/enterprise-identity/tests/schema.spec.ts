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

/** Create the pre-existing tables and committed rows the in-place v6 migration must preserve. */
function seedVersion6Memories(database: DatabaseSync): void {
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
    CREATE TABLE departments (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      parent_id TEXT REFERENCES departments(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE enterprise_memories (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      scope_type TEXT NOT NULL CHECK (scope_type IN ('organization', 'department')),
      department_id TEXT REFERENCES departments(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('business-fact', 'process', 'terminology', 'decision')),
      status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'retired')),
      summary TEXT NOT NULL,
      source_digest TEXT NOT NULL,
      privacy_findings TEXT NOT NULL,
      created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reviewed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
      review_reason TEXT,
      revision INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK ((scope_type = 'organization' AND department_id IS NULL)
        OR (scope_type = 'department' AND department_id IS NOT NULL))
    ) STRICT;
  `)
  seedOrgAndUser(database)
  database.prepare(`INSERT INTO departments(id, org_id, parent_id, name, sort_order, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('dept-1', 'org-1', null, '运营部', 0, 0, 1, 1)
  const insertMemory = database.prepare(`INSERT INTO enterprise_memories(
      id, org_id, scope_type, department_id, kind, status, summary, source_digest, privacy_findings,
      created_by, reviewed_by, review_reason, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  insertMemory.run('memory-dept', 'org-1', 'department', 'dept-1', 'process', 'proposed',
    '采购订单必须在入库前完成审批。', 'b'.repeat(64), '[]', 'user-1', null, null, 1, 1, 1)
  insertMemory.run('memory-org', 'org-1', 'organization', null, 'business-fact', 'approved',
    '公司使用统一合同编号。', 'a'.repeat(64), '[]', 'user-1', 'user-1', '已核对', 2, 1, 2)
  database.prepare("INSERT INTO enterprise_meta(key, value) VALUES ('schema-version', '6')").run()
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

  it('migrates a schema-version 6 file in place, rebuilding memories without losing rows', () => {
    const database = new DatabaseSync(':memory:')
    seedVersion6Memories(database)
    migrateEnterpriseIdentity(database)

    expect(database.prepare(`SELECT id, scope_type, department_id, status, importance, agent_employee_id,
      pair_user_id FROM enterprise_memories ORDER BY id`).all()).toEqual([
      {
        id: 'memory-dept', scope_type: 'department', department_id: 'dept-1', status: 'proposed',
        importance: 0, agent_employee_id: null, pair_user_id: null,
      },
      {
        id: 'memory-org', scope_type: 'organization', department_id: null, status: 'approved',
        importance: 0, agent_employee_id: null, pair_user_id: null,
      },
    ])
    expect(database.prepare("SELECT value FROM enterprise_meta WHERE key = 'schema-version'").get())
      .toEqual({ value: String(ENTERPRISE_IDENTITY_SCHEMA_VERSION) })
  })

  it('stores agent, pair, and CHECK-only project memory compartments after migration', () => {
    const database = new DatabaseSync(':memory:')
    seedVersion6Memories(database)
    migrateEnterpriseIdentity(database)

    const insert = database.prepare(`INSERT INTO enterprise_memories(
        id, org_id, scope_type, department_id, agent_employee_id, pair_user_id, kind, status, summary,
        source_digest, privacy_findings, created_by, revision, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', ?, ?, '[]', ?, 1, 1, 1)`)
    insert.run('memory-agent', 'org-1', 'agent', null, 'employee-1', null, 'preference',
      '回复保持正式书面语。', 'c'.repeat(64), 'user-1')
    insert.run('memory-pair', 'org-1', 'pair', null, null, 'user-1', 'preference',
      '用户偏好表格汇总。', 'd'.repeat(64), 'user-1')
    insert.run('memory-project', 'org-1', 'project', null, null, null, 'process',
      '项目约定。', 'e'.repeat(64), 'user-1')
    expect(database.prepare(`SELECT count(*) AS n FROM enterprise_memories
      WHERE scope_type IN ('agent', 'pair', 'project')`).get()).toEqual({ n: 3 })
  })

  it('rejects private memory rows whose scope owner column is missing or scope is unknown', () => {
    const database = new DatabaseSync(':memory:')
    migrateEnterpriseIdentity(database)
    seedOrgAndUser(database)

    const insert = database.prepare(`INSERT INTO enterprise_memories(
        id, org_id, scope_type, department_id, agent_employee_id, pair_user_id, kind, status, summary,
        source_digest, privacy_findings, created_by, revision, created_at, updated_at)
      VALUES (?, ?, ?, NULL, ?, ?, 'preference', 'approved', ?, ?, '[]', ?, 1, 1, 1)`)
    expect(() => insert.run('memory-agent', 'org-1', 'agent', null, null, '摘要', 'a'.repeat(64), 'user-1'))
      .toThrow(/CHECK constraint failed/i)
    expect(() => insert.run('memory-pair', 'org-1', 'pair', null, null, '摘要', 'b'.repeat(64), 'user-1'))
      .toThrow(/CHECK constraint failed/i)
    expect(() => insert.run('memory-bogus', 'org-1', 'workspace', 'employee-1', null, '摘要', 'c'.repeat(64), 'user-1'))
      .toThrow(/CHECK constraint failed/i)
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
