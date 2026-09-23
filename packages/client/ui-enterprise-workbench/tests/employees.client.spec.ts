// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { EmployeeDirectory } from '../src/client/employees.tsx'
import { zh } from '../src/client/locales.ts'
import {
  EnterpriseWorkbenchController,
  type EmployeeSummary, type EnterpriseStaffState,
} from '../src/client/store.ts'

const t = makeTranslate(zh)

const BUYER: EmployeeSummary = {
  id: 'employee-buyer', displayName: '采购协调员', roleCard: '严谨核验供应商报价', state: 'active',
}
const ARCHIVIST: EmployeeSummary = {
  id: 'employee-archivist', displayName: '档案助手', roleCard: '整理归档业务资料', state: 'suspended',
}

const IDLE_STAFF: EnterpriseStaffState = { phase: 'idle', list: [], error: null, sending: false, sendError: null }
const READY_STAFF: EnterpriseStaffState = {
  phase: 'ready', list: [BUYER, ARCHIVIST], error: null, sending: false, sendError: null,
}

function staff(overrides: Partial<EnterpriseStaffState>): EnterpriseStaffState {
  return { ...IDLE_STAFF, ...overrides }
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function directoryProps(overrides: {
  staff?: EnterpriseStaffState
  loadEmployees?: () => Promise<boolean>
  sendMessage?: (employeeId: string, text: string) => Promise<boolean>
  selectEmployee?: (employeeId?: string) => void
} = {}) {
  return {
    staff: overrides.staff ?? IDLE_STAFF,
    loadEmployees: overrides.loadEmployees ?? vi.fn(() => Promise.resolve(true)),
    sendMessage: overrides.sendMessage ?? vi.fn(() => Promise.resolve(true)),
    selectEmployee: overrides.selectEmployee ?? vi.fn(),
    t,
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('EnterpriseWorkbenchController employee directory slice', () => {
  it('loads the persistent employee directory through the employee dm list endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([BUYER, ARCHIVIST]))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never)

    await expect(controller.loadEmployees()).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith('/enterprise/employees', {
      credentials: 'same-origin', headers: { accept: 'application/json' },
    })
    expect(controller.store.getSnapshot().staff).toMatchObject({
      phase: 'ready', error: null, sendError: null, sending: false,
      list: [BUYER, ARCHIVIST],
    })
  })

  it('keeps a failed directory load contained in the slice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'forbidden' }, 403)))
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never)

    await expect(controller.loadEmployees()).resolves.toBe(false)

    const staffState = controller.store.getSnapshot().staff
    expect(staffState.phase).toBe('error')
    expect(staffState.error).toContain('403')
  })

  it('selects a directory row and clears the selection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([BUYER, ARCHIVIST])))
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never)
    await controller.loadEmployees()

    controller.selectEmployee('employee-archivist')
    expect(controller.store.getSnapshot().staff.selected).toEqual(ARCHIVIST)

    controller.selectEmployee('employee-archivist')
    controller.selectEmployee()
    expect(controller.store.getSnapshot().staff.selected).toBeUndefined()
  })

  it('delivers one dm through the employee messages endpoint and settles clean', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ employeeId: 'employee-buyer', inboxItemId: 'inbox-1' }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never)

    await expect(controller.sendMessage('employee-buyer', '请核验本周报价')).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith('/enterprise/employees/employee-buyer/messages', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '请核验本周报价' }),
    })
    expect(controller.store.getSnapshot().staff).toMatchObject({ sending: false, sendError: null })
  })

  it('maps inactive employees and failed deliveries to contained dictionary keys', async () => {
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never)
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'employee-inactive' }, 409)))
    await expect(controller.sendMessage('employee-archivist', '在吗')).resolves.toBe(false)
    expect(controller.store.getSnapshot().staff.sendError).toBe('employee-inactive')

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'delivery-failed' }, 502)))
    await expect(controller.sendMessage('employee-archivist', '在吗')).resolves.toBe(false)
    expect(controller.store.getSnapshot().staff.sendError).toBe('delivery-failed')
    expect(controller.store.getSnapshot().staff.sending).toBe(false)
  })
})

