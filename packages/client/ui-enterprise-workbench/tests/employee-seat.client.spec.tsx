// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EmployeeSeat } from '../src/client/EmployeeSeat.tsx'
import { zh } from '../src/client/locales.ts'

describe('new-session employee picker', () => {
  it('keeps the selected employee and pinned release version after a work-mode switch', async () => {
    let notify = () => {}
    const select = vi.fn(async () => 3)
    const props = {
      sessionId: 'session-a',
      load: async () => ({
        employees: [{ id: 'employee-a', kind: 'employee', name: '采购员', isDefault: false,
          employee: { position: '采购执行', releaseVersion: 3 } }], selectedId: 'employee-a', selectedVersion: 2,
        unavailable: false,
      }),
      select,
      currentEmployee: () => ({ employeeId: 'employee-a', releaseVersion: 2 }),
      subscribe: (listener: () => void) => { notify = listener; return () => {} },
      t: (key: keyof typeof zh, params?: { version?: number }) => zh[key].replace('{version}', String(params?.version ?? '')),
    } as unknown as Parameters<typeof EmployeeSeat>[0]
    render(<EmployeeSeat {...props} />)
    expect(await screen.findByRole('button', { name: /采购员 · 版本 2/ })).toBeDefined()
    // The anchor and each option carry the roster avatar; without a profile
    // seed the employee id seeds the same face as the roster card.
    const anchor = screen.getByRole('button', { name: /采购员 · 版本 2/ })
    expect(anchor.querySelector('img')?.getAttribute('src')).toContain('employee-a')
    fireEvent.click(anchor)
    expect(await screen.findByText(/版本 3/)).toBeDefined()
    const srcs = [...document.querySelectorAll('img')].map(node => node.getAttribute('src'))
    expect(srcs.filter(src => src?.includes('employee-a'))).toHaveLength(2)
    act(() => { notify() })
    expect(screen.getByRole('button', { name: /采购员 · 版本 2/ })).toBeDefined()
  })
})
