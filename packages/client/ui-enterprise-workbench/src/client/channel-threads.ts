/** Read-only channel thread projection over signed facts and persisted topic destinations. */
import type { CollaborationDetail, RoomEvent } from './collaboration-store.ts'

/**
 * Place historical unthreaded employee facts into their known topic thread.
 * @param events - authorized signed event page.
 * @param detail - persisted channel topics and native destinations.
 * @returns view records with inferred thread roots, leaving source records unchanged.
 */
export function channelThreadEvents(events: readonly RoomEvent[], detail: CollaborationDetail): readonly RoomEvent[] {
  if (detail.kind !== 'channel') return events
  const byId = new Map(events.map(event => [event.id, event]))
  const roots = new Map<string, string>()
  if (detail.topicPolicy === 'thread') {
    for (const topic of detail.topics) for (const destination of topic.destinations ?? []) {
      roots.set(destination.sessionId, topic.id)
    }
  }
  return events.map((event) => {
    if (event.kind === 7 || event.threadRoot !== undefined || event.author.kind !== 'employee') return event
    const referenced = event.tags.filter(tag => tag[0] === 'e').map(tag => tag[1])
      .flatMap(id => id === undefined ? [] : byId.get(id) ?? [])
      .find(source => source.kind === 9 && source.id !== event.id)
    const root = referenced === undefined
      ? event.sourceSessionId === undefined ? undefined : roots.get(event.sourceSessionId)
      : referenced.threadRoot ?? referenced.id
    return root === undefined || root === event.id ? event : { ...event, threadRoot: root }
  })
}

/** One displayed thread reply, retaining collapsed signed execution facts. */
export interface ThreadReplyItem {
  readonly event: RoomEvent
  readonly details: readonly RoomEvent[]
}

/**
 * Fold execution and follow-up facts between human replies into their employee's reply.
 * @param events - ordered signed replies excluding the root and reactions.
 * @returns human and employee replies with their auditable details.
 */
export function threadReplyItems(events: readonly RoomEvent[]): readonly ThreadReplyItem[] {
  const items: Array<{ event: RoomEvent; details: RoomEvent[] }> = []
  const active = new Map<string, { event: RoomEvent; details: RoomEvent[] }>()
  const pending = new Map<string, RoomEvent[]>()
  const flush = (): void => {
    for (const facts of pending.values()) {
      const first = facts[0]
      if (first !== undefined) items.push({ event: first, details: facts.slice(1) })
    }
    pending.clear()
  }
  for (const event of events) {
    if (event.kind === 7) continue
    if (event.author.kind !== 'employee') {
      flush()
      active.clear()
      items.push({ event, details: [] })
      continue
    }
    const key = `${event.author.id}:${event.sourceSessionId ?? ''}`
    const existing = active.get(key)
    if (existing !== undefined && event.kind !== 9) { existing.details.push(event); continue }
    if (event.kind !== 9) {
      const facts = pending.get(key) ?? []
      facts.push(event)
      pending.set(key, facts)
      continue
    }
    const item = { event, details: pending.get(key) ?? [] }
    pending.delete(key)
    active.set(key, item)
    items.push(item)
  }
  flush()
  return items.sort((left, right) => BigInt(left.event.sequence) < BigInt(right.event.sequence) ? -1 : 1)
}
