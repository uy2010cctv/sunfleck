import { describe, expect, it } from 'vitest'
import type { EnterpriseMemoryEntry } from '@deepseek-ai/dsh-enterprise-identity'
import { selectRelevantMemory } from '../src/retrieval.ts'

function memory(id: string, scope: EnterpriseMemoryEntry['scope'], summary: string, updatedAt: number): EnterpriseMemoryEntry {
  return {
    id, orgId: 'org-a', scope, kind: 'business-fact', status: 'approved', summary,
    sourceDigest: id.padEnd(64, 'a').slice(0, 64), privacyFindings: [], createdBy: 'user-1',
    revision: 1, createdAt: updatedAt, updatedAt,
  }
}

describe('enterprise memory relevance retrieval', () => {
  it('prefers task-relevant memory over a newer unrelated entry after ACL filtering', () => {
    const selected = selectRelevantMemory([
      memory('new-unrelated', 'organization', '员工工牌使用蓝色系带。', 30),
      memory('purchase-process', 'department', '采购订单入库前必须完成审批。', 10),
      memory('user-format', 'user', '我的采购报告使用中文。', 20),
    ], '帮我审核这份采购订单并生成报告', 2)

    expect(selected.map(item => item.id)).toEqual(['purchase-process', 'user-format'])
  })

  it('falls back to newest entries when no current task text exists', () => {
    const selected = selectRelevantMemory([
      memory('old', 'organization', '旧规则', 1),
      memory('new', 'department', '新规则', 2),
    ], '', 1)

    expect(selected.map(item => item.id)).toEqual(['new'])
  })
})
