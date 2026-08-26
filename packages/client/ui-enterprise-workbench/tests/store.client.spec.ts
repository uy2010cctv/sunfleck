import { describe, expect, it } from 'vitest'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentPresetEntry } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {
  SessionListState, SessionSummary, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { deriveEnterpriseView } from '../src/client/store.ts'

const STANDARD: AgentPresetEntry = {
  id: 'standard',
  trust: 'system',
  isDefault: true,
  name: '标准模式',
  description: '完整编码员工。',
  employee: {
    position: '通用执行员工',
    department: '数字化运营',
    capabilities: ['文件执行', '信息检索'],
  },
}

function sessions(
  rows: Array<Omit<Partial<SessionSummary>, 'id'> & { id: string }>,
): SessionListState {
  const byId = Object.fromEntries(rows.map((row, index) => {
    const { id: rawId, ...overrides } = row
    const id = rawId as SessionId
    return [id, {
      id,
      displayTitle: row.displayTitle ?? rawId,
      running: false,
      blank: false,
      updatedAt: 100 - index,
      ...overrides,
    }]
  })) as SessionListState['byId']
  return {
    ids: rows.map(row => row.id as SessionId),
    byId,
    current: undefined,
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
    currentAddress: undefined,
  }
}

function workspaces(): WorkspaceListState {
  return {
    items: [{
      workspaceId: 'workspace-1' as WorkspaceId,
      path: '/business/procurement',
      title: '采购部',
      sessionIds: ['session-1' as SessionId, 'session-2' as SessionId],
      createdAt: '2026-08-26T00:00:00.000Z',
      updatedAt: '2026-08-26T00:00:01.000Z',
    }],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: 'workspace-1' as WorkspaceId,
  }
}

describe('deriveEnterpriseView employees', () => {
  it('projects a healthy preset as an active employee from real Session state', () => {
    const view = deriveEnterpriseView([STANDARD], sessions([
      { id: 'session-1', agentPreset: 'standard', running: true },
      { id: 'session-2', agentPreset: 'standard', completed: true },
      { id: 'blank', agentPreset: 'standard', blank: true },
    ]), workspaces())

    expect(view.employees[0]).toMatchObject({
      id: 'standard',
      employeeCode: 'standard',
      name: '标准模式',
      position: '通用执行员工',
      department: '数字化运营',
      capabilities: ['文件执行', '信息检索'],
      status: 'active',
      activeWork: 1,
      recentWork: 2,
      custom: false,
    })
  })

  it('gives attention and unavailable states precedence over ordinary activity', () => {
    const broken: AgentPresetEntry = {
      id: 'broken', trust: 'user', isDefault: false, broken: 'composition missing',
    }
    const view = deriveEnterpriseView([STANDARD, broken], sessions([
      {
        id: 'session-1', agentPreset: 'standard', running: true,
        pendingInteraction: { kind: 'approval' } as never,
      },
    ]), workspaces())

    expect(view.employees.map(employee => [employee.id, employee.status])).toEqual([
      ['standard', 'attention'],
      ['broken', 'unavailable'],
    ])
    expect(view.employees[1]?.custom).toBe(true)
  })
})

describe('deriveEnterpriseView records and metrics', () => {
  it('orders non-blank work records newest-first and resolves employee and workspace', () => {
    const view = deriveEnterpriseView([STANDARD], sessions([
      {
        id: 'session-1', agentPreset: 'standard', running: true, updatedAt: 20,
        displayTitle: '供应商核验',
      },
      {
        id: 'session-2', agentPreset: 'standard', completed: true, updatedAt: 30,
        displayTitle: '合同复核',
      },
      { id: 'blank', agentPreset: 'standard', blank: true, updatedAt: 40 },
    ]), workspaces())

    expect(view.records.map(record => record.sessionId)).toEqual(['session-2', 'session-1'])
    expect(view.records[0]).toMatchObject({
      title: '合同复核',
      employeeId: 'standard',
      employeeName: '标准模式',
      workspaceTitle: '采购部',
      state: 'completed',
    })
    expect(view.metrics).toEqual({
      employees: 1,
      active: 1,
      attention: 0,
      workRecords: 2,
      workspaces: 1,
    })
  })

  it('keeps legacy unassigned records visible without inventing an employee', () => {
    const view = deriveEnterpriseView([], sessions([
      { id: 'legacy', displayTitle: '历史会话', updatedAt: 1 },
    ]), workspaces())

    expect(view.records[0]).toMatchObject({
      sessionId: 'legacy',
      state: 'ready',
    })
    expect(view.records[0]).not.toHaveProperty('employeeId')
    expect(view.records[0]).not.toHaveProperty('employeeName')
  })
})
