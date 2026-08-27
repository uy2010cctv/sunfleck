import { describe, expect, it, vi } from 'vitest'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import {
  EnterpriseOperationsAuthorizationError,
  EnterpriseOperationsService,
  type EnterpriseOperationsDriver,
} from '../src/index.ts'

const principal: EnterprisePrincipal = { userId: 'user-a', orgId: 'org-a', roles: ['operator'] }

function driver(overrides: Partial<EnterpriseOperationsDriver> = {}): EnterpriseOperationsDriver {
  return {
    upsertWorkRecord: vi.fn(),
    getWorkRecord: vi.fn(),
    listWorkRecords: vi.fn().mockResolvedValue({ items: [] }),
    createApprovalRequest: vi.fn(),
    getApproval: vi.fn(),
    listApprovals: vi.fn().mockResolvedValue({ items: [] }),
    transitionApproval: vi.fn(),
    createSchedule: vi.fn(),
    saveSchedule: vi.fn(),
    getSchedule: vi.fn(),
    listSchedules: vi.fn().mockResolvedValue([]),
    transitionSchedule: vi.fn(),
    fireSchedule: vi.fn(),
    claimOutbox: vi.fn().mockResolvedValue([]),
    completeOutbox: vi.fn(),
    failOutbox: vi.fn(),
    createFixedTeam: vi.fn(),
    saveFixedTeam: vi.fn(),
    getFixedTeam: vi.fn(),
    listFixedTeams: vi.fn().mockResolvedValue({ items: [] }),
    ...overrides,
  }
}

describe('EnterpriseOperationsService', () => {
  it('denies a cross-organization request before invoking authorization or the driver', async () => {
    const operations = driver()
    const authorize = vi.fn().mockResolvedValue(true)
    const audit = vi.fn()
    const service = new EnterpriseOperationsService(operations, { authorize, audit })

    await expect(service.listWorkRecords(principal, { orgId: 'org-b' })).rejects.toMatchObject<EnterpriseOperationsAuthorizationError>({
      code: 'organization-mismatch',
    })
    expect(authorize).not.toHaveBeenCalled()
    expect(operations.listWorkRecords).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'enterpriseOperation.workRecords.list',
      decision: { allowed: false, reason: 'organization-mismatch' },
    }))
  })

  it('authorizes and audits an allowed operation, then scopes the driver to the principal organization', async () => {
    const operations = driver()
    const authorize = vi.fn().mockResolvedValue({ allowed: true, reason: 'role' })
    const audit = vi.fn()
    const service = new EnterpriseOperationsService(operations, { authorize, audit })

    await service.listWorkRecords(principal, { businessState: 'active' })

    expect(authorize).toHaveBeenCalledWith(principal, 'enterpriseOperation.workRecords.list', { businessState: 'active' })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      principal,
      endpoint: 'enterpriseOperation.workRecords.list',
      decision: { allowed: true, reason: 'role' },
    }))
    expect(operations.listWorkRecords).toHaveBeenCalledWith({ orgId: 'org-a', businessState: 'active' })
  })

  it('fails closed when the authorization callback denies a mutation', async () => {
    const operations = driver()
    const authorize = vi.fn().mockResolvedValue({ allowed: false, reason: 'insufficient-role' })
    const service = new EnterpriseOperationsService(operations, { authorize, audit: vi.fn() })

    await expect(service.transitionSchedule(principal, {
      scheduleId: 'schedule-a', expectedRevision: 1, state: 'paused', idempotencyKey: 'request-a',
    })).rejects.toMatchObject<EnterpriseOperationsAuthorizationError>({ code: 'insufficient-role' })
    expect(operations.transitionSchedule).not.toHaveBeenCalled()
  })

  it('allows approval cancellation only to its requester or an administrator', async () => {
    const operations = driver({
      getApproval: vi.fn().mockResolvedValue({ approvalId: 'approval-a', orgId: 'org-a', requestedBy: 'owner-a', state: 'pending' }),
    })
    const authorize = vi.fn().mockResolvedValue(true)
    const audit = vi.fn()
    const service = new EnterpriseOperationsService(operations, { authorize, audit })
    await expect(service.transitionApproval(principal, {
      approvalId: 'approval-a', expectedRevision: 1, idempotencyKey: 'cancel-a', state: 'cancelled', actorUserId: 'user-a',
    })).rejects.toMatchObject<EnterpriseOperationsAuthorizationError>({ code: 'insufficient-role' })
    expect(operations.transitionApproval).not.toHaveBeenCalled()
    expect(authorize).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledTimes(1)
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'enterpriseOperation.approvals.transition',
      decision: { allowed: false, reason: 'insufficient-role' },
      resourceType: 'approval', resourceId: 'approval-a',
    }))
  })

  it('forwards schedule filters and cursor through the scoped page contract', async () => {
    const page = { items: [], nextCursor: 'next' }
    const operations = driver({ listSchedules: vi.fn().mockResolvedValue(page) })
    const service = new EnterpriseOperationsService(operations, { authorize: vi.fn().mockResolvedValue(true), audit: vi.fn() })

    await expect(service.listSchedules(principal, { state: 'paused', limit: 10, cursor: 'cursor' })).resolves.toEqual(page)
    expect(operations.listSchedules).toHaveBeenCalledWith({
      orgId: 'org-a', state: 'paused', limit: 10, cursor: 'cursor',
    })
  })
})
