// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TabId } from '@deepseek-ai/dsh-client-ui-dockkit'
import { SidebarSessionView } from '../src/client/session-view.ts'
import { SidebarSessionViews } from '../src/client/session-views.ts'

const A = 'a' as SessionId
const B = 'b' as SessionId
const TAB = 'tab' as TabId
const runtimes: SlotTestRuntime[] = []
const owners: { dispose(): void }[] = []

afterEach(async () => {
  for (const owner of owners.splice(0)) owner.dispose()
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  vi.restoreAllMocks()
})

async function runtime() {
  const runtime = await SlotTestRuntime.create()
  runtimes.push(runtime)
  await runtime.sessions.add({ id: A })
  await runtime.sessions.add({ id: B })
  return runtime
}

it('keeps one reference per View until the final committed root of a retired View unmounts', async () => {
  const r = await runtime()
  const disposed = vi.fn()
  const changed = vi.fn()
  const view = new SidebarSessionView(A, r.sessions, disposed, changed)
  owners.push(view)
  await view.reference.ready
  const release = vi.spyOn(view.reference, 'release')
  const firstMount = view.mount()
  const secondMount = view.mount()
  const first = new AbortController()
  const second = new AbortController()
  const firstHold = view.retainTab(TAB, first.signal)
  const secondHold = view.retainTab(TAB, second.signal)
  firstHold()
  firstHold()
  expect(view.hasRetainedTabs).toBe(true)
  expect(changed).toHaveBeenCalledOnce()
  second.abort()
  secondHold()
  expect(view.hasRetainedTabs).toBe(false)
  view.retainTab(TAB, second.signal)()
  view.retire()
  firstMount()
  expect(release).not.toHaveBeenCalled()
  secondMount()
  expect(release).toHaveBeenCalledOnce()
  view.retainTab(TAB, first.signal)()
  view.dispose()
  expect(disposed).toHaveBeenCalledExactlyOnceWith(view)
})

it('retires only unselected Views without retained bodies and rejects released reference identities', async () => {
  const r = await runtime()
  const views = new SidebarSessionViews(r.sessions)
  owners.push(views)
  views.select(A)
  const first = views.source.getSnapshot()
  const a = first[0]!
  views.select(A)
  expect(views.source.getSnapshot()).toBe(first)
  const unmount = views.mount(a.reference)
  const lifetime = new AbortController()
  const release = vi.spyOn(a.reference, 'release')
  a.retainTab(TAB, lifetime.signal)
  views.select(B)
  expect(views.source.getSnapshot().map(view => [view.sessionId, view.selected])).toEqual([[A, false], [B, true]])
  lifetime.abort()
  expect(views.source.getSnapshot().map(view => view.sessionId)).toEqual([B])
  expect(release).not.toHaveBeenCalled()
  unmount()
  expect(release).toHaveBeenCalledOnce()
  expect(() => views.mount(a.reference)).toThrow('no longer owned')
  views.select(undefined)
  expect(views.source.getSnapshot()).toEqual([])
  views.dispose()
  views.select(A)
  views.mount(a.reference)()
  expect(views.source.getSnapshot()).toEqual([])
})

it('reports opening failure and releases Views even when committed roots are still present', async () => {
  const r = await runtime()
  const reference = r.sessions.retain(A, { source: 'sidebarView' })
  const failure = new Error('opening failed')
  const release = vi.fn(() => { reference.release() })
  vi.spyOn(r.sessions, 'retain').mockReturnValueOnce({
    sessionId: reference.sessionId,
    get binding() { return reference.binding },
    ready: Promise.reject(failure),
    release,
    [Symbol.dispose]: () => { reference.release() },
  })
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const views = new SidebarSessionViews(r.sessions)
  owners.push(views)
  views.select(A)
  const view = views.source.getSnapshot()[0]!
  const unmount = views.mount(view.reference)
  await expect(view.reference.ready).rejects.toBe(failure)
  expect(error).toHaveBeenCalledWith('Sidebar Session opening failed:', failure)
  views.dispose()
  expect(release).toHaveBeenCalledOnce()
  unmount()
  expect(release).toHaveBeenCalledOnce()
})

it('releases an explicit source view after its final root leaves and preserves the main view', async () => {
  const r = await runtime()
  const views = new SidebarSessionViews(r.sessions)
  owners.push(views)
  views.select(A)
  const main = views.source.getSnapshot()[0]!
  const panel = 'enterprise-collaboration' as MainPanelId
  views.showPreview(B, panel)
  const source = views.source.getSnapshot().find(view => view.sessionId === B)!
  const unmount = views.mount(source.reference)
  const release = vi.spyOn(source.reference, 'release')
  expect(source.selected).toBe(true)
  expect(source.previewPanelId).toBe(panel)
  expect(views.changePanel(panel)).toBe(false)
  views.clearPreview()
  expect(views.source.getSnapshot()).toEqual([{ ...main, selected: true }])
  expect(release).not.toHaveBeenCalled()
  unmount()
  expect(release).toHaveBeenCalledOnce()
})

it('retains an initialized source body after panel exit until its occurrence closes', async () => {
  const r = await runtime()
  const views = new SidebarSessionViews(r.sessions)
  owners.push(views)
  views.showPreview(B, 'enterprise-collaboration' as MainPanelId)
  const source = views.source.getSnapshot()[0]!
  const lifetime = new AbortController()
  source.retainTab(TAB, lifetime.signal)
  const release = vi.spyOn(source.reference, 'release')
  expect(views.changePanel(null)).toBe(true)
  expect(views.source.getSnapshot()[0]?.selected).toBe(false)
  expect(views.source.getSnapshot()[0]?.previewPanelId).toBeUndefined()
  expect(release).not.toHaveBeenCalled()
  lifetime.abort()
  expect(views.source.getSnapshot()).toEqual([])
  expect(release).toHaveBeenCalledOnce()
})
