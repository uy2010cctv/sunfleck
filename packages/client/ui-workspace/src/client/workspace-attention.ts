/** Root Workspace-tab reminder from the existing Session completion status. */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Aggregate unread completed turns from Sessions still shown by Workspace browsing.
 * @param statuses - Native Session completion reminders.
 * @param sessions - Current Host Session catalog.
 * @param hidden - Room execution Sessions classified out of Workspace browsing.
 * @returns Reactive presence of a Workspace completion reminder.
 */
export function workspaceCompletionAttention(
  statuses: HostObservable<SessionStatusSnapshot>,
  sessions: HostObservable<SessionListState>,
  hidden: HostObservable<ReadonlySet<SessionId>>,
): HostObservable<boolean> {
  return {
    getSnapshot: () => {
      const status = statuses.getSnapshot()
      const excluded = hidden.getSnapshot()
      return sessions.getSnapshot().ids.some(id => !excluded.has(id) && status.get(id)?.completionUnread === true)
    },
    subscribe: (listener) => {
      const releases = [statuses.subscribe(listener), sessions.subscribe(listener), hidden.subscribe(listener)]
      return () => { for (const release of releases) release() }
    },
  }
}
