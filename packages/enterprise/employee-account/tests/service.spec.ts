import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import {
  attachGroupSurfaceSession,
  attachSurfaceSession,
  attachTopicSession,
  ensureChannelSurface,
  ensureGroupSurface,
  ensureSurface,
  ensureTopic,
  migrateEnterpriseIdentity,
} from '@deepseek-ai/dsh-enterprise-identity'
import { describe, expect, it } from 'vitest'
import { apply, employeeId, EmployeeAccountService, surfaceId } from '../src/index.ts'
import type { EmployeeAccount, EmployeeId } from '../src/index.ts'

/** An employee id no fixture account owns. */
function employeeIdFixture(): EmployeeId {
  return employeeId('employee-missing')
}

/** Open a fresh in-memory database migrated to the current enterprise identity schema. */
function makeDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  migrateEnterpriseIdentity(database)
  return database
}

/** Insert the organization and user rows that employee, surface, and inbox rows reference. */
function seedOrgAndUser(database: DatabaseSync): void {
  database.prepare('INSERT INTO organizations(id, name) VALUES (?, ?)').run('org-1', 'Existing enterprise')
  database.prepare('INSERT INTO users(id, org_id, username, display_name, disabled) VALUES (?, ?, ?, ?, ?)')
    .run('user-1', 'org-1', 'alice', 'Alice', 0)
}

/** Create one service over a migrated database seeded with the org and user fixture rows. */
function makeService(): { database: DatabaseSync; service: EmployeeAccountService } {
  const database = makeDatabase()
  seedOrgAndUser(database)
  return { database, service: new EmployeeAccountService(database) }
}

/** Create one active employee and the direct-message surface its inbox tests enqueue on. */
function createEmployeeWithSurface(service: EmployeeAccountService, database: DatabaseSync): EmployeeAccount {
  const account = service.create({
    orgId: 'org-1', displayName: 'Support', roleCard: '客服助理',
    homeWorkspacePath: '/managed/employees/support',
  })
  ensureSurface(database, {
    id: `surface-${account.id}`, orgId: 'org-1', kind: 'dm', userId: 'user-1',
    employeeId: account.id, sessionId: null, createdAt: 1,
  })
  return account
}

describe('EmployeeAccountService.create', () => {
  it('creates an active account whose optional release id round-trips through get', () => {
    const { service } = makeService()
    const withRelease = service.create({
      orgId: 'org-1', displayName: 'Support', roleCard: '客服助理',
      homeWorkspacePath: '/managed/employees/support', activeReleaseId: 'release-1',
    })
    expect(withRelease.state).toBe('active')
    expect(withRelease.activeReleaseId).toBe('release-1')
    expect(service.get(withRelease.id)).toEqual(withRelease)

    const withoutRelease = service.create({
      orgId: 'org-1', displayName: 'Billing', roleCard: '账务助理',
      homeWorkspacePath: '/managed/employees/billing',
    })
    expect('activeReleaseId' in withoutRelease).toBe(false)
    expect(service.get(withoutRelease.id)?.displayName).toBe('Billing')
  })

  it('returns undefined for an unknown id', () => {
    const { service } = makeService()
    expect(service.get(employeeIdFixture())).toBeUndefined()
  })

  it('rejects an empty displayName, an empty roleCard, and a relative homeWorkspacePath', () => {
    const { service } = makeService()
    expect(() => service.create({
      orgId: 'org-1', displayName: '  ', roleCard: '客服助理', homeWorkspacePath: '/managed/employees/support',
    })).toThrow(TypeError)
    expect(() => service.create({
      orgId: 'org-1', displayName: 'Support', roleCard: '', homeWorkspacePath: '/managed/employees/support',
    })).toThrow(/roleCard/)
    expect(() => service.create({
      orgId: 'org-1', displayName: 'Support', roleCard: '客服助理', homeWorkspacePath: 'managed/employees/support',
    })).toThrow(/absolute path/)
  })
})

