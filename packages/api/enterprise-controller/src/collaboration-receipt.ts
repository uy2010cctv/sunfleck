/** Durable native receipt lookup independent of TeamRun lifecycle. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { CollaborationSession } from '@deepseek-ai/dsh-enterprise-postgres'

/** Find a previously delivered request without starting or resuming an Agent.
 * @param bindings - Conversation's recorded native destinations.
 * @param request - Authenticated request attribution.
 * @param read - Async, bounded event reader for one native Session.
 * @returns The original target Session, including completed and waiting-human runs.
 */
export async function findCollaborationRequest(
  bindings: readonly CollaborationSession[],
  request: { readonly surfaceId: string; readonly actorUserId: string; readonly requestId: string },
  read: (sessionId: string) => AsyncIterable<SessionEvent>,
): Promise<string | undefined> {
  for (const binding of bindings) {
    if (binding.surfaceId !== request.surfaceId || binding.employeeId !== '') continue
    for await (const event of read(binding.sessionId)) {
      if (event.type !== 'user/message') continue
      const source = event.data.source
      if (source.kind === 'user' && 'rpcId' in source && source.rpcId === request.requestId
        && 'originSurfaceId' in source && source.originSurfaceId === request.surfaceId
        && 'actorUserId' in source && source.actorUserId === request.actorUserId) return binding.sessionId
    }
  }
  return undefined
}
