// @vitest-environment jsdom
/** Pending-file factories preserve shared upload display and explicit owner gestures. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { PendingFileCard } from '../src/client/PendingFileCard.tsx'

afterEach(cleanup)

const t: PropsLocale<'conversation'>['t'] = (key, params) => {
  if (key === 'file.remove') return `Remove ${params?.name ?? ''}`
  if (key === 'file.retry') return `Retry ${params?.name ?? ''}`
  if (key === 'file.uploading') return 'Uploading'
  if (key === 'file.uploadFailed') return 'Upload failed'
  return key
}

it('shows uploaded file metadata and invokes remove without retrying', () => {
  const onRemove = vi.fn()
  const onRetry = vi.fn()
  const view = render(<PendingFileCard name="report.pdf" bytes={1024} state="ready" t={t}
    onRemove={onRemove} onRetry={onRetry} />)
  expect(view.getByText('report.pdf')).toBeTruthy()
  expect(view.getByText(/PDF.*1.*KB/)).toBeTruthy()
  expect(view.queryByRole('button', { name: 'Retry report.pdf' })).toBeNull()
  fireEvent.click(view.getByRole('button', { name: 'Remove report.pdf' }))
  expect(onRemove).toHaveBeenCalledOnce()
  expect(onRetry).not.toHaveBeenCalled()
})

it('renders owner upload states and keeps retry separate from remove', () => {
  const props = { name: 'draft.docx', bytes: 2, onRemove: vi.fn(), onRetry: vi.fn(), t }
  const view = render(<PendingFileCard {...props} state="uploading" progress={0.5} />)
  expect(view.getByText('Uploading')).toBeTruthy()
  expect(view.queryByRole('button', { name: 'Retry draft.docx' })).toBeNull()
  expect(view.container.querySelector('[style]')?.getAttribute('style')).toContain('50%')
  view.rerender(<PendingFileCard {...props} state="error" />)
  expect(view.getByText('Upload failed')).toBeTruthy()
  fireEvent.click(view.getByRole('button', { name: 'Retry draft.docx' }))
  expect(props.onRetry).toHaveBeenCalledOnce()
  expect(props.onRemove).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'Remove draft.docx' }))
  expect(props.onRemove).toHaveBeenCalledOnce()
})
