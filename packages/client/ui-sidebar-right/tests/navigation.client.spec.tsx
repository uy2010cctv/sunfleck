// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { RightbarRoot } from '../src/client/shell/RightbarRoot.tsx'
import { SidebarRightNavigationRegistry } from '../src/client/navigation-registry.ts'

afterEach(cleanup)

it('shows root navigation without a Session and switches its keyed content with the keyboard', () => {
  const registry = new SidebarRightNavigationRegistry()
  registry.register({ id: 'workspace', order: 100, title: () => 'Workspace', icon: () => <span>W</span> })
  registry.register({ id: 'group', order: 200, title: () => 'Groups', icon: () => <span>G</span> })
  registry.register({ id: 'channel', order: 300, title: () => 'Channels', icon: () => <span>C</span> })
  const renderSlot = vi.fn((name: string, _owner: unknown, options: { entryKey?: string }) => <p>{`${name}:${options.entryKey}`}</p>)
  const props = {
    width: 320, viewportWidth: 1200, canShow: true,
    usePanelInfo: (selector: (value: { activePanelId: null }) => boolean) => selector({ activePanelId: null }),
    useViews: (selector: (value: readonly []) => readonly []) => selector([]),
    useNavigationTabs: (selector: (value: ReturnType<typeof registry.entries>) =>
    ReturnType<typeof registry.entries>) => selector(registry.entries()),
    renderSlot,
    SessionProvider: ({ children }: { children: React.ReactNode }) => children,
    mountView: vi.fn(() => vi.fn()),
    syncNavigationPresentation: vi.fn(),
    reportNavigationOcclusion: vi.fn(),
    t: (key: string) => key === 'navigation.label' ? 'Right sidebar' : key,
  } as unknown as Parameters<typeof RightbarRoot>[0]
  render(<RightbarRoot {...props} />)
  expect(screen.getByRole('tablist', { name: 'Right sidebar' })).toBeTruthy()
  expect(screen.getByText('sidebar.right.navigation.tab:workspace')).toBeTruthy()
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Workspace' }), { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: 'Groups' }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByText('sidebar.right.navigation.tab:group')).toBeTruthy()
})

it('publishes attention changes without replacing navigation registrations', () => {
  const registry = new SidebarRightNavigationRegistry()
  const attention = createSnapshotStore(false)
  registry.register({ id: 'workspace', title: () => 'Workspace', icon: () => <span>W</span>, attention })
  expect(registry.entries()[0]?.attention?.getSnapshot()).toBe(false)
  attention.set(true)
  expect(registry.entries()[0]?.attention?.getSnapshot()).toBe(true)
})

it('publishes committed narrow occlusion through the navigation service', () => {
  const registry = new SidebarRightNavigationRegistry()
  const states: boolean[] = []
  const release = registry.occludesMain.subscribe(() => { states.push(registry.occludesMain.getSnapshot()) })
  registry.reportOcclusion(true)
  registry.reportOcclusion(true)
  registry.reportOcclusion(false)
  release()
  expect(states).toEqual([true, false])
})

it('keeps navigation available while a room main panel is selected', () => {
  const registry = new SidebarRightNavigationRegistry()
  registry.register({ id: 'workspace', title: () => 'Workspace', icon: () => <span>W</span> })
  render(<RightbarRoot {...({
    width: 320, viewportWidth: 1200, canShow: true,
    usePanelInfo: (selector: (value: { activePanelId: string }) => boolean) => selector({ activePanelId: 'enterprise-collaboration' }),
    useViews: (selector: (value: readonly []) => readonly []) => selector([]),
    useNavigationTabs: (selector: (value: ReturnType<typeof registry.entries>) =>
    ReturnType<typeof registry.entries>) => selector(registry.entries()),
    renderSlot: (_name: string, _owner: unknown, options: { entryKey?: string }) => <p>{options.entryKey}</p>,
    SessionProvider: ({ children }: { children: React.ReactNode }) => children,
    mountView: vi.fn(() => vi.fn()), syncNavigationPresentation: vi.fn(), reportNavigationOcclusion: vi.fn(),
    t: (key: string) => key === 'navigation.label' ? 'Right sidebar' : key,
  } as unknown as Parameters<typeof RightbarRoot>[0])} />)
  expect(screen.getByRole('tablist', { name: 'Right sidebar' })).toBeTruthy()
  expect(screen.getByText('workspace')).toBeTruthy()
})

it('retains the selected Session detail subtree after choosing Workspace', () => {
  const registry = new SidebarRightNavigationRegistry()
  registry.register({ id: 'workspace', title: () => 'Workspace', icon: () => <span>W</span> })
  const view = { sessionId: 's1', selected: true, reference: {}, retainTab: () => vi.fn() }
  render(<RightbarRoot {...({
    width: 320, viewportWidth: 1200, canShow: true,
    usePanelInfo: (selector: (value: { activePanelId: null }) => boolean) => selector({ activePanelId: null }),
    useViews: (selector: (value: readonly [typeof view]) => readonly [typeof view]) => selector([view]),
    useNavigationTabs: (selector: (value: ReturnType<typeof registry.entries>) =>
    ReturnType<typeof registry.entries>) => selector(registry.entries()),
    renderSlot: (name: string) => <p>{name}</p>,
    SessionProvider: ({ children }: { children: React.ReactNode }) => children,
    mountView: vi.fn(() => vi.fn()), syncNavigationPresentation: vi.fn(), reportNavigationOcclusion: vi.fn(),
    t: (key: string) => key === 'navigation.label' ? 'Right sidebar' : key === 'navigation.session' ? 'Session' : key,
  } as unknown as Parameters<typeof RightbarRoot>[0])} />)
  const subtree = document.querySelector('[data-sidebar-right-session="s1"]') as HTMLElement
  expect(subtree.hidden).toBe(false)
  fireEvent.click(screen.getByRole('tab', { name: 'Workspace' }))
  expect(subtree.hidden).toBe(true)
  expect(subtree.textContent).toContain('rightbar.session')
  fireEvent.click(screen.getByRole('tab', { name: 'Session' }))
  expect(subtree.hidden).toBe(false)
})

