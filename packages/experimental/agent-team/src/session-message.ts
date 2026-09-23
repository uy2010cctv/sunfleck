/** Durable Session-message acceptance checks shared by provisioning and mailbox recovery. */

import { pendingInboxMessages } from '@deepseek-ai/dsh-agent-loop/inbox'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Test whether one message is model-visible or still durably pending.
 * @param events - one Session's non-inherited event suffix.
 * @param predicate - identity check for the accepted message.
 * @returns whether history or the current inbox contains a match.
 */
export function messageAccepted(
  events: readonly SessionEvent[],
  predicate: (message: UserMessage) => boolean,
): boolean {
  return events.some(event => event.type === 'user/message' && predicate(event.data))
    || pendingInboxMessages(events).some(predicate)
}
