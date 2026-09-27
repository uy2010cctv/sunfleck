// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionContextController, type ContextMemoryScope } from '../src/client/session-context-store.ts'
import { CollaborationController } from '../src/client/collaboration-store.ts'
import { SessionContextDetails, NativeSessionDetailsAction } from '../src/client/SessionContextDetails.tsx'
import { zh } from '../src/client/collaboration-details-locales.ts'
afterEach(cleanup)
function props() {
  const contextController = new SessionContextController(vi.fn())
  const scopes: ContextMemoryScope[] = ['organization', 'department', 'project', 'agent', 'pair']
  contextController.state.set({ sessionId: 'current', phase: 'ready', context: {
    employee: { id: 'hidden-id', displayName: '采购员', role: '采购', capabilities: ['采购查询'], releaseVersion: 2 },
    project: { id: 'project-hidden', name: '秋季采购', goal: '按时备货', state: 'active' }, memoryAvailable: true,
    memories: scopes.map((scope, index) => ({ id: `${index}`, scope, summary: `memory-${scope}`, status: 'approved', createdAt: 0, revision: 1 })),
  } })
  return { contextController, sessionId: 'current', t: (key: keyof typeof zh) => zh[key] }
}
function actionProps(employee: Record<string, unknown> | undefined, project = true) {
  const contextController = new SessionContextController(vi.fn())
  contextController.state.set({ sessionId: 'current', phase: 'ready', context: {
    ...(employee === undefined ? {} : { employee: employee as never }),
    ...(project ? { project: { id: 'p', name: '秋季采购', goal: '按时备货', state: 'active' } } : {}),
    memories: [], memoryAvailable: true,
  } })
  const controller = new CollaborationController(vi.fn(), vi.fn(), vi.fn())
  return { contextController, controller, sessionId: 'current', t: (key: keyof typeof zh) => zh[key], openDetails: vi.fn() }
}
describe('authorized Session memory scopes', () => {
  it('filters each of the five scopes without exposing IDs or review controls', () => {
    const view = render(<SessionContextDetails {...props()} />)
    expect(screen.getByText('采购查询')).toBeTruthy()
    for (const scope of ['organization', 'department', 'project', 'agent', 'pair']) {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: scope } })
      expect(screen.getByText(`memory-${scope}`)).toBeTruthy()
      expect(view.container.querySelectorAll('li')).toHaveLength(2)
    }
    expect(view.container.textContent).not.toContain('hidden')
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('shows no previous Session data while a different Session is selected', () => {
    const view = render(<SessionContextDetails {...props()} sessionId="different" />)
    expect(view.container.textContent).not.toContain('采购员')
    expect(view.container.textContent).not.toContain('memory-')
  })
  it('presents the pinned employee as an avatar with its name and opens the details on click', () => {
    const props = actionProps({ id: 'employee-a', displayName: '采购员', role: '采购', capabilities: [], avatarSeed: 'seed-a' })
    const view = render(<NativeSessionDetailsAction {...props} />)
    expect(screen.getByText('采购员')).toBeTruthy()
    expect(screen.queryByText(zh.title)).toBeNull()
    expect(view.container.querySelector('img')?.getAttribute('src')).toContain('seed-a')
    fireEvent.click(screen.getByRole('button'))
    expect(props.openDetails).toHaveBeenCalledOnce()
  })
  it('renders the roster avatar for a bound employee with or without a profile seed, and the generic icon for projects only', () => {
    const seeded = render(<NativeSessionDetailsAction {...actionProps({ id: 'employee-a', displayName: '采购员', role: '采购', capabilities: [], avatarSeed: 'seed-a' })} />)
    expect(screen.getByText('采购员')).toBeTruthy()
    expect(seeded.container.querySelector('img')?.getAttribute('src')).toContain('seed-a')
    cleanup()
    const unseeded = render(<NativeSessionDetailsAction {...actionProps({ id: 'employee-a', displayName: '采购员', role: '采购', capabilities: [] })} />)
    // Without a profile seed the employee id seeds the same roster avatar.
    expect(unseeded.container.querySelector('img')?.getAttribute('src')).toContain('employee-a')
    cleanup()
    const projectOnly = render(<NativeSessionDetailsAction {...actionProps(undefined)} />)
    expect(projectOnly.container.querySelector('img')).toBeNull()
    expect(screen.getByText(zh.title)).toBeTruthy()
    expect(screen.queryByText('采购员')).toBeNull()
  })
})
