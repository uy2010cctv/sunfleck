import { describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentPresetEntry } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {
  SessionListState, SessionSummary, WorkspaceListState,
} from '@deepseek-ai/dsh-client-runtime/client'
import { deriveEnterpriseView, EnterpriseWorkbenchController } from '../src/client/store.ts'

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

const ok = <T>(value: T) => Promise.resolve({ result: { ok: true as const, value } })
const unavailable = () => Promise.resolve({
  result: {
    ok: false as const,
    error: { code: 'internal', message: 'enterprise API is unavailable in this profile', details: {} },
  },
})

function controllerApi(overrides: Record<string, unknown> = {}) {
  return {
    agentPresets: { list: () => ok({ presets: [STANDARD], authorable: false, hasDocument: false }) },
    enterpriseEmployees: {
      list: () => ok({ items: [{
        presetId: 'buyer', orgId: 'server-org', ownerUserId: 'owner-1', visibility: 'restricted',
        profile: { name: '采购专员', position: '采购执行', capabilities: ['询价'] },
        bindings: [{ kind: 'sop', assetId: 'rfq', version: 2 }], revision: 4,
        status: 'published', updatedAt: 20,
      }], nextCursor: 'employee-next' }),
      getDraft: () => ok({
        presetId: 'buyer', orgId: 'server-org', ownerUserId: 'owner-1', visibility: 'restricted',
        profile: { name: '采购专员', prompt: '核验供应商', modelRef: 'deepseek-chat' }, bindings: [],
        revision: 4, status: 'published', updatedAt: 20,
      }),
      saveDraft: () => ok({}), publish: () => ok({}), listReleases: () => ok([]), rollback: () => ok({}),
    },
    enterpriseAssets: {
      list: () => ok({ items: [] }), get: () => ok({}), saveVersion: () => ok({}),
      listVersions: () => ok([]), archive: () => ok({}),
    },
    enterpriseTeams: { list: () => ok({ items: [] }), get: () => ok({}), save: () => ok({}) },
    enterpriseOperations: {
      listWorkRecords: () => ok({ items: [{
        orgId: 'server-org', sessionId: 'session-1', employeeReleaseId: 'release-2', source: 'console',
        businessState: 'active', sourceReferences: { presetId: 'buyer', title: '核验供应商' },
        revision: 3, createdAt: 10, updatedAt: 30,
      }] }),
      getWorkRecord: () => ok({}), updateWorkRecord: () => ok({}),
      listApprovals: () => ok({ items: [] }), getApproval: () => ok({}),
      createApproval: () => ok({}), transitionApproval: () => ok({}), cancelApproval: () => ok({}),
      listSchedules: () => ok({ items: [] }), getSchedule: () => ok({}), saveSchedule: () => ok({}), transitionSchedule: () => ok({}),
    },
    ...overrides,
  }
}

function controllerServices() {
  return {
    sessions: {
      list: { getSnapshot: () => sessions([]), subscribe: () => () => {} },
      create: () => Promise.resolve('session-new' as SessionId), open: () => {},
    },
    workspaces: { list: { getSnapshot: workspaces, subscribe: () => () => {} } },
  }
}

describe('EnterpriseWorkbenchController enterprise read models', () => {
  it('loads PostgreSQL employee and operations pages and forwards roster filters/cursor', async () => {
    const list = vi.fn(controllerApi().enterpriseEmployees.list)
    const api = controllerApi({ enterpriseEmployees: { ...controllerApi().enterpriseEmployees, list } })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never)

    controller.setEmployeeFilters({ search: '采购', status: 'published', visibility: 'restricted', ownerUserId: 'owner-1' })
    await controller.refresh()
    await controller.loadMoreEmployees()

    expect(list).toHaveBeenNthCalledWith(1, {
      limit: 24, search: '采购', status: 'published', visibility: 'restricted', ownerUserId: 'owner-1',
    })
    expect(list).toHaveBeenNthCalledWith(2, {
      limit: 24, cursor: 'employee-next', search: '采购', status: 'published', visibility: 'restricted', ownerUserId: 'owner-1',
    })
    expect(controller.store.getSnapshot()).toMatchObject({
      mode: 'enterprise',
      employees: { phase: 'ready', nextCursor: 'employee-next' },
      workRecords: { phase: 'ready' },
    })
  })

  it('falls back to native AgentPreset/Session projections only when enterprise is unavailable', async () => {
    const api = controllerApi({
      enterpriseEmployees: { ...controllerApi().enterpriseEmployees, list: unavailable },
    })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never)

    await controller.refresh()

    expect(controller.store.getSnapshot()).toMatchObject({ mode: 'fallback', phase: 'ready' })
    expect(controller.store.getSnapshot().view?.employees[0]?.id).toBe('standard')
  })
})

