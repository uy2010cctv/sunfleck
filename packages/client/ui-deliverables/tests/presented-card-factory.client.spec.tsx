// @vitest-environment jsdom
/** Shared cards retain source Session preview and authenticated file action coordinates. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { PresentedCardFactory } from '../src/client/PresentedCardFactory.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

it('previews the source Session file and independently exposes its authenticated actions', () => {
  const preview = vi.fn()
  const open = vi.fn().mockResolvedValue(null)
  const renderSlot = vi.fn((_name: string, owner: { downloadUrl?: string; available: boolean; pending: boolean; onAction: (action: 'open') => Promise<unknown> }) => <>
    <a href={owner.downloadUrl}>Download</a>
    {owner.available && <button disabled={owner.pending} onClick={() => { void owner.onAction('open') }}>Open</button>}
  </>)
  const props = {
    sessionId: SessionId('source-session'),
    file: { path: 'out/report.pdf', seq: 9, index: 2, description: 'Final report' },
    downloadUrl: '/api/present.download?sessionId=source-session&seq=9&index=2',
    useSessions: (select: (state: { byId: Record<string, { cwd: string }> }) => unknown) => select({ byId: { 'source-session': { cwd: '/work/source' } } }),
    usePresentedOpen: (select: (state: object) => unknown) => select({}),
    usePresentedHost: (select: (state: object | string) => unknown) => select({ name: 'desktop', available: true, fileManager: 'finder' }),
    reloadPresentedHost: vi.fn(), openPresented: open, openPreview: preview, renderSlot,
    t: makeTranslate(en),
  }
  const view = render(<PresentedCardFactory {...props as Parameters<typeof PresentedCardFactory>[0]} />)
  fireEvent.click(view.getByRole('button', { name: 'Preview out/report.pdf in sidebar' }))
  expect(preview).toHaveBeenCalledWith('source-session', '/work/source', 'out/report.pdf')
  expect(renderSlot).toHaveBeenCalledWith('deliverables.presented-card.actions', expect.objectContaining({
    actionUrl: 'api/present.open?sessionId=source-session&seq=9&index=2', downloadUrl: props.downloadUrl,
  }))
  fireEvent.click(view.getByRole('button', { name: 'Open' }))
  expect(open).toHaveBeenCalledWith('source-session', 9, 2, 'open', undefined)
  expect(view.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe(props.downloadUrl)
  expect(preview).toHaveBeenCalledOnce()
  props.usePresentedOpen = select => select({ 'api/present.open?sessionId=source-session&seq=9&index=2': 'opening' })
  view.rerender(<PresentedCardFactory {...props as Parameters<typeof PresentedCardFactory>[0]} />)
  expect(view.getByRole('button', { name: 'Open' }).hasAttribute('disabled')).toBe(true)
  props.usePresentedHost = select => select('error')
  view.rerender(<PresentedCardFactory {...props as Parameters<typeof PresentedCardFactory>[0]} />)
  expect(view.queryByRole('button', { name: 'Open' })).toBeNull()
  expect(view.getByRole('link', { name: 'Download' }).getAttribute('href')).toBe(props.downloadUrl)
  fireEvent.click(view.getByRole('button', { name: 'Retry' }))
  expect(props.reloadPresentedHost).toHaveBeenCalledOnce()
})
