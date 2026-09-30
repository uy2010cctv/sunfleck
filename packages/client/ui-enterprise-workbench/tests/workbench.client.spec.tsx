// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, type ReactNode } from 'react'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { EnterpriseTrigger } from '../src/client/EnterpriseTrigger.tsx'
import { ScheduleTrigger } from '../src/client/ScheduleTrigger.tsx'
import {
  EnterpriseWorkbench, type EnterpriseWorkbenchProps,
} from '../src/client/EnterpriseWorkbench.tsx'
import { en, zh } from '../src/client/locales.ts'
import type { EnterpriseView, EnterpriseWorkbenchState } from '../src/client/store.ts'
import {
  officialChannelAuthorizationUrl, officialChannelBindingState,
} from '../src/client/channelBindingProfiles.ts'
import {
  CHANNEL_BINDING_BROADCAST_CHANNEL, completeChannelBindingCallback, completeChannelBotInstallCallback,
} from '../src/client/index.ts'

class FakeBroadcastChannel {
  static readonly channels: FakeBroadcastChannel[] = []
  readonly name: string
  closed = false
  onmessage: ((event: MessageEvent) => void) | null = null
  constructor(name: string) {
    this.name = name
    FakeBroadcastChannel.channels.push(this)
  }
  postMessage(message: unknown): void {
    for (const channel of FakeBroadcastChannel.channels) {
      if (channel !== this && !channel.closed && channel.name === this.name) {
        channel.onmessage?.(new MessageEvent('message', { data: message }))
      }
    }
  }
  close(): void { this.closed = true }
  static reset(): void { FakeBroadcastChannel.channels.splice(0) }
}

const SIGNED_STATE_A = `${'a'.repeat(43)}.${'b'.repeat(43)}`
const SIGNED_STATE_B = `${'c'.repeat(43)}.${'d'.repeat(43)}`

beforeEach(() => {
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
})

