import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrateEnterpriseIdentity } from '../src/index.ts'
import {
  attachSurfaceSession,
  bindSticky,
  claimInbox,
  createEmployee,
  enqueueInbox,
  ensureSurface,
  failInboxItem,
  getEmployee,
  listEmployees,
  resolveSticky,
  updateEmployeeState,
  type EmployeeAccountRow,
  type InboxRow,
  type SurfaceRow,
} from '../src/employee-store.ts'

// Ascending fixture times in epoch milliseconds.
const T1 = Date.UTC(2026, 8, 21, 9)
const T2 = Date.UTC(2026, 8, 22, 9)
const T3 = Date.UTC(2026, 8, 23, 9)
const T4 = Date.UTC(2026, 8, 24, 9)

/** Open a fresh in-memory database migrated to the current enterprise identity schema. */
function makeDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  migrateEnterpriseIdentity(database)
  return database
}

/** Insert the organization and user rows that employee, surface, and inbox rows reference. */
function seedOrgAndUser(database: DatabaseSync, orgId: string, userId: string): void {
  database.prepare('INSERT INTO organizations(id, name) VALUES (?, ?)').run(orgId, `组织 ${orgId}`)
  database.prepare('INSERT INTO users(id, org_id, username, display_name, disabled) VALUES (?, ?, ?, ?, ?)')
    .run(userId, orgId, 'alice', 'Alice', 0)
}