describe('EmployeeAccountService.list', () => {
  it('lists accounts and excludes archived accounts unless included', () => {
    const { service } = makeService()
    const first = service.create({
      orgId: 'org-1', displayName: 'Support', roleCard: '客服助理', homeWorkspacePath: '/managed/employees/support',
    })
    const second = service.create({
      orgId: 'org-1', displayName: 'Billing', roleCard: '账务助理', homeWorkspacePath: '/managed/employees/billing',
    })
    service.setState(second.id, 'archived')

    expect(service.list('org-1').map(account => account.id)).toEqual([first.id])
    expect(service.list('org-1', { includeArchived: true }).map(account => account.displayName).sort())
      .toEqual(['Billing', 'Support'])
    expect(service.list('org-other')).toEqual([])
  })
})

describe('EmployeeAccountService.setState', () => {
  it('moves an account through suspend and back and refuses to revive an archived account', () => {
    const { service } = makeService()
    const account = service.create({
      orgId: 'org-1', displayName: 'Support', roleCard: '客服助理', homeWorkspacePath: '/managed/employees/support',
    })

    service.setState(account.id, 'suspended')
    expect(service.get(account.id)?.state).toBe('suspended')
    service.setState(account.id, 'active')
    expect(service.get(account.id)?.state).toBe('active')

    service.setState(account.id, 'archived')
    expect(() => { service.setState(account.id, 'active') }).toThrow(/current state: archived/)
    expect(service.get(account.id)?.state).toBe('archived')
  })

  it('refuses to move a missing account', () => {
    const { service } = makeService()
    expect(() => { service.setState(employeeIdFixture(), 'active') }).toThrow(/is missing/)
  })
})

describe('EmployeeAccountService sticky bindings', () => {
  it('binds, replaces, and resolves an actor key inside its organization only', () => {
    const { service } = makeService()
    const first = service.create({
      orgId: 'org-1', displayName: 'Support', roleCard: '客服助理', homeWorkspacePath: '/managed/employees/support',
    })
    const second = service.create({
      orgId: 'org-1', displayName: 'Billing', roleCard: '账务助理', homeWorkspacePath: '/managed/employees/billing',
    })

    service.bindSticky('org-1', 'actor-a', first.id)
    expect(service.resolveSticky('org-1', 'actor-a')).toBe(first.id)
    service.bindSticky('org-1', 'actor-a', second.id)
    expect(service.resolveSticky('org-1', 'actor-a')).toBe(second.id)

    expect(service.resolveSticky('org-2', 'actor-a')).toBeUndefined()
    expect(service.resolveSticky('org-1', 'actor-unbound')).toBeUndefined()
  })

  it('refuses to bind a missing employee or an employee from another organization', () => {
    const { database, service } = makeService()
    database.prepare('INSERT INTO organizations(id, name) VALUES (?, ?)').run('org-2', 'Other enterprise')
    const foreign = service.create({
      orgId: 'org-2', displayName: 'Support', roleCard: '客服助理', homeWorkspacePath: '/managed/employees/support',
    })

    expect(() => { service.bindSticky('org-1', 'actor-a', employeeIdFixture()) }).toThrow(/is missing/)
    expect(() => { service.bindSticky('org-1', 'actor-a', foreign.id) }).toThrow(/belongs to org-2/)
    expect(service.resolveSticky('org-1', 'actor-a')).toBeUndefined()
  })
})

describe('EmployeeAccountService inbox', () => {
  it('refuses a negative claim limit before touching the store', () => {
    const { service } = makeService()
    expect(() => { service.claim(employeeIdFixture(), -1) }).toThrow(TypeError)
  })

  it('enqueues an item and claims it once, honoring the claim limit', () => {
    const { database, service } = makeService()
    const account = createEmployeeWithSurface(service, database)
    const surface = surfaceId(`surface-${account.id}`)

    const first = service.enqueue({
      employeeId: account.id, surfaceId: surface, originActor: 'actor-a', payloadText: '你好',
    })
    expect(first.state).toBe('queued')
    expect(first.employeeId).toBe(account.id)
    expect(first.surfaceId).toBe(surface)
    const second = service.enqueue({
      employeeId: account.id, surfaceId: surface, originActor: 'actor-b', payloadText: '在吗',
    })

    const claimed = service.claim(account.id, 1)
    expect(claimed).toHaveLength(1)
    expect(claimed[0]?.state).toBe('delivered')

    const rest = service.claim(account.id, 10)
    expect(rest.map(item => item.id)).toEqual([first.id, second.id].filter(id => id !== claimed[0]?.id))
    expect(service.claim(account.id, 10)).toEqual([])
  })

  it('refuses to enqueue for a missing employee', () => {
    const { service } = makeService()
    const account = service.create({
      orgId: 'org-1', displayName: 'Support', roleCard: '客服助理', homeWorkspacePath: '/managed/employees/support',
    })
    expect(() => service.enqueue({
      employeeId: employeeIdFixture(), surfaceId: surfaceId(`surface-${account.id}`),
      originActor: 'actor-a', payloadText: '你好',
    })).toThrow(/is missing/)
  })
})

