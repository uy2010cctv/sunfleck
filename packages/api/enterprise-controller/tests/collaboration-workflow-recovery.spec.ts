import { describe, expect, it, vi } from 'vitest'
import { recoverCommittedWorkflowDecision } from '../src/collaboration-workflow-recovery.ts'

const decision = { orgId: 'org', channelId: 'channel', approvalId: 'approval',
  state: 'approved' as const, reviewerUserId: 'reviewer' }
const manager = { actor: { orgId: 'org', userId: 'manager', roles: ['administrator'] as const },
  room: { id: 'channel', orgId: 'org', kind: 'channel' as const, name: 'Release', workspaceId: 'w',
    memberUserIds: ['manager'], memberEmployeeIds: ['editor'], dutyEmployeeIds: [] } }

describe('committed workflow decision recovery', () => {
  it('uses a signed service attestation when the original reviewer lost access', async () => {
    const recordHuman = vi.fn(async () => undefined)
    const recordService = vi.fn(async () => undefined)
    const resume = vi.fn(async () => undefined)
    const result = await recoverCommittedWorkflowDecision(decision, {
      reviewer: async () => undefined, manager: async () => manager,
      hasHumanRecord: async () => false, recordHuman, recordService, resume,
    })
    expect(result).toBe('service')
    expect(recordHuman).not.toHaveBeenCalled()
    expect(recordService).toHaveBeenCalledWith(manager, decision)
    expect(resume).toHaveBeenCalledWith(manager, decision)
  })

  it('continues under the reviewer identity while authorization remains current', async () => {
    const recordHuman = vi.fn(async () => undefined)
    const recordService = vi.fn(async () => undefined)
    const resume = vi.fn(async () => undefined)
    expect(await recoverCommittedWorkflowDecision(decision, {
      reviewer: async () => manager, manager: async () => undefined,
      hasHumanRecord: async () => false, recordHuman, recordService, resume,
    })).toBe('human')
    expect(recordHuman).toHaveBeenCalledWith(manager, decision)
    expect(recordService).not.toHaveBeenCalled()
    expect(resume).toHaveBeenCalledWith(manager, decision)
  })
})
