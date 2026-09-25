/** Honest author attribution for native TeamRun records projected into a shared room. */

/** Pinned employee identity for one durable Team member Session. */
export interface TeamRoomMember {
  readonly sessionId: string
  readonly employeeId: string
  readonly name: string
}

/** Native Team record fields required to render a room fact. */
export type TeamRoomRecord =
  | { readonly type: 'team/message/queued'
    readonly seq: number
    readonly data: { readonly message: { readonly senderId: string
      readonly targetId: string
      readonly senderName: string
      readonly content: readonly { readonly type: string
        readonly text?: string }[] } } }
  | { readonly type: 'team/task'
    readonly seq: number
    readonly data: { readonly task: { readonly id: string
      readonly subject: string
      readonly status: string
      readonly ownerId?: string } } }
  | { readonly type: 'team/decision'
    readonly seq: number
    readonly data: { readonly decision: { readonly question: string
      readonly state: string
      readonly answer?: string
      readonly respondedBy?: { readonly userId: string
        readonly displayName: string } } } }
  | { readonly type: 'team/run'
    readonly seq: number
    readonly data: { readonly run: { readonly state: string } } }

/** Signed room projection with an author supported by the native record. */
export interface TeamRoomFact {
  readonly kind: 'text' | 'workflow'
  readonly authorKind: 'employee' | 'human' | 'service'
  readonly authorId: string
  readonly sourceSeq: number
  readonly content: string
}

/** Render a Team fact without attributing a task mutation to its assignee.
 * @param event - Durable native Team event.
 * @param roster - Earlier pinned employee members in this TeamRun.
 * @returns A room fact, or no fact when the actor cannot be resolved.
 */
export function projectTeamRoomFact(event: TeamRoomRecord, roster: readonly TeamRoomMember[]): TeamRoomFact | undefined {
  switch (event.type) {
    case 'team/message/queued': {
      const sender = roster.find(member => member.sessionId === event.data.message.senderId)
      if (sender === undefined) return undefined
      const recipient = roster.find(member => member.sessionId === event.data.message.targetId)
      const text = event.data.message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('').trim()
      if (text === '') return undefined
      return { kind: 'text', authorKind: 'employee', authorId: sender.employeeId, sourceSeq: event.seq,
        content: `To ${recipient?.name ?? event.data.message.targetId}: ${text}` }
    }
    case 'team/task': {
      const task = event.data.task
      const owner = roster.find(member => member.sessionId === task.ownerId)?.name
      return { kind: 'workflow', authorKind: 'service', authorId: 'team', sourceSeq: event.seq,
        content: `Task ${task.subject}: ${task.status}${owner === undefined ? '.' : `; owner ${owner}.`}` }
    }
    case 'team/decision': {
      const decision = event.data.decision
      const human = decision.state === 'answered' ? decision.respondedBy : undefined
      return { kind: 'workflow', authorKind: human === undefined ? 'service' : 'human',
        authorId: human?.userId ?? 'team', sourceSeq: event.seq,
        content: `Decision ${decision.question}: ${decision.answer ?? decision.state}.` }
    }
    case 'team/run': return { kind: 'workflow', authorKind: 'service', authorId: 'team',
      sourceSeq: event.seq, content: `Team run: ${event.data.run.state}.` }
  }
}

/** Minimal durable input records that identify a teammate's consumed peer message. */
export type TeamTurnSourceRecord =
  | { readonly type: 'turn/start' | 'turn/end'
    readonly seq: number
    readonly data: { readonly turn: number } }
  | { readonly type: 'user/message'
    readonly seq: number
    readonly data: { readonly source: { readonly kind: string
      readonly messageId?: string } } }

/** Pair one teammate turn with queued Team message ids that it actually consumed.
 * @param records - Native teammate Session records in sequence order.
 * @param turn - Completed turn number.
 * @returns Peer message ids to verify against the Lead Session's queue events.
 */
export function teamTurnSourceIds(records: readonly TeamTurnSourceRecord[], turn: number): string[] {
  const start = records.findLast(record => record.type === 'turn/start' && record.data.turn === turn)
  const end = records.findLast(record => record.type === 'turn/end' && record.data.turn === turn)
  if (start === undefined || end === undefined) return []
  return records.filter(record => record.type === 'user/message' && record.seq > start.seq && record.seq < end.seq
    && record.data.source.kind === 'team-message' && record.data.source.messageId !== undefined)
    .map(record => record.type === 'user/message' ? record.data.source.messageId ?? '' : '')
}