describe('EmployeeAccountService.findByHomeWorkspacePath', () => {
  it('reads the account claiming a home workspace and returns undefined for an unknown path', () => {
    const { service } = makeService()
    const support = service.create({
      orgId: 'org-1', displayName: 'Support', roleCard: '客服助理', homeWorkspacePath: '/managed/employees/support',
    })
    service.create({
      orgId: 'org-1', displayName: 'Billing', roleCard: '账务助理', homeWorkspacePath: '/managed/employees/billing',
    })

    expect(service.findByHomeWorkspacePath('/managed/employees/support')).toEqual(support)
    // Exact string equality mirrors the workspace-grant root-path lookup; no normalization.
    expect(service.findByHomeWorkspacePath('/managed/employees/support/')).toBeUndefined()
    expect(service.findByHomeWorkspacePath('/managed/employees/missing')).toBeUndefined()
  })
})

describe('employee-account plugin', () => {
  it('provides ctx.employeeAccounts over the configured database', () => {
    const database = makeDatabase()
    seedOrgAndUser(database)
    const ctx = new Context()
    apply(ctx, { database })

    const account = ctx.employeeAccounts.create({
      orgId: 'org-1', displayName: 'Support', roleCard: '客服助理', homeWorkspacePath: '/managed/employees/support',
    })
    expect(ctx.employeeAccounts.get(account.id)?.id).toBe(account.id)
  })
})

describe('EmployeeAccountService.resolveSessionActor', () => {
  it('resolves the org, surface user, and employee from one anchored session', () => {
    const { database, service } = makeService()
    const account = createEmployeeWithSurface(service, database)
    attachSurfaceSession(database, `surface-${account.id}`, 'session-1')

    expect(service.resolveSessionActor('session-1')).toEqual({
      orgId: 'org-1', userId: 'user-1', employeeId: account.id,
    })
  })

  it('resolves a group member session to its employee and the surface project', () => {
    const { database, service } = makeService()
    const account = createEmployeeWithSurface(service, database)
    ensureGroupSurface(database, {
      id: 'surface-group', orgId: 'org-1', name: '支持群', projectId: 'project-1', createdAt: 1,
    })
    attachGroupSurfaceSession(database, 'surface-group', account.id, 'session-group')

    expect(service.resolveSessionActor('session-group')).toEqual({
      orgId: 'org-1', employeeId: account.id, projectId: 'project-1',
    })
  })

  it('resolves a channel topic session to the surface project without a principal identity', () => {
    const { database, service } = makeService()
    createEmployeeWithSurface(service, database)
    ensureChannelSurface(database, {
      id: 'surface-channel', orgId: 'org-1', name: '值班频道', topicPolicy: 'thread',
      respondPolicy: 'mention_duty', dutyEmployeeIds: [], createdAt: 1,
    })
    ensureTopic(database, {
      topicId: 'topic-1', surfaceId: 'surface-channel', title: '值班', createdBy: 'user-1', createdAt: 1,
    })
    attachTopicSession(database, 'topic-1', 'session-topic')

    expect(service.resolveSessionActor('session-topic')).toEqual({ orgId: 'org-1' })
  })

  it('returns undefined for a session no surface anchors', () => {
    const { service } = makeService()
    expect(service.resolveSessionActor('session-unknown')).toBeUndefined()
  })
})
