// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { EmployeeDirectory } from '../src/client/employees.tsx'
import { zh } from '../src/client/locales.ts'
import {
  EnterpriseWorkbenchController,
  type EmployeeMemoryEntryView, type EmployeeSummary, type EnterpriseStaffMemoriesState,
  type EnterpriseStaffState,
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

const NOW = Date.UTC(2026, 8, 23, 8, 0)
const PROPOSED: EmployeeMemoryEntryView = {
  id: 'agent-memory-a1', scope: 'organization', kind: 'business-fact', status: 'proposed',
  summary: '供应商报价需双人复核', createdAt: NOW - 86_400_000, revision: 1,
}
const APPROVED_AGENT: EmployeeMemoryEntryView = {
  id: 'private-memory-b2', scope: 'agent', kind: 'process', status: 'approved',
  summary: '客户偏好中文回复', createdAt: NOW - 2 * 86_400_000, revision: 1,
}
const APPROVED_SHARED: EmployeeMemoryEntryView = {
  id: 'agent-memory-c3', scope: 'department', kind: 'decision', status: 'approved',
  summary: '报销流程已归档', createdAt: NOW - 3 * 86_400_000, revision: 2,
}

const IDLE_MEMORIES: EnterpriseStaffMemoriesState = { phase: 'idle', entries: [], error: null }

function staff(overrides: Partial<EnterpriseStaffState>): EnterpriseStaffState {
  return { ...IDLE_STAFF, ...overrides }
}

function memories(overrides: Partial<EnterpriseStaffMemoriesState>): EnterpriseStaffMemoriesState {
  return { ...IDLE_MEMORIES, ...overrides }
}

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

function directoryProps(overrides: {
  staff?: EnterpriseStaffState
  memories?: EnterpriseStaffMemoriesState
  loadEmployees?: () => Promise<boolean>
  loadEmployeeMemories?: (employeeId: string) => Promise<boolean>
  reviewEmployeeMemory?: (
    employeeId: string, memoryId: string, decision: 'approved' | 'rejected', revision: number,
  ) => Promise<boolean>
  retireEmployeeMemory?: (employeeId: string, memoryId: string, revision: number) => Promise<boolean>
  sendMessage?: (employeeId: string, text: string) => Promise<boolean>
  selectEmployee?: (employeeId?: string) => void
} = {}) {
  return {
    staff: overrides.staff ?? IDLE_STAFF,
    memories: overrides.memories ?? IDLE_MEMORIES,
    loadEmployees: overrides.loadEmployees ?? vi.fn(() => Promise.resolve(true)),
    loadEmployeeMemories: overrides.loadEmployeeMemories ?? vi.fn(() => Promise.resolve(true)),
    reviewEmployeeMemory: overrides.reviewEmployeeMemory ?? vi.fn(() => Promise.resolve(true)),
    retireEmployeeMemory: overrides.retireEmployeeMemory ?? vi.fn(() => Promise.resolve(true)),
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

describe('EnterpriseWorkbenchController employee memory slice', () => {
  it('loads one employee memory view through the governance endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([PROPOSED, APPROVED_AGENT]))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never)

    await expect(controller.loadEmployeeMemories('employee-buyer')).resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith('/enterprise/employees/employee-buyer/memories', {
      credentials: 'same-origin', headers: { accept: 'application/json' },
    })
    expect(controller.store.getSnapshot().staffMemories).toEqual({
      phase: 'ready', entries: [PROPOSED, APPROVED_AGENT], error: null,
    })
  })

  it('keeps a failed memory load contained in the slice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'forbidden' }, 403)))
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never)

    await expect(controller.loadEmployeeMemories('employee-buyer')).resolves.toBe(false)

    const state = controller.store.getSnapshot().staffMemories
    expect(state.phase).toBe('error')
    expect(state.error).toContain('403')
  })

  it('posts one review decision with the seen revision and reloads the view', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/review') ? jsonResponse(APPROVED_AGENT) : jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never)

    await expect(controller.reviewEmployeeMemory('employee-buyer', PROPOSED.id, 'approved', 1))
      .resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      `/enterprise/employees/employee-buyer/memories/${PROPOSED.id}/review`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          decision: 'approved', reason: 'reviewed in the employee workbench', revision: 1,
        }),
      })
    expect(controller.store.getSnapshot().staffMemories.phase).toBe('ready')
  })

  it('posts one retire with the seen revision and reloads the view', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/retire') ? jsonResponse(APPROVED_AGENT) : jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never)

    await expect(controller.retireEmployeeMemory('employee-buyer', APPROVED_AGENT.id, 1))
      .resolves.toBe(true)

    expect(fetchMock).toHaveBeenCalledWith(
      `/enterprise/employees/employee-buyer/memories/${APPROVED_AGENT.id}/retire`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ revision: 1 }),
      })
    expect(controller.store.getSnapshot().staffMemories.phase).toBe('ready')
  })

  it('keeps a failed review contained in the slice', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'memory-conflict' }, 409)))
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never)

    await expect(controller.reviewEmployeeMemory('employee-buyer', PROPOSED.id, 'rejected', 1))
      .resolves.toBe(false)

    const state = controller.store.getSnapshot().staffMemories
    expect(state.phase).toBe('error')
    expect(state.error).toBe('employee memory review failed (409)')
  })

  it('names the retire in a failed retire error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'memory-conflict' }, 409)))
    const controller = new EnterpriseWorkbenchController({} as never, {} as never, {} as never)

    await expect(controller.retireEmployeeMemory('employee-buyer', APPROVED_AGENT.id, 1))
      .resolves.toBe(false)

    const state = controller.store.getSnapshot().staffMemories
    expect(state.phase).toBe('error')
    expect(state.error).toBe('employee memory retire failed (409)')
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

  it('loads the selected employee memory view once on mount', async () => {
    const loadEmployeeMemories = vi.fn(() => Promise.resolve(true))
    render(createElement(EmployeeDirectory, directoryProps({
      staff: staff({ ...READY_STAFF, selected: BUYER }), loadEmployeeMemories,
    })))

    await waitFor(() => { expect(loadEmployeeMemories).toHaveBeenCalledWith('employee-buyer') })
  })

  it('shows the detail fields with the memory dots and the dm entry as the only primary button', () => {
    const { container } = render(createElement(EmployeeDirectory, directoryProps({
      staff: staff({ ...READY_STAFF, selected: BUYER }),
      memories: memories({ phase: 'ready', entries: [PROPOSED, APPROVED_AGENT] }),
    })))

    expect(screen.getByRole('article', { name: '采购协调员详情' })).toBeDefined()
    expect(screen.getByText(`角色卡：${BUYER.roleCard}`)).toBeDefined()
    expect(screen.getByRole('img', { name: '组织：0' })).toBeDefined()
    expect(screen.getByRole('img', { name: '部门：0' })).toBeDefined()
    expect(screen.getByRole('img', { name: '私有：1' })).toBeDefined()
    expect(screen.getByRole('img', { name: '待审：1' })).toBeDefined()
    expect(screen.getByPlaceholderText(`给${BUYER.displayName}写消息…`)).toBeDefined()
    expect(screen.getByRole('button', { name: zh['staff.back'] })).toBeDefined()
    const primaryButtons = container.querySelectorAll('[class*="primaryButton"]')
    expect(primaryButtons.length).toBe(1)
    expect(primaryButtons[0]?.getAttribute('type')).toBe('submit')
  })

  it('renders review buttons only on proposed rows and retire only on approved private rows', () => {
    render(createElement(EmployeeDirectory, directoryProps({
      staff: staff({ ...READY_STAFF, selected: BUYER }),
      memories: memories({
        phase: 'ready',
        entries: [PROPOSED, APPROVED_AGENT, APPROVED_SHARED],
      }),
    })))

    expect(screen.getByRole('button', { name: `批准记忆提案：${PROPOSED.summary}` })).toBeDefined()
    expect(screen.getByRole('button', { name: `拒绝记忆提案：${PROPOSED.summary}` })).toBeDefined()
    expect(screen.getByRole('button', { name: `下线记忆：${APPROVED_AGENT.summary}` })).toBeDefined()
    // The approved shared row shows neither review nor retire controls.
    expect(screen.getAllByRole('button', { name: /记忆提案：/ }).length).toBe(2)
    expect(screen.getAllByRole('button', { name: /下线记忆：/ }).length).toBe(1)
    expect(screen.getByText(zh['staff.memoryStatus.proposed'])).toBeDefined()
    expect(screen.getAllByText(zh['staff.memoryStatus.approved']).length).toBe(2)
  })

  it('clicking approve and retire forwards the employee, memory, and seen revision', async () => {
    const reviewEmployeeMemory = vi.fn(() => Promise.resolve(true))
    const retireEmployeeMemory = vi.fn(() => Promise.resolve(true))
    render(createElement(EmployeeDirectory, directoryProps({
      staff: staff({ ...READY_STAFF, selected: BUYER }),
      memories: memories({ phase: 'ready', entries: [PROPOSED, APPROVED_AGENT] }),
      reviewEmployeeMemory,
      retireEmployeeMemory,
    })))

    fireEvent.click(screen.getByRole('button', { name: `批准记忆提案：${PROPOSED.summary}` }))
    fireEvent.click(screen.getByRole('button', { name: `下线记忆：${APPROVED_AGENT.summary}` }))

    await waitFor(() => {
      expect(reviewEmployeeMemory).toHaveBeenCalledWith('employee-buyer', PROPOSED.id, 'approved', 1)
    })
    await waitFor(() => {
      expect(retireEmployeeMemory).toHaveBeenCalledWith('employee-buyer', APPROVED_AGENT.id, 1)
    })
  })

  it('shows the contained empty and memory error states', async () => {
    const loadEmployeeMemories = vi.fn(() => Promise.resolve(true))
    const { rerender } = render(createElement(EmployeeDirectory, directoryProps({
      staff: staff({ ...READY_STAFF, selected: BUYER }),
      memories: memories({ phase: 'loading' }),
      loadEmployeeMemories,
    })))
    expect(screen.getByText(zh['staff.memoryLoading'])).toBeDefined()

    rerender(createElement(EmployeeDirectory, directoryProps({
      staff: staff({ ...READY_STAFF, selected: BUYER }),
      memories: memories({ phase: 'ready', entries: [] }),
      loadEmployeeMemories,
    })))
    expect(screen.getByText(zh['staff.memoryEmpty'])).toBeDefined()

    rerender(createElement(EmployeeDirectory, directoryProps({
      staff: staff({ ...READY_STAFF, selected: BUYER }),
      memories: memories({ phase: 'error', error: 'employee memory request failed (403)' }),
      loadEmployeeMemories,
    })))
    expect(screen.getByText(zh['staff.memoryLoadError'])).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: zh.retry }))
    expect(loadEmployeeMemories).toHaveBeenCalledTimes(2)
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