it('collapses narrow navigation for a room and reopens it for another room on the same main panel', () => {
  const registry = new SidebarRightNavigationRegistry()
  registry.register({ id: 'group', title: () => 'Groups', icon: () => <span>G</span> })
  const renderSlot = (_name: string, owner: { closeNavigation: () => void }) =>
    <button type="button" onClick={owner.closeNavigation}>Choose room</button>
  render(<RightbarRoot {...({
    width: 320, viewportWidth: 600, canShow: true,
    usePanelInfo: (selector: (value: { activePanelId: string }) => boolean) => selector({ activePanelId: 'enterprise-collaboration' }),
    useViews: (selector: (value: readonly []) => readonly []) => selector([]),
    useNavigationTabs: (selector: (value: ReturnType<typeof registry.entries>) =>
    ReturnType<typeof registry.entries>) => selector(registry.entries()),
    renderSlot,
    SessionProvider: ({ children }: { children: React.ReactNode }) => children,
    mountView: vi.fn(() => vi.fn()), syncNavigationPresentation: vi.fn(), reportNavigationOcclusion: vi.fn(),
    t: (key: string) => key === 'navigation.reopen' ? 'Open right navigation' : key,
  } as unknown as Parameters<typeof RightbarRoot>[0])} />)
  expect(screen.queryByRole('tablist')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Open right navigation' }))
  expect(screen.getByRole('tab', { name: 'Groups' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Choose room' }))
  expect(screen.queryByRole('tablist')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Open right navigation' }))
  expect(screen.getByRole('tab', { name: 'Groups' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Choose room' }))
  expect(screen.queryByRole('tablist')).toBeNull()
})

it('collapses narrow navigation when a Session becomes selected', () => {
  const registry = new SidebarRightNavigationRegistry()
  registry.register({ id: 'workspace', title: () => 'Workspace', icon: () => <span>W</span> })
  const view = { sessionId: 's1', selected: true, reference: {}, retainTab: () => vi.fn() }
  let views: readonly typeof view[] = []
  const props = {
    width: 320, viewportWidth: 600, canShow: true,
    usePanelInfo: (selector: (value: { activePanelId: null }) => boolean) => selector({ activePanelId: null }),
    useViews: (selector: (value: readonly typeof view[]) => readonly typeof view[]) => selector(views),
    useNavigationTabs: (selector: (value: ReturnType<typeof registry.entries>) =>
    ReturnType<typeof registry.entries>) => selector(registry.entries()),
    renderSlot: (name: string) => <p>{name}</p>,
    SessionProvider: ({ children }: { children: React.ReactNode }) => children,
    mountView: vi.fn(() => vi.fn()), syncNavigationPresentation: vi.fn(), reportNavigationOcclusion: vi.fn(),
    t: (key: string) => key === 'navigation.reopen' ? 'Open right navigation' : key,
  } as unknown as Parameters<typeof RightbarRoot>[0]
  const result = render(<RightbarRoot {...props} />)
  expect(screen.getByRole('tablist')).toBeTruthy()
  views = [view]
  result.rerender(<RightbarRoot {...props} />)
  expect(screen.queryByRole('tablist')).toBeNull()
  expect(screen.getByRole('button', { name: 'Open right navigation' })).toBeTruthy()
})

it('reports when narrow root content occludes a room', () => {
  const registry = new SidebarRightNavigationRegistry()
  registry.register({ id: 'group', title: () => 'Groups', icon: () => <span>G</span> })
  const reportNavigationOcclusion = vi.fn()
  render(<RightbarRoot {...({
    width: 320, viewportWidth: 600, canShow: true,
    usePanelInfo: (selector: (value: { activePanelId: string }) => boolean) => selector({ activePanelId: 'enterprise-collaboration' }),
    useViews: (selector: (value: readonly []) => readonly []) => selector([]),
    useNavigationTabs: (selector: (value: ReturnType<typeof registry.entries>) =>
    ReturnType<typeof registry.entries>) => selector(registry.entries()),
    renderSlot: () => <p>Groups</p>,
    SessionProvider: ({ children }: { children: React.ReactNode }) => children,
    mountView: vi.fn(() => vi.fn()), syncNavigationPresentation: vi.fn(), reportNavigationOcclusion,
    t: (key: string) => key === 'navigation.reopen' ? 'Open right navigation' : key === 'navigation.close' ? 'Close right navigation' : key,
  } as unknown as Parameters<typeof RightbarRoot>[0])} />)
  expect(reportNavigationOcclusion).toHaveBeenLastCalledWith(false)
  fireEvent.click(screen.getByRole('button', { name: 'Open right navigation' }))
  expect(reportNavigationOcclusion).toHaveBeenLastCalledWith(true)
  fireEvent.click(screen.getByRole('button', { name: 'Close right navigation' }))
  expect(reportNavigationOcclusion).toHaveBeenLastCalledWith(false)
})
