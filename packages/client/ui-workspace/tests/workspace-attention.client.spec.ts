import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { workspaceCompletionAttention } from '../src/client/workspace-attention.ts'

const sessionId = SessionId('session-1')
const list = createSnapshotStore<SessionListState>({ ids: [sessionId], byId: {
  [sessionId]: { id: sessionId, displayTitle: 'Work', running: false, retainedBy: {}, blank: false, updatedAt: 1 },
}, phase: 'ready', projectionsBySession: {} })
const statuses = createSnapshotStore<SessionStatusSnapshot>(new Map())
const hidden = createSnapshotStore<ReadonlySet<SessionId>>(new Set())

describe('Workspace completion attention', () => {
  it('follows unread completion, hides room executions, and clears on Session read', () => {
    const attention = workspaceCompletionAttention(statuses, list, hidden)
    const changed = vi.fn()
    const stop = attention.subscribe(changed)
    expect(attention.getSnapshot()).toBe(false)
    statuses.set(new Map([[sessionId, { running: false, pendingInteraction: undefined, completionUnread: true }]]))
    expect(attention.getSnapshot()).toBe(true)
    hidden.set(new Set([sessionId]))
    expect(attention.getSnapshot()).toBe(false)
    hidden.set(new Set())
    statuses.set(new Map([[sessionId, { running: false, pendingInteraction: undefined, completionUnread: false }]]))
    expect(attention.getSnapshot()).toBe(false)
    expect(changed).toHaveBeenCalled()
    stop()
  })
})
