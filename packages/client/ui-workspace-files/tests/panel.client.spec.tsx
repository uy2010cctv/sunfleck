// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '../src/client/index.ts'
import { WorkspaceFilesPanel, type WorkspaceFilesPanelProps } from '../src/client/WorkspaceFilesPanel.tsx'

afterEach(cleanup)

it('loads the main-view Session workspace rather than the first catalog row', async () => {
  const other = 'other' as SessionId
  const selected = 'selected' as SessionId
  const state: SessionListState = {
    ids: [other, selected], phase: 'ready', projectionsBySession: {},
    byId: {
      [other]: { id: other, displayTitle: 'Other', cwd: '/other', running: false, blank: false, updatedAt: 0, retainedBy: {} },
      [selected]: { id: selected, displayTitle: 'Selected', cwd: '/selected', running: false, blank: false, updatedAt: 0, retainedBy: { mainView: 1 } },
    },
  }
  const listLevel = vi.fn().mockResolvedValue([])
  const props = {
    useWorkspaceFiles: selector => selector({ open: true }),
    useSessions: selector => selector(state),
    close: vi.fn(), listLevel, t: key => key,
  } satisfies Pick<WorkspaceFilesPanelProps, 'useWorkspaceFiles' | 'useSessions' | 'close' | 'listLevel' | 't'>
  render(<WorkspaceFilesPanel {...props as WorkspaceFilesPanelProps} />)
  await waitFor(() => expect(listLevel).toHaveBeenCalledWith(selected, '', expect.any(AbortSignal)))
  expect(screen.getByText('selected · /selected')).toBeTruthy()
})