describe('EmployeeDirectory view', () => {
  it('renders rows with accessible state dots and opens the detail from a row', () => {
    const selectEmployee = vi.fn()
    const { container } = render(createElement(EmployeeDirectory, directoryProps({
      staff: READY_STAFF, selectEmployee,
    })))

    expect(screen.getByText(zh['staff.heading'])).toBeDefined()
    expect(screen.getByRole('button', { name: `查看${BUYER.displayName}` })).toBeDefined()
    expect(screen.getByRole('img', { name: zh['staff.state.active'] })).toBeDefined()
    expect(screen.getByRole('img', { name: zh['staff.state.suspended'] })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: `查看${ARCHIVIST.displayName}` }))
    expect(selectEmployee).toHaveBeenCalledWith('employee-archivist')
    expect(container.querySelectorAll('[class*="primaryButton"]').length).toBe(0)
  })

  it('shows the detail fields with the dm entry as the only primary button', () => {
    const { container } = render(createElement(EmployeeDirectory, directoryProps({
      staff: staff({ ...READY_STAFF, selected: BUYER }),
    })))

    expect(screen.getByRole('article', { name: '采购协调员详情' })).toBeDefined()
    expect(screen.getByText(`角色卡：${BUYER.roleCard}`)).toBeDefined()
    expect(screen.getByText(`记忆：${zh['staff.memoryPlaceholder']}`)).toBeDefined()
    expect(screen.getByPlaceholderText(`给${BUYER.displayName}写消息…`)).toBeDefined()
    expect(screen.getByRole('button', { name: zh['staff.back'] })).toBeDefined()
    const primaryButtons = container.querySelectorAll('[class*="primaryButton"]')
    expect(primaryButtons.length).toBe(1)
    expect(primaryButtons[0]?.getAttribute('type')).toBe('submit')
  })

  it('sends the typed dm and clears the draft after delivery', async () => {
    const sendMessage = vi.fn(() => Promise.resolve(true))
    render(createElement(EmployeeDirectory, directoryProps({
      staff: staff({ ...READY_STAFF, selected: BUYER }), sendMessage,
    })))

    const input = screen.getByPlaceholderText<HTMLInputElement>(`给${BUYER.displayName}写消息…`)
    fireEvent.change(input, { target: { value: '请核验本周报价' } })
    const send = screen.getByRole('button', { name: zh['staff.send'] }) as HTMLButtonElement
    expect(send.disabled).toBe(false)
    fireEvent.click(send)

    await waitFor(() => { expect(sendMessage).toHaveBeenCalledWith('employee-buyer', '请核验本周报价') })
    await waitFor(() => { expect(screen.getByPlaceholderText<HTMLInputElement>(`给${BUYER.displayName}写消息…`).value).toBe('') })
  })

  it('keeps the draft and shows the dictionary error when delivery fails', () => {
    render(createElement(EmployeeDirectory, directoryProps({
      staff: staff({ ...READY_STAFF, selected: BUYER, sendError: 'employee-inactive' }),
    })))

    expect(screen.getByRole('alert')?.textContent).toBe(
      zh['staff.sendError.employee-inactive'].replace('{name}', BUYER.displayName),
    )
  })

  it('loads the directory once on mount and shows the contained empty and error states', async () => {
    const loadEmployees = vi.fn(() => Promise.resolve(true))
    const { rerender } = render(createElement(EmployeeDirectory, directoryProps({
      staff: IDLE_STAFF, loadEmployees,
    })))
    await waitFor(() => { expect(loadEmployees).toHaveBeenCalledTimes(1) })

    rerender(createElement(EmployeeDirectory, directoryProps({
      staff: staff({ phase: 'ready', list: [] }), loadEmployees,
    })))
    expect(screen.getByText(zh['staff.empty'])).toBeDefined()

    rerender(createElement(EmployeeDirectory, directoryProps({
      staff: staff({ phase: 'error', error: 'employee list request failed (403)' }), loadEmployees,
    })))
    expect(screen.getByRole('alert')?.textContent).toContain(zh['staff.loadError'])
    fireEvent.click(screen.getByRole('button', { name: zh.retry }))
    expect(loadEmployees).toHaveBeenCalledTimes(2)
  })
})
