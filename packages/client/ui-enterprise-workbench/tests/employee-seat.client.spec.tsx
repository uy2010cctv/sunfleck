// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EmployeeSeat } from '../src/client/EmployeeSeat.tsx'
import { zh } from '../src/client/locales.ts'

describe('new-session employee picker', () => {
  it('shows an authorized release separately and clears its label after a work-mode switch', async () => {
    let preset = 'employee-a'
    let notify = () => {}
    const select = vi.fn(async () => {})
    const props = {
      sessionId: 'session-a',
      load: async () => ({
        employees: [{ id: 'employee-a', kind: 'employee', name: '采购员', isDefault: false,
          employee: { position: '采购执行', releaseVersion: 3 } }], selectedId: 'employee-a', unavailable: false,
      }),
      select,
      currentPreset: () => preset,
      subscribe: (listener: () => void) => { notify = listener; return () => {} },
      t: (key: keyof typeof zh, params?: { version?: number }) => zh[key].replace('{version}', String(params?.version ?? '')),
    } as unknown as Parameters<typeof EmployeeSeat>[0]
    render(<EmployeeSeat {...props} />)
    expect(await screen.findByRole('button', { name: /采购员/ })).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /采购员/ }))
    expect(await screen.findByText(/版本 3/)).toBeDefined()
    preset = 'standard'
    act(() => { notify() })
    expect(screen.getByRole('button', { name: /数字员工/ })).toBeDefined()
  })
})
