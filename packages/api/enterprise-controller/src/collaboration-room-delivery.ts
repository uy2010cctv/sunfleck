/** Bounded, source-labelled room context for native employee Sessions. */
import type { RoomEvent } from '@deepseek-ai/dsh-enterprise-postgres'

/** Compose bounded room delivery instructions and authorized, signed events for native user history.
 * @param roomName - Current room name.
 * @param events - Recent events in ascending sequence order.
 * @param current - Event that triggered this employee turn.
 * @param limits - Deployment-configured event and character ceilings.
 * @param names - Current authorized display names keyed by actor kind and id.
 * @returns One bounded native user message with source ids.
 */
export function roomPrompt(roomName: string, events: readonly RoomEvent[], current: RoomEvent,
  limits: { readonly characters: number; readonly events: number }, names: ReadonlyMap<string, string> = new Map()): string {
  if (!Number.isSafeInteger(limits.characters) || limits.characters < 500
    || !Number.isSafeInteger(limits.events) || limits.events < 1) throw new Error('invalid room context limits')
  const header = `Shared room: ${roomName.slice(0, 80)}\nRead these signed room events in order. Each [id] is an auditable source event. Reply in the room as yourself.\n`
    + 'For requested files, create them and call present with existing paths before your final reply for room members to open or download. '
    + 'Reply here; external messaging requires an explicit request.\n'
  const currentLine = line(current, names)
  const ceiling = limits.characters
  const tailBudget = ceiling - header.length - 2
  const latest = currentLine.length > tailBudget
    ? `${currentLine.slice(0, Math.max(0, tailBudget - 26))}… [current event truncated]`
    : currentLine
  const prior = events.filter(value => value.event.id !== current.event.id && value.event.kind === 9).slice(-limits.events)
  let lines = [latest]
  let omitted = events.length - 1 - prior.length
  for (let index = prior.length - 1; index >= 0; index--) {
    const candidate = prior[index]
    if (candidate === undefined) continue
    const rendered = line(candidate, names)
    if (`${header}Earlier room events omitted: ${omitted + index}.\n${[rendered, ...lines].join('\n')}`.length > ceiling) {
      omitted += index + 1
      break
    }
    lines = [rendered, ...lines]
  }
  const prefix = omitted > 0 ? `Earlier room events omitted: ${omitted}.\n` : ''
  const prompt = `${header}${prefix}${lines.join('\n')}`
  return prompt.length > ceiling ? prompt.slice(0, ceiling) : prompt
}

function line(value: RoomEvent, names: ReadonlyMap<string, string>): string {
  const root = value.threadRoot === undefined ? '' : ` thread:${value.threadRoot}`
  const identity = `${value.authorKind}:${value.authorId}`
  const author = names.get(identity)
  const attachments = value.event.tags.filter(tag => tag[0] === 'attachment')
    .map(([, id, name, mime, size]) => {
      const meta = [name, mime, size === undefined ? undefined : `${size} bytes`].filter(Boolean).join(' · ')
      return `attachment ${id}${meta === '' ? '' : ` (${meta})`}`
    })
  const files = attachments.length === 0 ? '' : ` [${attachments.join('; ')}]`
  return `[${value.event.id}] ${author === undefined ? identity : `${author} (${identity})`}${root}: ${value.event.content}${files}`
}

/** Select directly addressed Bots while preventing self-loops and hop chains.
 * @param post - Signed Bot post.
 * @param memberIds - Current room Bot membership.
 * @param employees - Published names for mention matching.
 * @param maxHops - Deployment-configured maximum Bot-to-Bot hops.
 * @returns Unique member ids eligible for another native turn.
 */
export function roomRecipients(post: RoomEvent, memberIds: readonly string[],
  employees: readonly { readonly employeeId: string; readonly displayName: string }[], maxHops: number): string[] {
  if (!Number.isSafeInteger(maxHops) || maxHops < 0) throw new Error('invalid room hop limit')
  if (post.authorKind !== 'employee') return []
  const hop = Number(post.event.tags.find(tag => tag[0] === 'dsh-hop')?.[1] ?? '0')
  if (!Number.isSafeInteger(hop) || hop >= maxHops) return []
  return employees.filter(employee => memberIds.includes(employee.employeeId) && employee.employeeId !== post.authorId
    && new RegExp(`@${escapeRegExp(employee.displayName)}(?=$|[\\s@\\p{P}\\p{S}])`, 'iu').test(post.event.content))
    .map(employee => employee.employeeId)
}

function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') }

/** Stable native source cursor for a projected Bot post.
 * @param sessionId - Native execution Session.
 * @param eventSeq - Durable assistant event sequence.
 * @returns Collision-resistant cursor scoped by Session identity.
 */
export function roomSourceCursor(sessionId: string, eventSeq: number): string { return `${sessionId}:${eventSeq}` }

