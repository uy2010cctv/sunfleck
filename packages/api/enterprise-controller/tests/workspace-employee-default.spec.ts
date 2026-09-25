import { describe, expect, it } from 'vitest'
import { WorkspaceEmployeeDefaultService } from '../src/workspace-employee-default.ts'

const admin = { orgId: 'org', userId: 'admin', roles: ['administrator'] } as never
const manager = { orgId: 'org', userId: 'manager', roles: [] } as never
const member = { orgId: 'org', userId: 'member', roles: [] } as never

function fixture() {
  let row: { workspaceId: string; orgId: string; employeeId: string | null; revision: number } | undefined
  const service = new WorkspaceEmployeeDefaultService({
    grant: async () => ({ workspaceId: 'work', orgId: 'org', kind: 'department' as const, departmentId: 'dept' }),
    mayUseWorkspace: async () => true,
    departmentManagers: async () => ['manager'],
    publishedEmployee: async id => id === 'employee' ? { presetId: id, orgId: 'org' } : undefined,
    mayUseEmployee: async actor => actor.userId !== 'member',
    read: async () => row,
    save: async (input) => {
      if ((row?.revision ?? 0) !== input.expectedRevision) throw new Error('revision conflict')
      row = { workspaceId: input.workspaceId, orgId: input.orgId, employeeId: input.employeeId, revision: input.expectedRevision + 1 }
      return row
    },
  })
  return service
}

describe('workspace employee default', () => {
  it('allows managers to set and clear with revisions and hides an unavailable employee from members', async () => {
    const service = fixture()
    await expect(service.save(member, { workspaceId: 'work', employeeId: 'employee', expectedRevision: 0 })).rejects.toThrow('manager')
    const saved = await service.save(manager, { workspaceId: 'work', employeeId: 'employee', expectedRevision: 0 })
    expect(saved).toMatchObject({ employeeId: 'employee', revision: 1 })
    await expect(service.read(member, 'work')).resolves.toMatchObject({ employeeId: null, unavailable: true, revision: 1 })
    await expect(service.read(admin, 'work')).resolves.toMatchObject({ employeeId: 'employee', revision: 1 })
    await expect(service.save(manager, { workspaceId: 'work', employeeId: null, expectedRevision: 0 })).rejects.toThrow('revision conflict')
    await expect(service.save(manager, { workspaceId: 'work', employeeId: null, expectedRevision: 1 })).resolves.toMatchObject({ employeeId: null, revision: 2 })
  })
  it('lets a personal owner edit and rejects other users and organizations', async () => {
    let row: { workspaceId: string; orgId: string; employeeId: string | null; revision: number } | undefined
    const service = new WorkspaceEmployeeDefaultService({
      grant: async () => ({ workspaceId: 'personal', orgId: 'org', kind: 'personal', ownerUserId: 'manager' }),
      mayUseWorkspace: async () => true,
      departmentManagers: async () => [],
      publishedEmployee: async id => ({ presetId: id, orgId: 'org' }),
      mayUseEmployee: async () => true,
      read: async () => row,
      save: async input => row = {
        workspaceId: input.workspaceId, orgId: input.orgId, employeeId: input.employeeId,
        revision: input.expectedRevision + 1,
      },
    })
    await expect(service.save(member, { workspaceId: 'personal', employeeId: 'employee', expectedRevision: 0 })).rejects.toThrow('manager')
    await expect(service.save({ orgId: 'other', userId: 'member', roles: [] },
      { workspaceId: 'personal', employeeId: 'employee', expectedRevision: 0 })).rejects.toThrow('not available')
    await expect(service.save(manager, { workspaceId: 'personal', employeeId: 'employee', expectedRevision: 0 }))
      .resolves.toMatchObject({ employeeId: 'employee' })
  })
})