describe('EnterpriseWorkbenchController edits, mutations, and events', () => {
  it('saves the explicit employee draft without sending principal or organization fields', async () => {
    const saveDraft = vi.fn((_payload: unknown) => ok({
      presetId: 'buyer', orgId: 'server-org', ownerUserId: 'owner-1', visibility: 'private',
      profile: { name: '采购员' }, bindings: [], revision: 5, status: 'draft', updatedAt: 30,
    }))
    const api = controllerApi({ enterpriseEmployees: { ...controllerApi().enterpriseEmployees, saveDraft } })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never)
    await controller.openEmployeeDraft('buyer')
    controller.patchEmployeeDraft({ name: '采购员', visibility: 'private' })

    await controller.saveEmployeeDraft()

    expect(saveDraft).toHaveBeenCalledTimes(1)
    const payload = saveDraft.mock.calls[0]?.[0] as Record<string, unknown>
    expect(payload).toMatchObject({ presetId: 'buyer', expectedRevision: 4, visibility: 'private' })
    expect(payload).not.toHaveProperty('orgId')
    expect(payload).not.toHaveProperty('principal')
    expect(controller.store.getSnapshot().employeeEditor).toMatchObject({ dirty: false, conflict: false })
  })

  it('keeps dirty input and exposes revision conflict when a save loses the revision race', async () => {
    const saveDraft = (_payload: unknown) => Promise.resolve({ result: {
      ok: false as const,
      error: { code: 'version-conflict', message: 'revision conflict', details: {} },
    } })
    const api = controllerApi({ enterpriseEmployees: { ...controllerApi().enterpriseEmployees, saveDraft } })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never)
    await controller.openEmployeeDraft('buyer')
    controller.patchEmployeeDraft({ prompt: '新职责' })

    await controller.saveEmployeeDraft()

    expect(controller.store.getSnapshot().employeeEditor).toMatchObject({
      dirty: true, conflict: true, fields: { prompt: '新职责' },
    })
  })

  it('deduplicates enterprise HostFrames and refreshes only the owning workbench page', async () => {
    const listAssets = vi.fn(() => ok({ items: [] }))
    const listEmployees = vi.fn(controllerApi().enterpriseEmployees.list)
    const api = controllerApi({
      enterpriseEmployees: { ...controllerApi().enterpriseEmployees, list: listEmployees },
      enterpriseAssets: { ...controllerApi().enterpriseAssets, list: listAssets },
    })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never)
    await controller.refresh()
    const frame = {
      type: 'enterprise/event', event: 'enterprise/asset-updated', eventId: 'event-1',
      orgId: 'server-org', resourceId: 'asset-1', resourceType: 'asset',
    } as const

    await controller.handleHostFrame(frame)
    await controller.handleHostFrame(frame)

    expect(listAssets).toHaveBeenCalledTimes(2)
    expect(listEmployees).toHaveBeenCalledTimes(1)
  })

  it('routes background operation events by resourceType instead of the visible page', async () => {
    const listWorkRecords = vi.fn(() => ok({ items: [] }))
    const listApprovals = vi.fn(() => ok({ items: [] }))
    const listSchedules = vi.fn(() => ok({ items: [] }))
    const api = controllerApi({ enterpriseOperations: {
      ...controllerApi().enterpriseOperations, listWorkRecords, listApprovals, listSchedules,
    } })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never)
    await controller.refresh()

    await controller.handleHostFrame({
      type: 'enterprise/event', event: 'enterprise/operation-updated', eventId: 'approval-event',
      orgId: 'server-org', resourceId: 'approval-1', resourceType: 'approval',
    })
    await controller.handleHostFrame({
      type: 'enterprise/event', event: 'enterprise/operation-updated', eventId: 'schedule-event',
      orgId: 'server-org', resourceId: 'schedule-1', resourceType: 'schedule',
    })
    await controller.handleHostFrame({
      type: 'enterprise/event', event: 'enterprise/operation-updated', eventId: 'outbox-event',
      orgId: 'server-org', resourceId: 'outbox-1', resourceType: 'outbox',
    })

    expect(listApprovals).toHaveBeenCalledTimes(2)
    expect(listSchedules).toHaveBeenCalledTimes(2)
    expect(listWorkRecords).toHaveBeenCalledTimes(2)
  })

  it('contains mutation failures and exposes a retry action without rejecting', async () => {
    const transitionApproval = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockImplementation(() => ok({}))
    const api = controllerApi({ enterpriseOperations: {
      ...controllerApi().enterpriseOperations, transitionApproval,
    } })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never)
    const approval = {
      approvalId: 'approval-1', orgId: 'server-org', kind: 'business', subjectType: 'order',
      subjectId: 'order-1', requestedBy: 'owner-1', state: 'pending', revision: 2,
      createdAt: 10, updatedAt: 20,
    } as const

    await expect(controller.transitionApproval(approval, 'approved')).resolves.toBeUndefined()
    expect(controller.store.getSnapshot()).toMatchObject({
      mutationPhase: 'error', mutationError: 'network unavailable', retryAction: 'approval-transition',
    })
    await controller.retryMutation()
    expect(transitionApproval).toHaveBeenCalledTimes(2)
    expect(controller.store.getSnapshot()).toMatchObject({
      mutationPhase: 'idle', mutationError: null, retryAction: null,
    })
  })

  it('locks programmatic employee edits while a save is in flight', async () => {
    let resolveSave!: (value: Awaited<ReturnType<typeof ok>>) => void
    const saveDraft = vi.fn((_payload: unknown) => new Promise<Awaited<ReturnType<typeof ok>>>((resolve) => { resolveSave = resolve }))
    const api = controllerApi({ enterpriseEmployees: { ...controllerApi().enterpriseEmployees, saveDraft } })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never)
    await controller.openEmployeeDraft('buyer')
    controller.patchEmployeeDraft({ name: '保存中的名称' })

    const saving = controller.saveEmployeeDraft()
    controller.patchEmployeeDraft({ name: '不得覆盖' })
    expect(controller.store.getSnapshot().employeeEditor).toMatchObject({
      saving: true, fields: { name: '保存中的名称' },
    })
    resolveSave(await ok({
      presetId: 'buyer', orgId: 'server-org', ownerUserId: 'owner-1', visibility: 'restricted',
      profile: { name: '保存后的名称', prompt: '核验供应商', modelRef: 'deepseek-chat' },
      bindings: [], revision: 5, status: 'draft', updatedAt: 30,
    }))
    await saving
    expect(controller.store.getSnapshot().employeeEditor).toMatchObject({
      saving: false, dirty: false, fields: { name: '保存后的名称' },
    })
  })

  it('reuses one idempotency key after a committed mutation response is lost', async () => {
    const saveSchedule = vi.fn()
      .mockRejectedValueOnce(new Error('response lost after commit'))
      .mockImplementation(() => ok({}))
    const saveVersion = vi.fn()
      .mockRejectedValueOnce(new Error('response lost after commit'))
      .mockImplementation(() => ok({}))
    const saveTeam = vi.fn()
      .mockRejectedValueOnce(new Error('response lost after commit'))
      .mockImplementation(() => ok({}))
    const publish = vi.fn()
      .mockRejectedValueOnce(new Error('response lost after commit'))
      .mockImplementation(() => ok({}))
    const base = controllerApi()
    const api = controllerApi({
      enterpriseEmployees: { ...base.enterpriseEmployees, publish },
      enterpriseAssets: { ...base.enterpriseAssets, saveVersion },
      enterpriseTeams: { ...base.enterpriseTeams, save: saveTeam },
      enterpriseOperations: { ...base.enterpriseOperations, saveSchedule },
    })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never)

    await controller.saveSchedule({
      scheduleId: 'schedule-1', target: { kind: 'employee', employeeReleaseId: 'release-1' },
      timezone: 'Asia/Shanghai', rule: '0 9 * * *', input: {}, nextRunAt: null, expectedRevision: 0,
    })
    await controller.retryMutation()
    expect((saveSchedule.mock.calls[0]?.[0] as unknown as { idempotencyKey: string }).idempotencyKey)
      .toBe((saveSchedule.mock.calls[1]?.[0] as unknown as { idempotencyKey: string }).idempotencyKey)

    await controller.saveAssetVersion({ assetId: 'asset-1', kind: 'sop', name: 'SOP', content: {}, expectedRevision: 0 })
    await controller.retryMutation()
    expect((saveVersion.mock.calls[0]?.[0] as unknown as { idempotencyKey: string }).idempotencyKey)
      .toBe((saveVersion.mock.calls[1]?.[0] as unknown as { idempotencyKey: string }).idempotencyKey)

    await controller.saveTeam({
      teamId: 'team-1', leaderEmployeeReleaseId: 'release-1', members: [],
      workflowTemplate: {}, approvalPolicy: {}, expectedRevision: 0,
    })
    await controller.retryMutation()
    expect((saveTeam.mock.calls[0]?.[0] as unknown as { idempotencyKey: string }).idempotencyKey)
      .toBe((saveTeam.mock.calls[1]?.[0] as unknown as { idempotencyKey: string }).idempotencyKey)

    await controller.openEmployeeDraft('buyer')
    await controller.publishEmployee()
    await controller.retryMutation()
    expect((publish.mock.calls[0]?.[0] as unknown as { idempotencyKey: string }).idempotencyKey)
      .toBe((publish.mock.calls[1]?.[0] as unknown as { idempotencyKey: string }).idempotencyKey)
  })

  it('does not retry a revision conflict with the stale expectedRevision', async () => {
    const transitionSchedule = vi.fn(() => Promise.resolve({ result: {
      ok: false as const,
      error: { code: 'enterprise-conflict', message: 'revision changed', details: { resourceType: 'schedule' } },
    } }))
    const listSchedules = vi.fn(() => ok({ items: [] }))
    const base = controllerApi()
    const api = controllerApi({ enterpriseOperations: {
      ...base.enterpriseOperations, transitionSchedule, listSchedules,
    } })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never)
    const schedule = {
      scheduleId: 'schedule-1', orgId: 'server-org', target: { kind: 'employee', employeeReleaseId: 'release-1' },
      timezone: 'Asia/Shanghai', rule: '0 9 * * *', input: {}, state: 'active', nextRunAt: null,
      lastRunAt: null, revision: 3, createdAt: 10, updatedAt: 20,
    } as const

    await controller.transitionSchedule(schedule, 'paused')
    expect(controller.store.getSnapshot()).toMatchObject({
      mutationPhase: 'conflict', retryAction: null,
    })
    await controller.retryMutation()
    expect(transitionSchedule).toHaveBeenCalledTimes(1)
    await controller.resolveMutationConflict()
    expect(listSchedules).toHaveBeenCalledTimes(1)
  })

  it('reloads an employee conflict as a server comparison while preserving local fields', async () => {
    const getDraft = vi.fn()
      .mockImplementationOnce(() => ok({
        presetId: 'buyer', orgId: 'server-org', ownerUserId: 'owner-1', visibility: 'restricted',
        profile: { name: '原名称', prompt: '原职责', modelRef: 'model-a' }, bindings: [],
        revision: 4, status: 'published', updatedAt: 20,
      }))
      .mockImplementation(() => ok({
        presetId: 'buyer', orgId: 'server-org', ownerUserId: 'owner-1', visibility: 'organization',
        profile: { name: '服务器名称', prompt: '服务器职责', modelRef: 'model-b' }, bindings: [],
        revision: 5, status: 'published', updatedAt: 30,
      }))
    const saveDraft = vi.fn(() => Promise.resolve({ result: {
      ok: false as const,
      error: { code: 'enterprise-conflict', message: 'revision changed', details: { resourceType: 'employee' } },
    } }))
    const base = controllerApi()
    const api = controllerApi({ enterpriseEmployees: { ...base.enterpriseEmployees, getDraft, saveDraft } })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never)
    await controller.openEmployeeDraft('buyer')
    controller.patchEmployeeDraft({ name: '本地未保存名称', prompt: '本地未保存职责' })

    await controller.saveEmployeeDraft()
    await controller.resolveMutationConflict()

    expect(saveDraft).toHaveBeenCalledTimes(1)
    expect(controller.store.getSnapshot().employeeEditor).toMatchObject({
      dirty: true,
      fields: { name: '本地未保存名称', prompt: '本地未保存职责' },
      conflictServerFields: { name: '服务器名称', prompt: '服务器职责', modelRef: 'model-b' },
      conflictServerRevision: 5,
    })
  })
})