/** Minimal native records needed to project one finished turn into the room. */
export type RoomTurnEvent =
  | { readonly type: 'assistant/message'
    readonly seq: number
    readonly data: { readonly turn: number
      readonly message: { readonly content: readonly { readonly type: string
        readonly text?: string }[] } } }
  | { readonly type: 'turn/end'
    readonly seq: number
    readonly data: { readonly turn: number
      readonly reason: { readonly kind: string } } }
  | { readonly type: 'turn/start'
    readonly seq: number
    readonly data: { readonly turn: number } }
  | { readonly type: 'user/message'
    readonly seq: number
    readonly data: { readonly source?: { readonly surfaceId?: string
      readonly rpcId?: string } } }

/** Select the last user-visible reply or one stable failure marker from a completed native turn.
 * @param events - Native assistant and turn-end records in sequence order.
 * @param turn - Completed turn number.
 * @returns Room post and unique native source sequence.
 */
export function roomTurnPost(events: readonly RoomTurnEvent[], turn: number): { text: string; sourceSeq: number } | undefined {
  const ending = events.findLast(event => event.type === 'turn/end' && event.data.turn === turn)
  if (ending?.type !== 'turn/end') return undefined
  const assistant = events.findLast(event => event.type === 'assistant/message' && event.data.turn === turn
    && event.data.message.content.some(block => block.type === 'text' && (block.text ?? '').trim() !== ''))
  if (assistant?.type === 'assistant/message') {
    const text = assistant.data.message.content.filter(block => block.type === 'text')
      .map(block => block.text ?? '').join('').trim()
    if (text !== '') return { text, sourceSeq: assistant.seq }
  }
  if (ending.data.reason.kind === 'error') {
    return { text: 'Employee execution failed. See the linked Session for details.', sourceSeq: ending.seq }
  }
  return undefined
}

/** Find signed room event IDs consumed by a native turn.
 * @param events - Native turn and user records in sequence order.
 * @param turn - Completed native turn.
 * @param surfaceId - Room bound to the native Session.
 * @returns Source ids to verify against the durable room log.
 */
export function roomTurnTriggers(events: readonly RoomTurnEvent[], turn: number, surfaceId: string): string[] {
  const start = events.findLast(event => event.type === 'turn/start' && event.data.turn === turn)
  const end = events.findLast(event => event.type === 'turn/end' && event.data.turn === turn)
  if (start === undefined || end === undefined) return []
  return events.filter(event => event.type === 'user/message' && event.seq > start.seq && event.seq < end.seq
    && event.data.source?.surfaceId === surfaceId && /^[0-9a-f]{64}$/u.test(event.data.source.rpcId ?? ''))
    .map(event => event.type === 'user/message' ? event.data.source?.rpcId ?? '' : '')
}

/** Exact published employee selection folded from a native Session log. */
export interface ReleasedRoomEmployee {
  readonly orgId: string
  readonly ownerUserId: string
  readonly employeeId: string
  readonly releaseId: string
}

/** Recover employee identity when a completed native Agent has left process memory.
 * @param events - Durable selected and cleared Session records in order.
 * @returns Latest active release selection, if present.
 */
export function releasedRoomEmployee(events: readonly (
  | { readonly type: 'enterprise-employee/selected'; readonly data: ReleasedRoomEmployee }
  | { readonly type: 'enterprise-employee/cleared'; readonly data: object }
)[]): ReleasedRoomEmployee | undefined {
  const latest = events.at(-1)
  return latest?.type === 'enterprise-employee/selected' ? latest.data : undefined
}

/** Native tool records with only the fields permitted in a room audit fact. */
export type RoomToolEvent =
  | { readonly type: 'tool/call'
    readonly seq: number
    readonly data: { readonly turn: number
      readonly callId: string
      readonly name: string } }
  | { readonly type: 'tool/result'
    readonly seq: number
    readonly data: { readonly turn: number
      readonly message: { readonly toolCallId: string
        readonly isError?: boolean }
      readonly error?: object } }

/** Render bounded tool activity without arguments, result blocks, metadata, or failure reasons.
 * @param events - Native call and result records in order.
 * @param target - Record being projected.
 * @returns Safe signed room fact and exact native source sequence.
 */
export function roomToolFact(events: readonly RoomToolEvent[], target: RoomToolEvent): {
  readonly content: string
  readonly sourceSeq: number
} | undefined {
  const call = target.type === 'tool/call' ? target : events.findLast(event => event.type === 'tool/call'
    && event.seq < target.seq && event.data.callId === target.data.message.toolCallId)
  if (call?.type !== 'tool/call') return undefined
  const name = call.data.name.replace(/\p{C}/gu, ' ').trim().slice(0, 80)
  if (name === '') return undefined
  const status = target.type === 'tool/call' ? 'started'
    : target.data.message.isError === true || target.data.error !== undefined ? 'failed' : 'succeeded'
  return { sourceSeq: target.seq, content: `Tool ${name} ${status}.` }
}
