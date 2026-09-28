/** Associates declared files with the native reply that follows their recorded events. */
import type { RoomEvent, RoomPresentedFile } from './collaboration-store.ts'

function sourceSequence(event: RoomEvent): number | undefined {
  if (event.sourceSessionId === undefined) return undefined
  const source = event.tags.find(tag => tag[0] === 'dsh-source')?.[1]
  const prefix = `${event.sourceSessionId}:`
  if (source === undefined || !source.startsWith(prefix)) return undefined
  const value = source.slice(prefix.length)
  if (!/^(0|[1-9][0-9]*)$/u.test(value)) return undefined
  const sequence = Number(value)
  return Number.isSafeInteger(sequence) ? sequence : undefined
}

/**
 * Select declarations between the previous native reply and this reply.
 * @param events - signed room and thread history currently displayed.
 * @param reply - closing employee post carrying the source Session.
 * @param files - declarations read from that source Session.
 * @returns this reply's declarations; legacy posts show files only on the latest reply.
 */
export function filesForRoomReply(events: readonly RoomEvent[], reply: RoomEvent,
  files: readonly RoomPresentedFile[]): readonly RoomPresentedFile[] {
  if (reply.kind !== 9 || reply.author.kind !== 'employee' || reply.sourceSessionId === undefined) return []
  const replies = events.filter(event => event.kind === 9 && event.author.kind === 'employee'
    && event.sourceSessionId === reply.sourceSessionId)
  const ending = sourceSequence(reply)
  if (ending === undefined) {
    const latest = replies.reduce<RoomEvent | undefined>((current, event) => current === undefined
      || BigInt(event.sequence) > BigInt(current.sequence) ? event : current, undefined)
    return latest?.id === reply.id ? files : []
  }
  let previous = -1
  for (const event of replies) {
    const sequence = sourceSequence(event)
    if (sequence !== undefined && sequence < ending && sequence > previous) previous = sequence
  }
  return files.filter(file => file.replySourceSeq === undefined
    ? previous >= 0 && file.seq > previous && file.seq <= ending
    : file.replySourceSeq === ending)
}
