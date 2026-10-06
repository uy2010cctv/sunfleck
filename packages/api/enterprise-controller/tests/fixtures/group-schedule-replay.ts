/** Deterministic room transport for the recorded Schedule-source model interaction. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-schedule'
import type { RoomEvent } from '@deepseek-ai/dsh-enterprise-postgres'
import { installCollaborationAgentTools } from '../../src/collaboration-agent-tools.ts'

/** Services used by the ordinary room tools and their recorded native turn. */
export const inject = ['agents', 'tools', 'systemPrompt', 'sessions', 'sessionPersistence']

/** Mount the production room tools with a deterministic external-room transport.
 * @param ctx - Snapshot profile context.
 */
export function apply(ctx: Context): void {
  let posted: RoomEvent | undefined
  const room = { id: 'snapshot-room', orgId: 'snapshot-org', kind: 'group' as const,
    name: 'Review', workspaceId: 'snapshot-workspace', memberUserIds: ['owner'],
    memberEmployeeIds: ['writer', 'reviewer'], dutyEmployeeIds: [] }
  installCollaborationAgentTools(ctx, {
    maxHops: 2, groupSchedules: () => true,
    resolveAgentRoom: async () => ({ room, employeeId: 'writer' }),
    memberEmployees: async () => [{ employeeId: 'writer', displayName: 'Writer' },
      { employeeId: 'reviewer', displayName: 'Reviewer' }],
    roomEvents: {
      append: async (input) => { posted = { ...input, sequence: '1' }; return posted },
      findByRequest: async () => posted,
      getByEventId: async () => undefined,
      ensureTaskOwner: async () => 'writer',
      transferOwner: async () => false,
    },
    identity: { signEmployee: async (_actor, _room, input) => {
      if (input.type !== 'text' || input.sourceCursor === undefined || input.hop === undefined) {
        throw new Error('snapshot expects a source-labelled room post')
      }
      return { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128),
        created_at: 0, kind: 9, content: input.content,
        tags: [['h', room.id], ['dsh-source', input.sourceCursor],
          ['dsh-hop', String(input.hop)], ['dsh-schedule']] }
    } },
    dispatchEmployeePost: async () => [{ sessionId: 'review-session', employeeId: 'reviewer' }],
  })
  ctx.on('agent/pre-step', async (_proposal, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    return { ...decision, messages: decision.messages.map(message => message.source.kind === 'user'
      ? { ...message, source: { kind: 'schedule' as const } } : message) }
  })
}
