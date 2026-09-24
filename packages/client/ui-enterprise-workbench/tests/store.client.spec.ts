import { describe, expect, it, vi } from 'vitest'
import type { SessionId, WorkspaceId } from '@deepseek-ai/dsh-api-remotes/client'
import type { AgentPresetRow } from '@deepseek-ai/dsh-agent-preset-registry/types'
import type {
  SessionListState, SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot as WorkspaceListState } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { deriveEnterpriseView, EnterpriseWorkbenchController } from '../src/client/store.ts'

const STANDARD: AgentPresetRow = {
  id: 'standard',
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
  rows: Array<Omit<Partial<SessionSummary>, 'id'> & {
    id: string
    agentPreset?: string
    pendingInteraction?: unknown
  }>,
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
    phase: 'ready',
    projectionsBySession: {},
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
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
}

describe('deriveEnterpriseView employees', () => {
  it('projects a healthy preset as an active employee from real Session state', () => {
    const view = deriveEnterpriseView([STANDARD], sessions([
      { id: 'session-1', agentPreset: 'standard', running: true },
      { id: 'session-2', agentPreset: 'standard' },
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
    const broken: AgentPresetRow = {
      id: 'employee-broken', isDefault: false, broken: 'composition missing',
    }
    const view = deriveEnterpriseView([STANDARD, broken], sessions([
      {
        id: 'session-1', agentPreset: 'standard', running: true,
        pendingInteraction: { kind: 'approval' },
      },
    ]), workspaces())

    expect(view.employees.map(employee => [employee.id, employee.status])).toEqual([
      ['standard', 'attention'],
      ['employee-broken', 'unavailable'],
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
        id: 'session-2', agentPreset: 'standard', updatedAt: 30,
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
      state: 'ready',
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
    pluginInventory: { list: () => ok({ entries: [{
      entryId: 'formal-plugin', moduleName: '@company/dsh-orders', enabled: true, fiberPhase: 'active',
    }] }) },
    agentPresets: { list: () => ok({ presets: [STANDARD], authorable: false, hasDocument: false }) },
    session: { modelCatalog: () => ok({
      default: { provider: 'deepseek', model: 'deepseek-chat' }, routableProviders: ['deepseek'], failures: [],
      groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] }],
    }) },
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
      optimizePrompt: () => ok({ prompt: '优化后的职责 Prompt' }),
    },
    enterpriseAssets: {
      list: () => ok({ items: [] }), get: () => ok({}), saveVersion: () => ok({}),
      listVersions: () => ok([]), archive: () => ok({}),
    },
    enterpriseTeams: { list: () => ok({ items: [] }), get: () => ok({}), save: () => ok({}) },
    enterpriseTeamDefinitions: { list: () => ok({ items: [] }), get: () => ok({}), save: () => ok({}), archive: () => ok({}) },
    enterpriseChannels: {
      list: () => ok({ items: [] }), get: () => ok({}), save: () => ok({}), archive: () => ok({}),
      beginBinding: () => ok({}), completeBinding: () => ok({}),
    },
    enterpriseDevices: { list: () => ok([]), pair: () => ok({ deviceId: 'device-1' }) },
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
    cordisWorkspace: {
      list: () => ok({ packages: [], bindings: [] }), save: () => ok({}), activate: () => ok({}),
      stop: () => ok({}), rollback: () => ok({}), pinGeneration: () => ok({}),
    },
    cordisReview: {
      list: () => ok([]), submit: () => ok({}), derive: () => ok({}), approveDepartment: () => ok({}),
      return: () => ok({}), publishOrganization: () => ok({}),
    },
    cordisGovernance: {
      departmentManagers: () => ok(null), setDepartmentManagers: () => ok({}), disable: () => ok({}),
      rollback: () => ok({}), setTrust: () => ok({}),
    },
    ...overrides,
  }
}

function controllerServices() {
  return {
    sessions: {
      list: { getSnapshot: () => sessions([]), subscribe: () => () => {} },
      create: () => Promise.resolve('session-new' as SessionId),
    },
    workspaces: { list: { getSnapshot: workspaces, subscribe: () => () => {} } },
  }
}

describe('EnterpriseWorkbenchController enterprise read models', () => {
  it('pairs a local Device Agent without exposing private key material', async () => {
    const pair = vi.fn(() => ok({ deviceId: 'device-1' }))
    const list = vi.fn(() => ok([{ deviceId: 'device-1', deviceName: 'Kris Mac', platform: 'macos', status: 'online' }]))
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        publicKey: 'public-key', deviceName: 'Kris Mac', platform: 'macos', challenge: 'challenge-12345678',
      }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(controllerApi({
      enterpriseDevices: { pair, list },
    }) as never, services.sessions as never, services.workspaces as never, () => {})

    await expect(controller.pairLocalDevice('http://dsh.example', 'http://127.0.0.1:47631', fetcher)).resolves.toBe(true)
    expect(pair).toHaveBeenCalledWith({ publicKey: 'public-key', deviceName: 'Kris Mac', platform: 'macos' })
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({
      challenge: 'challenge-12345678', deviceId: 'device-1', dshOrigin: 'http://dsh.example',
    })
    expect(controller.store.getSnapshot().devices.items).toEqual([
      expect.objectContaining({ deviceId: 'device-1', status: 'online' }),
    ])
  })

  it('creates a recorder pairing code through the authenticated remote', async () => {
    const createRecorderPairing = vi.fn(() => ok({ pairingId: 'pair-1', code: '482913', expiresAt: 620_000 }))
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(controllerApi({
      enterpriseDevices: { createRecorderPairing },
    }) as never, services.sessions as never, services.workspaces as never, () => {})
    await expect(controller.createRecorderPairing()).resolves.toEqual({ pairingId: 'pair-1', code: '482913', expiresAt: 620_000 })
    expect(createRecorderPairing).toHaveBeenCalledWith({})
  })
  it('prepares goal-first work without inferring a workspace from list order', async () => {
    const enterpriseWork = {
      prepare: vi.fn(() => ok({ kind: 'needs-workspace-selection', availableWorkspaceIds: ['workspace-1'] })), start: vi.fn(),
    }
    const services = {
      sessions: { list: { getSnapshot: () => sessions([]), subscribe: () => () => {} } },
      workspaces: { list: { getSnapshot: () => workspaces(), subscribe: () => () => {} } },
    }
    const controller = new EnterpriseWorkbenchController(
      controllerApi({ enterpriseWork }) as never, services.sessions as never, services.workspaces as never, () => {},
    )

    await expect(controller.prepareWork({ objective: 'Prepare weekly report' })).resolves.toMatchObject({ kind: 'needs-workspace-selection' })
    expect(enterpriseWork.prepare).toHaveBeenCalledWith({ objective: 'Prepare weekly report' })
  })

  it('prepares goal-first work with the record the workbench last opened', async () => {
    const enterpriseWork = {
      prepare: vi.fn(() => ok({ kind: 'needs-workspace-selection', availableWorkspaceIds: [] })), start: vi.fn(),
    }
    const services = {
      sessions: { list: { getSnapshot: () => sessions([{ id: 'current-session' }]), subscribe: () => () => {} } },
      workspaces: { list: { getSnapshot: () => workspaces(), subscribe: () => () => {} } },
    }
    const controller = new EnterpriseWorkbenchController(
      controllerApi({ enterpriseWork }) as never, services.sessions as never, services.workspaces as never, () => {},
    )
    controller.openRecord('current-session' as SessionId)

    await controller.prepareWork({ objective: 'Prepare weekly report' })
    expect(enterpriseWork.prepare).toHaveBeenCalledWith({ objective: 'Prepare weekly report', currentSessionId: 'current-session' })
  })

  it('loads and mutates Workspace Cordis projections through typed remotes', async () => {
    const base = controllerApi()
    const binding = {
      bindingId: 'binding-1', orgId: 'server-org', pluginId: 'orders-1', activePackageId: 'package-1',
      scope: { type: 'personal-workspace', workspaceId: 'workspace-1', ownerUserId: 'owner-1' },
      generation: 1, revision: 1, activatedBy: 'owner-1', disabled: false, trustLevel: 'isolated', updatedAt: 1,
    }
    const pkg = {
      packageId: 'package-1', orgId: 'server-org', pluginId: 'orders-1', dynamicPackageId: 'pkg-1', version: 1,
      scope: binding.scope, name: 'Orders', purpose: 'Validate orders.', hostCode: 'return { apply() {} }',
      manifest: { apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm', provides: ['tool:orders'], capabilities: [] },
      artifactRef: 'artifact://orders/1', validationReportRef: 'report://orders/1', authoredBy: 'owner-1',
      sourceDigest: 'a'.repeat(64), createdAt: 1,
    }
    const list = vi.fn(() => ok({ packages: [pkg], bindings: [binding] }))
    const stop = vi.fn(() => ok({ ...binding, disabled: true, revision: 2 }))
    const controller = new EnterpriseWorkbenchController(controllerApi({
      cordisWorkspace: { ...base.cordisWorkspace, list, stop },
    }) as never, controllerServices().sessions as never, controllerServices().workspaces as never, () => {})

    await controller.refreshExtensions()
    await controller.stopExtension(binding as never, 'Pause.')

    expect(list).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(stop).toHaveBeenCalledWith(expect.objectContaining({
      bindingId: 'binding-1', expectedRevision: 1, reason: 'Pause.',
    }))
    expect(controller.store.getSnapshot()).toMatchObject({
      extensionWorkspaceId: 'workspace-1', extensions: { phase: 'ready', items: [expect.objectContaining({ packageId: 'package-1' })] },
    })
  })

  it('defaults extensions to the Workspace holding the opened record instead of list order', async () => {
    const base = controllerServices()
    const list = vi.fn(() => ok({ packages: [], bindings: [] }))
    const currentSessions = sessions([{ id: 'current-session' }])
    const controller = new EnterpriseWorkbenchController(controllerApi({
      cordisWorkspace: { ...controllerApi().cordisWorkspace, list },
    }) as never, {
      ...base.sessions,
      list: { getSnapshot: () => currentSessions, subscribe: () => () => {} },
    } as never, {
      list: { getSnapshot: () => ({ ...workspaces(), items: [
        { ...workspaces().items[0]!, workspaceId: 'department-first' as WorkspaceId, sessionIds: [] },
        { ...workspaces().items[0]!, workspaceId: 'personal-current' as WorkspaceId, sessionIds: ['current-session' as SessionId] },
      ] }), subscribe: () => () => {} },
    } as never, () => {})
    controller.openRecord('current-session' as SessionId)

    await controller.refreshExtensions()

    expect(list).toHaveBeenCalledWith({ workspaceId: 'personal-current' })
    expect(controller.store.getSnapshot().extensionWorkspaceId).toBe('personal-current')
  })

  it('loads PostgreSQL employee and operations pages and forwards roster filters/cursor', async () => {
    const list = vi.fn(controllerApi().enterpriseEmployees.list)
    const api = controllerApi({ enterpriseEmployees: { ...controllerApi().enterpriseEmployees, list } })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never, () => {})

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
      formalPlugins: { phase: 'ready', items: [expect.objectContaining({ moduleName: '@company/dsh-orders' })] },
    })
  })

  it('falls back to native AgentPreset/Session projections only when enterprise is unavailable', async () => {
    const api = controllerApi({
      enterpriseEmployees: { ...controllerApi().enterpriseEmployees, list: unavailable },
    })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never, () => {})

    await controller.refresh()

    expect(controller.store.getSnapshot()).toMatchObject({ mode: 'fallback', phase: 'ready' })
    expect(controller.store.getSnapshot().view?.employees[0]?.id).toBe('standard')
  })
})

