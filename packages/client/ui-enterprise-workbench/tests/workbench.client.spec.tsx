// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
  mutationPhase: 'idle', mutationError: null, retryAction: null,
}

function workbenchProps(overrides: Partial<EnterpriseWorkbenchProps> & {
  state?: Partial<EnterpriseWorkbenchState>
} = {}): EnterpriseWorkbenchProps {
  const state: EnterpriseWorkbenchState = { ...BASE_STATE, ...overrides.state }
  const { state: _state, ...rest } = overrides
  return {
    useEnterprise: select => select(state),
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
    }, setPage, close } as never)} />)

    fireEvent.change(screen.getByLabelText(zh['schedule.id']), { target: { value: 'schedule-1' } })
    fireEvent.click(screen.getByRole('button', { name: zh['nav.employees'] }))
    fireEvent.click(screen.getByRole('button', { name: zh.close }))

    expect(confirmSpy).toHaveBeenCalledTimes(2)
    expect(setPage).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
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
    expect(screen.getAllByText('开始工作')).toHaveLength(1)
    const metrics = screen.getByLabelText(zh['metrics.aria'])
    expect(within(metrics).getByText('2')).toBeDefined()
    expect(within(metrics).getAllByText('1')).toHaveLength(2)
  })

  it('starts healthy employees, opens work records, and refuses unavailable employees', () => {
    const startEmployee = vi.fn(() => Promise.resolve())
    const openRecord = vi.fn()
    render(<EnterpriseWorkbench {...workbenchProps({ startEmployee, openRecord })} />)

    fireEvent.click(screen.getByRole('button', { name: '与标准模式开始工作' }))
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
    const last = screen.getByRole('button', { name: '打开工作记录：供应商核验' })

    expect(document.activeElement).toBe(close)
    first.focus()
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
})
