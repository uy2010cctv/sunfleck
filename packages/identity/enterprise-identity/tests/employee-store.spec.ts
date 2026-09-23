import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { migrateEnterpriseIdentity } from '../src/index.ts'
import {
  attachGroupSurfaceSession,
  attachSurfaceSession,
  attachTopicSession,
  bindSticky,
  channelTopic,
  claimInbox,
  createEmployee,
  dutyRoster,
  employeeByHomeWorkspacePath,
  enqueueInbox,
  ensureChannelSurface,
  ensureGroupSurface,
  ensureSurface,
  ensureTopic,
  failInboxItem,
  getEmployee,
  groupSessionBinding,
  groupSurfaceSession,
  listEmployees,
  resolveSticky,
  setDutyRoster,
  settleTopic,
  setSurfaceMembers,
  surfaceBySession,
  surfaceMembers,
  topicBySession,
  topicsBySurface,
  updateEmployeeState,
  type EmployeeAccountRow,
  type EnsureChannelSurfaceRow,
  type EnsureGroupSurfaceRow,
  type GroupSurfaceRow,
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

  it('reads an employee by exact home workspace path and returns undefined otherwise', () => {
    const database = makeDatabase()
    seedOrgAndUser(database, 'org-1', 'user-1')
    createEmployee(database, employeeRow('employee-1', T1))
    createEmployee(database, {
      ...employeeRow('employee-2', T2),
      homeWorkspacePath: '/managed/employees/billing',
    })

    expect(employeeByHomeWorkspacePath(database, '/managed/employees/billing')).toEqual({
      ...employeeRow('employee-2', T2),
      homeWorkspacePath: '/managed/employees/billing',
    })
    // Exact string equality mirrors `workspaceGrantByRootPath`: no normalization, no realpath.
    expect(employeeByHomeWorkspacePath(database, '/managed/employees/support/')).toBeUndefined()
    expect(employeeByHomeWorkspacePath(database, '/managed/employees/missing')).toBeUndefined()
  })

  it('hides archived accounts from the home workspace path lookup so an active replacement wins', () => {
    const database = makeDatabase()
    seedOrgAndUser(database, 'org-1', 'user-1')
    createEmployee(database, {
      ...employeeRow('employee-archived', T1),
      state: 'archived',
      homeWorkspacePath: '/managed/employees/billing',
    })

    expect(employeeByHomeWorkspacePath(database, '/managed/employees/billing')).toBeUndefined()

    createEmployee(database, {
      ...employeeRow('employee-active', T2),
      homeWorkspacePath: '/managed/employees/billing',
    })
    expect(employeeByHomeWorkspacePath(database, '/managed/employees/billing')).toEqual({
      ...employeeRow('employee-active', T2),
      homeWorkspacePath: '/managed/employees/billing',
    })
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

  it('reads the surface anchored to one session and returns undefined for unknown sessions', () => {
    const database = makeDatabase()
    seedGraph(database)
    ensureDefaultSurface(database)

    expect(surfaceBySession(database, 'session-1')).toBeUndefined()
    attachSurfaceSession(database, 'surface-1', 'session-1')
    expect(surfaceBySession(database, 'session-1')).toEqual({ ...surfaceRow(), sessionId: 'session-1' })
    expect(surfaceBySession(database, 'session-2')).toBeUndefined()
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

describe('collaboration surfaces', () => {
  /** Build a group surface row for org-1; the transform may replace or drop fields. */
  function groupRow(transform: (row: EnsureGroupSurfaceRow) => EnsureGroupSurfaceRow = row => row): EnsureGroupSurfaceRow {
    return transform({ id: 'surface-group', orgId: 'org-1', name: '支持群', externalKey: 'fe-1', createdAt: T1 })
  }

  /** Build a channel surface row for org-1 anchored to employee-1 on duty. */
  function channelRow(transform: (row: EnsureChannelSurfaceRow) => EnsureChannelSurfaceRow = row => row): EnsureChannelSurfaceRow {
    return transform({
      id: 'surface-channel', orgId: 'org-1', name: '值班频道', externalKey: 'fe-2',
      topicPolicy: 'thread', respondPolicy: 'mention_duty', dutyEmployeeIds: ['employee-1'],
      createdAt: T1,
    })
  }

  /** Drop the external key so a surface is keyed by id alone. */
  function withoutExternalKey<R extends EnsureGroupSurfaceRow | EnsureChannelSurfaceRow>(
    row: R,
  ): Omit<R, 'externalKey'> {
    const { externalKey: _dropped, ...rest } = row
    return rest
  }

  /** Build the group-1 row the seed helpers store, for use as an expected value. */
  function expectedGroup(overrides: Partial<GroupSurfaceRow> = {}): GroupSurfaceRow {
    return {
      id: 'surface-group', orgId: 'org-1', kind: 'group', userId: null, employeeId: null,
      sessionId: null, createdAt: T1, name: '支持群', externalKey: 'fe-1', dutyEmployeeIds: [],
      ...overrides,
    }
  }

  /** Create org-1 with two employees so member and roster fixtures can reference both. */
  function seedSurfaceGraph(database: DatabaseSync): void {
    seedGraph(database)
    seedEmployee(database, { id: 'employee-2', orgId: 'org-1', at: T2 })
  }

  it('creates a group surface once keyed by external key and returns the existing row', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)

    expect(ensureGroupSurface(database, groupRow())).toEqual(expectedGroup())
    // The external-key hit wins over a freshly generated id and over requested field updates.
    expect(ensureGroupSurface(database, groupRow(row => ({ ...row, id: 'surface-again', createdAt: T2 }))))
      .toEqual(expectedGroup())
    expect(ensureGroupSurface(database, groupRow(row => ({ ...row, name: '改名群', teamDefinitionId: 'team-1' }))))
      .toEqual(expectedGroup())
    // Without an external key the id alone keys the row.
    expect(ensureGroupSurface(database, groupRow(withoutExternalKey)))
      .toEqual(expectedGroup())
    expect(ensureGroupSurface(database, groupRow(row => withoutExternalKey({ ...row, name: '改名群' }))))
      .toEqual(expectedGroup())
    // A new external key inserts a new row carrying its optional columns.
    expect(ensureGroupSurface(database, groupRow(row => ({
      ...row, id: 'surface-group-3', externalKey: 'fe-3', projectId: 'project-1', createdAt: T2,
    })))).toEqual(expectedGroup({ id: 'surface-group-3', externalKey: 'fe-3', projectId: 'project-1', createdAt: T2 }))
    expect(ensureGroupSurface(database, groupRow(row => ({
      ...row, id: 'surface-group-3', externalKey: 'fe-3', name: '改名群', teamDefinitionId: 'team-1',
    }))).projectId).toBe('project-1')
  })

  it('rejects re-keying an id that already names another kind of surface', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)
    ensureDefaultSurface(database)

    expect(() => ensureGroupSurface(database, groupRow(row => withoutExternalKey({ ...row, id: 'surface-1' }))))
      .toThrow(/surface-1.*not a group surface/u)
    expect(() => ensureChannelSurface(database, channelRow(row => withoutExternalKey({ ...row, id: 'surface-1' }))))
      .toThrow(/surface-1.*not a channel surface/u)
  })

  it('creates a channel surface with its policies and a deduplicated duty roster', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)

    const channel = ensureChannelSurface(database, channelRow(row => ({
      ...row, dutyEmployeeIds: ['employee-2', 'employee-1', 'employee-2'],
    })))
    expect(channel).toEqual({
      id: 'surface-channel', orgId: 'org-1', kind: 'channel', userId: null, employeeId: null,
      sessionId: null, createdAt: T1, name: '值班频道', externalKey: 'fe-2', topicPolicy: 'thread',
      respondPolicy: 'mention_duty', dutyEmployeeIds: ['employee-2', 'employee-1'],
    })
    // Repeat and idless re-keying return the stored row without rewriting the policies.
    expect(ensureChannelSurface(database, channelRow(row => ({ ...row, id: 'surface-again' })))).toEqual(channel)
    expect(ensureChannelSurface(database, channelRow(withoutExternalKey))).toEqual(channel)
    expect(dutyRoster(database, 'surface-channel')).toEqual(['employee-2', 'employee-1'])
  })

  it('replaces a surface member set and lists members in principal order', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)
    ensureChannelSurface(database, channelRow())

    setSurfaceMembers(database, 'surface-channel', [
      { principalType: 'employee', principalId: 'employee-2' },
      { principalType: 'user', principalId: 'user-1', roleId: 'lead' },
      { principalType: 'employee', principalId: 'employee-1', roleId: 'duty' },
    ])
    expect(surfaceMembers(database, 'surface-channel')).toEqual([
      { surfaceId: 'surface-channel', principalType: 'employee', principalId: 'employee-1', roleId: 'duty' },
      { surfaceId: 'surface-channel', principalType: 'employee', principalId: 'employee-2' },
      { surfaceId: 'surface-channel', principalType: 'user', principalId: 'user-1', roleId: 'lead' },
    ])

    // Replace-all drops the previous set; duplicate principals collapse to their first entry.
    setSurfaceMembers(database, 'surface-channel', [
      { principalType: 'employee', principalId: 'employee-1', roleId: 'duty' },
      { principalType: 'employee', principalId: 'employee-1', roleId: 'ignored' },
    ])
    expect(surfaceMembers(database, 'surface-channel')).toEqual([
      { surfaceId: 'surface-channel', principalType: 'employee', principalId: 'employee-1', roleId: 'duty' },
    ])
    expect(surfaceMembers(database, 'surface-unknown')).toEqual([])

    setSurfaceMembers(database, 'surface-channel', [])
    expect(surfaceMembers(database, 'surface-channel')).toEqual([])
  })

  it('rejects member, roster, and channel writes that name a missing surface', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)

    expect(() => {
      setSurfaceMembers(database, 'surface-unknown', [
        { principalType: 'user', principalId: 'user-1' },
      ])
    }).toThrow(/surface is missing/)
    expect(() => {
      setDutyRoster(database, 'surface-unknown', ['employee-1'])
    }).toThrow(/surface is missing/)
    expect(() => dutyRoster(database, 'surface-unknown')).toThrow(/surface is missing/)
    expect(() => ensureChannelSurface(database, channelRow(row => ({ ...row, id: 'surface-unknown', orgId: 'org-x' }))))
      .toThrow(/FOREIGN KEY constraint failed/i)
  })

  it('creates topics idempotently and settles them exactly once', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)
    ensureChannelSurface(database, channelRow())

    const topic = ensureTopic(database, {
      topicId: 'topic-1', surfaceId: 'surface-channel', title: '上线事项', createdBy: 'user-1',
      sessionId: 'session-1', createdAt: T2,
    })
    expect(topic).toEqual({
      topicId: 'topic-1', surfaceId: 'surface-channel', title: '上线事项', state: 'open',
      sessionId: 'session-1', createdBy: 'user-1', createdAt: T2,
    })
    // The existing row wins over freshly requested values.
    expect(ensureTopic(database, {
      topicId: 'topic-1', surfaceId: 'surface-channel', title: '换标题', createdBy: 'user-1',
      createdAt: T3,
    })).toEqual(topic)
    expect(ensureTopic(database, {
      topicId: 'topic-2', surfaceId: 'surface-channel', title: '无会话话题', createdBy: 'user-1', createdAt: T3,
    }).sessionId).toBeUndefined()

    expect(settleTopic(database, 'topic-1', T3)).toEqual({ ...topic, state: 'settled', settledAt: T3 })
    expect(() => settleTopic(database, 'topic-1', T4)).toThrow(/settled and cannot settle/)
    expect(() => settleTopic(database, 'topic-missing', T4)).toThrow(/topic is missing/)
  })

  it('lists topics in creation order and resolves the topic anchored to a session', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)
    ensureChannelSurface(database, channelRow())

    ensureTopic(database, { topicId: 'topic-b', surfaceId: 'surface-channel', title: '第二', createdBy: 'user-1', createdAt: T2 })
    ensureTopic(database, { topicId: 'topic-a', surfaceId: 'surface-channel', title: '第一', createdBy: 'user-1', sessionId: 'session-1', createdAt: T1 })
    ensureTopic(database, { topicId: 'topic-other', surfaceId: 'surface-channel', title: '别处', createdBy: 'user-1', sessionId: 'session-2', createdAt: T3 })

    expect(topicsBySurface(database, 'surface-channel').map(topic => topic.topicId))
      .toEqual(['topic-a', 'topic-b', 'topic-other'])
    expect(topicBySession(database, 'session-1')?.topicId).toBe('topic-a')
    expect(topicBySession(database, 'session-missing')).toBeUndefined()
  })

  it('reads a topic by id and attaches its session in place', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)
    ensureChannelSurface(database, channelRow())
    ensureTopic(database, { topicId: 'topic-1', surfaceId: 'surface-channel', title: '上线事项', createdBy: 'user-1', createdAt: T1 })

    expect(channelTopic(database, 'topic-1')?.sessionId).toBeUndefined()
    expect(channelTopic(database, 'topic-missing')).toBeUndefined()

    attachTopicSession(database, 'topic-1', 'session-1')
    expect(channelTopic(database, 'topic-1')?.sessionId).toBe('session-1')
    expect(topicBySession(database, 'session-1')?.topicId).toBe('topic-1')
    // The binding replaces any previous session so a recreated session stays authoritative.
    attachTopicSession(database, 'topic-1', 'session-2')
    expect(channelTopic(database, 'topic-1')?.sessionId).toBe('session-2')
    expect(() => {
      attachTopicSession(database, 'topic-missing', 'session-3')
    }).toThrow(/topic is missing/)
  })

  it('round-trips a duty roster and fails loud when stored values left their closed sets', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)
    ensureDefaultSurface(database)
    ensureChannelSurface(database, channelRow())

    setDutyRoster(database, 'surface-channel', ['employee-2', 'employee-1', 'employee-2'])
    expect(dutyRoster(database, 'surface-channel')).toEqual(['employee-2', 'employee-1'])
    setDutyRoster(database, 'surface-channel', [])
    expect(dutyRoster(database, 'surface-channel')).toEqual([])
    // A dm surface never carries a roster; the NULL column reads as an empty one.
    expect(dutyRoster(database, 'surface-1')).toEqual([])

    database.exec('PRAGMA ignore_check_constraints = ON')
    database.prepare("UPDATE surfaces SET topic_policy = 'bogus' WHERE id = ?").run('surface-channel')
    database.prepare("UPDATE surfaces SET duty_employee_ids = 'not-json' WHERE id = ?").run('surface-channel')
    database.exec('PRAGMA ignore_check_constraints = OFF')

    expect(() => dutyRoster(database, 'surface-channel')).toThrow(/invalid duty_employee_ids value/)
    database.prepare('UPDATE surfaces SET duty_employee_ids = ? WHERE id = ?').run('[]', 'surface-channel')
    expect(() => ensureChannelSurface(database, channelRow())).toThrow(/invalid topic_policy value/)

    database.exec('PRAGMA ignore_check_constraints = ON')
    database.prepare("UPDATE surfaces SET duty_employee_ids = '{\"a\":1}' WHERE id = ?").run('surface-channel')
    database.exec('PRAGMA ignore_check_constraints = OFF')
    expect(() => dutyRoster(database, 'surface-channel')).toThrow(/invalid duty_employee_ids value/)
    expect(() => ensureGroupSurface(database, groupRow())).not.toThrow()
  })

  it('resolves a surfaces.session_id hit to its stored kind instead of rejecting non-dm rows', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)
    ensureChannelSurface(database, channelRow())
    attachSurfaceSession(database, 'surface-channel', 'session-channel')

    expect(surfaceBySession(database, 'session-channel')?.id).toBe('surface-channel')
  })

  it('binds one group session per (surface, employee) pair and replaces it on re-attach', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)
    ensureGroupSurface(database, groupRow())

    expect(groupSurfaceSession(database, 'surface-group', 'employee-1')).toBeUndefined()
    attachGroupSurfaceSession(database, 'surface-group', 'employee-1', 'session-1')
    attachGroupSurfaceSession(database, 'surface-group', 'employee-2', 'session-2')
    expect(groupSurfaceSession(database, 'surface-group', 'employee-1')).toBe('session-1')
    expect(groupSurfaceSession(database, 'surface-group', 'employee-2')).toBe('session-2')

    attachGroupSurfaceSession(database, 'surface-group', 'employee-1', 'session-1b')
    expect(groupSurfaceSession(database, 'surface-group', 'employee-1')).toBe('session-1b')
    expect(groupSurfaceSession(database, 'surface-group', 'employee-missing')).toBeUndefined()
  })

  it('fails loud when attaching a group session to a missing surface and cascades on surface delete', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)
    ensureGroupSurface(database, groupRow())
    attachGroupSurfaceSession(database, 'surface-group', 'employee-1', 'session-1')

    expect(() => {
      attachGroupSurfaceSession(database, 'surface-missing', 'employee-1', 'session-x')
    }).toThrow(/FOREIGN KEY constraint failed/i)

    database.prepare('DELETE FROM surfaces WHERE id = ?').run('surface-group')
    expect(groupSurfaceSession(database, 'surface-group', 'employee-1')).toBeUndefined()
    expect(groupSessionBinding(database, 'session-1')).toBeUndefined()
  })

  it('reads the (surface, employee) binding of one group session by session id', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)
    ensureGroupSurface(database, groupRow())
    attachGroupSurfaceSession(database, 'surface-group', 'employee-1', 'session-1')

    expect(groupSessionBinding(database, 'session-1')).toEqual({
      surfaceId: 'surface-group', employeeId: 'employee-1',
    })
    expect(groupSessionBinding(database, 'session-other')).toBeUndefined()
  })

  it('resolves the anchoring surface through every anchor kind, projects included', () => {
    const database = makeDatabase()
    seedSurfaceGraph(database)
    ensureDefaultSurface(database)
    ensureGroupSurface(database, groupRow(row => ({ ...row, projectId: 'project-1' })))
    ensureChannelSurface(database, channelRow())

    // Dm anchor: the surface row's own session_id column.
    attachSurfaceSession(database, 'surface-1', 'session-dm')
    expect(surfaceBySession(database, 'session-dm')).toEqual({ ...surfaceRow(), sessionId: 'session-dm' })

    // Group anchor: the surface_sessions binding; the resolved row carries the surface's project.
    attachGroupSurfaceSession(database, 'surface-group', 'employee-1', 'session-group')
    expect(surfaceBySession(database, 'session-group'))
      .toEqual(expectedGroup({ projectId: 'project-1' }))

    // Channel topic anchor: the topic's session binding resolves its surface.
    ensureTopic(database, {
      topicId: 'topic-1', surfaceId: 'surface-channel', title: '值班', createdBy: 'user-1', createdAt: T2,
    })
    attachTopicSession(database, 'topic-1', 'session-topic')
    expect(surfaceBySession(database, 'session-topic')?.id).toBe('surface-channel')

    expect(surfaceBySession(database, 'session-unknown')).toBeUndefined()
  })
})
