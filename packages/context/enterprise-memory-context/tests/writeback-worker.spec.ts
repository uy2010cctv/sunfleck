import { describe, expect, it } from 'vitest'
import type { EnterpriseMemoryEntry, EnterpriseWorkspaceGrant } from '@deepseek-ai/dsh-enterprise-identity'
import { processMemoryWriteback, type MemoryWritebackJob } from '../src/writeback-worker.ts'

const grant: EnterpriseWorkspaceGrant = {
  workspaceId: 'ws', orgId: 'org-a', name: 'Finance', kind: 'department', departmentId: 'finance',
  rootPath: '/managed/finance', sandboxMode: 'workspace-write', revision: 1, createdAt: 1, updatedAt: 1,
}

function job(): MemoryWritebackJob {
  return {
    sourceKey: 'session-1:1', orgId: 'org-a', workspaceId: 'ws', departmentId: 'finance',
    actorUserId: 'user-1', sessionId: 'session-1', turn: 1, provider: 'deepseek', model: 'v4',
    userText: '月度报表每月 5 日前完成。', assistantText: '已确认。', attempts: 1, leaseOwner: 'worker-1',
  }
}

function memory(summary: string, status: EnterpriseMemoryEntry['status'] = 'approved'): EnterpriseMemoryEntry {
  return {
    id: 'memory-1', orgId: 'org-a', scope: 'department', departmentId: 'finance', kind: 'process', status,
    summary, sourceDigest: 'a'.repeat(64), privacyFindings: [], createdBy: 'user-1', revision: 2,
    createdAt: 1, updatedAt: 2,
  }
}

describe('enterprise memory writeback reconciliation', () => {
  it('skips an exact existing memory without writing another record', async () => {
    const proposed: unknown[] = []
    const result = await processMemoryWriteback(job(), {
      currentGrant: async () => grant, currentActorEnabled: async () => true,
      listMemories: async () => [memory('月度报表须在每月 5 日前完成。')],
      extract: async () => [{ action: 'create', scope: 'department', kind: 'process',
        summary: '月度报表须在每月 5 日前完成。', confidence: .98, reason: 'confirmed' }],
      propose: async (input) => { proposed.push(input); return memory(input.summary, 'proposed') },
      approve: async value => value,
      audit: async () => undefined,
    })
    expect(result).toMatchObject({ outcome: 'completed', skipped: 1, activated: 0, pending: 0 })
    expect(proposed).toHaveLength(0)
  })

  it('activates high-confidence new knowledge and leaves conflicts pending', async () => {
    const approvals: string[] = []
    const result = await processMemoryWriteback(job(), {
      currentGrant: async () => grant, currentActorEnabled: async () => true, listMemories: async () => [],
      extract: async () => [
        { action: 'create', scope: 'department', kind: 'process', summary: '月度报表每月 5 日前完成。', confidence: .98, reason: 'confirmed' },
        { action: 'conflict', scope: 'department', kind: 'decision', summary: '报表截止日可能调整。', confidence: .8, reason: 'conflict' },
      ],
      propose: async input => memory(input.summary, 'proposed'),
      approve: async (value) => { approvals.push(value.summary); return { ...value, status: 'approved' } },
      audit: async () => undefined,
    })
    expect(result).toMatchObject({ outcome: 'completed', activated: 1, pending: 1, skipped: 0 })
    expect(approvals).toEqual(['月度报表每月 5 日前完成。'])
  })

  it('rechecks workspace and actor authority before extraction', async () => {
    let extracted = false
    await expect(processMemoryWriteback(job(), {
      currentGrant: async () => undefined, currentActorEnabled: async () => true, listMemories: async () => [],
      extract: async () => { extracted = true; return [] }, propose: async () => memory('x'),
      approve: async value => value, audit: async () => undefined,
    })).rejects.toThrow(/workspace/iu)
    expect(extracted).toBe(false)
  })

  it('finishes an interrupted high-confidence activation without duplicating the proposal', async () => {
    const prior = memory('月度报表每月 5 日前完成。', 'proposed')
    const approvals: string[] = []
    const result = await processMemoryWriteback(job(), {
      currentGrant: async () => grant, currentActorEnabled: async () => true, listMemories: async () => [{
        ...prior,
        id: 'turn-memory-5ed0f9859ee3638436592e5a4571da6b219585b7d4c3aa90eaaaac9d30fef8d4',
      }],
      extract: async () => [{ action: 'create', scope: 'department', kind: 'process',
        summary: '月度报表每月 5 日前完成。', confidence: .98, reason: 'confirmed' }],
      propose: async () => { throw new Error('must reuse prior proposal') },
      approve: async (value) => { approvals.push(value.id); return { ...value, status: 'approved' } },
      audit: async () => undefined,
    })
    expect(result.activated).toBe(1)
    expect(approvals).toHaveLength(1)
  })
})