describe('EnterpriseWorkbenchController edits, mutations, and events', () => {
  it('begins channel binding with the saved revision and exact canonical callback', async () => {
    const beginBinding = vi.fn(() => ok({
      bindingId: 'binding-1', channelId: 'finance-wecom', provider: 'wecom',
      authorizationUrl: 'https://login.work.weixin.qq.com/wwlogin/sso/login?state=opaque',
      officialDocumentationUrl: 'https://developer.work.weixin.qq.com/document/path/98152',
      expiresAt: 100,
    }))
    const base = controllerApi(); const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(controllerApi({
      enterpriseChannels: { ...base.enterpriseChannels, beginBinding },
    }) as never, services.sessions as never, services.workspaces as never, () => {})
    const channel = {
      channelId: 'finance-wecom', revision: 7,
    } as never

    await expect(controller.beginChannelBinding(
      channel,
      'https://dsh.example/workbench?dsh_channel_binding=1',
    )).resolves.toMatchObject({ bindingId: 'binding-1', channelId: 'finance-wecom' })
    expect(beginBinding).toHaveBeenCalledWith({
      channelId: 'finance-wecom', expectedRevision: 7,
      redirectUri: 'https://dsh.example/workbench?dsh_channel_binding=1',
    })
  })

  it('polls a channel Device Grant with a deterministic idempotency key', async () => {
    const pollBotInstall = vi.fn(() => ok({ status: 'pending', provider: 'feishu' }))
    const base = controllerApi(); const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(controllerApi({
      enterpriseChannels: { ...base.enterpriseChannels, pollBotInstall },
    }) as never, services.sessions as never, services.workspaces as never, () => {})

    await expect(controller.pollChannelBotInstall('signed-install-id')).resolves.toEqual({
      status: 'pending', provider: 'feishu',
    })
    expect(pollBotInstall).toHaveBeenCalledWith({
      installId: 'signed-install-id', idempotencyKey: 'channel-bot-install:signed-install-id',
    })

    await controller.pollChannelBotInstall('signed-install-id', '123456')
    expect(pollBotInstall).toHaveBeenLastCalledWith({
      installId: 'signed-install-id', verificationCode: '123456',
      idempotencyKey: 'channel-bot-install:signed-install-id',
    })
  })

  it('ignores an old employee response after filters change', async () => {
    let resolveOld!: (value: ReturnType<typeof responsePage>) => void
    const responsePage = (name: string) => ({ result: { ok: true as const, value: { items: [{
      presetId: name, orgId: 'server-org', ownerUserId: 'owner-1', visibility: 'organization' as const,
      profile: { name }, bindings: [], revision: 1, status: 'draft' as const, updatedAt: 20,
    }] } } })
    const list = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve }))
      .mockImplementationOnce(() => Promise.resolve(responsePage('new-result')))
    const base = controllerApi()
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(controllerApi({
      enterpriseEmployees: { ...base.enterpriseEmployees, list },
    }) as never, services.sessions as never, services.workspaces as never, () => {})

    controller.setEmployeeFilters({ search: 'old' })
    const oldRequest = controller.refreshEmployees()
    controller.setEmployeeFilters({ search: 'new' })
    await controller.refreshEmployees()
    resolveOld(responsePage('old-result'))
    await oldRequest

    expect(controller.store.getSnapshot().employees.items.map(item => item.presetId)).toEqual(['new-result'])
  })

  it('lets only the latest mutation attempt update global mutation state', async () => {
    let resolveFirst!: (value: Awaited<ReturnType<typeof ok>>) => void
    const transitionApproval = vi.fn(() => new Promise<Awaited<ReturnType<typeof ok>>>((resolve) => { resolveFirst = resolve }))
    const saveSchedule = vi.fn(() => Promise.reject(new Error('latest failed')))
    const base = controllerApi(); const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(controllerApi({ enterpriseOperations: {
      ...base.enterpriseOperations, transitionApproval, saveSchedule,
    } }) as never, services.sessions as never, services.workspaces as never, () => {})
    const approval = { approvalId: 'a', orgId: 'o', kind: 'business', subjectType: 'order', subjectId: '1', requestedBy: 'u', state: 'pending', revision: 1, createdAt: 1, updatedAt: 1 } as const

    const first = controller.transitionApproval(approval, 'approved')
    await controller.saveSchedule({ scheduleId: 's', target: { kind: 'employee', employeeReleaseId: 'r' }, timezone: 'UTC', rule: '* * * * *', input: {}, nextRunAt: null, expectedRevision: 0 })
    resolveFirst(await ok({}))
    await first

    expect(controller.store.getSnapshot()).toMatchObject({
      mutationPhase: 'error', mutationError: 'latest failed', retryAction: 'schedule-save',
    })
  })

  it('returns an explicit current-attempt receipt for schedule, asset, and team saves', async () => {
    const base = controllerApi(); const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(controllerApi({
      enterpriseOperations: { ...base.enterpriseOperations, saveSchedule: () => ok({}) },
      enterpriseAssets: { ...base.enterpriseAssets, saveVersion: () => Promise.reject(new Error('asset failed')) },
      enterpriseTeams: { ...base.enterpriseTeams, save: () => ok({}) },
    }) as never, services.sessions as never, services.workspaces as never, () => {})

    await expect(controller.saveSchedule({
      scheduleId: 's', target: { kind: 'employee', employeeReleaseId: 'r' }, timezone: 'UTC',
      rule: '* * * * *', input: {}, nextRunAt: null, expectedRevision: 0,
    })).resolves.toBe(true)
    await expect(controller.saveAssetVersion({
      assetId: 'a', kind: 'sop', name: 'SOP', content: {}, expectedRevision: 0,
    })).resolves.toBe(false)
    await expect(controller.saveTeam({
      teamId: 't', leaderEmployeeReleaseId: 'r', members: [], workflowTemplate: {},
      approvalPolicy: {}, expectedRevision: 0,
    })).resolves.toBe(true)
  })

  it('saves a typed team charter and refreshes the versioned definition projection', async () => {
    const save = vi.fn(() => ok({}))
    const list = vi.fn(() => ok({ items: [] }))
    const base = controllerApi(); const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(controllerApi({
      enterpriseTeamDefinitions: { ...base.enterpriseTeamDefinitions, save, list },
    }) as never, services.sessions as never, services.workspaces as never, () => {})

    await expect(controller.saveTeamDefinition({
      teamId: 'team-charter', name: '采购协同组', northStar: '让采购交付可验证',
      ownerUserId: 'owner-1', visibility: 'organization', leaderEmployeeReleaseId: 'release-lead',
      roster: [
        { actor: { kind: 'human', userId: 'owner-1' }, roleId: 'owner' },
        { actor: { kind: 'agent', employeeReleaseId: 'release-lead' }, roleId: 'lead' },
      ],
      roles: [
        { roleId: 'owner', name: 'Human owner', responsibility: 'Own goals and irreversible decisions.' },
        { roleId: 'lead', name: 'Agent lead', responsibility: 'Break down, coordinate, and report work.' },
      ],
      verificationPolicy: { verifierRequired: true, rubricRefs: ['交付标准'], highRiskHumanReviewRequired: true },
      attentionPolicy: { decisionQueue: 'centralized', openDecisionLimit: 5, workInProgressLimit: 3 },
      approvalPolicy: { highRiskApprovalRequired: true }, state: 'active', expectedRevision: 2,
    })).resolves.toBe(true)

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-charter', expectedRevision: 2, idempotencyKey: expect.stringMatching(/^team-definition-save:/u),
    }))
    expect(list).toHaveBeenCalledWith({ limit: 50 })
  })

  it('deduplicates concurrent starts for the same employee', async () => {
    let resolveCreate!: (id: SessionId) => void
    const create = vi.fn(() => new Promise<SessionId>((resolve) => { resolveCreate = resolve }))
    const services = controllerServices()
    services.sessions.create = create
    const controller = new EnterpriseWorkbenchController(controllerApi() as never, services.sessions as never, services.workspaces as never, () => {})

    const first = controller.startEmployee('buyer')
    const second = controller.startEmployee('buyer')
    expect(create).toHaveBeenCalledTimes(1)
    resolveCreate('session-new' as SessionId)
    await Promise.all([first, second])
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('saves the explicit employee draft without sending principal or organization fields', async () => {
    const saveDraft = vi.fn((_payload: unknown) => ok({
      presetId: 'buyer', orgId: 'server-org', ownerUserId: 'owner-1', visibility: 'private',
      profile: { name: '采购员' }, bindings: [], revision: 5, status: 'draft', updatedAt: 30,
    }))
    const api = controllerApi({ enterpriseEmployees: { ...controllerApi().enterpriseEmployees, saveDraft } })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never, () => {})
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

  it('saves a new managed employee draft without any client-side preset write', async () => {
    const saveDraft = vi.fn((payload: Record<string, unknown>) => ok({
      presetId: payload.presetId as string, orgId: 'server-org', ownerUserId: 'owner-1',
      visibility: 'organization' as const, profile: payload.profile as Record<string, never>,
      bindings: [], revision: 1, status: 'draft' as const, updatedAt: 30,
    }))
    const base = controllerApi()
    const api = controllerApi({
      agentPresets: { ...base.agentPresets },
      enterpriseEmployees: { ...base.enterpriseEmployees, saveDraft },
    })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never, () => {})

    controller.createEmployeeDraft()
    const assignedSeed = controller.store.getSnapshot().employeeEditor?.fields?.avatarSeed
    controller.patchEmployeeDraft({
      name: '采购专员', prompt: '负责采购需求核验。', modelRef: 'deepseek-chat',
    })
    await controller.saveEmployeeDraft()

    const presetId = saveDraft.mock.calls[0]?.[0].presetId as string
    const savedProfile = saveDraft.mock.calls[0]?.[0].profile as { avatarSeed?: unknown }
    expect(presetId).toMatch(/^employee-[a-z0-9-]+$/u)
    expect(assignedSeed).toMatch(/^[a-f0-9-]{36}$/u)
    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({
      presetId, expectedRevision: 0, visibility: 'organization',
    }))
    expect(savedProfile.avatarSeed).toBe(assignedSeed)
    expect(controller.store.getSnapshot().employeeEditor).toMatchObject({
      dirty: false, revision: 1, fields: { presetId, name: '采购专员' },
    })
    expect(controller.store.getSnapshot().employeeEditor?.creating).toBeUndefined()
  })

  it('keeps dirty input and exposes revision conflict when a save loses the revision race', async () => {
    const saveDraft = (_payload: unknown) => Promise.resolve({ result: {
      ok: false as const,
      error: { code: 'version-conflict', message: 'revision conflict', details: {} },
    } })
    const api = controllerApi({ enterpriseEmployees: { ...controllerApi().enterpriseEmployees, saveDraft } })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never, () => {})
    await controller.openEmployeeDraft('buyer')
    controller.patchEmployeeDraft({ prompt: '新职责' })

    await controller.saveEmployeeDraft()

    expect(controller.store.getSnapshot().employeeEditor).toMatchObject({
      dirty: true, conflict: true, fields: { prompt: '新职责' },
    })
  })

  it('loads configured models and replaces the draft prompt with an AI-optimized result', async () => {
    const optimizePrompt = vi.fn(() => ok({ prompt: '负责采购需求澄清、校验与输出。' }))
    const base = controllerApi()
    const api = controllerApi({
      enterpriseEmployees: { ...base.enterpriseEmployees, optimizePrompt },
    })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never, () => {})
    await controller.refresh()
    await controller.openEmployeeDraft('buyer')
    controller.patchEmployeeDraft({ modelRef: 'deepseek/deepseek-chat' })

    await controller.optimizeEmployeePrompt()

    expect(controller.store.getSnapshot().modelOptions).toEqual([{
      value: 'deepseek/deepseek-chat', provider: 'DeepSeek', model: 'DeepSeek Chat',
    }])
    expect(optimizePrompt).toHaveBeenCalledWith({
      provider: 'deepseek', model: 'deepseek-chat', prompt: '核验供应商',
    })
    expect(controller.store.getSnapshot().employeeEditor).toMatchObject({
      optimizingPrompt: false, dirty: true, fields: { prompt: '负责采购需求澄清、校验与输出。' },
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
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never, () => {})
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
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never, () => {})
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

  it('replays an enterprise event after its first target refresh fails', async () => {
    const listAssets = vi.fn()
      .mockRejectedValueOnce(new Error('asset refresh failed'))
      .mockImplementation(() => ok({ items: [] }))
    const base = controllerApi(); const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(controllerApi({
      enterpriseAssets: { ...base.enterpriseAssets, list: listAssets },
    }) as never, services.sessions as never, services.workspaces as never, () => {})
    const frame = { type: 'enterprise/event', event: 'enterprise/asset-updated', eventId: 'replay-event', orgId: 'o', resourceId: 'asset-1', resourceType: 'asset' } as const

    await controller.handleHostFrame(frame)
    expect(controller.store.getSnapshot().assets).toMatchObject({ phase: 'error', error: 'asset refresh failed' })
    await controller.handleHostFrame(frame)
    expect(listAssets).toHaveBeenCalledTimes(2)
    expect(controller.store.getSnapshot().assets.phase).toBe('ready')
  })

  it('contains mutation failures and exposes a retry action without rejecting', async () => {
    const transitionApproval = vi.fn()
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockImplementation(() => ok({}))
    const api = controllerApi({ enterpriseOperations: {
      ...controllerApi().enterpriseOperations, transitionApproval,
    } })
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never, () => {})
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
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never, () => {})
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
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never, () => {})

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
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never, () => {})
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
    const controller = new EnterpriseWorkbenchController(api as never, services.sessions as never, services.workspaces as never, () => {})
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

    controller.patchEmployeeDraft({ department: '本地部门' })
    expect(controller.store.getSnapshot().employeeEditor).toMatchObject({
      conflict: true, fields: { department: '本地部门' },
    })
  })

  it('adopts the server employee conflict as a clean editable draft', async () => {
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(controllerApi() as never, services.sessions as never, services.workspaces as never, () => {})
    controller.store.set({ ...controller.store.getSnapshot(), employeeEditor: {
      phase: 'ready', dirty: true, saving: false, conflict: true, errors: [], error: null,
      revision: 4, releases: [],
      fields: { presetId: 'buyer', name: '本地', description: '', position: '', department: '', prompt: '本地职责', modelRef: 'model-a', capabilities: [], visibility: 'private', bindings: [] },
      conflictServerRevision: 5,
      conflictServerFields: { presetId: 'buyer', name: '服务器', description: '', position: '', department: '', prompt: '服务器职责', modelRef: 'model-b', capabilities: [], visibility: 'organization', bindings: [] },
    } })

    controller.adoptServerEmployeeConflict()

    expect(controller.store.getSnapshot().employeeEditor).toMatchObject({
      revision: 5, dirty: false, conflict: false,
      fields: { name: '服务器', prompt: '服务器职责', modelRef: 'model-b' },
    })
    expect(controller.store.getSnapshot().employeeEditor).not.toHaveProperty('conflictServerFields')
  })

  it('keeps local employee fields on the server revision and allows an explicit resave', async () => {
    const saveDraft = vi.fn((_payload: unknown) => ok({
      presetId: 'buyer', orgId: 'server-org', ownerUserId: 'owner-1', visibility: 'private',
      profile: { name: '本地', prompt: '本地职责', modelRef: 'model-a' }, bindings: [],
      revision: 6, status: 'draft', updatedAt: 40,
    }))
    const base = controllerApi()
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(
      controllerApi({ enterpriseEmployees: { ...base.enterpriseEmployees, saveDraft } }) as never,
      services.sessions as never, services.workspaces as never, () => {},
    )
    controller.store.set({ ...controller.store.getSnapshot(), employeeEditor: {
      phase: 'ready', dirty: true, saving: false, conflict: true, errors: [], error: null,
      revision: 4, releases: [],
      fields: { presetId: 'buyer', name: '本地', description: '', position: '', department: '', prompt: '本地职责', modelRef: 'model-a', capabilities: [], visibility: 'private', bindings: [] },
      conflictServerRevision: 5,
      conflictServerFields: { presetId: 'buyer', name: '服务器', description: '', position: '', department: '', prompt: '服务器职责', modelRef: 'model-b', capabilities: [], visibility: 'organization', bindings: [] },
    } })

    controller.keepLocalEmployeeConflict()
    await controller.saveEmployeeDraft()

    expect(saveDraft).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 5 }))
    expect(controller.store.getSnapshot().employeeEditor).toMatchObject({
      revision: 6, dirty: false, conflict: false, fields: { name: '本地' },
    })
  })

  it('retries only the same conflict reload when server refresh fails', async () => {
    const transitionSchedule = vi.fn(() => Promise.resolve({ result: {
      ok: false as const,
      error: { code: 'enterprise-conflict', message: 'revision changed', details: { resourceType: 'schedule' } },
    } }))
    const listSchedules = vi.fn()
      .mockRejectedValueOnce(new Error('reload unavailable'))
      .mockImplementation(() => ok({ items: [] }))
    const base = controllerApi()
    const services = controllerServices()
    const controller = new EnterpriseWorkbenchController(controllerApi({ enterpriseOperations: {
      ...base.enterpriseOperations, transitionSchedule, listSchedules,
    } }) as never, services.sessions as never, services.workspaces as never, () => {})
    const schedule = {
      scheduleId: 'schedule-1', orgId: 'server-org', target: { kind: 'employee', employeeReleaseId: 'release-1' },
      timezone: 'Asia/Shanghai', rule: '0 9 * * *', input: {}, state: 'active', nextRunAt: null,
      lastRunAt: null, revision: 3, createdAt: 10, updatedAt: 20,
    } as const

    await controller.transitionSchedule(schedule, 'paused')
    await controller.resolveMutationConflict()
    expect(controller.store.getSnapshot()).toMatchObject({
      mutationPhase: 'error', mutationError: 'reload unavailable', retryAction: 'conflict-reload',
    })
    await controller.retryMutation()
    expect(listSchedules).toHaveBeenCalledTimes(2)
    expect(transitionSchedule).toHaveBeenCalledTimes(1)
    expect(controller.store.getSnapshot()).toMatchObject({
      mutationPhase: 'idle', mutationError: null, retryAction: null,
    })
  })
})