/** Insert one employee account row directly; its literal columns must match `employeeRow`. */
function seedEmployee(
  database: DatabaseSync,
  input: { id: string; orgId: string; at: number; state?: EmployeeAccountRow['state'] },
): void {
  database.prepare(`INSERT INTO employee_accounts(
      id, org_id, display_name, role_card, active_release_id, state,
      home_workspace_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(input.id, input.orgId, 'Support', '客服助理', null, input.state ?? 'active',
      '/managed/employees/support', input.at, input.at)
}

/** Seed org-1, user-1, and the active employee-1 that the surface and inbox fixtures reference. */
function seedGraph(database: DatabaseSync): void {
  seedOrgAndUser(database, 'org-1', 'user-1')
  seedEmployee(database, { id: 'employee-1', orgId: 'org-1', at: T1 })
}

/** Build the employee account row the seed helpers store, for use as an expected value. */
function employeeRow(id: string, at: number): EmployeeAccountRow {
  return {
    id,
    orgId: 'org-1',
    displayName: 'Support',
    roleCard: '客服助理',
    activeReleaseId: null,
    state: 'active',
    homeWorkspacePath: '/managed/employees/support',
    createdAt: at,
    updatedAt: at,
  }
}

/** Build the surface-1 row between user-1 and employee-1 in org-1. */
function surfaceRow(): SurfaceRow {
  return {
    id: 'surface-1',
    orgId: 'org-1',
    kind: 'dm',
    userId: 'user-1',
    employeeId: 'employee-1',
    sessionId: null,
    createdAt: T1,
  }
}

/** Create surface-1 through the store under test. */
function ensureDefaultSurface(database: DatabaseSync): SurfaceRow {
  return ensureSurface(database, surfaceRow())
}

/** Build one queued inbox row for employee-1 on surface-1 in org-1. */
function inboxRow(id: string, at: number): InboxRow {
  return {
    id,
    orgId: 'org-1',
    employeeId: 'employee-1',
    surfaceId: 'surface-1',
    originActor: 'actor-a',
    payloadText: '你好',
    state: 'queued',
    attempts: 0,
    createdAt: at,
    deliveredAt: null,
  }
}

describe('employee row store', () => {
  it('creates an employee account and reads it back field for field', () => {
    const database = makeDatabase()
    seedOrgAndUser(database, 'org-1', 'user-1')

    const row = employeeRow('employee-1', T1)
    createEmployee(database, row)

    expect(getEmployee(database, 'employee-1')).toEqual(row)
    expect(getEmployee(database, 'employee-x')).toBeUndefined()
  })

  it('rejects a second employee account with the same id', () => {
    const database = makeDatabase()
    seedOrgAndUser(database, 'org-1', 'user-1')

    createEmployee(database, employeeRow('employee-1', T1))
    expect(() => {
      createEmployee(database, employeeRow('employee-1', T2))
    }).toThrow(/UNIQUE constraint failed/i)
  })

  it('lists only the organization employees and hides archived accounts unless asked', () => {
    const database = makeDatabase()
    seedOrgAndUser(database, 'org-1', 'user-1')
    seedOrgAndUser(database, 'org-2', 'user-2')
    seedEmployee(database, { id: 'employee-b', orgId: 'org-1', at: T2 })
    seedEmployee(database, { id: 'employee-a', orgId: 'org-1', at: T1 })
    seedEmployee(database, { id: 'employee-c', orgId: 'org-1', at: T3, state: 'archived' })
    seedEmployee(database, { id: 'employee-d', orgId: 'org-2', at: T1 })

    expect(listEmployees(database, 'org-1')).toEqual([
      employeeRow('employee-a', T1),
      employeeRow('employee-b', T2),
    ])
    expect(listEmployees(database, 'org-1', { includeArchived: true })).toEqual([
      employeeRow('employee-a', T1),
      employeeRow('employee-b', T2),
      { ...employeeRow('employee-c', T3), state: 'archived' },
    ])
  })

  it('moves an employee to a new state and stamps the update time', () => {
    const database = makeDatabase()
    seedOrgAndUser(database, 'org-1', 'user-1')
    createEmployee(database, employeeRow('employee-1', T1))

    updateEmployeeState(database, 'employee-1', 'suspended', T2)

    expect(getEmployee(database, 'employee-1'))
      .toEqual({ ...employeeRow('employee-1', T1), state: 'suspended', updatedAt: T2 })
  })

  it('rejects further state changes once an employee is archived', () => {
    const database = makeDatabase()
    seedOrgAndUser(database, 'org-1', 'user-1')
    seedEmployee(database, { id: 'employee-1', orgId: 'org-1', at: T1, state: 'archived' })

    expect(() => {
      updateEmployeeState(database, 'employee-1', 'active', T2)
    }).toThrow(/archived/)
  })

  it('rejects a state change for a missing employee', () => {
    const database = makeDatabase()

    expect(() => {
      updateEmployeeState(database, 'employee-x', 'active', T1)
    }).toThrow(/missing/)
  })

  it('creates a dm surface once and returns the existing row for the same pair', () => {
    const database = makeDatabase()
    seedGraph(database)

    expect(ensureDefaultSurface(database)).toEqual(surfaceRow())
    expect(ensureSurface(database, { ...surfaceRow(), id: 'surface-2' })).toEqual(surfaceRow())
  })

  it('attaches a session to a surface and rejects a missing one', () => {
    const database = makeDatabase()
    seedGraph(database)
    ensureDefaultSurface(database)

    attachSurfaceSession(database, 'surface-1', 'session-1')
    expect(ensureDefaultSurface(database)).toEqual({ ...surfaceRow(), sessionId: 'session-1' })
    expect(() => {
      attachSurfaceSession(database, 'surface-x', 'session-1')
    }).toThrow(/missing/)
  })

  it('enqueues an inbox row and claims it back delivered', () => {
    const database = makeDatabase()
    seedGraph(database)
    ensureDefaultSurface(database)

    const row = inboxRow('inbox-1', T2)
    enqueueInbox(database, row)

    expect(claimInbox(database, 'employee-1', 5, T3))
      .toEqual([{ ...row, state: 'delivered', deliveredAt: T3 }])
    expect(claimInbox(database, 'employee-1', 5, T4)).toEqual([])
  })

  it('claims queued rows in creation order and skips delivered and failed rows', () => {
    const database = makeDatabase()
    seedGraph(database)
    ensureDefaultSurface(database)

    enqueueInbox(database, inboxRow('inbox-done', T1))
    failInboxItem(database, 'inbox-done', T1)
    enqueueInbox(database, inboxRow('inbox-taken', T1))
    enqueueInbox(database, inboxRow('inbox-late', T3))
    enqueueInbox(database, inboxRow('inbox-early', T2))

    expect(claimInbox(database, 'employee-1', 1, T2))
      .toEqual([{ ...inboxRow('inbox-taken', T1), state: 'delivered', deliveredAt: T2 }])
    expect(claimInbox(database, 'employee-1', 5, T3)).toEqual([
      { ...inboxRow('inbox-early', T2), state: 'delivered', deliveredAt: T3 },
      { ...inboxRow('inbox-late', T3), state: 'delivered', deliveredAt: T3 },
    ])
    expect(claimInbox(database, 'employee-1', 5, T4)).toEqual([])
  })

  it('breaks creation-order ties by row id', () => {
    const database = makeDatabase()
    seedGraph(database)
    ensureDefaultSurface(database)

    enqueueInbox(database, inboxRow('inbox-b', T1))
    enqueueInbox(database, inboxRow('inbox-a', T1))

    expect(claimInbox(database, 'employee-1', 5, T2).map(row => row.id))
      .toEqual(['inbox-a', 'inbox-b'])
  })

  it('marks one inbox row failed at the given time', () => {
    const database = makeDatabase()
    seedGraph(database)
    ensureDefaultSurface(database)
    enqueueInbox(database, inboxRow('inbox-1', T1))

    failInboxItem(database, 'inbox-1', T2)

    expect(database.prepare('SELECT state, delivered_at FROM employee_inbox WHERE id = ?')
      .get('inbox-1')).toEqual({ state: 'failed', delivered_at: T2 })
  })

  it('rejects failing a missing inbox row', () => {
    const database = makeDatabase()

    expect(() => {
      failInboxItem(database, 'inbox-x', T1)
    }).toThrow(/missing/)
  })

  it('rebinds an actor key to a new employee without error', () => {
    const database = makeDatabase()
    seedOrgAndUser(database, 'org-1', 'user-1')
    seedEmployee(database, { id: 'employee-1', orgId: 'org-1', at: T1 })
    seedEmployee(database, { id: 'employee-2', orgId: 'org-1', at: T2 })

    bindSticky(database, 'org-1', 'actor-a', 'employee-1', T1)
    expect(resolveSticky(database, 'org-1', 'actor-a')).toBe('employee-1')
    bindSticky(database, 'org-1', 'actor-a', 'employee-2', T2)
    expect(resolveSticky(database, 'org-1', 'actor-a')).toBe('employee-2')
  })

  it('resolves an unbound actor key to undefined', () => {
    const database = makeDatabase()

    expect(resolveSticky(database, 'org-1', 'actor-a')).toBeUndefined()
  })

  it('rejects a durable employee row whose state left the closed set', () => {
    const database = makeDatabase()
    seedOrgAndUser(database, 'org-1', 'user-1')
    createEmployee(database, employeeRow('employee-1', T1))

    database.exec('PRAGMA ignore_check_constraints = ON')
    database.prepare("UPDATE employee_accounts SET state = 'bogus' WHERE id = ?").run('employee-1')
    database.exec('PRAGMA ignore_check_constraints = OFF')

    expect(() => getEmployee(database, 'employee-1')).toThrow(/invalid state/)
  })
})
