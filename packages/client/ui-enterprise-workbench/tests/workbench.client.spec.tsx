// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { EnterpriseTrigger } from '../src/client/EnterpriseTrigger.tsx'
import {
  EnterpriseWorkbench, type EnterpriseWorkbenchProps,
} from '../src/client/EnterpriseWorkbench.tsx'
import { zh } from '../src/client/locales.ts'
import type { EnterpriseView, EnterpriseWorkbenchState } from '../src/client/store.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
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
  workRecords: EMPTY_PAGE, approvals: EMPTY_PAGE, schedules: EMPTY_PAGE,
  assets: EMPTY_PAGE, teams: EMPTY_PAGE,
  extensions: EMPTY_PAGE, extensionBindings: [], extensionReviews: EMPTY_PAGE, formalPlugins: EMPTY_PAGE,
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
    useWorkspaces: select => select({
      items: [{ workspaceId: 'workspace-1', title: '采购部', path: '/business/procurement', sessionIds: [],
        createdAt: '2026-08-26T00:00:00.000Z', updatedAt: '2026-08-26T00:00:00.000Z' }],
      archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
    } as never),
    close: vi.fn(),
    refresh: vi.fn(() => Promise.resolve()),
    startEmployee: vi.fn(() => Promise.resolve()),
    openRecord: vi.fn(),
    t,
    ...rest,
  } as EnterpriseWorkbenchProps
}

describe('EnterpriseTrigger', () => {
  it('renders the labelled row when wide and the accessible icon control on the rail', () => {
    const toggle = vi.fn()
    const { rerender } = render(
      <EnterpriseTrigger wide open={false} toggle={toggle} t={t} />,
    )
    fireEvent.click(screen.getByRole('button', { name: zh['trigger.open'] }))
    expect(toggle).toHaveBeenCalledTimes(1)
    expect(screen.getByText(zh['trigger.label'])).toBeDefined()

    rerender(<EnterpriseTrigger wide={false} open toggle={toggle} t={t} />)
    expect(screen.queryByText(zh['trigger.label'])).toBeNull()
    expect(screen.getByRole('button', { name: zh['trigger.close'] })).toBeDefined()
  })
})