afterEach(() => {
  cleanup()
  FakeBroadcastChannel.reset()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const t = makeTranslate(zh)

const VIEW: EnterpriseView = {
  employees: [{
    id: 'standard',
    employeeCode: 'standard',
    name: '标准模式',
    description: '完整编码员工。',
    position: '通用执行员工',
    department: '数字化运营',
    capabilities: ['文件执行', '信息检索'],
    status: 'active',
    activeWork: 1,
    recentWork: 2,
    custom: false,
    isDefault: true,
  }, {
    id: 'broken',
    employeeCode: 'broken',
    name: '损坏员工',
    capabilities: [],
    status: 'unavailable',
    activeWork: 0,
    recentWork: 0,
    custom: true,
    isDefault: false,
    unavailableReason: 'composition missing',
  }],
  records: [{
    sessionId: 'session-1' as never,
    title: '供应商核验',
    employeeId: 'standard',
    employeeName: '标准模式',
    workspaceTitle: '采购部',
    state: 'running',
    updatedAt: Date.UTC(2026, 7, 26, 8, 0),
  }],
  metrics: { employees: 2, active: 1, attention: 0, workRecords: 1, workspaces: 1 },
}

const EMPTY_PAGE = { phase: 'idle' as const, items: [], error: null }
const BASE_STATE: EnterpriseWorkbenchState = {
  open: true, phase: 'ready', mode: 'fallback', page: 'employees', view: VIEW,
  error: null, busyEmployee: null, employeeFilters: {}, employees: EMPTY_PAGE,
  staff: { phase: 'idle', list: [], error: null, sending: false, sendError: null },
  staffMemories: { phase: 'idle', entries: [], error: null },
  projects: { phase: 'idle', list: [], selected: undefined, detailError: null, error: null, busy: false, actionError: null },
  surfaces: { phase: 'idle', list: [], error: null },
  workRecords: EMPTY_PAGE, approvals: EMPTY_PAGE, schedules: EMPTY_PAGE,
  assets: EMPTY_PAGE, teams: EMPTY_PAGE,
  channels: EMPTY_PAGE,
  teamDefinitions: EMPTY_PAGE, teamRuns: EMPTY_PAGE, teamDecisions: EMPTY_PAGE, teamAutonomy: EMPTY_PAGE,
  devices: EMPTY_PAGE,
  modelOptions: [],
  extensions: EMPTY_PAGE, extensionBindings: [], extensionReviews: EMPTY_PAGE, formalPlugins: EMPTY_PAGE,
  archivedExtensions: EMPTY_PAGE,
  releases: [],
  mutationPhase: 'idle', mutationError: null, retryAction: null,
}

function workbenchProps(overrides: Partial<EnterpriseWorkbenchProps> & {
  state?: Partial<EnterpriseWorkbenchState>
} = {}): EnterpriseWorkbenchProps {
  const state: EnterpriseWorkbenchState = { ...BASE_STATE, ...overrides.state }
  const { state: _state, ...rest } = overrides
  return {
    useEnterprise: select => select(state),
    useSessions: select => select({ phase: 'ready', ids: [], byId: {}, projectionsBySession: {} }),
    readRuntimeCapabilities: vi.fn(async sessionId => ({ sessionId, live: false, catalogAt: null, tools: [] })),
    useWorkspaces: select => select({
      items: [{ workspaceId: 'workspace-1', title: '采购部', path: '/business/procurement', sessionIds: [],
        createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z' }],
      archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    } as never),
    close: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
    startEmployee: vi.fn(() => Promise.resolve()),
    readWorkspaceDefault: vi.fn(() => Promise.resolve({ workspaceId: 'workspace-1', employeeId: null, revision: 0, unavailable: false, manageable: false })),
    saveWorkspaceDefault: vi.fn(() => Promise.resolve({ workspaceId: 'workspace-1', employeeId: null, revision: 1, unavailable: false, manageable: true })),
    loadEmployees: vi.fn(() => Promise.resolve(true)),
    sendMessage: vi.fn(() => Promise.resolve(true)),
    selectEmployee: vi.fn(),
    loadEmployeeMemories: vi.fn(() => Promise.resolve(true)),
    reviewEmployeeMemory: vi.fn(() => Promise.resolve(true)),
    retireEmployeeMemory: vi.fn(() => Promise.resolve(true)),
    loadProjects: vi.fn(() => Promise.resolve(true)),
    loadSurfaces: vi.fn(() => Promise.resolve(true)),
    createProject: vi.fn(() => Promise.resolve(true)),
    selectProject: vi.fn(() => Promise.resolve()),
    addProjectMember: vi.fn(() => Promise.resolve(true)),
    archiveProject: vi.fn(() => Promise.resolve(true)),
    openCollaboration: vi.fn(() => true),
    createCollaboration: vi.fn(() => true),
    prepareWork: vi.fn(() => Promise.resolve({ kind: 'needs-workspace-selection', availableWorkspaceIds: [] })),
    startPreparedWork: vi.fn(() => Promise.resolve({ sessionId: 'session-created', workspaceId: 'workspace-1', employeeReleaseId: 'release-1', executionSummary: 'Ready.' })),
    openRecord: vi.fn(),
    beginChannelBotInstall: vi.fn((provider: string) => Promise.resolve({
      status: provider === 'wechat' ? 'unsupported' : 'setup-required', provider,
      officialDocumentationUrl: 'https://example.test/provider-app',
    })),
    renderSlot: (_name: string, _owner: object, options?: { fallback?: ReactNode }) => options?.fallback ?? null,
    t,
    ...rest,
  } as EnterpriseWorkbenchProps
}

function activeFeishuChannel(channelId: string, name: string) {
  return {
    orgId: 'org-a', channelId, name, provider: 'feishu', accountId: `${channelId}-app`, credentialRef: 'FEISHU',
    credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified', state: 'active',
    bindingStatus: 'unbound', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
  } as const
}

describe('EnterpriseTrigger', () => {
  it('renders the labelled row when wide and the accessible icon control on the rail', () => {
    const toggle = vi.fn()
    const { rerender } = render(
      <EnterpriseTrigger wide open={false} toggle={toggle} t={t} />,
    )
    fireEvent.click(screen.getByRole('button', { name: zh['trigger.open'] }))
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Lichen Agent')).toBeDefined()

    rerender(<EnterpriseTrigger wide={false} open toggle={toggle} t={t} />)
    expect(screen.queryByText(zh['trigger.label'])).toBeNull()
    expect(screen.getByRole('button', { name: zh['trigger.close'] })).toBeDefined()
  })
})

describe('ScheduleTrigger', () => {
  it('opens scheduled-task management from both sidebar widths', () => {
    const openSchedules = vi.fn()
    const { rerender } = render(<ScheduleTrigger wide openSchedules={openSchedules} t={t} />)
    fireEvent.click(screen.getByRole('button', { name: zh['nav.schedules'] }))
    expect(openSchedules).toHaveBeenCalledTimes(1)
    rerender(<ScheduleTrigger wide={false} openSchedules={openSchedules} t={t} />)
    expect(screen.queryByText(zh['nav.schedules'])).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['nav.schedules'] }))
    expect(openSchedules).toHaveBeenCalledTimes(2)
  })
})

describe('EnterpriseWorkbench', () => {
  it('opens a channel from the collaboration directory in the native room', () => {
    const openCollaboration = vi.fn(() => true)
    render(<EnterpriseWorkbench {...workbenchProps({ openCollaboration,
      state: { mode: 'enterprise', page: 'projects', projects: {
        phase: 'ready', list: [], selected: undefined, detailError: null,
        error: null, busy: false, actionError: null,
      }, surfaces: { phase: 'ready', error: null, list: [{ id: 'room-a', kind: 'channel',
        name: '产品频道', memberCount: 3, workspaceId: 'workspace-1' }] } },
    })}/>)
    fireEvent.click(screen.getByRole('tab', { name: '频道' }))
    fireEvent.click(screen.getByRole('button', { name: '打开 产品频道' }))
    expect(openCollaboration).toHaveBeenCalledWith('room-a')
  })
  it('scopes contributed channel settings to the selected published employee', () => {
    const renderSlot = vi.fn((_name: string, owner: { employee: { name: string; presetId: string; releaseId: string } }) => (
      <div data-testid="employee-channel-panel">{owner.employee.name}:{owner.employee.presetId}:{owner.employee.releaseId}</div>
    ))
    render(<EnterpriseWorkbench {...workbenchProps({
      renderSlot,
      state: {
        mode: 'enterprise', page: 'channels',
        channels: { phase: 'ready', error: null, items: [] },
        releases: [{
          releaseId: 'release-finance-v2', presetId: 'finance-director', orgId: 'org-a', version: 2,
          digest: 'finance-old', snapshot: { profile: { name: '财务大王', position: '财务总监' }, bindings: [] },
          publishedBy: 'admin', publishedAt: 2,
        }, {
          releaseId: 'release-finance-v3', presetId: 'finance-director', orgId: 'org-a', version: 3,
          digest: 'finance', snapshot: { profile: { name: '财务大王', position: '财务总监' }, bindings: [] },
          publishedBy: 'admin', publishedAt: 3,
        }, {
          releaseId: 'release-media-v1', presetId: 'media-operator', orgId: 'org-a', version: 1,
          digest: 'media', snapshot: { profile: { name: '新媒体员工', position: '运营' }, bindings: [] },
          publishedBy: 'admin', publishedAt: 1,
        }],
      },
    } as never)} />)

    expect(screen.queryByRole('combobox', { name: '选择数字员工' })).toBeNull()
    const employeeSwitcher = screen.getByRole('group', { name: '选择数字员工' })
    expect(within(employeeSwitcher).getAllByRole('button')).toHaveLength(2)
    expect(within(employeeSwitcher).getByRole('button', { name: /财务大王/u }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByText(/已发布版本/u)).toBeNull()
    expect(screen.getByTestId('employee-channel-panel').textContent)
      .toBe('财务大王:finance-director:release-finance-v3')

    fireEvent.click(within(employeeSwitcher).getByRole('button', { name: /新媒体员工/u }))
    expect(screen.getByTestId('employee-channel-panel').textContent)
      .toBe('新媒体员工:media-operator:release-media-v1')
    expect(renderSlot).toHaveBeenLastCalledWith('enterprise.employee-channels', expect.objectContaining({
      employee: expect.objectContaining({ presetId: 'media-operator', releaseId: 'release-media-v1' }) as unknown,
    }), expect.any(Object))
  })

  it('connects the current computer without exposing device ids or key fields', () => {
    const pairLocalDevice = vi.fn(() => Promise.resolve(true))
    render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', page: 'devices', devices: { phase: 'ready', error: null, items: [{
          deviceId: 'device-secret-id', deviceName: 'Kris Mac', platform: 'macos', status: 'online',
          lastHeartbeatAt: Date.now(),
        }] },
      },
      pairLocalDevice,
    } as never)} />)
    expect(screen.getByText('Kris Mac')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '我的设备' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '我的设备' })).toBeTruthy()
    expect(screen.getByText('在线')).toBeTruthy()
    expect(screen.queryByText('device-secret-id')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '连接此电脑' }))
    expect(pairLocalDevice).toHaveBeenCalledWith(window.location.origin)
  })

  it('creates a recorder pairing code without asking for a user id', async () => {
    const createRecorderPairing = vi.fn(async () => ({ pairingId: 'pair-1', code: '482913', expiresAt: Date.now() + 600_000 }))
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'devices', devices: { phase: 'ready', error: null, items: [] } },
      createRecorderPairing,
    } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: '绑定录音卡' }))
    expect(await screen.findByText('482913')).toBeTruthy()
    expect(createRecorderPairing).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('keeps provider identifiers and Credential references out of the user channel flow', async () => {
    vi.spyOn(window, 'open').mockReturnValue({
      closed: false, close: vi.fn(), opener: window, location: { href: 'about:blank' },
    } as never)
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [] } },
    })} />)

    expect(screen.queryByRole('button', { name: '新建渠道' })).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '扫码添加飞书 Bot' }))
    await screen.findByRole('heading', { name: '飞书 Bot 安装尚未就绪' })
    expect(screen.queryByText('使用已有飞书自建应用')).toBeNull()
    expect(screen.queryByLabelText('渠道名称')).toBeNull()
    expect(screen.queryByLabelText('渠道 ID')).toBeNull()
    expect(screen.queryByLabelText('飞书 App ID')).toBeNull()
    expect(screen.queryByText(/Credential 引用/u)).toBeNull()
  })

  it('preopens the provider installer and refreshes after an automatic channel callback', async () => {
    let resolveInstall!: (value: Record<string, unknown>) => void
    const beginChannelBotInstall = vi.fn(() => new Promise<Record<string, unknown>>((resolve) => {
      resolveInstall = resolve
    }))
    const refreshChannels = vi.fn(() => Promise.resolve(true))
    const popup = { closed: false, close: vi.fn(), opener: window, location: { href: 'about:blank' } }
    vi.spyOn(window, 'open').mockReturnValue(popup as never)
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [] } },
      beginChannelBotInstall, refreshChannels,
    } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '扫码添加飞书 Bot' }))
    expect(window.open).toHaveBeenCalledTimes(1)
    expect(popup.location.href).toBe('about:blank')
    resolveInstall({
      status: 'ready', provider: 'feishu', completionMode: 'callback', installId: SIGNED_STATE_A,
      expiresAt: Date.now() + 60_000,
      authorizationUrl: `https://open.feishu.cn/app/install?state=${SIGNED_STATE_A}`,
    })
    await waitFor(() => { expect(popup.location.href).toContain(`state=${SIGNED_STATE_A}`) })
    expect(popup.opener).toBeNull()

    await completeChannelBotInstallCallback({ completeBotInstall: () => Promise.resolve({ result: {
      ok: true, value: { channelId: 'feishu-123456789abc', name: '夏树助手' },
    } }) } as never, {
      location: {
        origin: window.location.origin, pathname: window.location.pathname,
        search: `?dsh_channel_bot_install=1&code=provider-code&state=${SIGNED_STATE_A}`,
      },
      history: { replaceState: vi.fn() }, opener: null, close: vi.fn(),
    })
    await waitFor(() => { expect(refreshChannels).toHaveBeenCalledTimes(1) })
  })

  it('polls the Feishu Device Grant and refreshes after the channel is created', async () => {
    const beginChannelBotInstall = vi.fn(() => Promise.resolve({
      status: 'ready', provider: 'feishu', completionMode: 'poll', installId: SIGNED_STATE_A,
      expiresAt: Date.now() + 60_000,
      authorizationUrl: 'https://open.feishu.cn/page/launcher?user_code=ABCD-EFGH',
    }))
    const pollChannelBotInstall = vi.fn()
      .mockResolvedValueOnce({ status: 'pending', provider: 'feishu' })
      .mockResolvedValueOnce({
        status: 'complete', provider: 'feishu',
        channel: { channelId: 'feishu-created', name: 'DSH Agent' },
      })
    const refreshChannels = vi.fn(() => Promise.resolve(true))
    const popup = { closed: false, close: vi.fn(), opener: window, location: { href: 'about:blank' } }
    vi.spyOn(window, 'open').mockReturnValue(popup as never)
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [] } },
      beginChannelBotInstall, pollChannelBotInstall, refreshChannels,
    } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '扫码添加飞书 Bot' }))
    await waitFor(() => { expect(popup.location.href).toContain('user_code=ABCD-EFGH') })
    expect(screen.getByRole('heading', { name: '等待扫码创建飞书 Bot' })).toBeDefined()
    const qr = await screen.findByRole('img', { name: '飞书 Bot 安装二维码' })
    expect(qr.tagName).toBe('svg')
    expect(qr.querySelector('path')?.getAttribute('d')?.length).toBeGreaterThan(100)
    await waitFor(() => { expect(pollChannelBotInstall).toHaveBeenCalledWith(SIGNED_STATE_A) })
    await waitFor(() => { expect(pollChannelBotInstall).toHaveBeenCalledTimes(2) }, { timeout: 3_000 })
    expect(refreshChannels).toHaveBeenCalledTimes(1)
    expect(popup.close).toHaveBeenCalledTimes(1)
  })

  it('asks only for the conditional Weixin verification number and resumes the QR login', async () => {
    const beginChannelBotInstall = vi.fn(() => Promise.resolve({
      status: 'ready', provider: 'wechat', completionMode: 'poll', installId: SIGNED_STATE_A,
      expiresAt: Date.now() + 60_000,
      authorizationUrl: 'https://liteapp.weixin.qq.com/q/visible-code',
    }))
    const pollChannelBotInstall = vi.fn()
      .mockResolvedValueOnce({ status: 'verification-required', provider: 'wechat' })
      .mockResolvedValueOnce({ status: 'pending', provider: 'wechat' })
    const popup = { closed: false, close: vi.fn(), opener: window, location: { href: 'about:blank' } }
    vi.spyOn(window, 'open').mockReturnValue(popup as never)
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [] } },
      beginChannelBotInstall, pollChannelBotInstall,
    } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '扫码连接微信 Bot' }))
    expect(await screen.findByRole('img', { name: '微信 Bot 安装二维码' })).toBeDefined()
    const code = await screen.findByRole('textbox', { name: '微信显示的验证数字' })
    fireEvent.change(code, { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '提交验证数字' }))
    await waitFor(() => { expect(pollChannelBotInstall).toHaveBeenCalledWith(SIGNED_STATE_A, '123456') })
    expect(screen.queryByRole('textbox', { name: '微信显示的验证数字' })).toBeNull()
  })

  it('starts provider Bot installation without exposing a manual app form', async () => {
    vi.spyOn(window, 'open').mockReturnValue({
      closed: false, close: vi.fn(), opener: window, location: { href: 'about:blank' },
    } as never)
    const beginChannelBotInstall = vi.fn(() => Promise.resolve({
      status: 'setup-required', provider: 'feishu',
      officialDocumentationUrl: 'https://open.feishu.cn/document/isv-guides/publish-your-app/publishing-guidelines',
    }))
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [] } },
      beginChannelBotInstall,
    } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '扫码添加飞书 Bot' }))
    await waitFor(() => { expect(beginChannelBotInstall).toHaveBeenCalledWith(
      'feishu', expect.stringMatching(/\?dsh_channel_bot_install=1$/u),
    ) })
    expect(screen.getByRole('heading', { name: '飞书 Bot 安装尚未就绪' })).toBeDefined()
    expect(screen.getByText('需要先部署 SUNFLECK 飞书商店应用，之后管理员扫码即可自动安装并创建渠道。')).toBeDefined()
    expect(screen.queryByLabelText('飞书 App ID')).toBeNull()
  })

  it('shows Workspace Cordis versions, source, lifecycle actions, and department review actions', () => {
    const stopExtension = vi.fn(() => Promise.resolve())
    const reviewExtension = vi.fn(() => Promise.resolve())
    render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', page: 'extensions', extensionWorkspaceId: 'workspace-1',
        extensions: { phase: 'ready', error: null, items: [{
          packageId: 'package-1', orgId: 'org-a', pluginId: 'orders-1', dynamicPackageId: 'pkg-1',
          version: 1, scope: { type: 'personal-workspace', workspaceId: 'workspace-1', ownerUserId: 'user-1' },
          name: '订单校验', purpose: '提交前检查订单字段。', hostCode: 'return { apply() {} }',
          manifest: { apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm', provides: ['tool:validate_order'], capabilities: [] },
          artifactRef: 'artifact://orders/1', validationReportRef: 'report://orders/1', authoredBy: 'user-1',
          sourceDigest: 'a'.repeat(64), createdAt: 1,
        }] },
        extensionBindings: [{
          bindingId: 'binding-1', orgId: 'org-a', pluginId: 'orders-1', activePackageId: 'package-1',
          scope: { type: 'personal-workspace', workspaceId: 'workspace-1', ownerUserId: 'user-1' },
          generation: 1, revision: 1, activatedBy: 'user-1', disabled: false, trustLevel: 'isolated', updatedAt: 1,
          canManage: true,
        }],
        extensionReviews: { phase: 'ready', error: null, items: [{
          reviewId: 'review-1', orgId: 'org-a', departmentId: 'dept-a', pluginId: 'orders-1',
          packageId: 'package-1', sourceSessionId: 'session-1', submittedBy: 'user-1', status: 'pending',
          revision: 1, createdAt: 1, updatedAt: 1,
        }] },
        formalPlugins: { phase: 'ready', error: null, items: [{
          entryId: 'formal-orders', moduleName: '@company/dsh-orders', enabled: true, fiberPhase: 'active',
          installSource: { kind: 'registry' }, protectedProfile: true,
        }] },
      }, stopExtension, reviewExtension,
    } as never)} />)

    expect(screen.getByText('订单校验')).toBeDefined()
    fireEvent.click(screen.getByText('版本详情与源码'))
    expect(screen.getByText('return { apply() {} }')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '停止供新会话使用' }))
    expect(stopExtension).toHaveBeenCalledWith(expect.objectContaining({ bindingId: 'binding-1' }), zh['extensions.stopReason'])
    fireEvent.click(screen.getByRole('button', { name: '审核与发布' }))
    fireEvent.change(screen.getByLabelText('审核原因'), { target: { value: '已验证' } })
    fireEvent.click(screen.getByRole('button', { name: '批准部门启用' }))
    expect(reviewExtension).toHaveBeenCalledWith(expect.objectContaining({ reviewId: 'review-1' }), 'approve', '已验证')
    fireEvent.click(screen.getByRole('button', { name: '企业发行插件' }))
    expect(screen.getByText('@company/dsh-orders')).toBeDefined()
    expect(screen.getByText('已挂载')).toBeDefined()
    expect(screen.getByText('私有 Registry')).toBeDefined()
    expect(screen.getByText('受保护 Profile')).toBeDefined()
  })

  it('shows a private saved Cordis version and lets its author restore it', () => {
    const activateExtension = vi.fn(() => Promise.resolve())
    const archiveExtension = vi.fn(() => Promise.resolve())
    const submitExtensionForDepartment = vi.fn(() => Promise.resolve())
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'extensions', extensionWorkspaceId: 'workspace-1',
        extensions: { phase: 'ready', error: null, items: [{
          packageId: 'package-saved', orgId: 'org-a', pluginId: 'private-1', dynamicPackageId: 'pkg-1',
          version: 1, scope: { type: 'personal-workspace', workspaceId: 'workspace-1', ownerUserId: 'user-1' },
          canSubmitDepartment: true,
          name: '私有助手', purpose: '供创建者使用。', hostCode: 'return { apply() {} }',
          manifest: { apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm', provides: [], capabilities: [] },
          artifactRef: 'artifact://private', validationReportRef: 'report://private', authoredBy: 'user-1',
          sourceDigest: 'a'.repeat(64), createdAt: 1,
        }] }, extensionBindings: [],
      }, activateExtension, archiveExtension, submitExtensionForDepartment,
    } as never)} />)
    expect(screen.getByText('私有助手')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '启用所选版本' }))
    expect(activateExtension).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'package-saved' }), undefined)
    fireEvent.click(screen.getByRole('button', { name: '移入回收站' }))
    expect(archiveExtension).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'package-saved' }))
    fireEvent.click(screen.getByRole('button', { name: '提交部门审核' }))
    expect(submitExtensionForDepartment).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'package-saved' }))
  })

  it('groups immutable versions under one private Plugin and offers each lifecycle action once', () => {
    const activateExtension = vi.fn(() => Promise.resolve())
    const rollbackExtension = vi.fn(() => Promise.resolve())
    const stopExtension = vi.fn(() => Promise.resolve())
    const archiveExtension = vi.fn(() => Promise.resolve())
    const submitExtensionForDepartment = vi.fn(() => Promise.resolve())
    const version = (number: number) => ({
      packageId: `package-${number}`, orgId: 'org-a', pluginId: 'orders-1', dynamicPackageId: `pkg-${number}`,
      version: number, scope: { type: 'personal-workspace', workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      canSubmitDepartment: true, name: `订单校验 v${number}`, purpose: `第 ${number} 版规则。`,
      hostCode: `return { apply() { /* v${number} */ } }`,
      manifest: { apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm', provides: ['tool:validate_order'], capabilities: [] },
      artifactRef: `artifact://orders/${number}`, validationReportRef: `report://orders/${number}`,
      authoredBy: 'user-1', sourceDigest: 'a'.repeat(64), createdAt: number,
    })
    const binding = {
      bindingId: 'binding-1', orgId: 'org-a', pluginId: 'orders-1', activePackageId: 'package-3',
      scope: version(3).scope, generation: 3, revision: 3, activatedBy: 'user-1', disabled: false,
      trustLevel: 'isolated', updatedAt: 3, canManage: true,
    }
    const view = render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'extensions', extensionWorkspaceId: 'workspace-1',
        extensions: { phase: 'ready', error: null, items: [version(1), version(2), version(3)] },
        extensionBindings: [binding], extensionReviews: { phase: 'ready', error: null, items: [] } },
      activateExtension, rollbackExtension, stopExtension, archiveExtension, submitExtensionForDepartment,
    } as never)} />)

    expect(view.container.querySelectorAll('[data-extension-plugin]')).toHaveLength(1)
    expect(screen.getByText('订单校验 v3')).toBeDefined()
    expect(screen.getAllByRole('button', { name: '停止供新会话使用' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '移入回收站' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '提交部门审核' })).toHaveLength(1)
    expect([...view.container.querySelectorAll('[data-extension-plugin]')].map(card => ({
      title: card.querySelector('h3')?.textContent,
      versions: [...card.querySelectorAll('option')].map(option => option.textContent),
      actions: [...card.querySelectorAll('button')].map(button => button.textContent),
    }))).toMatchSnapshot('grouped extension versions and actions')
    const picker = screen.getByRole('combobox', { name: '查看订单校验 v3的版本' })
    expect(picker.querySelectorAll('option')).toHaveLength(3)
    fireEvent.change(picker, { target: { value: 'package-1' } })
    expect(screen.getByText('第 1 版规则。')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '回退到 v1' }))
    expect(rollbackExtension).toHaveBeenCalledWith(expect.objectContaining({ bindingId: 'binding-1' }),
      'package-1', zh['extensions.rollbackReason'])
    expect(activateExtension).not.toHaveBeenCalled()
  })

  it('shows the newest saved version when a binding is stopped and identifies the previous selection', () => {
    const version = (number: number) => ({
      packageId: `package-${number}`, orgId: 'org-a', pluginId: 'private-1', dynamicPackageId: `pkg-${number}`,
      version: number, scope: { type: 'personal-workspace', workspaceId: 'workspace-1', ownerUserId: 'user-1' },
      name: `私有助手 v${number}`, purpose: `版本 ${number}`, hostCode: 'return { apply() {} }',
      manifest: { apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm', provides: [], capabilities: [] },
      artifactRef: `artifact://${number}`, validationReportRef: `report://${number}`,
      authoredBy: 'user-1', sourceDigest: 'a'.repeat(64), createdAt: number,
    })
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'extensions', extensions: {
        phase: 'ready', error: null, items: [version(1), version(2)],
      }, extensionBindings: [{ bindingId: 'binding-1', orgId: 'org-a', pluginId: 'private-1',
        activePackageId: 'package-1', scope: version(1).scope, generation: 1, revision: 2,
        activatedBy: 'user-1', disabled: true, trustLevel: 'isolated', updatedAt: 2, canManage: true,
      }],
    } } as never)} />)

    expect(screen.getByRole('heading', { name: '私有助手 v2' })).toBeDefined()
    expect(screen.getByText('上次启用 v1')).toBeDefined()
    expect(screen.getByRole('button', { name: '启用所选版本' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '停止供新会话使用' })).toBeNull()
  })

  it('shows review actions only in the matching review state', () => {
    const reviewExtension = vi.fn(() => Promise.resolve())
    const review = { reviewId: 'review-1', orgId: 'org-a', departmentId: 'dept-a',
      pluginId: 'orders-1', packageId: 'package-1', sourceSessionId: 'session-1',
      submittedBy: 'user-1', status: 'pending', revision: 1, createdAt: 1, updatedAt: 1 }
    const props = (status: string) => workbenchProps({
      state: { mode: 'enterprise', page: 'extensions',
        extensionReviews: { phase: 'ready', error: null, items: [{ ...review, status }] } },
      reviewExtension,
    } as never)
    const view = render(<EnterpriseWorkbench {...props('pending')} />)
    fireEvent.click(screen.getByRole('button', { name: '审核与发布' }))
    expect(screen.getByRole('button', { name: '批准部门启用' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '发布到全组织' })).toBeNull()
    view.rerender(<EnterpriseWorkbench {...props('approved-department')} />)
    expect(screen.queryByRole('button', { name: '批准部门启用' })).toBeNull()
    expect(screen.queryByRole('button', { name: '退回作者' })).toBeNull()
    expect(screen.getByRole('button', { name: '发布到全组织' })).toBeDefined()
    view.rerender(<EnterpriseWorkbench {...props('changes-requested')} />)
    expect(screen.queryByRole('button', { name: '批准部门启用' })).toBeNull()
    expect(screen.queryByRole('button', { name: '发布到全组织' })).toBeNull()
    view.rerender(<EnterpriseWorkbench {...props('published-organization')} />)
    expect(screen.queryByRole('button', { name: '发布到全组织' })).toBeNull()
  })

  it('keeps review reasons on the review where they were entered', () => {
    const review = (reviewId: string) => ({
      reviewId, orgId: 'org-a', departmentId: 'dept-a', pluginId: reviewId,
      packageId: `package-${reviewId}`, sourceSessionId: 'session-1', submittedBy: 'user-1',
      status: 'pending', revision: 1, createdAt: 1, updatedAt: 1,
    })
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'extensions', extensionReviews: {
        phase: 'ready', error: null, items: [review('first'), review('second')],
      },
    } } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: '审核与发布' }))
    const reasons = screen.getAllByRole('textbox', { name: '审核原因' })
    fireEvent.change(reasons[0]!, { target: { value: '已核验第一项' } })
    const approvals = screen.getAllByRole('button', { name: '批准部门启用' })
    expect(approvals[0]?.hasAttribute('disabled')).toBe(false)
    expect(approvals[1]?.hasAttribute('disabled')).toBe(true)
  })

  it('groups newer pending and earlier approved reviews for one Plugin', () => {
    const review = (reviewId: string, status: string, updatedAt: number) => ({
      reviewId, orgId: 'org-a', departmentId: 'dept-a', pluginId: 'board-1',
      packageId: `package-${reviewId}`, sourceSessionId: 'session-1', submittedBy: 'user-1',
      status, revision: 1, createdAt: updatedAt, updatedAt,
    })
    const view = render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'extensions', extensionReviews: { phase: 'ready', error: null,
        items: [review('approved', 'approved-department', 1), review('pending', 'pending', 2)] },
    } } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: '审核与发布' }))

    expect(view.container.querySelectorAll('[data-extension-review-group]')).toHaveLength(1)
    const group = view.container.querySelector('[data-extension-review-group]')
    if (group === null) throw new Error('extension review group is missing')
    const history = group.querySelector('details')
    if (history === null) throw new Error('review history is missing')
    expect(history.open).toBe(false)
    expect(group.querySelector(':scope > div button')?.textContent).toBe('批准部门启用')
    expect({
      current: group.querySelector(':scope > div')?.textContent?.replace(/\s+/gu, ' ').trim(),
      history: history.querySelector('summary')?.textContent,
    }).toMatchSnapshot('review grouped by plugin and department')
    fireEvent.click(screen.getByText('历史审核 1 条'))
    expect(history.open).toBe(true)
    expect(history.querySelector('button')?.textContent).toBe('发布到全组织')
  })

  it('clears the draft reason when a newer review replaces the visible request', () => {
    const review = (reviewId: string, updatedAt: number) => ({
      reviewId, orgId: 'org-a', departmentId: 'dept-a', pluginId: 'board-1',
      packageId: `package-${reviewId}`, sourceSessionId: 'session-1', submittedBy: 'user-1',
      status: 'pending', revision: 1, createdAt: updatedAt, updatedAt,
    })
    const props = (items: readonly ReturnType<typeof review>[]) => workbenchProps({ state: {
      mode: 'enterprise', page: 'extensions', extensionReviews: { phase: 'ready', error: null, items },
    } } as never)
    const view = render(<EnterpriseWorkbench {...props([review('old', 1)])} />)
    fireEvent.click(screen.getByRole('button', { name: '审核与发布' }))
    fireEvent.change(screen.getByRole('textbox', { name: '审核原因' }), { target: { value: '仅适用于旧审核' } })

    view.rerender(<EnterpriseWorkbench {...props([review('old', 1), review('new', 2)])} />)
    expect(screen.getAllByRole('textbox', { name: '审核原因' })[0]).toHaveProperty('value', '')
  })

  it('restores a private Plugin from the recycle bin without activating it', () => {
    const restoreExtension = vi.fn(() => Promise.resolve())
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'extensions', archivedExtensions: { phase: 'ready', error: null, items: [{
        packageId: 'archived-1', orgId: 'org-a', pluginId: 'private-1', dynamicPackageId: 'pkg-1',
        version: 1, scope: { type: 'personal-workspace', workspaceId: 'workspace-1', ownerUserId: 'user-1' },
        name: '归档助手', purpose: '供创建者使用。', hostCode: 'return { apply() {} }',
        manifest: { apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm', provides: [], capabilities: [] },
        artifactRef: 'artifact://private', validationReportRef: 'report://private', authoredBy: 'user-1',
        sourceDigest: 'a'.repeat(64), createdAt: 1,
      }] },
    }, restoreExtension } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: '回收站' }))
    expect(screen.getByText('归档助手')).toBeDefined()
    expect(screen.getByText('回收站中，可恢复')).toBeDefined()
    expect(screen.queryByRole('button', { name: '启用所选版本' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '恢复' }))
    expect(restoreExtension).toHaveBeenCalledWith(expect.objectContaining({ packageId: 'archived-1' }))
  })

  it('shows all Workspace extensions together with their source Workspace and an optional filter', () => {
    const setExtensionWorkspace = vi.fn()
    const workspaceSnapshot = workbenchProps().useWorkspaces(snapshot => snapshot)
    const saved = (packageId: string, workspaceId: string, name: string) => ({
      packageId, orgId: 'org-a', pluginId: packageId, dynamicPackageId: 'pkg-1', version: 1,
      scope: { type: 'personal-workspace', workspaceId, ownerUserId: 'user-1' },
      name, purpose: '验证统一管理。', hostCode: 'return { apply() {} }',
      manifest: { apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm', provides: [], capabilities: [] },
      artifactRef: `artifact://${packageId}`, validationReportRef: `report://${packageId}`, authoredBy: 'user-1',
      sourceDigest: 'a'.repeat(64), createdAt: 1,
    })
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'extensions',
        extensions: { phase: 'ready', error: null, items: [
          saved('saved-1', 'workspace-1', '采购助手'), saved('saved-2', 'workspace-2', '财务助手'),
        ] }, extensionBindings: [] },
      useWorkspaces: (select: (snapshot: typeof workspaceSnapshot) => unknown) => select({ ...workspaceSnapshot, items: [
        ...workspaceSnapshot.items,
        { ...workspaceSnapshot.items[0]!, workspaceId: 'workspace-2', title: '财务部' },
      ] } as never),
      setExtensionWorkspace,
    } as never)} />)

    const filter = screen.getByRole('combobox', { name: '工作区' }) as HTMLSelectElement
    expect(filter.value).toBe('')
    expect(screen.getByRole('option', { name: '全部工作区' })).toBeDefined()
    expect(within(screen.getByText('采购助手').closest('article')!).getByText('采购部')).toBeDefined()
    expect(within(screen.getByText('财务助手').closest('article')!).getByText('财务部')).toBeDefined()
    fireEvent.change(filter, { target: { value: 'workspace-2' } })
    expect(setExtensionWorkspace).toHaveBeenCalledWith('workspace-2')
  })

  it('names the Workspace that failed while retaining other extension rows', () => {
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'extensions', extensions: { phase: 'error', error: '财务部', items: [{
        packageId: 'saved-1', orgId: 'org-a', pluginId: 'helper-1', dynamicPackageId: 'pkg-1', version: 1,
        scope: { type: 'personal-workspace', workspaceId: 'workspace-1', ownerUserId: 'user-1' },
        name: '采购助手', purpose: '验证部分加载。', hostCode: 'return { apply() {} }',
        manifest: { apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm', provides: [], capabilities: [] },
        artifactRef: 'artifact://saved', validationReportRef: 'report://saved', authoredBy: 'user-1',
        sourceDigest: 'a'.repeat(64), createdAt: 1,
      }] },
    } as never })} />)
    expect(screen.getByText('采购助手')).toBeDefined()
    expect(screen.getByRole('status').textContent).toContain('未能加载 财务部 的扩展')
  })

  it('lists a published department package under organization extensions', () => {
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'extensions', extensionWorkspaceId: 'workspace-1',
        extensions: { phase: 'ready', error: null, items: [{
          packageId: 'published-1', orgId: 'org-a', pluginId: 'session-1:helper-1', dynamicPackageId: 'pkg-1',
          version: 1, scope: { type: 'department', departmentId: 'dept-a' },
          name: '组织助手', purpose: '供全组织使用。', hostCode: 'return { apply() {} }',
          manifest: { apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm', provides: [], capabilities: [] },
          artifactRef: 'artifact://published', validationReportRef: 'report://published', authoredBy: 'user-1',
          sourceDigest: 'a'.repeat(64), createdAt: 1,
        }] }, extensionBindings: [{
          bindingId: 'org-binding', orgId: 'org-a', pluginId: 'session-1:helper-1', activePackageId: 'published-1',
          scope: { type: 'organization', organizationId: 'org-a' }, generation: 1, revision: 1,
          activatedBy: 'manager-1', disabled: false, trustLevel: 'isolated', updatedAt: 1,
          canManage: false,
        }],
      },
    } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: '组织扩展' }))
    expect(screen.getByText('组织助手')).toBeDefined()
    expect(screen.getByText('全组织')).toBeDefined()
    expect(screen.getByText('新会话可用')).toBeDefined()
    expect(screen.queryByRole('button', { name: '停止供新会话使用' })).toBeNull()
  })

  it('shows authorized pending department source in the Department tab without activation actions', () => {
    const row = (packageId: string, name: string) => ({
      packageId, orgId: 'org-a', pluginId: packageId, dynamicPackageId: 'pkg-1', version: 1,
      scope: { type: 'department', departmentId: 'dept-a' }, name, purpose: '部门能力。',
      hostCode: 'return { apply() {} }',
      manifest: { apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm', provides: [], capabilities: [] },
      artifactRef: `artifact://${packageId}`, validationReportRef: `report://${packageId}`,
      authoredBy: 'user-1', sourceDigest: 'a'.repeat(64), createdAt: 1,
    })
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'extensions', extensions: { phase: 'ready', error: null, items: [
        row('pending-1', '待审源码'), row('approved-1', '部门共享助手'),
      ] }, extensionBindings: [{
        bindingId: 'department-binding', orgId: 'org-a', pluginId: 'approved-1', activePackageId: 'approved-1',
        scope: { type: 'department', departmentId: 'dept-a' }, generation: 1, revision: 1,
        activatedBy: 'manager-1', disabled: false, trustLevel: 'isolated', updatedAt: 1, canManage: false,
      }], extensionReviews: { phase: 'ready', error: null, items: [{
        reviewId: 'pending-review', orgId: 'org-a', departmentId: 'dept-a', pluginId: 'pending-1',
        packageId: 'pending-1', sourceSessionId: 'session-1', submittedBy: 'user-1',
        status: 'pending', revision: 1, createdAt: 1, updatedAt: 1,
      }] },
    } as never })} />)
    fireEvent.click(screen.getByRole('button', { name: '部门扩展' }))
    expect(screen.getByText('部门共享助手')).toBeDefined()
    expect(screen.getByText('待审源码')).toBeDefined()
    expect(within(screen.getByText('待审源码').closest('article')!).getByText('待审核')).toBeDefined()
    expect(screen.queryByRole('button', { name: '停止供新会话使用' })).toBeNull()
  })

  it('provides local management navigation and opens the employee draft editor from the roster', () => {
    const openEmployeeDraft = vi.fn(() => Promise.resolve())
    render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        open: true, phase: 'ready', mode: 'enterprise', page: 'employees', view: VIEW,
        error: null, busyEmployee: null,
        employees: { phase: 'ready', items: [{
          presetId: 'buyer', orgId: 'server-org', ownerUserId: 'owner-1', visibility: 'restricted',
          profile: { name: '采购专员', position: '采购执行', capabilities: ['询价'] },
          bindings: [{ kind: 'sop', assetId: 'rfq', version: 2 }], revision: 4,
          status: 'published', updatedAt: 20,
        }], error: null },
      } as never,
      openEmployeeDraft,
    })} />)

    expect(screen.getByRole('navigation', { name: '管理台导航' })).toBeDefined()
    for (const label of ['数字员工', '协作空间', '工作记录', '审批', '定时任务', '能力资产', '团队治理']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
    fireEvent.click(screen.getByRole('button', { name: '编辑采购专员' }))
    expect(openEmployeeDraft).toHaveBeenCalledWith('buyer')
  })

  it('manages channel configuration without accepting secret values', async () => {
    const saveChannelConfiguration = vi.fn(() => Promise.resolve(true))
    const archiveChannelConfiguration = vi.fn(() => Promise.resolve())
    const { container } = render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', page: 'channels',
        channels: { phase: 'ready', error: null, items: [{
          orgId: 'org-a', channelId: 'finance-wecom', name: '财务企业微信', provider: 'wecom',
          tenantId: 'corp-a', accountId: 'app-a', credentialRef: 'WECOM_FINANCE_SECRET',
          credentialStatus: 'configured', inboundEnabled: true,
          allowedIntents: ['notify', 'handoff', 'team-start', 'decision-response', 'status'],
          transportStatus: 'unverified', state: 'active', createdBy: 'admin-a', revision: 1,
          createdAt: 1, updatedAt: 1,
        }] } as never,
      },
      saveChannelConfiguration, archiveChannelConfiguration,
    } as never)} />)

    expect(screen.getByRole('heading', { name: '渠道设置' })).toBeDefined()
    expect(screen.getByRole('button', { name: '外部渠道' })).toBeDefined()
    expect(screen.getByRole('heading', { name: '财务企业微信' })).toBeDefined()
    expect(screen.getByText('凭证已配置')).toBeDefined()
    expect(screen.getAllByText('适配器证据待补充').length).toBeGreaterThan(0)
    expect(container.querySelector('input[type="password"]')).toBeNull()

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByRole('button', { name: '扫码连接微信 Bot' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: '暂停财务企业微信' }))
    expect(saveChannelConfiguration).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'finance-wecom', state: 'paused', expectedRevision: 1,
    }))
    fireEvent.click(screen.getByRole('button', { name: '归档财务企业微信' }))
    expect(archiveChannelConfiguration).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'finance-wecom' }))
  })

  it('shows provider guidance, official docs, and disables binding until prerequisites are saved', () => {
    const beginChannelBinding = vi.fn()
    render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [
          {
            orgId: 'org-a', channelId: 'wecom', name: '企业微信', provider: 'wecom', accountId: 'agent',
            credentialRef: 'WECOM', credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [],
            transportStatus: 'unverified', state: 'draft', bindingStatus: 'unbound', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
          },
          {
            orgId: 'org-a', channelId: 'feishu', name: '飞书', provider: 'feishu', accountId: 'app', credentialRef: 'FEISHU',
            credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified', state: 'paused',
            bindingStatus: 'unbound', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
          },
          {
            orgId: 'org-a', channelId: 'dingtalk', name: '钉钉', provider: 'dingtalk', accountId: '',
            credentialStatus: 'missing', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified', state: 'active',
            bindingStatus: 'unbound', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
          },
          {
            orgId: 'org-a', channelId: 'wechat', name: '个人微信', provider: 'wechat', accountId: 'website-app',
            credentialRef: 'WECHAT', credentialStatus: 'configured', inboundEnabled: false, allowedIntents: ['handoff'],
            transportStatus: 'unverified', state: 'archived', bindingStatus: 'unbound', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
          },
        ] } as never,
      }, beginChannelBinding,
    } as never)} />)

    for (const copy of [
      'CorpID + AgentID + OAuth 可信回调域名', '安全设置中配置 App ID + 重定向 URL',
      'Client ID +「钉钉登录与分享」回调', '已审核网站应用 + snsapi_login',
    ]) expect(screen.getByText(copy)).toBeDefined()
    const links = screen.getAllByRole('link', { name: '查看官方配置文档' })
    expect(links).toHaveLength(4)
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      'https://developer.work.weixin.qq.com/document/path/98152',
      'https://open.feishu.cn/document/common-capabilities/sso/web-application-sso/qr-sdk-documentation',
      'https://open.dingtalk.com/document/isvapp/tutorial-enabling-login-to-third-party-websites.md',
      'https://developers.weixin.qq.com/doc/oplatform/developers/dev/auth/web.html',
    ])
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    }
    expect(screen.getAllByText('企业 / 租户 ID 缺失').length).toBeGreaterThan(0)
    expect(screen.getAllByText('账号 ID 缺失 · 凭证缺失').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '扫码绑定企业微信' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '扫码绑定飞书' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: '扫码绑定钉钉' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '扫码绑定个人微信' }).hasAttribute('disabled')).toBe(true)
  })

  it('targets enabled configuration and binding recovery controls without treating pending adapter evidence as attention', () => {
    const channel = (overrides: Record<string, unknown>) => ({
      orgId: 'org-a', provider: 'feishu', tenantId: 'tenant', accountId: 'app', credentialRef: 'CREDENTIAL',
      credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified',
      state: 'active', bindingStatus: 'verified', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
      ...overrides,
    })
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [
        channel({ channelId: 'missing', name: '缺少配置', provider: 'wecom', tenantId: '', accountId: '', credentialStatus: 'missing', bindingStatus: 'unbound' }),
        channel({ channelId: 'unbound', name: '待绑定', bindingStatus: 'unbound' }),
        channel({ channelId: 'evidence', name: '待证据' }),
        channel({ channelId: 'draft', name: '草稿未绑定', state: 'draft', bindingStatus: 'unbound' }),
        channel({ channelId: 'paused', name: '暂停待证据', state: 'paused' }),
        channel({ channelId: 'archived', name: '归档缺少配置', state: 'archived', accountId: '', credentialStatus: 'missing', bindingStatus: 'unbound' }),
      ] } as never,
    } } as never)} />)

    const attention = screen.getByRole('region', { name: '渠道待处理项' })
    expect(within(attention).getByText('账号 ID 缺失 · 企业 / 租户 ID 缺失 · 凭证缺失')).toBeDefined()
    expect(within(attention).getByText('已启用渠道的官方二维码身份未绑定')).toBeDefined()
    expect(attention.textContent).not.toContain('待证据')
    expect(attention.textContent).not.toContain('草稿未绑定')
    expect(attention.textContent).not.toContain('暂停待证据')
    expect(attention.textContent).not.toContain('归档缺少配置')
    expect(attention.textContent).not.toContain('已连接')
    expect(attention.textContent).not.toContain('传输失败')

    const missingRow = screen.getByRole('article', { name: '缺少配置' })
    const setupDocs = within(missingRow).getByRole('link', { name: '查看官方配置文档' })
    fireEvent.click(within(attention).getByRole('button', { name: /缺少配置/u }))
    expect(document.activeElement).toBe(setupDocs)
    expect(document.activeElement).not.toBe(within(missingRow).getByRole('button', { name: '扫码绑定企业微信' }))

    const unboundRow = screen.getByRole('article', { name: '待绑定' })
    const bind = within(unboundRow).getByRole('button', { name: '扫码绑定飞书' })
    fireEvent.click(within(attention).getByRole('button', { name: /待绑定/u }))
    expect(document.activeElement).toBe(bind)
    expect(bind.hasAttribute('disabled')).toBe(false)

    const evidenceRow = screen.getByRole('article', { name: '待证据' })
    expect(within(evidenceRow).queryByRole('link', { name: '查看传输接入要求' })).toBeNull()
    expect(within(evidenceRow).getAllByText('适配器证据待补充').length).toBeGreaterThan(0)
  })

  it('keeps attention items as native keyboard buttons for Enter and Space activation', () => {
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [{
        orgId: 'org-a', channelId: 'missing', name: '缺少配置', provider: 'wecom', tenantId: '', accountId: '',
        credentialStatus: 'missing', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified',
        state: 'active', bindingStatus: 'unbound', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
      }] } as never,
    } } as never)} />)

    const attention = within(screen.getByRole('region', { name: '渠道待处理项' }))
      .getByRole('button', { name: /缺少配置/u })
    const setupDocs = within(screen.getByRole('article', { name: '缺少配置' })).getByRole('link', { name: '查看官方配置文档' })
    const focus = vi.spyOn(setupDocs, 'focus')
    expect(attention.tagName).toBe('BUTTON')
    expect(attention.getAttribute('type')).toBe('button')
    attention.focus()
    expect(fireEvent.keyDown(attention, { key: 'Enter', code: 'Enter' })).toBe(false)
    expect(document.activeElement).toBe(setupDocs)
    expect(focus).toHaveBeenCalledTimes(1)
    expect(fireEvent.keyUp(attention, { key: 'Enter', code: 'Enter' })).toBe(true)
    expect(focus).toHaveBeenCalledTimes(1)

    attention.focus()
    expect(fireEvent.keyDown(attention, { key: ' ', code: 'Space' })).toBe(false)
    expect(document.activeElement).toBe(attention)
    expect(focus).toHaveBeenCalledTimes(1)
    expect(fireEvent.keyUp(attention, { key: ' ', code: 'Space' })).toBe(false)
    expect(document.activeElement).toBe(setupDocs)
    expect(focus).toHaveBeenCalledTimes(2)
  })

  it('suppresses bind attention while an official binding is opening, waiting, or checking', async () => {
    vi.useFakeTimers()
    let resolveBinding!: (value: { authorizationUrl: string; expiresAt: number }) => void
    const beginChannelBinding = vi.fn(() => new Promise<{ authorizationUrl: string; expiresAt: number }>((resolve) => {
      resolveBinding = resolve
    }))
    const refreshChannels = vi.fn(() => new Promise<boolean>(() => {}))
    const popup = { closed: false, close: vi.fn(), opener: window, location: { href: 'about:blank' } }
    vi.spyOn(window, 'open').mockReturnValue(popup as never)
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null,
        items: [activeFeishuChannel('first', '首个飞书'), activeFeishuChannel('second', '第二个飞书')] } as never,
    }, beginChannelBinding, refreshChannels } as never)} />)

    fireEvent.click(screen.getAllByRole('button', { name: '扫码绑定飞书' })[0] as HTMLElement)
    expect(screen.getByRole('status').textContent).toContain('正在准备官方授权')
    expect(screen.queryByRole('region', { name: '渠道待处理项' })).toBeNull()

    resolveBinding({
      authorizationUrl: `https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=${SIGNED_STATE_A}`,
      expiresAt: Date.now() + 60_000,
    })
    await act(async () => {})
    expect(screen.getByRole('status').textContent).toContain('已打开官方授权')
    expect(screen.queryByRole('region', { name: '渠道待处理项' })).toBeNull()

    popup.closed = true
    act(() => { vi.advanceTimersByTime(250) })
    expect(screen.getByRole('status').textContent).toContain('正在同步绑定结果')
    expect(screen.queryByRole('region', { name: '渠道待处理项' })).toBeNull()
  })

  it('renders English attention, readiness status, and provider transport guidance', () => {
    const english = makeTranslate(en)
    render(<EnterpriseWorkbench {...workbenchProps({ t: english, state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [{
        orgId: 'org-a', channelId: 'missing-wecom', name: 'Finance WeCom', provider: 'wecom', tenantId: '', accountId: '',
        credentialStatus: 'missing', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified',
        state: 'active', bindingStatus: 'unbound', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
      }, {
        orgId: 'org-a', channelId: 'verified-feishu', name: 'Finance Feishu', provider: 'feishu', accountId: 'app',
        credentialRef: 'FEISHU', credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [],
        transportStatus: 'unverified', state: 'active', bindingStatus: 'verified', createdBy: 'admin', revision: 1,
        createdAt: 1, updatedAt: 1,
      }] } as never,
    } } as never)} />)

    expect(screen.getByRole('region', { name: 'Channel attention' }).textContent).toContain('Account ID missing · Enterprise / tenant ID missing · Credential missing')
    expect(screen.getByText('Pending configuration')).toBeDefined()
    expect(screen.getAllByText('Adapter evidence pending').length).toBeGreaterThan(0)
    expect(screen.getByText(/Create an Intelligent Bot or app in the admin console/u)).toBeDefined()
    expect(screen.getByText(/Minimum transport permissions: read P2P messages/u)).toBeDefined()
    expect(screen.getByRole('region', { name: 'Channel attention' }).textContent).not.toContain('Finance Feishu')
  })

  it('keeps configuration, official identity, DSH route, and transport evidence independent', () => {
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [{
        orgId: 'org-a', channelId: 'finance-feishu', name: '财务飞书', provider: 'feishu', accountId: 'app',
        credentialRef: 'FEISHU', credentialStatus: 'configured', defaultEmployeeReleaseId: 'release-finance-v3',
        inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified', state: 'active', bindingStatus: 'verified',
        createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
      }] } as never,
    } } as never)} />)

    const rail = screen.getByRole('group', { name: '财务飞书渠道事实' })
    for (const label of ['配置', '官方二维码身份', 'SUNFLECK 路由', '传输证据']) {
      expect(within(rail).getByText(label)).toBeDefined()
    }
    expect(within(rail).getByText('release-finance-v3')).toBeDefined()
    expect(within(rail).getByText('身份已验证')).toBeDefined()
    expect(within(rail).getByText('适配器证据待补充')).toBeDefined()
  })

  it('separates provider transport setup from OAuth identity guidance', () => {
    const channel = (provider: 'wecom' | 'feishu' | 'dingtalk' | 'wechat') => ({
      orgId: 'org-a', channelId: provider, name: provider, provider, tenantId: 'tenant', accountId: 'app',
      credentialRef: 'REF', credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [],
      transportStatus: 'unverified', state: 'active', bindingStatus: 'verified', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
    })
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null,
        items: ['wecom', 'feishu', 'dingtalk', 'wechat'].map(provider => channel(provider as never)) } as never,
    } } as never)} />)

    for (const copy of [
      '在管理后台创建智能机器人或应用，配置 Agent / 应用可见范围与回调可信域名；仍需 Bot / 传输 Credential 引用。',
      '传输最小权限：读取单聊消息、接收群 @ 事件、以机器人身份发送；联系人、邮件、HR 仅在业务需要时申请。',
      '创建 Stream 模式机器人 / 监听器，并引用 Client ID / Secret Credential。',
      '腾讯微信扫码凭证已配置；SUNFLECK 记录提供方回执或心跳前，传输仍为待验证。',
    ]) expect(screen.getByText(copy)).toBeDefined()
    expect(screen.getAllByText('传输配置，与 OAuth 身份分离')).toHaveLength(4)
  })

  it('derives channel readiness copy and disables every archived row action', () => {
    const channel = (overrides: Record<string, unknown>) => ({
      orgId: 'org-a', provider: 'feishu', tenantId: 'tenant', accountId: 'app', credentialRef: 'REF',
      credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified', state: 'active',
      bindingStatus: 'unbound', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1, ...overrides,
    })
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [
        channel({ channelId: 'pending', name: '待配置', accountId: '', credentialStatus: 'missing' }),
        channel({ channelId: 'scan', name: '待扫码' }),
        channel({ channelId: 'verified', name: '已验证', bindingStatus: 'verified' }),
        channel({ channelId: 'paused', name: '暂停', state: 'paused' }),
        channel({ channelId: 'archived', name: '归档', state: 'archived' }),
      ] } as never,
    } } as never)} />)

    for (const status of ['待补全配置', '可扫码', '身份已验证', '适配器证据待补充']) {
      expect(screen.getAllByText(status).length).toBeGreaterThan(0)
    }
    expect(screen.getAllByText('已暂停')).toHaveLength(1)
    expect(screen.getAllByText('已归档')).toHaveLength(1)
    const archivedRow = screen.getByRole('article', { name: '归档' })
    expect(within(archivedRow).getAllByRole('button').every(button => button.hasAttribute('disabled'))).toBe(true)
  })

  it('opens a blank popup synchronously, then assigns the returned official authorization URL', async () => {
    let resolveBinding!: (value: { authorizationUrl: string }) => void
    const beginChannelBinding = vi.fn(() => new Promise((resolve) => { resolveBinding = resolve }))
    const navigationOrder: string[] = []
    let assignedHref = 'about:blank'
    const popup = {
      closed: false, close: vi.fn(),
      set opener(value: unknown) { navigationOrder.push(`opener:${String(value)}`) },
      location: {
        get href() { return assignedHref },
        set href(value: string) { navigationOrder.push(`href:${value}`); assignedHref = value },
      },
    }
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as never)
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [{
        orgId: 'org-a', channelId: 'finance-wecom', name: '财务企业微信', provider: 'wecom', tenantId: 'corp', accountId: 'agent',
        credentialRef: 'WECOM', credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified',
        state: 'active', bindingStatus: 'unbound', createdBy: 'admin', revision: 3, createdAt: 1, updatedAt: 1,
      }] } as never }, beginChannelBinding,
    } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '扫码绑定企业微信' }))
    expect(open).toHaveBeenCalledWith('', 'dsh-channel-binding', expect.any(String))
    expect(beginChannelBinding).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'finance-wecom' }),
      expect.stringMatching(/\?dsh_channel_binding=1$/u),
    )
    expect(popup.location.href).toBe('about:blank')
    resolveBinding({ authorizationUrl: `https://login.work.weixin.qq.com/wwlogin/sso/login?state=${SIGNED_STATE_A}` })
    await waitFor(() => { expect(popup.location.href).toContain(`state=${SIGNED_STATE_A}`) })
    expect(navigationOrder).toEqual([
      'opener:null', `href:https://login.work.weixin.qq.com/wwlogin/sso/login?state=${SIGNED_STATE_A}`,
    ])
  })

  it('rejects malicious or provider-mismatched authorization URLs without navigation', async () => {
    const beginChannelBinding = vi.fn()
      .mockResolvedValueOnce({ authorizationUrl: 'javascript:alert(1)', expiresAt: Date.now() + 60_000 })
      .mockResolvedValueOnce({ authorizationUrl: 'https://evil.example/wwlogin/sso/login', expiresAt: Date.now() + 60_000 })
    const assigned: string[] = []
    const popups = [0, 1].map(() => ({
      closed: false, close: vi.fn(), opener: window,
      location: { set href(value: string) { assigned.push(value) } },
    }))
    vi.spyOn(window, 'open').mockReturnValueOnce(popups[0] as never).mockReturnValueOnce(popups[1] as never)
    const channel = {
      orgId: 'org-a', channelId: 'finance-wecom', name: '财务企业微信', provider: 'wecom', tenantId: 'corp', accountId: 'agent',
      credentialRef: 'WECOM', credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified',
      state: 'active', bindingStatus: 'unbound', createdBy: 'admin', revision: 3, createdAt: 1, updatedAt: 1,
    }
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [channel] } as never,
    }, beginChannelBinding } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '扫码绑定企业微信' }))
    await waitFor(() => { expect(popups[0]?.close).toHaveBeenCalledTimes(1) })
    fireEvent.click(screen.getByRole('button', { name: '重试绑定' }))
    await waitFor(() => { expect(popups[1]?.close).toHaveBeenCalledTimes(1) })
    expect(assigned).toEqual([])
    expect(screen.getByRole('alert').textContent).toContain('未能启动官方绑定')
  })

  it('fails closed before popup or begin when BroadcastChannel is unavailable', () => {
    vi.stubGlobal('BroadcastChannel', undefined)
    const beginChannelBinding = vi.fn()
    const open = vi.spyOn(window, 'open')
    const channel = {
      orgId: 'org-a', channelId: 'finance-wecom', name: '财务企业微信', provider: 'wecom', tenantId: 'corp', accountId: 'agent',
      credentialRef: 'WECOM', credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified',
      state: 'active', bindingStatus: 'unbound', createdBy: 'admin', revision: 3, createdAt: 1, updatedAt: 1,
    }
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [channel] } as never,
    }, beginChannelBinding } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '扫码绑定企业微信' }))

    expect(open).not.toHaveBeenCalled()
    expect(beginChannelBinding).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('当前浏览器不支持安全绑定')
  })

  it('centralizes each exact official authorization host and path', () => {
    expect(officialChannelAuthorizationUrl('wecom', 'https://login.work.weixin.qq.com/wwlogin/sso/login?state=1')?.pathname).toBe('/wwlogin/sso/login')
    expect(officialChannelAuthorizationUrl('feishu', 'https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=1')?.pathname).toBe('/open-apis/authen/v1/authorize')
    expect(officialChannelAuthorizationUrl('dingtalk', 'https://login.dingtalk.com/oauth2/auth?state=1')?.pathname).toBe('/oauth2/auth')
    expect(officialChannelAuthorizationUrl('wechat', 'https://open.weixin.qq.com/connect/qrconnect?state=1')?.pathname).toBe('/connect/qrconnect')
    expect(officialChannelAuthorizationUrl('wecom', 'https://user@login.work.weixin.qq.com/wwlogin/sso/login')).toBeNull()
    const official = officialChannelAuthorizationUrl('wecom',
      `https://login.work.weixin.qq.com/wwlogin/sso/login?state=${SIGNED_STATE_A}`)
    expect(officialChannelBindingState(official as URL)).toBe(SIGNED_STATE_A)
    expect(officialChannelBindingState(new URL('https://login.work.weixin.qq.com/wwlogin/sso/login?state=short'))).toBeNull()
  })

  it('fences out-of-order begin results and disables every bind action while one attempt is opening', async () => {
    let resolveFirst!: (value: { authorizationUrl: string; expiresAt: number }) => void
    let resolveSecond!: (value: { authorizationUrl: string; expiresAt: number }) => void
    const beginChannelBinding = vi.fn((channel: { channelId: string }) =>
      new Promise<{ authorizationUrl: string; expiresAt: number }>((resolve) => {
        if (channel.channelId === 'first') resolveFirst = resolve
        else resolveSecond = resolve
      }))
    const popups = [
      { closed: false, close: vi.fn(), opener: window, location: { href: 'about:blank' } },
      { closed: false, close: vi.fn(), opener: window, location: { href: 'about:blank' } },
    ]
    vi.spyOn(window, 'open').mockReturnValueOnce(popups[0] as never).mockReturnValueOnce(popups[1] as never)
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [activeFeishuChannel('first', '首个飞书'), activeFeishuChannel('second', '第二个飞书')] } as never,
    }, beginChannelBinding } as never)} />)

    const buttons = screen.getAllByRole('button', { name: '扫码绑定飞书' })
    act(() => {
      buttons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(beginChannelBinding).toHaveBeenCalledTimes(2)
    expect(buttons.every(button => button.hasAttribute('disabled'))).toBe(true)
    expect(popups[0]?.close).toHaveBeenCalledTimes(1)

    resolveSecond({
      authorizationUrl: `https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=${SIGNED_STATE_B}`,
      expiresAt: Date.now() + 60_000,
    })
    await waitFor(() => { expect(popups[1]?.location.href).toContain(`state=${SIGNED_STATE_B}`) })
    resolveFirst({
      authorizationUrl: `https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=${SIGNED_STATE_A}`,
      expiresAt: Date.now() + 60_000,
    })
    await act(async () => {})
    expect(popups[1]?.location.href).toContain(`state=${SIGNED_STATE_B}`)
    expect(popups[1]?.close).not.toHaveBeenCalled()
  })

  it('settles opener-null callbacks through BroadcastChannel and rejects wrong attempt or channel messages', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const refreshChannels = vi.fn(() => Promise.resolve(true))
    let redirectUri = ''
    const beginChannelBinding = vi.fn((_channel: unknown, redirect: string) => {
      redirectUri = redirect
      return Promise.resolve({
        authorizationUrl: `https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=${SIGNED_STATE_A}`,
        expiresAt: Date.now() + 60_000,
      })
    })
    const popup = { closed: false, close: vi.fn(), opener: window, location: { href: 'about:blank' } }
    vi.spyOn(window, 'open').mockReturnValue(popup as never)
    const channel = {
      orgId: 'org-a', channelId: 'finance-feishu', name: '财务飞书', provider: 'feishu', accountId: 'app',
      credentialRef: 'FEISHU', credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified',
      state: 'active', bindingStatus: 'unbound', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
    }
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [channel] } as never,
    }, beginChannelBinding, refreshChannels } as never)} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '扫码绑定飞书' })) })
    expect(new URL(redirectUri).searchParams.get('dsh_channel_binding')).toBe('1')
    const attemptId = SIGNED_STATE_A
    expect(popup.opener).toBeNull()
    const sender = new FakeBroadcastChannel(CHANNEL_BINDING_BROADCAST_CHANNEL)
    sender.postMessage({ type: 'dsh-channel-binding-complete', attemptId: 'wrong-attempt', channelId: 'finance-feishu' })
    sender.postMessage({ type: 'dsh-channel-binding-complete', attemptId, channelId: 'other-channel' })
    expect(refreshChannels).not.toHaveBeenCalled()
    sender.close()

    const callbackClose = vi.fn()
    await completeChannelBindingCallback({ completeBinding: () => Promise.resolve({ result: {
      ok: true, value: { channelId: 'finance-feishu' },
    } }) } as never, {
      location: {
        origin: window.location.origin, pathname: window.location.pathname,
        search: `?dsh_channel_binding=1&code=provider-code&state=${SIGNED_STATE_A}`,
      },
      history: { replaceState: vi.fn() }, opener: null, close: callbackClose,
    })

    expect(refreshChannels).toHaveBeenCalledTimes(1)
    expect(callbackClose).toHaveBeenCalledTimes(1)
    expect(FakeBroadcastChannel.channels.every(item => item.closed)).toBe(true)
  })

  it('delivers opener-null callback failure through BroadcastChannel and releases listeners', async () => {
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    let redirectUri = ''
    const beginChannelBinding = vi.fn((_channel: unknown, redirect: string) => {
      redirectUri = redirect
      return Promise.resolve({
        authorizationUrl: `https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=${SIGNED_STATE_A}`,
        expiresAt: Date.now() + 60_000,
      })
    })
    const popup = { closed: false, close: vi.fn(), opener: window, location: { href: 'about:blank' } }
    vi.spyOn(window, 'open').mockReturnValue(popup as never)
    const channel = {
      orgId: 'org-a', channelId: 'finance-feishu', name: '财务飞书', provider: 'feishu', accountId: 'app',
      credentialRef: 'FEISHU', credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified',
      state: 'active', bindingStatus: 'unbound', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
    }
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [channel] } as never,
    }, beginChannelBinding } as never)} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '扫码绑定飞书' })) })
    expect(new URL(redirectUri).searchParams.get('dsh_channel_binding')).toBe('1')

    const completeBinding = vi.fn()
    await completeChannelBindingCallback({ completeBinding }, {
      location: {
        origin: window.location.origin, pathname: window.location.pathname,
        search: `?dsh_channel_binding=1&state=${SIGNED_STATE_A}&error=access_denied`,
      },
      history: { replaceState: vi.fn() }, opener: null, close: vi.fn(),
    })

    expect(completeBinding).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toContain('提供方验证失败')
    expect(FakeBroadcastChannel.channels.every(item => item.closed)).toBe(true)
  })

  it('waits for refreshed projection after popup close and clears checking when verification arrives', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    let resolveRefresh!: (value: boolean) => void
    const refreshChannels = vi.fn(() => new Promise<boolean>((resolve) => { resolveRefresh = resolve }))
    const beginChannelBinding = vi.fn(() => Promise.resolve({
      authorizationUrl: `https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=${SIGNED_STATE_A}`,
      expiresAt: Date.now() + 60_000,
    }))
    const popup = { closed: false, close: vi.fn(), opener: window, location: { href: 'about:blank' } }
    vi.spyOn(window, 'open').mockReturnValue(popup as never)
    const channel = {
      orgId: 'org-a', channelId: 'finance-feishu', name: '财务飞书', provider: 'feishu', accountId: 'app',
      credentialRef: 'FEISHU', credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified',
      state: 'active', bindingStatus: 'unbound', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
    }
    const rendered = render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [channel] } as never,
    }, beginChannelBinding, refreshChannels } as never)} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '扫码绑定飞书' })) })
    popup.closed = true
    act(() => { vi.advanceTimersByTime(250) })
    expect(refreshChannels).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status').textContent).toContain('正在同步绑定结果')
    expect(screen.queryByRole('alert')).toBeNull()

    rendered.rerender(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels',
      channels: { phase: 'ready', error: null, items: [{ ...channel, bindingStatus: 'verified' }] } as never,
    }, beginChannelBinding, refreshChannels } as never)} />)
    await act(async () => {})
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    resolveRefresh(true)
  })

  it('shows popup-closed recovery only after refreshed projection remains unverified', async () => {
    vi.useFakeTimers()
    const refreshChannels = vi.fn(() => Promise.resolve(true))
    const beginChannelBinding = vi.fn(() => Promise.resolve({
      authorizationUrl: `https://accounts.feishu.cn/open-apis/authen/v1/authorize?state=${SIGNED_STATE_A}`,
      expiresAt: Date.now() + 60_000,
    }))
    const popup = { closed: false, close: vi.fn(), opener: window, location: { href: 'about:blank' } }
    vi.spyOn(window, 'open').mockReturnValue(popup as never)
    const channel = {
      orgId: 'org-a', channelId: 'finance-feishu', name: '财务飞书', provider: 'feishu', accountId: 'app',
      credentialRef: 'FEISHU', credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified',
      state: 'active', bindingStatus: 'unbound', createdBy: 'admin', revision: 1, createdAt: 1, updatedAt: 1,
    }
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [channel] } as never,
    }, beginChannelBinding, refreshChannels } as never)} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '扫码绑定飞书' })) })
    popup.closed = true
    act(() => { vi.advanceTimersByTime(250) })
    await act(async () => {})
    expect(screen.getByRole('status').textContent).toContain('正在同步绑定结果')
    act(() => { vi.advanceTimersByTime(1_500) })
    expect(screen.getByRole('alert').textContent).toContain('绑定窗口已关闭')
    act(() => { vi.advanceTimersByTime(2_000) })
    expect(refreshChannels).toHaveBeenCalledTimes(1)
  })

  it('shows actionable popup blocked and begin-binding failure states', async () => {
    const beginChannelBinding = vi.fn(() => Promise.reject(new Error('remote failed')))
    const popup = { location: { href: 'about:blank' }, close: vi.fn() }
    vi.spyOn(window, 'open').mockReturnValueOnce(null).mockReturnValueOnce(popup as never)
    const channel = {
      orgId: 'org-a', channelId: 'finance-wecom', name: '财务企业微信', provider: 'wecom', tenantId: 'corp', accountId: 'agent',
      credentialRef: 'WECOM', credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified',
      state: 'active', bindingStatus: 'unbound', createdBy: 'admin', revision: 3, createdAt: 1, updatedAt: 1,
    }
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [channel] } as never,
    }, beginChannelBinding } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '扫码绑定企业微信' }))
    expect(screen.getByRole('alert').textContent).toContain('浏览器阻止了绑定窗口')
    fireEvent.click(screen.getByRole('button', { name: '扫码绑定企业微信' }))
    await waitFor(() => { expect(popup.close).toHaveBeenCalledTimes(1) })
    expect(screen.getByRole('alert').textContent).toContain('未能启动官方绑定')
  })

  it('accepts binding messages only from the active same-origin popup and keeps controls keyboard-focusable', async () => {
    const refreshChannels = vi.fn(() => Promise.resolve(true))
    const redirects: string[] = []
    const beginChannelBinding = vi.fn((_channel: unknown, redirect: string) => {
      redirects.push(redirect)
      return Promise.resolve({
        authorizationUrl: `https://login.work.weixin.qq.com/wwlogin/sso/login?state=${SIGNED_STATE_A}`,
        expiresAt: Date.now() + 60_000,
      })
    })
    const popup = { location: { href: 'about:blank' }, close: vi.fn(), closed: false }
    vi.spyOn(window, 'open').mockReturnValue(popup as never)
    const channel = {
      orgId: 'org-a', channelId: 'finance-wecom', name: '财务企业微信', provider: 'wecom', tenantId: 'corp', accountId: 'agent',
      credentialRef: 'WECOM', credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified',
      state: 'active', bindingStatus: 'verified', boundProviderIdentityId: 'user-42', boundProviderIdentityName: '王小明',
      verifiedTenantId: 'corp-verified', bindingVerifiedBy: 'admin-a', bindingVerifiedAt: Date.UTC(2026, 8, 2, 1, 2),
      createdBy: 'admin', revision: 3, createdAt: 1, updatedAt: 1,
    }
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [channel] } as never,
    }, refreshChannels, beginChannelBinding } as never)} />)

    expect(screen.getByText('王小明')).toBeDefined()
    expect(screen.getByText(/corp-verified/u)).toBeDefined()
    expect(screen.getByText(/admin-a/u)).toBeDefined()
    const bindButton = screen.getByRole('button', { name: '重新绑定' })
    const docsLink = screen.getByRole('link', { name: '查看官方配置文档' })
    expect(bindButton.tagName).toBe('BUTTON')
    expect(bindButton.tabIndex).toBe(0)
    expect(docsLink.tagName).toBe('A')
    expect(docsLink.tabIndex).toBe(0)
    bindButton.focus()
    expect(document.activeElement).toBe(bindButton)
    fireEvent.click(bindButton)
    await waitFor(() => { expect(popup.location.href).toContain(`state=${SIGNED_STATE_A}`) })
    expect(new URL(redirects[0] as string).searchParams.get('dsh_channel_binding')).toBe('1')
    const attemptId = SIGNED_STATE_A
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://evil.example', source: popup as never,
      data: { type: 'dsh-channel-binding-complete', attemptId, channelId: 'finance-wecom' },
    }))
    expect(refreshChannels).not.toHaveBeenCalled()
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin, source: {} as never,
      data: { type: 'dsh-channel-binding-complete', attemptId, channelId: 'finance-wecom' },
    }))
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin,
      data: { type: 'dsh-channel-binding-complete', attemptId, channelId: 'finance-wecom' },
    }))
    expect(refreshChannels).not.toHaveBeenCalled()
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin, source: popup as never,
      data: { type: 'dsh-channel-binding-complete', attemptId, channelId: 'finance-wecom' },
    }))
    await waitFor(() => { expect(refreshChannels).toHaveBeenCalledTimes(1) })
    await waitFor(() => { expect(screen.queryByRole('status')).toBeNull() })
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin, source: popup as never,
      data: { type: 'dsh-channel-binding-complete', attemptId, channelId: 'finance-wecom' },
    }))
    expect(refreshChannels).toHaveBeenCalledTimes(1)

    fireEvent.click(bindButton)
    await waitFor(() => { expect(screen.getByRole('status').textContent).toContain('已打开官方授权') })
    expect(new URL(redirects[1] as string).searchParams.get('dsh_channel_binding')).toBe('1')
    const retryAttemptId = SIGNED_STATE_A
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin, source: {} as never,
      data: { type: 'dsh-channel-binding-failed', attemptId: retryAttemptId },
    }))
    expect(screen.queryByRole('alert')).toBeNull()
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin, source: popup as never,
      data: { type: 'dsh-channel-binding-failed', attemptId: retryAttemptId },
    }))
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toContain('提供方验证失败') })
    window.dispatchEvent(new MessageEvent('message', {
      origin: window.location.origin, source: popup as never,
      data: { type: 'dsh-channel-binding-complete', attemptId: retryAttemptId, channelId: 'finance-wecom' },
    }))
    expect(refreshChannels).toHaveBeenCalledTimes(1)
  })

  it('expires a waiting binding session without reporting success and leaves retry available', async () => {
    vi.useFakeTimers()
    const refreshChannels = vi.fn(() => Promise.resolve(true))
    const beginChannelBinding = vi.fn(() => Promise.resolve({
      authorizationUrl: `https://login.work.weixin.qq.com/wwlogin/sso/login?state=${SIGNED_STATE_A}`, expiresAt: Date.now() + 100,
    }))
    const popup = { location: { href: 'about:blank' }, close: vi.fn(), closed: false }
    vi.spyOn(window, 'open').mockReturnValue(popup as never)
    const channel = {
      orgId: 'org-a', channelId: 'finance-wecom', name: '财务企业微信', provider: 'wecom', tenantId: 'corp', accountId: 'agent',
      credentialRef: 'WECOM', credentialStatus: 'configured', inboundEnabled: true, allowedIntents: [], transportStatus: 'unverified',
      state: 'active', bindingStatus: 'unbound', createdBy: 'admin', revision: 3, createdAt: 1, updatedAt: 1,
    }
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'channels', channels: { phase: 'ready', error: null, items: [channel] } as never,
    }, beginChannelBinding, refreshChannels } as never)} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '扫码绑定企业微信' })) })
    expect(screen.getByRole('status').textContent).toContain('已打开官方授权')
    act(() => { vi.advanceTimersByTime(101) })
    expect(screen.getByRole('alert').textContent).toContain('本次绑定已过期')
    const retry = screen.getByRole('button', { name: '重试绑定' })
    expect(retry.hasAttribute('disabled')).toBe(false)
    const attention = screen.getByRole('region', { name: '渠道待处理项' })
    expect(attention.textContent).toContain('当前绑定尝试需要恢复')
    fireEvent.click(within(attention).getByRole('button', { name: /财务企业微信/u }))
    expect(document.activeElement).toBe(retry)
    expect(refreshChannels).not.toHaveBeenCalled()
  })

  it('launches an active team charter, opens its Team Room, and answers assigned decisions', async () => {
    const startTeamRun = vi.fn(() => Promise.resolve(true))
    const openRecord = vi.fn()
    const respondTeamDecision = vi.fn(() => Promise.resolve())
    const definition = {
      teamId: 'team-a', orgId: 'org-a', name: '采购交付组', northStar: '让采购交付可验证',
      ownerUserId: 'owner-a', visibility: 'organization', leaderEmployeeReleaseId: 'release-lead',
      roster: [
        { actor: { kind: 'human', userId: 'owner-a' }, roleId: 'sponsor' },
        { actor: { kind: 'agent', employeeReleaseId: 'release-lead' }, roleId: 'lead' },
      ],
      roles: [{ roleId: 'sponsor', name: 'Sponsor', responsibility: 'Decide' }, { roleId: 'lead', name: 'Lead', responsibility: 'Coordinate' }],
      verificationPolicy: { rubricRefs: ['采购验收标准'] }, attentionPolicy: { decisionQueue: 'centralized' },
      approvalPolicy: {}, revision: 4, state: 'active', createdAt: 1, updatedAt: 1,
    }
    const decision = {
      decisionId: 'decision-a', orgId: 'org-a', runId: 'run-a', kind: 'approval', question: '是否发布采购结论？',
      options: ['批准', '退回'], recommendation: '批准', contextDigest: 'digest', assigneeUserId: 'owner-a',
      state: 'open', runtimeRevision: 3, revision: 1, createdAt: 1, updatedAt: 1,
    }
    const run = {
      runId: 'run-a', orgId: 'org-a', teamId: 'team-a', teamDefinitionRevision: 4,
      workspaceId: 'workspace-1', rootSessionId: 'session-team', rosterSnapshot: definition.roster,
      createdBy: 'owner-a', source: 'console', state: 'active', runtimeRevision: 2, revision: 2,
      createdAt: 1, updatedAt: 1,
    }
    const props = workbenchProps({
      state: {
        mode: 'enterprise', page: 'teams', releases: [],
        teamDefinitions: { phase: 'ready', items: [definition], error: null } as never,
        teamRuns: { phase: 'ready', items: [run], error: null } as never,
        teamDecisions: { phase: 'ready', items: [decision], error: null } as never,
        teamAutonomy: { phase: 'ready', items: [], error: null },
      }, startTeamRun, openRecord, respondTeamDecision,
    } as never)
    const { container, rerender } = render(<EnterpriseWorkbench {...props}/>)
    expect(screen.getByRole('heading', { name: '团队治理' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '编辑章程' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存草稿' })).toBeNull()
    expect(container.querySelector('details')?.open).toBe(false)
    expect(screen.getByRole('button', { name: '选择采购交付组章程' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByText('让采购交付可验证').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole('button', { name: '选择采购交付组章程' }))
    expect(screen.getByRole('button', { name: '选择采购交付组章程' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByText('北极星').length).toBe(2)
    fireEvent.change(screen.getByLabelText('业务空间'), { target: { value: 'workspace-1' } })
    fireEvent.change(screen.getByLabelText('本次工作目标'), { target: { value: '交付供应商核验报告' } })
    fireEvent.click(screen.getByRole('button', { name: '启动团队工作' }))
    await waitFor(() => { expect(startTeamRun).toHaveBeenCalledWith({
      teamId: 'team-a', expectedTeamRevision: 4, workspaceId: 'workspace-1', prompt: '交付供应商核验报告',
    }) })
    fireEvent.click(screen.getByRole('button', { name: '打开 Team Room' }))
    expect(openRecord).toHaveBeenCalledWith('session-team')

    rerender(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', page: 'attention',
        teamDefinitions: { phase: 'ready', items: [definition], error: null } as never,
        teamRuns: { phase: 'ready', items: [run], error: null } as never,
        teamDecisions: { phase: 'ready', items: [decision], error: null } as never,
      },
      respondTeamDecision, openRecord,
    } as never)}/>)
    expect(screen.getByText('是否发布采购结论？')).toBeDefined()
    expect(screen.getByText('来自 采购交付组')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '进入关联 Team Room' }))
    expect(openRecord).toHaveBeenLastCalledWith('session-team')
    fireEvent.click(screen.getByRole('button', { name: '批准' }))
    expect(respondTeamDecision).toHaveBeenCalledWith(expect.objectContaining({ decisionId: 'decision-a' }), '批准')
  })

  it('explains charter activation requirements and hides unusable launch controls', () => {
    render(<EnterpriseWorkbench {...workbenchProps({ state: { mode: 'enterprise', page: 'teams' } })} />)
    expect(screen.queryByRole('textbox', { name: '本次工作目标' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '新建章程' }))
    expect(screen.getByRole('region', { name: '启用前还需完成' })).toBeDefined()
    expect(screen.getByRole('region', { name: '启用前还需完成' }).textContent).toMatchSnapshot('charter activation checklist')
    expect(screen.getByText('选择核验数字员工')).toBeDefined()
    expect(screen.getByText('填写至少一条验收标准')).toBeDefined()
    expect(screen.getByRole('button', { name: '保存并启用' })).toHaveProperty('disabled', true)
  })

  it('rejects fractional work limits before sending a draft mutation', () => {
    const saveTeamDefinitionDraft = vi.fn()
    render(<EnterpriseWorkbench {...workbenchProps({ state: { mode: 'enterprise', page: 'teams' }, saveTeamDefinitionDraft })} />)
    fireEvent.click(screen.getByRole('button', { name: '新建章程' }))
    fireEvent.change(screen.getByLabelText(zh['team.charter.decisionLimit']), { target: { value: '1.5' } })
    expect(screen.getByText('工作量限制必须为正整数')).toBeDefined()
    expect(screen.getByRole('button', { name: '保存草稿' })).toHaveProperty('disabled', true)
    expect(saveTeamDefinitionDraft).not.toHaveBeenCalled()
  })

  it('creates a charter draft without exposing internal JSON or ids', async () => {
    const saveTeamDefinitionDraft = vi.fn((input: Parameters<EnterpriseWorkbenchProps['saveTeamDefinitionDraft']>[0]) => Promise.resolve({
      ...input, orgId: 'org-a', revision: 1, createdAt: 1, updatedAt: 1,
    } as never))
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'teams', releases: [{
        releaseId: 'release-lead', presetId: 'lead', orgId: 'o', version: 1, digest: 'a',
        snapshot: { profile: { name: '采购领队' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
      }] as never }, saveTeamDefinitionDraft,
    } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '新建章程' }))
    expect(screen.getByRole('heading', { name: '新建团队章程' })).toBeDefined()
    expect(screen.queryByText(/JSON/u)).toBeNull()
    expect(screen.queryByLabelText('团队 ID')).toBeNull()
    fireEvent.change(screen.getByLabelText('团队名称'), { target: { value: '采购协同组' } })
    fireEvent.change(screen.getByLabelText('团队负责人'), { target: { value: 'owner-1' } })
    fireEvent.change(screen.getByLabelText('领队数字员工'), { target: { value: 'release-lead' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => { expect(saveTeamDefinitionDraft).toHaveBeenCalledOnce() })
    expect(await screen.findByText('草稿已保存（版本 1）')).toBeDefined()
    expect(saveTeamDefinitionDraft).toHaveBeenCalledWith(expect.objectContaining({
      teamId: expect.stringMatching(/^team-/u) as unknown, name: '采购协同组', ownerUserId: 'owner-1',
      state: 'needs-charter', expectedRevision: 0,
      attentionPolicy: { decisionQueue: 'centralized' },
    }))
  })

  it('confirms before discarding unsaved charter changes', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'teams', releases: [] },
    } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: '新建章程' }))
    fireEvent.change(screen.getByLabelText('团队名称'), { target: { value: '未保存团队' } })
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('heading', { name: '新建团队章程' })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: '新建团队章程' })).toBeNull()
    expect(confirm).toHaveBeenCalledTimes(2)
  })

  it('improves a migrated charter and activates its governed Human-Agent roster', async () => {
    const saveTeamDefinitionDraft = vi.fn((input: Parameters<EnterpriseWorkbenchProps['saveTeamDefinitionDraft']>[0]) => Promise.resolve({
      ...input, orgId: 'org-a', revision: 2, createdAt: 2, updatedAt: 2,
    } as never))
    const publishTeamDefinitionDraft = vi.fn(() => Promise.resolve({ teamId: 'team-migrated', revision: 2 } as never))
    const releases = [{
      releaseId: 'release-lead-old', presetId: 'lead', orgId: 'o', version: 1, digest: 'old',
      snapshot: { profile: { name: '采购领队' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
    }, {
      releaseId: 'release-lead', presetId: 'lead', orgId: 'o', version: 2, digest: 'a',
      snapshot: { profile: { name: '采购领队' }, bindings: [] }, publishedBy: 'u', publishedAt: 2,
    }, {
      releaseId: 'release-verifier', presetId: 'verifier', orgId: 'o', version: 1, digest: 'b',
      snapshot: { profile: { name: '交付核验员' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
    }] as never
    const definition = {
      teamId: 'team-migrated', orgId: 'org-a', name: '旧采购组', northStar: '', ownerUserId: 'system:legacy-fixed-team-migration',
      visibility: 'organization', leaderEmployeeReleaseId: 'release-lead-old',
      roster: [{ actor: { kind: 'agent', employeeReleaseId: 'release-lead-old' }, roleId: 'lead' }],
      roles: [{ roleId: 'lead', name: 'Agent lead', responsibility: '' }],
      verificationPolicy: {}, attentionPolicy: {}, approvalPolicy: {}, revision: 1,
      state: 'needs-charter', createdAt: 1, updatedAt: 1,
    }
    render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', page: 'teams', releases,
        teamDefinitions: { phase: 'ready', items: [definition], error: null } as never,
      }, saveTeamDefinitionDraft, publishTeamDefinitionDraft,
    } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '完善章程' }))
    expect(screen.getByRole('heading', { name: '完善团队章程' })).toBeDefined()
    expect(screen.getByLabelText<HTMLInputElement>('团队负责人').value).toBe('')
    expect(screen.getByLabelText<HTMLSelectElement>('领队数字员工').value).toBe('release-lead-old')
    fireEvent.change(screen.getByLabelText('北极星目标'), { target: { value: '让每次采购交付都可验证、可追溯' } })
    fireEvent.change(screen.getByLabelText('团队负责人'), { target: { value: 'owner-1' } })
    fireEvent.change(screen.getByLabelText('Agent lead 职责说明'), { target: { value: '拆解工作并持续汇报' } })
    fireEvent.click(screen.getByRole('radio', { name: '选择交付核验员为核验数字员工' }))
    fireEvent.change(screen.getByLabelText('验收标准'), { target: { value: '来源可追溯\n金额复核通过' } })
    fireEvent.click(screen.getByRole('button', { name: '保存并启用' }))

    await waitFor(() => { expect(saveTeamDefinitionDraft).toHaveBeenCalledOnce() })
    expect(saveTeamDefinitionDraft).toHaveBeenCalledWith(expect.objectContaining({
      teamId: 'team-migrated', northStar: '让每次采购交付都可验证、可追溯', ownerUserId: 'owner-1',
      leaderEmployeeReleaseId: 'release-lead-old', state: 'draft', expectedRevision: 1,
      roster: expect.arrayContaining([
        { actor: { kind: 'human', userId: 'owner-1' }, roleId: 'owner' },
        { actor: { kind: 'agent', employeeReleaseId: 'release-lead-old' }, roleId: 'lead' },
        { actor: { kind: 'agent', employeeReleaseId: 'release-verifier' }, roleId: 'verifier' },
      ]) as unknown,
      verificationPolicy: expect.objectContaining({
        verifierRequired: true, rubricRefs: ['来源可追溯', '金额复核通过'], highRiskHumanReviewRequired: true,
      }) as unknown,
    }))
    expect(publishTeamDefinitionDraft).toHaveBeenCalledWith({ teamId: 'team-migrated', expectedRevision: 2 })
  })

  it('preserves unexposed migrated governance and reloads a newer charter revision', async () => {
    const saveTeamDefinitionDraft = vi.fn((input: Parameters<EnterpriseWorkbenchProps['saveTeamDefinitionDraft']>[0]) => Promise.resolve({
      ...input, orgId: 'org-a', revision: input.expectedRevision + 1, createdAt: 3, updatedAt: 3,
    } as never))
    const baseDefinition = {
      teamId: 'team-roundtrip', orgId: 'org-a', name: '迁移团队', northStar: '', ownerUserId: '',
      visibility: 'organization', leaderEmployeeReleaseId: 'release-lead',
      roster: [
        { actor: { kind: 'human', userId: 'observer-1' }, roleId: 'observer' },
        { actor: { kind: 'agent', employeeReleaseId: 'release-lead' }, roleId: 'coordinator' },
      ],
      roles: [
        { roleId: 'observer', name: '观察员', responsibility: '监督业务边界' },
        { roleId: 'coordinator', name: '协调者', responsibility: '' },
      ],
      verificationPolicy: { verifierRequired: false, rubricRefs: [], highRiskHumanReviewRequired: true },
      attentionPolicy: { decisionQueue: 'centralized', openDecisionLimit: 7 },
      approvalPolicy: { retainCustomGate: true }, revision: 1, state: 'needs-charter', createdAt: 1, updatedAt: 1,
    }
    const release = [{
      releaseId: 'release-lead', presetId: 'lead', orgId: 'o', version: 1, digest: 'a',
      snapshot: { profile: { name: '迁移领队' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
    }] as never
    const props = (definition: typeof baseDefinition) => workbenchProps({
      state: {
        mode: 'enterprise', page: 'teams', releases: release,
        teamDefinitions: { phase: 'ready', items: [definition], error: null } as never,
      }, saveTeamDefinitionDraft,
    } as never)
    const { rerender } = render(<EnterpriseWorkbench {...props(baseDefinition)}/>)
    fireEvent.click(screen.getByRole('button', { name: '完善章程' }))
    fireEvent.change(screen.getByLabelText('团队名称'), { target: { value: '本地未保存名称' } })

    rerender(<EnterpriseWorkbench {...props({ ...baseDefinition, name: '服务器新版本', revision: 2 })}/>)
    expect(screen.getByLabelText<HTMLInputElement>('团队名称').value).toBe('本地未保存名称')
    expect(screen.getByText('服务器已有更新版本')).toBeDefined()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '载入服务器版本' }))
    expect(screen.getByLabelText<HTMLInputElement>('团队名称').value).toBe('服务器新版本')
    fireEvent.change(screen.getByLabelText('团队负责人'), { target: { value: 'owner-1' } })
    fireEvent.change(screen.getByLabelText('协调者 职责说明'), { target: { value: '协调既有流程' } })
    fireEvent.click(screen.getByText('工作量限制（可选）'))
    fireEvent.change(screen.getByLabelText('同时等待人工处理的上限'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))

    await waitFor(() => { expect(saveTeamDefinitionDraft).toHaveBeenCalledOnce() })
    expect(saveTeamDefinitionDraft).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 2,
      roster: expect.arrayContaining([
        { actor: { kind: 'human', userId: 'observer-1' }, roleId: 'observer' },
        { actor: { kind: 'agent', employeeReleaseId: 'release-lead' }, roleId: 'coordinator' },
      ]) as unknown,
      roles: expect.arrayContaining([
        { roleId: 'observer', name: '观察员', responsibility: '监督业务边界' },
        { roleId: 'coordinator', name: '协调者', responsibility: '协调既有流程' },
      ]) as unknown,
      approvalPolicy: expect.objectContaining({ retainCustomGate: true }) as unknown,
    }))
    expect(saveTeamDefinitionDraft.mock.calls[0]![0].attentionPolicy).not.toHaveProperty('openDecisionLimit')
  })

  it('offers a primary creation action when the managed employee roster is empty', () => {
    const createEmployeeDraft = vi.fn()
    render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', page: 'employees',
        employees: { phase: 'ready', items: [], error: null },
      },
      createEmployeeDraft,
    } as never)} />)

    expect(screen.getByText('还没有数字员工')).toBeDefined()
    fireEvent.click(screen.getAllByRole('button', { name: '新建数字员工' })[0]!)
    expect(createEmployeeDraft).toHaveBeenCalledTimes(1)
  })

  it('does not allow publishing a new employee before its first draft save', () => {
    const patchEmployeeDraft = vi.fn()
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'employees', employeeEditor: {
        phase: 'ready', revision: 0, releases: [], dirty: false, saving: false, conflict: false,
        errors: ['name-required', 'prompt-required', 'model-required'], error: null,
        creating: true,
        fields: {
          presetId: 'employee-new', name: '', description: '', position: '', department: '',
          prompt: '', modelRef: '', capabilities: [], visibility: 'organization', bindings: [],
          avatarSeed: 'new-avatar-seed',
        },
      },
    } as never, patchEmployeeDraft })} />)

    expect(screen.getByRole('heading', { name: '新建数字员工' })).toBeDefined()
    expect(screen.getByRole('img', { name: '数字员工头像' }).getAttribute('src')).toContain(
      'https://api.dicebear.com/10.x/lorelei/svg?seed=new-avatar-seed',
    )
    fireEvent.click(screen.getByRole('button', { name: '换一个头像' }))
    const avatarPatch = patchEmployeeDraft.mock.calls[0]?.[0] as { avatarSeed?: unknown }
    expect(typeof avatarPatch.avatarSeed).toBe('string')
    expect(avatarPatch.avatarSeed).not.toBe('new-avatar-seed')
    expect(screen.getByRole('button', { name: '发布' }).hasAttribute('disabled')).toBe(true)
  })

  it('loads the enterprise department directory into a selector', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { id: 'dept-procurement', name: '采购部' }, { id: 'dept-ops', name: '运营部' },
    ]), { status: 200, headers: { 'content-type': 'application/json' } })))
    const patchEmployeeDraft = vi.fn()
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'employees', employeeEditor: {
        phase: 'ready', revision: 1, releases: [], dirty: false, saving: false, conflict: false,
        errors: [], error: null,
        fields: {
          presetId: 'employee-buyer', name: '采购专员', avatarSeed: 'seed', description: '',
          position: '采购运营', department: '采购部', prompt: '负责采购。', modelRef: 'deepseek-chat',
          capabilities: [], visibility: 'organization', bindings: [],
        },
      },
    } as never, patchEmployeeDraft })} />)

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: '部门' })).toBeDefined()
    })
    expect(screen.queryByRole('textbox', { name: '部门' })).toBeNull()
    fireEvent.change(screen.getByRole('combobox', { name: '部门' }), { target: { value: '运营部' } })
    expect(patchEmployeeDraft).toHaveBeenCalledWith({ department: '运营部' })
  })

  it('selects a configured provider model and offers AI prompt optimization', () => {
    const patchEmployeeDraft = vi.fn()
    const optimizeEmployeePrompt = vi.fn(() => Promise.resolve())
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'employees', modelOptions: [{
        value: 'deepseek/deepseek-chat', provider: 'DeepSeek', model: 'DeepSeek Chat',
      }, {
        value: 'deepseek/deepseek-reasoner', provider: 'DeepSeek', model: 'DeepSeek Reasoner',
      }], employeeEditor: {
        phase: 'ready', revision: 1, releases: [], dirty: true, saving: false, conflict: false,
        optimizingPrompt: false, errors: [], error: null,
        fields: {
          presetId: 'employee-buyer', name: '采购专员', avatarSeed: 'seed', description: '',
          position: '采购运营', department: '采购部', prompt: '负责采购。', modelRef: 'deepseek/deepseek-chat',
          capabilities: [], visibility: 'organization', bindings: [],
        },
      },
    } as never, patchEmployeeDraft, optimizeEmployeePrompt })} />)

    const model = screen.getByRole('combobox', { name: '使用模型' })
    expect(model.textContent).toContain('DeepSeek Chat')
    fireEvent.change(model, { target: { value: 'deepseek/deepseek-reasoner' } })
    expect(patchEmployeeDraft).toHaveBeenCalledWith({ modelRef: 'deepseek/deepseek-reasoner' })
    fireEvent.click(screen.getByRole('button', { name: 'AI 优化' }))
    expect(optimizeEmployeePrompt).toHaveBeenCalledTimes(1)
  })

  it('puts the employee roster first and keeps goal dispatch behind an explicit entry', () => {
    render(<EnterpriseWorkbench {...workbenchProps({ state: { mode: 'enterprise' } })} />)
    expect(screen.getByRole('heading', { name: '员工名册' })).toBeDefined()
    expect(screen.queryByRole('textbox', { name: '工作目标' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '按目标派工' }))
    const objective = screen.getByRole('textbox', { name: '工作目标' })
    fireEvent.change(objective, { target: { value: '检查合同' } })
    fireEvent.click(screen.getByRole('button', { name: '按目标派工' }))
    expect(screen.queryByRole('textbox', { name: '工作目标' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '按目标派工' }))
    expect(screen.getByRole('textbox', { name: '工作目标' })).toHaveProperty('value', '检查合同')
  })

  it('keeps Workspace defaults separate from roster search and starting employee conversations', async () => {
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise' },
      readWorkspaceDefault: vi.fn(async () => ({ workspaceId: 'workspace-1', employeeId: null,
        revision: 0, unavailable: false, manageable: true })),
    })} />)
    await screen.findByText('默认员工设置')
    expect(screen.getByText('默认员工设置').closest('details')?.open).toBe(false)
    fireEvent.click(screen.getByText('默认员工设置'))
    expect(screen.getByRole('combobox', { name: '默认数字员工' })).toBeDefined()
    expect(screen.getByRole('button', { name: '保存默认值' })).toBeDefined()
  })

  it('presents the roster as a StaffDeck-inspired employee gallery without technical metadata', () => {
    render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', page: 'employees',
        employees: { phase: 'ready', error: null, items: [{
          presetId: 'buyer', orgId: 'server-org', ownerUserId: 'owner-1', visibility: 'restricted',
          profile: {
            name: '采购专员', position: '采购协同顾问', department: '采购部',
            description: '帮助员工准备采购需求和审批材料。', capabilities: ['需求澄清', '合规校验'],
            avatarSeed: 'opaque-avatar-seed',
          },
          bindings: [
            { kind: 'sop', assetId: 'rfq', version: 2 },
            { kind: 'knowledge', assetId: 'policy', version: 1 },
          ],
          revision: 4, status: 'published', updatedAt: 20,
        }] },
      } as never,
    })} />)

    expect(screen.getByRole('heading', { name: '员工名册' })).toBeDefined()
    expect(screen.getByPlaceholderText('搜索数字员工名称、岗位或部门')).toBeDefined()
    expect(screen.getByRole('tab', { name: '所有员工' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '已发布' })).toBeDefined()
    expect(screen.getByRole('tab', { name: '草稿' })).toBeDefined()
    expect(screen.getByText('采购协同顾问')).toBeDefined()
    expect(screen.getByRole('img', { name: '采购专员头像' }).getAttribute('src')).toContain(
      'https://api.dicebear.com/10.x/lorelei/svg?seed=opaque-avatar-seed',
    )
    expect(screen.getByText('帮助员工准备采购需求和审批材料。')).toBeDefined()
    expect(within(screen.getByRole('region', { name: '员工名册' })).getAllByRole('heading').map(node => node.textContent)).toMatchSnapshot('employee directory hierarchy')
    expect(screen.getByText('1 SOP')).toBeDefined()
    expect(screen.getByText('1 知识')).toBeDefined()
    expect(screen.getByRole('button', { name: '与采购专员发起对话' })).toBeDefined()
    expect(screen.queryByText('所有者：owner-1')).toBeNull()
    expect(screen.queryByText('修订 4')).toBeNull()
    const navigation = screen.getByRole('navigation', { name: '管理台导航' })
    expect(within(navigation).getByText('使用')).toBeDefined()
    expect(within(navigation).getByText('管理')).toBeDefined()
  })

  it('keeps employee management separate from the explicit conversation action', () => {
    const startEmployee = vi.fn(() => Promise.resolve()); const openEmployeeDraft = vi.fn(() => Promise.resolve())
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', employees: { phase: 'ready', error: null, items: [{
        presetId: 'buyer', orgId: 'o', ownerUserId: 'u', visibility: 'organization',
        profile: { name: '采购专员' }, bindings: [], revision: 1, status: 'published', updatedAt: 1,
      }] } }, startEmployee, openEmployeeDraft,
    } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: '与采购专员发起对话' }))
    expect(startEmployee).toHaveBeenCalledWith('buyer', 'workspace-1')
    expect(openEmployeeDraft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '编辑采购专员' }))
    expect(openEmployeeDraft).toHaveBeenCalledWith('buyer')
  })

  it('shows actual runtime tools in the tool category alongside managed assets', async () => {
    const sourceId = SessionId('source-tools')
    const readRuntimeCapabilities = vi.fn(async (sessionId: Parameters<EnterpriseWorkbenchProps['readRuntimeCapabilities']>[0]) => ({
      sessionId, live: true, catalogAt: 10, tools: [{ name: 'read', description: 'Read files', availability: 'registered' as const, calls: 2, lastUsedAt: 10 }],
    }))
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'assets' }, readRuntimeCapabilities,
      useSessions: select => select({ phase: 'ready', ids: [sourceId], byId: {
        [sourceId]: { id: sourceId, displayTitle: '工具运行记录', running: false, blank: false, updatedAt: 10, retainedBy: { mainView: 1 } },
      }, projectionsBySession: {} }),
    })} />)
    expect(readRuntimeCapabilities).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /工具.*MCP/u }))
    expect(await screen.findByText('read')).toBeDefined()
    expect(screen.getByRole('heading', { name: '自建工具资产' })).toBeDefined()
    expect(screen.getByRole('button', { name: /工具.*1 项/u })).toBeDefined()
  })

  it('uses structured asset bindings and release selectors as the primary path', () => {
    const patchEmployeeDraft = vi.fn(); const saveTeam = vi.fn(() => Promise.resolve(true))
    const { rerender } = render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', employeeEditor: {
          phase: 'ready', dirty: false, saving: false, conflict: false, errors: [], error: null, revision: 1,
          fields: { presetId: 'buyer', name: '采购', description: '', position: '', department: '', prompt: '职责', modelRef: 'm', capabilities: [], visibility: 'organization', bindings: [] }, releases: [],
        },
        assets: { phase: 'ready', error: null, items: [{ assetId: 'rfq', orgId: 'o', kind: 'sop', name: '询价 SOP', revision: 2, archived: false, updatedAt: 1 }] },
      }, patchEmployeeDraft,
    } as never)} />)
    fireEvent.change(screen.getByLabelText('能力资产'), { target: { value: 'rfq' } })
    fireEvent.click(screen.getByRole('button', { name: '添加能力绑定' }))
    expect(patchEmployeeDraft).toHaveBeenCalledWith(expect.objectContaining({
      bindings: [{ kind: 'sop', assetId: 'rfq', version: 2 }],
    }))
    expect(screen.queryByText(/JSON/u)).toBeNull()

    rerender(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'teams', releases: [{
        releaseId: 'release-buyer', presetId: 'buyer', orgId: 'o', version: 2, digest: 'd',
        snapshot: { profile: { name: '采购' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
      }, {
        releaseId: 'release-rfq', presetId: 'rfq', orgId: 'o', version: 1, digest: 'e',
        snapshot: { profile: { name: '询价' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
      }],
    }, saveTeam } as never)} />)
    fireEvent.click(screen.getByText(zh['team.legacyTitle']))
    fireEvent.click(screen.getByRole('button', { name: '新建团队' }))
    expect(screen.getByRole('radio', { name: '选择采购为领队' })).toBeDefined()
    expect(screen.getByRole('checkbox', { name: '选择询价为成员' })).toBeDefined()
  })

  it('loads saved knowledge counts before selecting the category and after publish reload', async () => {
    const mountedProvider = vi.fn()
    function KnowledgeProbe({ presetId, onCountChange }: { presetId: string; onCountChange: (count: number) => void }) {
      useEffect(() => {
        mountedProvider(presetId)
        onCountChange(presetId === 'finance-director' ? 1 : 0)
      }, [presetId, onCountChange])
      return <div data-testid="saved-knowledge-bindings">Saved knowledge binding</div>
    }
    const renderSlot = (name: string, owner: { presetId: string; onCountChange: (count: number) => void }, options?: { fallback?: ReactNode }) => name === 'enterprise.employee-knowledge-bindings'
      ? <KnowledgeProbe {...owner} /> : options?.fallback ?? null
    const editor = {
      phase: 'ready', dirty: false, saving: false, conflict: false, errors: [], error: null, revision: 1,
      fields: { presetId: 'finance-director', name: '财务大王', description: '', position: '', department: '', prompt: '职责', modelRef: 'm', capabilities: [], visibility: 'organization', bindings: [] }, releases: [],
    } as const
    const props = (employeeEditor: unknown) => workbenchProps({ renderSlot, state: {
      mode: 'enterprise', employeeEditor, assets: { phase: 'ready', error: null, items: [] },
    } } as never)
    const view = render(<EnterpriseWorkbench {...props(editor)} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: /知识经审核的业务知识1 项/u })).toBeDefined() })
    expect(screen.getByTestId('saved-knowledge-bindings').closest('[hidden]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /知识经审核的业务知识/u }))
    expect(screen.getByTestId('saved-knowledge-bindings').closest('[hidden]')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /SOP可复用的标准步骤/u }))
    expect(mountedProvider).toHaveBeenCalledTimes(1)
    view.rerender(<EnterpriseWorkbench {...props({ ...editor, phase: 'loading', fields: undefined })} />)
    view.rerender(<EnterpriseWorkbench {...props({ ...editor, revision: 2 })} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: /知识经审核的业务知识1 项/u })).toBeDefined() })
    expect(mountedProvider).toHaveBeenCalledTimes(2)
    view.rerender(<EnterpriseWorkbench {...props({ ...editor, fields: { ...editor.fields, presetId: 'another-employee' } })} />)
    await waitFor(() => { expect(screen.getByRole('button', { name: /知识经审核的业务知识0 项/u })).toBeDefined() })
  })

  it('lets the knowledge provider manage bindings for the employee being edited', () => {
    let owner: { presetId: string; onCountChange: (count: number) => void } | undefined
    const renderSlot = vi.fn((
      name: string,
      slotOwner: { presetId: string; onCountChange: (count: number) => void },
      options?: { fallback?: ReactNode },
    ) => {
      if (name === 'enterprise.employee-knowledge-bindings') {
        owner = slotOwner
        return <div data-testid="employee-knowledge-bindings">Knowledge bindings</div>
      }
      return options?.fallback ?? null
    })
    render(<EnterpriseWorkbench {...workbenchProps({
      renderSlot,
      state: {
        mode: 'enterprise', employeeEditor: {
          phase: 'ready', dirty: false, saving: false, conflict: false, errors: [], error: null, revision: 1,
          fields: { presetId: 'finance-director', name: '财务大王', description: '', position: '', department: '', prompt: '职责', modelRef: 'm', capabilities: [], visibility: 'organization', bindings: [] }, releases: [],
        },
        assets: { phase: 'ready', error: null, items: [] },
      },
    } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: /知识经审核的业务知识/u }))
    expect(screen.getByTestId('employee-knowledge-bindings')).toBeDefined()
    expect(screen.queryByText('当前目录暂无可用的此类能力资产。可在“能力资产”中查看或登记。')).toBeNull()
    expect(owner?.presetId).toBe('finance-director')
    act(() => { owner?.onCountChange(2) })
    expect(screen.getByRole('button', { name: /知识经审核的业务知识2 项/u })).toBeDefined()
  })

  it('keeps bound assets selectable and removes only the chosen draft binding', () => {
    const patchEmployeeDraft = vi.fn()
    const saveEmployeeDraft = vi.fn()
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', employeeEditor: {
        phase: 'ready', dirty: false, saving: false, conflict: false, errors: [], error: null, revision: 1,
        fields: { presetId: 'buyer', name: '采购', description: '', position: '', department: '', prompt: '职责', modelRef: 'm', capabilities: [], visibility: 'organization', bindings: [
          { kind: 'sop', assetId: 'rfq', version: 2 }, { kind: 'skill', assetId: 'invoice', version: 1 },
        ] }, releases: [],
      }, assets: { phase: 'ready', error: null, items: [
        { assetId: 'rfq', orgId: 'o', kind: 'sop', name: '询价 SOP', revision: 2, archived: false, updatedAt: 1 },
      ] } }, patchEmployeeDraft, saveEmployeeDraft,
    } as never)} />)
    expect(screen.getByRole('option', { name: '询价 SOP（已绑定）' })).toBeDefined()
    expect(within(screen.getByRole('list', { name: '已绑定能力' })).getByText('询价 SOP')).toBeDefined()
    fireEvent.change(screen.getByRole('combobox', { name: '能力资产' }), { target: { value: 'rfq' } })
    expect(screen.getByRole('button', { name: '已绑定' }).matches(':disabled')).toBe(true)
    expect(patchEmployeeDraft).not.toHaveBeenCalled()
    expect({
      options: Array.from(screen.getByRole<HTMLSelectElement>('combobox', { name: '能力资产' }).options, option => option.text),
      bindings: screen.getByRole('list', { name: '已绑定能力' }).textContent,
      action: screen.getByRole('button', { name: '已绑定' }).textContent,
    }).toMatchInlineSnapshot(`
      {
        "action": "已绑定",
        "bindings": "询价 SOP版本 2移除",
        "options": [
          "选择已审核的能力资产",
          "询价 SOP（已绑定）",
        ],
      }
    `)
    fireEvent.click(screen.getByRole('button', { name: '移除能力绑定：询价 SOP' }))
    expect(patchEmployeeDraft).toHaveBeenCalledWith({ bindings: [{ kind: 'skill', assetId: 'invoice', version: 1 }] })
    expect(saveEmployeeDraft).not.toHaveBeenCalled()
  })

  it('updates an older binding instead of appending two versions of the same asset', () => {
    const patchEmployeeDraft = vi.fn()
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', employeeEditor: {
        phase: 'ready', dirty: false, saving: false, conflict: false, errors: [], error: null, revision: 1,
        fields: { presetId: 'buyer', name: '采购', description: '', position: '', department: '', prompt: '职责', modelRef: 'm', capabilities: [], visibility: 'organization', bindings: [{ kind: 'sop', assetId: 'rfq', version: 1 }] }, releases: [],
      }, assets: { phase: 'ready', error: null, items: [
        { assetId: 'rfq', orgId: 'o', kind: 'sop', name: '询价 SOP', revision: 2, archived: false, updatedAt: 1 },
      ] } }, patchEmployeeDraft,
    } as never)} />)
    fireEvent.change(screen.getByLabelText('能力资产'), { target: { value: 'rfq' } })
    fireEvent.click(screen.getByRole('button', { name: '更新能力绑定' }))
    expect(patchEmployeeDraft).toHaveBeenCalledWith({ bindings: [{ kind: 'sop', assetId: 'rfq', version: 2 }] })
  })

  it('keeps archived bindings visible without offering the archived asset for addition', () => {
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', employeeEditor: {
        phase: 'ready', dirty: false, saving: false, conflict: false, errors: [], error: null, revision: 1,
        fields: { presetId: 'buyer', name: '采购', description: '', position: '', department: '', prompt: '职责', modelRef: 'm', capabilities: [], visibility: 'organization', bindings: [{ kind: 'sop', assetId: 'rfq', version: 1 }] }, releases: [],
      }, assets: { phase: 'ready', error: null, items: [
        { assetId: 'rfq', orgId: 'o', kind: 'sop', name: '询价 SOP', revision: 2, archived: true, updatedAt: 1 },
      ] },
    } } as never)} />)
    expect(within(screen.getByRole('list', { name: '已绑定能力' })).getByText('询价 SOP')).toBeDefined()
    expect(screen.getByText('版本 1 · 当前目录中不可用')).toBeDefined()
    expect(screen.getByRole('combobox', { name: '能力资产' }).textContent).not.toContain('询价 SOP')
    expect(screen.getByText('当前目录暂无可用的此类能力资产。可在“能力资产”中查看或登记。')).toBeDefined()
  })

  it('distinguishes an empty asset category from a failed catalog load', () => {
    const refresh = vi.fn(() => Promise.resolve())
    const editor = {
      phase: 'ready', dirty: false, saving: false, conflict: false, errors: [], error: null, revision: 1,
      fields: { presetId: 'buyer', name: '采购', description: '', position: '', department: '', prompt: '职责', modelRef: 'm', capabilities: [], visibility: 'organization', bindings: [] }, releases: [],
    } as const
    const mounted = render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', employeeEditor: editor, assets: { phase: 'ready', error: null, items: [] },
    }, refresh } as never)} />)
    expect(screen.getByText('当前目录暂无可用的此类能力资产。可在“能力资产”中查看或登记。')).toBeDefined()
    mounted.rerender(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', employeeEditor: editor, assets: { phase: 'error', error: 'Catalog unavailable', items: [] },
    }, refresh } as never)} />)
    expect(screen.queryByText('当前目录暂无可用的此类能力资产。可在“能力资产”中查看或登记。')).toBeNull()
    expect(within(screen.getByRole('alert')).getByText('能力资产加载失败')).toBeDefined()
    expect(screen.getByRole('combobox', { name: '能力资产' }).matches(':disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重试加载能力资产' }))
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('uses the same five capability cards for asset management and employee binding', () => {
    const setPage = vi.fn()
    const patchEmployeeDraft = vi.fn()
    const assets = { phase: 'ready' as const, error: null, items: [
      { assetId: 'sop-1', orgId: 'o', kind: 'sop' as const, name: '报销 SOP', revision: 1, archived: false, updatedAt: 1 },
      { assetId: 'knowledge-1', orgId: 'o', kind: 'knowledge' as const, name: '财务制度', revision: 1, archived: false, updatedAt: 1 },
      { assetId: 'skill-1', orgId: 'o', kind: 'skill' as const, name: '发票识别', revision: 1, archived: false, updatedAt: 1 },
      { assetId: 'tool-1', orgId: 'o', kind: 'tool' as const, name: '财务 MCP', revision: 1, archived: false, updatedAt: 1 },
    ] }
    const extensions = { phase: 'ready' as const, error: null, items: [{
      packageId: 'pkg-1', pluginId: 'finance-panel', version: 1, scope: { type: 'organization', organizationId: 'o' },
      authoredBy: 'u', sourceDigest: 'd', manifest: { apiVersion: 'dsh-plugin/v1', runtime: 'isolated-realm', provides: [], capabilities: [], license: 'MIT', dependencies: [] },
      artifactRef: 'a', validationReportRef: 'v', createdAt: 1,
    }] }
    const { rerender } = render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'assets', assets, extensions }, setPage,
    } as never)} />)

    const managementCards = screen.getByRole('list', { name: '能力分类' })
    for (const label of ['SOP', '知识', '技能', '工具', 'Cordis 扩展']) {
      expect(within(managementCards).getByRole('button', { name: new RegExp(label, 'u') })).toBeDefined()
    }
    fireEvent.click(within(managementCards).getByRole('button', { name: /Cordis 扩展/u }))
    expect(setPage).toHaveBeenCalledWith('extensions')

    rerender(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'employees', assets, extensions,
      employeeEditor: {
        phase: 'ready', dirty: false, saving: false, conflict: false, errors: [], error: null, revision: 1,
        fields: { presetId: 'finance', name: '小钱', description: '', position: '', department: '', prompt: '职责', modelRef: 'm', capabilities: [], visibility: 'organization', bindings: [{ kind: 'sop', assetId: 'sop-1', version: 1 }] }, releases: [],
      },
    }, setPage, patchEmployeeDraft } as never)} />)
    const employeeCards = screen.getByRole('list', { name: '能力分类' })
    expect(within(employeeCards).getByRole('button', { name: /SOP.*1 项/u })).toBeDefined()
    fireEvent.click(within(employeeCards).getByRole('button', { name: /技能/u }))
    expect(screen.getByRole('combobox', { name: '能力资产' }).textContent).toContain('发票识别')
    expect(screen.getByRole('combobox', { name: '能力资产' }).textContent).not.toContain('报销 SOP')
  })

  it('loads provider knowledge on employee cards without opening an editor', async () => {
    const openEmployeeDraft = vi.fn()
    function Summary({ presetId, summaryOnly, onCountChange }: {
      presetId: string
      summaryOnly?: boolean
      onCountChange: (count: number | null) => void
    }) {
      useEffect(() => { onCountChange(presetId === 'buyer' ? 2 : 1) }, [presetId, onCountChange])
      expect(summaryOnly).toBe(true)
      return null
    }
    const renderSlot = (name: string, owner: { presetId: string; summaryOnly?: boolean; onCountChange: (count: number | null) => void }, options?: { fallback?: ReactNode }) => name === 'enterprise.employee-knowledge-bindings'
      ? <Summary {...owner} /> : options?.fallback ?? null
    render(<EnterpriseWorkbench {...workbenchProps({ renderSlot, openEmployeeDraft, state: {
      mode: 'enterprise', page: 'employees', employees: { phase: 'ready', error: null, items: [
        { presetId: 'buyer', profile: { name: '采购' }, status: 'published', bindings: [{ kind: 'knowledge', assetId: 'native', version: 1 }] },
        { presetId: 'finance', profile: { name: '财务' }, status: 'published', bindings: [] },
      ] },
    } } as never)} />)
    await waitFor(() => { expect(screen.getByText('3 知识')).toBeDefined() })
    expect(screen.getByText('1 知识')).toBeDefined()
    expect(screen.getAllByLabelText('已绑定能力资产').map(node => node.textContent)).toMatchInlineSnapshot(`
      [
        "3 知识0 技能0 SOP",
        "1 知识0 技能0 SOP",
      ]
    `)
    expect(openEmployeeDraft).not.toHaveBeenCalled()
  })

  it('reloads roster summaries when employee filtering refreshes independently of the workbench', () => {
    const renderSlot = vi.fn((_name: string, _owner: unknown, options?: { fallback?: ReactNode }) => options?.fallback ?? null)
    const employees = [{ presetId: 'buyer', profile: { name: '采购' }, status: 'published', bindings: [] }]
    const props = (phase: string) => workbenchProps({ renderSlot, state: {
      mode: 'enterprise', page: 'employees', phase: 'ready', employees: { phase, error: null, items: employees },
    } } as never)
    const { rerender } = render(<EnterpriseWorkbench {...props('ready')} />)
    rerender(<EnterpriseWorkbench {...props('loading')} />)
    expect(renderSlot).toHaveBeenLastCalledWith('enterprise.employee-knowledge-bindings', expect.objectContaining({
      presetId: 'buyer', summaryOnly: true, refreshKey: 'loading',
    }), { fallback: null })
    rerender(<EnterpriseWorkbench {...props('ready')} />)
    expect(renderSlot).toHaveBeenLastCalledWith('enterprise.employee-knowledge-bindings', expect.objectContaining({ refreshKey: 'ready' }), { fallback: null })
  })

  it('loads knowledge asset totals on the initial SOP category and never labels unavailable counts zero', async () => {
    let report: ((count: number | null) => void) | undefined
    const renderSlot = (name: string, owner: {
      summaryOnly?: boolean
      onCountChange: (count: number | null) => void
    }, options?: { fallback?: ReactNode }) => {
      if (name !== 'enterprise.knowledge-assets') return options?.fallback ?? null
      expect(owner.summaryOnly).toBe(true)
      report = owner.onCountChange
      return null
    }
    render(<EnterpriseWorkbench {...workbenchProps({ renderSlot, state: { mode: 'enterprise', page: 'assets', assets: { phase: 'ready', error: null, items: [] } } } as never)} />)
    expect(report).toBeTypeOf('function')
    const categories = screen.getByRole('list', { name: '能力分类' })
    act(() => { report?.(null) })
    expect(within(categories).getByRole('button', { name: /知识.*— 项/u })).toBeDefined()
    act(() => { report?.(4) })
    expect(within(categories).getByRole('button', { name: /知识.*4 项/u })).toBeDefined()
    expect(within(categories).getByRole('button', { name: /SOP/u }).getAttribute('aria-pressed')).toBe('true')
  })

  it('hosts the knowledge plugin inside the knowledge capability category and reflects its base count', () => {
    let knowledgeOwner: { onCountChange: (count: number) => void } | undefined
    const renderSlot = vi.fn((name: string, owner: { onCountChange: (count: number) => void }, options?: { fallback?: ReactNode }) => {
      if (name === 'enterprise.knowledge-assets') {
        knowledgeOwner = owner
        return <div data-testid="knowledge-core">DSH Knowledge Core</div>
      }
      return options?.fallback ?? null
    })
    render(<EnterpriseWorkbench {...workbenchProps({
      renderSlot,
      state: { mode: 'enterprise', page: 'assets', assets: { phase: 'ready', error: null, items: [] } },
    } as never)} />)

    const categories = screen.getByRole('list', { name: '能力分类' })
    fireEvent.click(within(categories).getByRole('button', { name: /知识/u }))
    expect(screen.getByTestId('knowledge-core')).toBeDefined()
    expect(screen.queryByText('还没有知识资产')).toBeNull()
    expect(renderSlot).toHaveBeenCalledWith('enterprise.knowledge-assets', expect.objectContaining({
      onCountChange: expect.any(Function) as unknown,
    }), expect.any(Object))

    act(() => { knowledgeOwner?.onCountChange(4) })
    expect(within(categories).getByRole('button', { name: /知识.*4 项/u })).toBeDefined()
  })

  it('explains employee prerequisites instead of rendering unusable schedule and team forms', () => {
    const setPage = vi.fn()
    const { rerender } = render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'schedules', releases: [] }, setPage,
    })} />)
    expect(screen.getByText('先发布一位数字员工')).toBeDefined()
    expect(screen.queryByLabelText('任务 ID')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '前往数字员工' }))
    expect(setPage).toHaveBeenCalledWith('employees')

    rerender(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'teams', releases: [] }, setPage,
    })} />)
    expect(screen.getByText('至少需要两位已发布员工')).toBeDefined()
    expect(screen.queryByLabelText('团队 ID')).toBeNull()
  })

  it('creates a schedule from business fields and a published employee', async () => {
    const saveSchedule = vi.fn((_input: Parameters<EnterpriseWorkbenchProps['saveSchedule']>[0]) => Promise.resolve(true))
    render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', page: 'schedules', releases: [{
          releaseId: 'release-buyer', presetId: 'buyer', orgId: 'o', version: 2, digest: 'd',
          snapshot: { profile: { name: '采购专员' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
        }],
      }, saveSchedule,
    } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '新建定时任务' }))
    fireEvent.change(screen.getByLabelText('任务名称'), { target: { value: '每日供应商跟进' } })
    fireEvent.change(screen.getByLabelText('执行员工'), { target: { value: 'release-buyer' } })
    fireEvent.change(screen.getByLabelText('任务说明'), { target: { value: '汇总逾期供应商并给出跟进清单' } })
    fireEvent.change(screen.getByLabelText('执行频率'), { target: { value: 'weekdays' } })
    fireEvent.change(screen.getByLabelText('执行时间'), { target: { value: '09:30' } })
    fireEvent.click(screen.getByRole('button', { name: '保存定时任务' }))

    await waitFor(() => { expect(saveSchedule).toHaveBeenCalledOnce() })
    const savedSchedule = saveSchedule.mock.calls[0]![0]
    expect(savedSchedule.scheduleId).toMatch(/^schedule-/u)
    expect(savedSchedule).toMatchObject({
      target: { kind: 'employee', employeeReleaseId: 'release-buyer' },
      rule: '30 9 * * 1-5',
      input: { prompt: '汇总逾期供应商并给出跟进清单' },
    })
  })

  it('shows the scheduled-task shortcut as a focused dialog over the current conversation', () => {
    const close = vi.fn()
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'schedules', scheduleDialogOpen: true,
        schedules: { phase: 'ready', items: [], error: null }, releases: [{
          releaseId: 'release-buyer', presetId: 'buyer', orgId: 'o', version: 2, digest: 'd',
          snapshot: { profile: { name: '采购专员' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
        }] }, close,
    } as never)} />)
    const dialog = screen.getByRole('dialog', { name: '定时任务' })
    expect(within(dialog).getByRole('button', { name: '新建定时任务' })).toBeDefined()
    expect(within(dialog).queryByRole('navigation', { name: '管理台导航' })).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: '新建定时任务' }))
    expect(within(dialog).getByLabelText('任务名称')).toBeDefined()
    fireEvent.click(within(dialog).getByRole('button', { name: '关闭' }))
    expect(close).toHaveBeenCalledOnce()
  })

  it('creates capability assets and teams without asking users for internal IDs or JSON', async () => {
    const saveAssetVersion = vi.fn((_input: Parameters<EnterpriseWorkbenchProps['saveAssetVersion']>[0]) => Promise.resolve(true))
    const saveTeam = vi.fn((_input: Parameters<EnterpriseWorkbenchProps['saveTeam']>[0]) => Promise.resolve(true))
    const releases = [{
      releaseId: 'release-lead', presetId: 'lead', orgId: 'o', version: 1, digest: 'a',
      snapshot: { profile: { name: '采购主管' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
    }, {
      releaseId: 'release-member', presetId: 'member', orgId: 'o', version: 1, digest: 'b',
      snapshot: { profile: { name: '询价专员' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
    }] as never
    const { rerender } = render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'assets' }, saveAssetVersion,
    } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '新建能力资产' }))
    expect(screen.queryByLabelText('资产 ID')).toBeNull()
    expect(screen.queryByLabelText('内容 JSON')).toBeNull()
    fireEvent.change(screen.getByLabelText('资产名称'), { target: { value: '询价标准流程' } })
    fireEvent.change(screen.getByLabelText('用途说明'), { target: { value: '统一供应商询价步骤' } })
    fireEvent.change(screen.getByLabelText('能力内容'), { target: { value: '收集需求\n邀请报价\n对比并留痕' } })
    fireEvent.click(screen.getByRole('button', { name: '保存能力资产' }))
    await waitFor(() => { expect(saveAssetVersion).toHaveBeenCalledOnce() })
    const savedAsset = saveAssetVersion.mock.calls[0]![0]
    expect(savedAsset.assetId).toMatch(/^asset-/u)
    expect(savedAsset).toMatchObject({
      name: '询价标准流程', kind: 'sop',
      content: { summary: '统一供应商询价步骤', steps: ['收集需求', '邀请报价', '对比并留痕'] },
    })

    rerender(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'teams', releases }, saveTeam,
    } as never)} />)
    fireEvent.click(screen.getByText(zh['team.legacyTitle']))
    fireEvent.click(screen.getByRole('button', { name: '新建团队' }))
    fireEvent.change(screen.getByLabelText('团队名称'), { target: { value: '采购协同组' } })
    fireEvent.click(screen.getByRole('radio', { name: '选择采购主管为领队' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择询价专员为成员' }))
    fireEvent.click(screen.getByRole('button', { name: '保存团队' }))
    await waitFor(() => { expect(saveTeam).toHaveBeenCalledOnce() })
    const savedTeam = saveTeam.mock.calls[0]![0]
    expect(savedTeam.teamId).toMatch(/^team-/u)
    expect(savedTeam).toMatchObject({
      leaderEmployeeReleaseId: 'release-lead',
      members: [{ employeeReleaseId: 'release-member', role: 'member' }],
    })
  })

  it('shows one latest Release per employee in an avatar-based team picker', async () => {
    const saveTeam = vi.fn((_input: Parameters<EnterpriseWorkbenchProps['saveTeam']>[0]) => Promise.resolve(true))
    const release = (presetId: string, releaseId: string, version: number, name: string, avatarSeed: string) => ({
      releaseId, presetId, orgId: 'o', version, digest: `${presetId}-${String(version)}`,
      snapshot: { profile: { name, avatarSeed, position: '业务专员', department: '运营部' }, bindings: [] },
      publishedBy: 'u', publishedAt: version,
    })
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { mode: 'enterprise', page: 'teams', releases: [
        release('buyer', 'buyer-v1', 1, '小圆', 'buyer-old'),
        release('buyer', 'buyer-v3', 3, '小圆', 'buyer-latest'),
        release('finance', 'finance-v1', 1, '小钱', 'finance-old'),
        release('finance', 'finance-v2', 2, '小钱', 'finance-latest'),
      ] }, saveTeam,
    } as never)} />)

    fireEvent.click(screen.getByText(zh['team.legacyTitle']))
    fireEvent.click(screen.getByRole('button', { name: '新建团队' }))
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    const buyerAvatars = screen.getAllByRole('img', { name: '小圆头像' })
    const financeAvatars = screen.getAllByRole('img', { name: '小钱头像' })
    expect(buyerAvatars).toHaveLength(2)
    expect(financeAvatars).toHaveLength(2)
    expect(buyerAvatars.every(avatar => avatar.getAttribute('src')?.includes('buyer-latest'))).toBe(true)
    expect(financeAvatars.every(avatar => avatar.getAttribute('src')?.includes('finance-latest'))).toBe(true)
    expect(screen.getAllByText('最新版本 v3')).toHaveLength(2)
    expect(screen.getAllByText('最新版本 v2')).toHaveLength(2)

    fireEvent.click(screen.getByRole('radio', { name: '选择小圆为领队' }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(1)
    fireEvent.click(screen.getByRole('checkbox', { name: '选择小钱为成员' }))
    fireEvent.change(screen.getByLabelText('团队名称'), { target: { value: '运营协同组' } })
    fireEvent.click(screen.getByRole('button', { name: '保存团队' }))
    await waitFor(() => { expect(saveTeam).toHaveBeenCalledOnce() })
    expect(saveTeam).toHaveBeenCalledWith(expect.objectContaining({
      leaderEmployeeReleaseId: 'buyer-v3',
      members: [{ employeeReleaseId: 'finance-v2', role: 'member' }],
    }))
  })

  it('makes fallback employee cells an explicit start-work destination', () => {
    const startEmployee = vi.fn(() => Promise.resolve())
    render(<EnterpriseWorkbench {...workbenchProps({ startEmployee })} />)
    fireEvent.click(screen.getByLabelText('开始工作目标：标准模式'))
    expect(startEmployee).toHaveBeenCalledWith('standard', 'workspace-1')
  })

  it('renders one-page employee fields, validation summary, explicit save, and dirty leave guard', () => {
    const setPage = vi.fn()
    const saveEmployeeDraft = vi.fn(() => Promise.resolve())
    const patchEmployeeDraft = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        open: true, phase: 'ready', mode: 'enterprise', page: 'employees', error: null,
        busyEmployee: null, employees: { phase: 'ready', items: [], error: null },
        employeeEditor: {
          phase: 'ready', dirty: true, saving: false, conflict: false, errors: ['职责 Prompt 不能为空'],
          fields: { presetId: 'buyer', name: '采购专员', description: '', position: '采购执行', department: '采购部', prompt: '', modelRef: 'deepseek-chat', visibility: 'restricted', bindings: [] },
          revision: 4, releases: [], error: null,
        },
      } as never,
      setPage, saveEmployeeDraft, patchEmployeeDraft,
    })} />)

    expect(screen.getByLabelText('职责 Prompt')).toBeDefined()
    expect(screen.getByLabelText('使用模型')).toBeDefined()
    expect(screen.getByRole('alert').textContent).toContain('职责 Prompt 不能为空')
    fireEvent.click(screen.getByRole('button', { name: '工作记录' }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(setPage).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(saveEmployeeDraft).toHaveBeenCalled()
  })

  it('uses one dirty guard for editor back, rollback, navigation, and overlay close', () => {
    const close = vi.fn(); const setPage = vi.fn(); const closeEmployeeEditor = vi.fn(); const rollbackEmployee = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', employeeEditor: {
          phase: 'ready', dirty: true, saving: false, conflict: false, errors: [], error: null, revision: 4,
          fields: { presetId: 'buyer', name: '未保存名称', description: '', position: '', department: '', prompt: '职责', modelRef: 'model', visibility: 'private', bindings: [] },
          releases: [{ releaseId: 'release-1', presetId: 'buyer', orgId: 'server-org', version: 1, digest: 'digest', snapshot: { profile: {}, bindings: [] }, publishedBy: 'owner-1', publishedAt: 20 }],
        },
      }, close, setPage, closeEmployeeEditor, rollbackEmployee,
    } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: zh['editor.back'] }))
    fireEvent.click(screen.getByRole('button', { name: '回滚到版本 1' }))
    fireEvent.click(screen.getByRole('button', { name: zh['nav.work-records'] }))
    fireEvent.click(screen.getByRole('button', { name: zh.close }))

    expect(confirmSpy).toHaveBeenCalledTimes(4)
    expect(closeEmployeeEditor).not.toHaveBeenCalled()
    expect(rollbackEmployee).not.toHaveBeenCalled()
    expect(setPage).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('未保存名称')).toBeDefined()
  })

  it('locks employee fields while saving and renders persistent mutation recovery', () => {
    const retryMutation = vi.fn(() => Promise.resolve()); const dismissMutationError = vi.fn()
    render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', mutationPhase: 'error', mutationError: '保存失败', retryAction: 'employee-save',
        employeeEditor: {
          phase: 'ready', dirty: true, saving: true, conflict: false, errors: [], error: null, revision: 4, releases: [],
          fields: { presetId: 'buyer', name: '采购专员', description: '', position: '', department: '', prompt: '职责', modelRef: 'model', visibility: 'private', bindings: [] },
        },
      }, retryMutation, dismissMutationError,
    } as never)} />)

    expect(screen.getByLabelText(zh['editor.name']).matches(':disabled')).toBe(true)
    const error = screen.getByRole('alert', { name: zh['mutation.errorAria'] })
    expect(error.textContent).toContain('保存失败')
    fireEvent.click(within(error).getByRole('button', { name: zh['mutation.retry'] }))
    fireEvent.click(within(error).getByRole('button', { name: zh['mutation.dismiss'] }))
    expect(retryMutation).toHaveBeenCalled()
    expect(dismissMutationError).toHaveBeenCalled()
  })

  it('offers server reload instead of retry for conflicts and shows the preserved draft comparison', () => {
    const resolveMutationConflict = vi.fn(() => Promise.resolve())
    const retryMutation = vi.fn(() => Promise.resolve())
    render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', mutationPhase: 'conflict', mutationError: 'revision changed', retryAction: null,
        employeeEditor: {
          phase: 'ready', dirty: true, saving: false, conflict: true, errors: [], error: null,
          revision: 4, releases: [], conflictServerRevision: 5,
          fields: { presetId: 'buyer', name: '本地名称', description: '', position: '', department: '', prompt: '本地职责', modelRef: 'model-a', visibility: 'private', bindings: [] },
          conflictServerFields: { presetId: 'buyer', name: '服务器名称', description: '', position: '', department: '', prompt: '服务器职责', modelRef: 'model-b', visibility: 'organization', bindings: [] },
        },
      }, resolveMutationConflict, retryMutation,
    } as never)} />)

    const error = screen.getByRole('alert', { name: zh['mutation.errorAria'] })
    expect(within(error).queryByRole('button', { name: zh['mutation.retry'] })).toBeNull()
    fireEvent.click(within(error).getByRole('button', { name: zh['mutation.reload'] }))
    expect(resolveMutationConflict).toHaveBeenCalled()
    expect(retryMutation).not.toHaveBeenCalled()
    expect(screen.getByText('服务器名称')).toBeDefined()
    expect(screen.getByDisplayValue('本地名称')).toBeDefined()
  })

  it('offers explicit adopt-server and keep-local employee conflict actions', () => {
    const adoptServerEmployeeConflict = vi.fn(); const keepLocalEmployeeConflict = vi.fn()
    render(<EnterpriseWorkbench {...workbenchProps({
      state: {
        mode: 'enterprise', mutationPhase: 'idle', mutationError: null, retryAction: null,
        employeeEditor: {
          phase: 'ready', dirty: true, saving: false, conflict: true, errors: [], error: null,
          revision: 4, releases: [], conflictServerRevision: 5,
          fields: { presetId: 'buyer', name: '本地名称', description: '', position: '', department: '', prompt: '本地职责', modelRef: 'model-a', visibility: 'private', bindings: [] },
          conflictServerFields: { presetId: 'buyer', name: '服务器名称', description: '', position: '', department: '', prompt: '服务器职责', modelRef: 'model-b', visibility: 'organization', bindings: [] },
        },
      }, adoptServerEmployeeConflict, keepLocalEmployeeConflict,
    } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: zh['editor.adoptServer'] }))
    fireEvent.click(screen.getByRole('button', { name: zh['editor.keepLocal'] }))
    expect(adoptServerEmployeeConflict).toHaveBeenCalled()
    expect(keepLocalEmployeeConflict).toHaveBeenCalled()
  })

  it('guards navigation and close when a schedule form is dirty', () => {
    const setPage = vi.fn(); const close = vi.fn()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'schedules', schedules: { phase: 'ready', items: [], error: null },
      releases: [{
        releaseId: 'release-buyer', presetId: 'buyer', orgId: 'o', version: 1, digest: 'd',
        snapshot: { profile: { name: '采购' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
      }],
    }, setPage, close } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: zh['schedule.create'] }))
    fireEvent.change(screen.getByLabelText(zh['schedule.name']), { target: { value: '采购日报' } })
    fireEvent.click(screen.getByRole('button', { name: zh['nav.employees'] }))
    fireEvent.click(screen.getByRole('button', { name: zh.close }))

    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(setPage).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
  })

  it('clears local form dirtiness only after successful schedule, asset, and team saves', async () => {
    const releases = [{
      releaseId: 'release-lead', presetId: 'lead', orgId: 'o', version: 1, digest: 'a',
      snapshot: { profile: { name: '领队' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
    }, {
      releaseId: 'release-member', presetId: 'member', orgId: 'o', version: 1, digest: 'b',
      snapshot: { profile: { name: '成员' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
    }] as never
    const cases = [
      { page: 'schedules', create: zh['schedule.create'], save: zh['schedule.save'], callback: 'saveSchedule' },
      { page: 'assets', create: zh['asset.create'], save: zh['asset.save'], callback: 'saveAssetVersion' },
      { page: 'teams', create: zh['team.create'], save: zh['team.save'], callback: 'saveTeam' },
    ] as const
    for (const testCase of cases) {
      for (const success of [true, false]) {
        cleanup()
        const setPage = vi.fn(); const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
        const save = vi.fn(() => Promise.resolve(success))
        render(<EnterpriseWorkbench {...workbenchProps({
          state: { mode: 'enterprise', page: testCase.page, releases }, setPage,
          [testCase.callback]: save,
        } as never)} />)
        if (testCase.page === 'teams') fireEvent.click(screen.getByText(zh['team.legacyTitle']))
        fireEvent.click(screen.getByRole('button', { name: testCase.create }))
        if (testCase.page === 'schedules') {
          fireEvent.change(screen.getByLabelText(zh['schedule.name']), { target: { value: '日报' } })
          fireEvent.change(screen.getByLabelText(zh['schedule.employee']), { target: { value: 'release-lead' } })
          fireEvent.change(screen.getByLabelText(zh['schedule.instructions']), { target: { value: '生成日报' } })
        } else if (testCase.page === 'assets') {
          fireEvent.change(screen.getByLabelText(zh['asset.name']), { target: { value: '日报 SOP' } })
          fireEvent.change(screen.getByLabelText(zh['asset.summary']), { target: { value: '统一日报' } })
          fireEvent.change(screen.getByLabelText(zh['asset.body']), { target: { value: '收集\n汇总' } })
        } else {
          fireEvent.change(screen.getByLabelText(zh['team.name']), { target: { value: '日报团队' } })
          fireEvent.click(screen.getByRole('radio', { name: '选择领队为领队' }))
          fireEvent.click(screen.getByRole('checkbox', { name: '选择成员为成员' }))
        }
        const button = screen.getByRole('button', { name: testCase.save })
        fireEvent.submit(button.closest('form') as HTMLFormElement)
        await waitFor(() => { expect(save).toHaveBeenCalled() })
        fireEvent.click(screen.getByRole('button', { name: zh['nav.employees'] }))
        if (success) {
          expect(confirmSpy).not.toHaveBeenCalled()
          expect(setPage).toHaveBeenCalledWith('employees')
        } else {
          expect(confirmSpy).toHaveBeenCalled()
          expect(setPage).not.toHaveBeenCalled()
        }
        confirmSpy.mockRestore()
      }
    }
  })

  it('disables operation mutations while another mutation is running', () => {
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'approvals', mutationPhase: 'running', retryAction: 'team-save',
      approvals: { phase: 'ready', error: null, items: [{
        approvalId: 'a', orgId: 'o', kind: 'business', subjectType: 'order', subjectId: '1',
        requestedBy: 'u', state: 'pending', revision: 1, createdAt: 1, updatedAt: 1,
      }] },
    } })} />)
    expect(screen.getByRole('button', { name: zh['approval.approve'] }).matches(':disabled')).toBe(true)
  })

  it('renders enterprise enum values through the Chinese locale', () => {
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', employees: { phase: 'ready', error: null, items: [{
        presetId: 'buyer', orgId: 'server-org', ownerUserId: 'owner-1', visibility: 'restricted',
        profile: { name: '采购专员' }, bindings: [{ kind: 'knowledge', assetId: 'kb', version: 1 }],
        revision: 2, status: 'published', updatedAt: 20,
      }] },
    } })} />)

    expect(screen.getAllByText('已发布').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/受限可见/u).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/知识/u).length).toBeGreaterThan(0)
    expect(screen.queryByText('published')).toBeNull()
    expect(screen.queryByText(/restricted/u)).toBeNull()
  })

  it('renders honest metrics, employee identity, capability labels, and work records', () => {
    render(<EnterpriseWorkbench {...workbenchProps()} />)

    expect(screen.getByRole('dialog', { name: zh['title'] })).toBeDefined()
    expect(screen.getByText('通用执行员工')).toBeDefined()
    expect(screen.getByText('数字化运营')).toBeDefined()
    expect(screen.getByText('文件执行')).toBeDefined()
    expect(screen.getByText('供应商核验')).toBeDefined()
    expect(screen.getByText('标准模式 · 采购部')).toBeDefined()
    expect(screen.getAllByText('发起对话')).toHaveLength(1)
    const metrics = screen.getByLabelText(zh['metrics.aria'])
    expect(metrics.getAttribute('aria-live')).toBe('polite')
    expect(within(metrics).getByText('2')).toBeDefined()
    expect(within(metrics).getAllByText('1')).toHaveLength(2)
  })

  it('starts healthy employees, opens work records, and refuses unavailable employees', () => {
    const startEmployee = vi.fn(() => Promise.resolve())
    const openRecord = vi.fn()
    render(<EnterpriseWorkbench {...workbenchProps({ startEmployee, openRecord })} />)

    fireEvent.click(screen.getByRole('button', { name: '与标准模式发起对话' }))
    expect(startEmployee).toHaveBeenCalledWith('standard', 'workspace-1')
    expect(screen.getByRole('button', { name: '损坏员工不可用' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '打开工作记录：供应商核验' }))
    expect(openRecord).toHaveBeenCalledWith('session-1')
  })

  it('shows a failed employee start without hiding the usable roster', () => {
    render(<EnterpriseWorkbench {...workbenchProps({
      state: { error: 'Employee selection failed' },
    })} />)
    expect(screen.getByRole('alert').textContent).toContain('Employee selection failed')
    expect(screen.getByRole('button', { name: '与标准模式发起对话' })).toBeDefined()
  })

  it('starts prepared goal-first work, opens the native Session, and never exposes internal identifiers', async () => {
    const prepareWork = vi.fn(() => Promise.resolve({ kind: 'ready', workspaceId: 'workspace-1', employeeReleaseId: 'release-buyer' }))
    const startPreparedWork = vi.fn(() => Promise.resolve({ sessionId: 'session-created', workspaceId: 'workspace-1', employeeReleaseId: 'release-buyer', executionSummary: 'Work is ready.' }))
    const openRecord = vi.fn()
    const close = vi.fn()
    render(<EnterpriseWorkbench {...workbenchProps({
      prepareWork, startPreparedWork, openRecord, close,
      state: { mode: 'enterprise', releases: [{ releaseId: 'release-buyer', presetId: 'buyer', orgId: 'org-a', version: 2, digest: 'digest', snapshot: { profile: { name: '采购专员' }, bindings: [] }, publishedBy: 'user-a', publishedAt: 1 }] },
    } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '按目标派工' }))
    fireEvent.change(screen.getByLabelText('工作目标'), { target: { value: '核验本周供应商报价' } })
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }))

    await waitFor(() => { expect(startPreparedWork).toHaveBeenCalledOnce() })
    expect(prepareWork).toHaveBeenCalledWith(expect.objectContaining({ objective: '核验本周供应商报价' }))
    expect(startPreparedWork).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: expect.stringMatching(/^enterprise-work:/u) as unknown,
    }))
    expect(openRecord).toHaveBeenCalledWith('session-created')
    expect(close).toHaveBeenCalledOnce()
    expect(screen.queryByText('workspace-1')).toBeNull()
    expect(screen.queryByText('release-buyer')).toBeNull()
  })

  it('asks only for named workspace choices before preparing again', async () => {
    const prepareWork = vi.fn()
      .mockResolvedValueOnce({ kind: 'needs-workspace-selection', availableWorkspaceIds: ['workspace-1'] })
      .mockResolvedValueOnce({ kind: 'needs-selection', workspaceId: 'workspace-1', availableEmployeeReleaseIds: [] })
    render(<EnterpriseWorkbench {...workbenchProps({ prepareWork, startPreparedWork: vi.fn(), state: { mode: 'enterprise' } } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: '按目标派工' }))
    fireEvent.change(screen.getByLabelText('工作目标'), { target: { value: '准备采购周报' } })
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }))
    await screen.findByRole('button', { name: '采购部' })
    expect(screen.queryByText('workspace-1')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '采购部' }))
    await waitFor(() => { expect(prepareWork).toHaveBeenCalledTimes(2) })
    expect(prepareWork).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceId: 'workspace-1' }))
  })

  it('asks only for named employee releases before preparing again', async () => {
    const release = { releaseId: 'release-buyer', presetId: 'buyer', orgId: 'org-a', version: 2, digest: 'digest', snapshot: { profile: { name: '采购专员' }, bindings: [] }, publishedBy: 'user-a', publishedAt: 1 }
    const prepareWork = vi.fn()
      .mockResolvedValueOnce({ kind: 'needs-selection', workspaceId: 'workspace-1', availableEmployeeReleaseIds: ['release-buyer'] })
      .mockResolvedValueOnce({ kind: 'ready', workspaceId: 'workspace-1', employeeReleaseId: 'release-buyer' })
    render(<EnterpriseWorkbench {...workbenchProps({ prepareWork, startPreparedWork: vi.fn(() => Promise.resolve({ sessionId: 'session-created', workspaceId: 'workspace-1', employeeReleaseId: 'release-buyer', executionSummary: 'Ready.' })), state: { mode: 'enterprise', releases: [release] } } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: '按目标派工' }))
    fireEvent.change(screen.getByLabelText('工作目标'), { target: { value: '准备采购周报' } })
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }))
    await screen.findByRole('button', { name: '采购专员 · v2' })
    expect(screen.queryByText('release-buyer')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '采购专员 · v2' }))
    await waitFor(() => { expect(prepareWork).toHaveBeenCalledTimes(2) })
    expect(prepareWork).toHaveBeenLastCalledWith(expect.objectContaining({ preferredEmployeeReleaseId: 'release-buyer' }))
  })

  it('uses a localized human-safe employee label when a release has no profile name', async () => {
    const release = { releaseId: 'release-internal-42', presetId: 'buyer', orgId: 'org-a', version: 2, digest: 'digest', snapshot: { profile: {}, bindings: [] }, publishedBy: 'user-a', publishedAt: 1 }
    const prepareWork = vi.fn(() => Promise.resolve({ kind: 'needs-selection', workspaceId: 'workspace-1', availableEmployeeReleaseIds: ['release-internal-42'] }))
    const { rerender } = render(<EnterpriseWorkbench {...workbenchProps({ prepareWork, state: { mode: 'enterprise', releases: [release] } } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: '按目标派工' }))
    fireEvent.change(screen.getByLabelText('工作目标'), { target: { value: '准备采购周报' } })
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }))
    await screen.findByRole('button', { name: '数字员工 · 版本 2' })
    expect(screen.queryByText('release-internal-42')).toBeNull()

    rerender(<EnterpriseWorkbench {...workbenchProps({ t: makeTranslate(en), prepareWork, state: { mode: 'enterprise', releases: [release] } } as never)} />)
    fireEvent.change(screen.getByLabelText('Work objective'), { target: { value: 'Prepare procurement report' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start work' }))
    await screen.findByRole('button', { name: 'Digital employee · version 2' })
    expect(screen.queryByText('release-internal-42')).toBeNull()
  })

  it('keeps a failed preparation recoverable with retry', async () => {
    const prepareWork = vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce({ kind: 'needs-workspace-selection', availableWorkspaceIds: [] })
    render(<EnterpriseWorkbench {...workbenchProps({ prepareWork, startPreparedWork: vi.fn(), state: { mode: 'enterprise' } } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: '按目标派工' }))
    fireEvent.change(screen.getByLabelText('工作目标'), { target: { value: '准备采购周报' } })
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => { expect(prepareWork).toHaveBeenCalledTimes(2) })
  })

  it('shows localized safe errors for failed preparation and start attempts', async () => {
    const internalFailure = new Error('{"code":"REQUEST_EXTENSION","releaseId":"release-internal-42","request":{"workspaceId":"workspace-secret"}}')
    const prepareWork = vi.fn()
      .mockRejectedValueOnce(internalFailure)
      .mockResolvedValueOnce({ kind: 'ready', workspaceId: 'workspace-1', employeeReleaseId: 'release-safe' })
    const startPreparedWork = vi.fn(() => Promise.reject(internalFailure))
    render(<EnterpriseWorkbench {...workbenchProps({ prepareWork, startPreparedWork, state: { mode: 'enterprise' } } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: '按目标派工' }))
    fireEvent.change(screen.getByLabelText('工作目标'), { target: { value: '准备采购周报' } })
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }))
    const prepareError = await screen.findByRole('alert')
    expect(prepareError.textContent).toContain('暂时无法准备这项工作，请重试。')
    expect(prepareError.textContent).not.toContain('REQUEST_EXTENSION')
    expect(prepareError.textContent).not.toContain('release-internal-42')
    expect(prepareError.textContent).not.toContain('workspace-secret')

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    const startError = await screen.findByRole('alert')
    expect(startError.textContent).toContain('暂时无法开始这项工作，请重试。')
    expect(startError.textContent).not.toContain('REQUEST_EXTENSION')
    expect(startError.textContent).not.toContain('release-internal-42')
    expect(startError.textContent).not.toContain('workspace-secret')
    expect(screen.getByRole('button', { name: '重试' })).toBeDefined()
  })

  it('reuses an unchanged retry key but starts fresh after objective or deadline edits', async () => {
    const prepareWork = vi.fn(() => Promise.resolve({ kind: 'ready', workspaceId: 'workspace-1', employeeReleaseId: 'release-safe' }))
    const startPreparedWork = vi.fn<EnterpriseWorkbenchProps['startPreparedWork']>(() => Promise.reject(new Error('start unavailable')))
    render(<EnterpriseWorkbench {...workbenchProps({ prepareWork, startPreparedWork, state: { mode: 'enterprise' } } as never)} />)

    fireEvent.click(screen.getByRole('button', { name: '按目标派工' }))
    fireEvent.change(screen.getByLabelText('工作目标'), { target: { value: '准备采购周报' } })
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }))
    await screen.findByRole('alert')

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => { expect(startPreparedWork).toHaveBeenCalledTimes(2) })
    const retryKey = (startPreparedWork.mock.calls[0]?.[0] as { idempotencyKey: string }).idempotencyKey
    expect((startPreparedWork.mock.calls[1]?.[0] as { idempotencyKey: string }).idempotencyKey).toBe(retryKey)

    fireEvent.change(screen.getByLabelText('工作目标'), { target: { value: '复核采购周报' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('工作已准备好。')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }))
    await waitFor(() => { expect(startPreparedWork).toHaveBeenCalledTimes(3) })
    const objectiveEditKey = (startPreparedWork.mock.calls[2]?.[0] as { idempotencyKey: string }).idempotencyKey
    expect(objectiveEditKey).not.toBe(retryKey)

    fireEvent.change(screen.getByLabelText('截止时间（可选）'), { target: { value: '2026-09-07T12:00' } })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('工作已准备好。')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '开始工作' }))
    await waitFor(() => { expect(startPreparedWork).toHaveBeenCalledTimes(4) })
    expect((startPreparedWork.mock.calls[3]?.[0] as { idempotencyKey: string }).idempotencyKey).not.toBe(objectiveEditKey)
  })

  it('closes on Escape and exposes loading, empty, and error recovery states', () => {
    const close = vi.fn()
    const { rerender } = render(
      <EnterpriseWorkbench {...workbenchProps({
        state: { open: true, phase: 'loading', mode: null, error: null, busyEmployee: null }, close,
      })} />,
    )
    expect(screen.getByRole('status').textContent).toContain(zh['loading'])
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(close).toHaveBeenCalledTimes(1)

    rerender(<EnterpriseWorkbench {...workbenchProps({ state: {
      open: true,
      phase: 'ready',
      view: { employees: [], records: [], metrics: { employees: 0, active: 0, attention: 0, workRecords: 0, workspaces: 0 } },
      error: null,
      busyEmployee: null,
    } })} />)
    expect(screen.getByText(zh['employees.empty.title'])).toBeDefined()

    rerender(<EnterpriseWorkbench {...workbenchProps({ state: {
      open: true, phase: 'error', error: 'network unavailable', busyEmployee: null,
    } })} />)
    expect(screen.getByRole('alert').textContent).toContain('network unavailable')
    expect(screen.getByRole('button', { name: zh['retry'] })).toBeDefined()
  })

  it('keeps keyboard focus inside the modal workbench', () => {
    render(<EnterpriseWorkbench {...workbenchProps()} />)
    const dialog = screen.getByRole('dialog')
    const close = screen.getByRole('button', { name: zh['close'] })
    const first = screen.getByRole('button', { name: zh['refresh'] })
    const last = screen.getByLabelText('开始工作目标：标准模式')

    expect(document.activeElement).toBe(close)
    first.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
})
