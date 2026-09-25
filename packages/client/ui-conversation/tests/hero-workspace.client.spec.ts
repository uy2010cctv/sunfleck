import { describe, expect, it } from 'vitest'
import type { WorkspaceSnapshot, WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { sessionWorkspaceForHero } from '../src/client/skeleton/ConversationContent.tsx'

describe('blank-session workspace label', () => {
  const workspace: WorkspaceSnapshot['items'][number] = {
    workspaceId: 'workspace-a' as WorkspaceId, path: '/managed/a', title: 'My workspace', sessionIds: [],
    createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z',
  }

  it('uses the canonical Session directory when membership has not appeared in the client list', () => {
    expect(sessionWorkspaceForHero('session-a', '/managed/a', [workspace])).toEqual(workspace)
  })

  it('does not invent a Workspace for a removed directory', () => {
    expect(sessionWorkspaceForHero('session-a', '/removed', [workspace])).toBeUndefined()
  })
})