describe('EnterpriseWorkbench', () => {
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
    fireEvent.click(screen.getByText('查看源码'))
    expect(screen.getByText('return { apply() {} }')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(stopExtension).toHaveBeenCalledWith(expect.objectContaining({ bindingId: 'binding-1' }), zh['extensions.stopReason'])
    fireEvent.click(screen.getByRole('button', { name: '待我审核' }))
    fireEvent.change(screen.getByLabelText('审核原因'), { target: { value: '已验证' } })
    fireEvent.click(screen.getByRole('button', { name: '批准部门启用' }))
    expect(reviewExtension).toHaveBeenCalledWith(expect.objectContaining({ reviewId: 'review-1' }), 'approve', '已验证')
    fireEvent.click(screen.getByRole('button', { name: '企业发行插件' }))
    expect(screen.getByText('@company/dsh-orders')).toBeDefined()
    expect(screen.getByText('已挂载')).toBeDefined()
    expect(screen.getByText('私有 Registry')).toBeDefined()
    expect(screen.getByText('受保护 Profile')).toBeDefined()
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
    for (const label of ['数字员工', '工作记录', '审批', '定时任务', '能力资产', '团队']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined()
    }
    fireEvent.click(screen.getByRole('button', { name: '编辑采购专员' }))
    expect(openEmployeeDraft).toHaveBeenCalledWith('buyer')
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
    render(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'employees', employeeEditor: {
        phase: 'ready', revision: 0, releases: [], dirty: false, saving: false, conflict: false,
        errors: ['name-required', 'prompt-required', 'model-required'], error: null,
        creatingFromPresetId: 'standard', presetCreated: false,
        fields: {
          presetId: 'employee-new', name: '', description: '', position: '', department: '',
          prompt: '', modelRef: '', capabilities: [], visibility: 'organization', bindings: [],
        },
      },
    } as never })} />)

    expect(screen.getByRole('heading', { name: '新建数字员工' })).toBeDefined()
    expect(screen.getByRole('button', { name: '发布' }).hasAttribute('disabled')).toBe(true)
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
          },
          bindings: [
            { kind: 'sop', assetId: 'rfq', version: 2 },
            { kind: 'knowledge', assetId: 'policy', version: 1 },
          ],
          revision: 4, status: 'published', updatedAt: 20,
        }] },
      } as never,
    })} />)

    expect(screen.getByRole('heading', { name: '选择数字员工' })).toBeDefined()
    expect(screen.getByPlaceholderText('搜索数字员工名称、岗位或部门')).toBeDefined()
    expect(screen.getByRole('tab', { name: '所有员工' }).getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: '已发布' })).toBeDefined()
    expect(screen.getByRole('tab', { name: '草稿' })).toBeDefined()
    expect(screen.getByText('采购协同顾问')).toBeDefined()
    expect(screen.getByText('帮助员工准备采购需求和审批材料。')).toBeDefined()
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
    expect(startEmployee).toHaveBeenCalledWith('buyer')
    expect(openEmployeeDraft).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '编辑采购专员' }))
    expect(openEmployeeDraft).toHaveBeenCalledWith('buyer')
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
    expect(screen.getByText('高级 JSON 编辑')).toBeDefined()

    rerender(<EnterpriseWorkbench {...workbenchProps({ state: {
      mode: 'enterprise', page: 'teams', releases: [{
        releaseId: 'release-buyer', presetId: 'buyer', orgId: 'o', version: 2, digest: 'd',
        snapshot: { profile: { name: '采购' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
      }, {
        releaseId: 'release-rfq', presetId: 'rfq', orgId: 'o', version: 1, digest: 'e',
        snapshot: { profile: { name: '询价' }, bindings: [] }, publishedBy: 'u', publishedAt: 1,
      }],
    }, saveTeam } as never)} />)
    fireEvent.click(screen.getByRole('button', { name: '新建团队' }))
    expect(screen.getByLabelText('领队数字员工').tagName).toBe('SELECT')
    expect(screen.getByRole('checkbox', { name: '询价' })).toBeDefined()
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
    fireEvent.change(screen.getByLabelText('能力类型'), { target: { value: 'sop' } })
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
    fireEvent.click(screen.getByRole('button', { name: '新建团队' }))
    fireEvent.change(screen.getByLabelText('团队名称'), { target: { value: '采购协同组' } })
    fireEvent.change(screen.getByLabelText('领队数字员工'), { target: { value: 'release-lead' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '询价专员' }))
    fireEvent.click(screen.getByRole('button', { name: '保存团队' }))
    await waitFor(() => { expect(saveTeam).toHaveBeenCalledOnce() })
    const savedTeam = saveTeam.mock.calls[0]![0]
    expect(savedTeam.teamId).toMatch(/^team-/u)
    expect(savedTeam).toMatchObject({
      leaderEmployeeReleaseId: 'release-lead',
      members: [{ employeeReleaseId: 'release-member', role: 'member' }],
    })
  })

  it('makes fallback employee cells an explicit start-work destination', () => {
    const startEmployee = vi.fn(() => Promise.resolve())
    render(<EnterpriseWorkbench {...workbenchProps({ startEmployee })} />)
    fireEvent.click(screen.getByLabelText('开始工作目标：标准模式'))
    expect(startEmployee).toHaveBeenCalledWith('standard')
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
    expect(screen.getByLabelText('模型引用')).toBeDefined()
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
          fireEvent.change(screen.getByLabelText(zh['team.leaderSelect']), { target: { value: 'release-lead' } })
          fireEvent.click(screen.getByRole('checkbox', { name: '成员' }))
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
    expect(startEmployee).toHaveBeenCalledWith('standard')
    expect(screen.getByRole('button', { name: '损坏员工不可用' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: '打开工作记录：供应商核验' }))
    expect(openRecord).toHaveBeenCalledWith('session-1')
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
