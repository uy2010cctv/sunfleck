import { describe, expect, it } from 'vitest'
import { roomPrompt, roomRecipients, roomSourceCursor, roomTurnPost, roomTurnTriggers,
  releasedRoomEmployee, roomToolFact } from '../src/collaboration-room-delivery.ts'
import type { RoomEvent } from '@deepseek-ai/dsh-enterprise-postgres'

const event = (sequence: string, authorId: string, content: string, tags: string[][] = []): RoomEvent => ({
  sequence, orgId: 'org', surfaceId: 'room', authorKind: authorId === 'alice' ? 'human' : 'employee', authorId,
  event: { id: `event-${sequence}`, pubkey: 'key', created_at: 1, kind: 9, tags, content, sig: 'signature' },
})

describe('shared room execution input', () => {
  it('directs requested file delivery through present in the native room input', () => {
    const latest = event('1', 'alice', '@Research create report.txt and share it here')
    expect(roomPrompt('Research room', [latest], latest, { characters: 500, events: 1 }))
      .toMatchInlineSnapshot(`
        "Shared room: Research room
        Read these signed room events in order. Each [id] is an auditable source event. Reply in the room as yourself.
        For requested files, create them and call present with existing paths before your final reply for room members to open or download. Reply here; external messaging requires an explicit request.
        [event-1] human:alice: @Research create report.txt and share it here"
      `)
  })

  it('retains exact source event IDs and current text while bounding older context', () => {
    const events = Array.from({ length: 40 }, (_, index) => event(String(index + 1), 'alice', `Older ${index} ${'x'.repeat(200)}`))
    const latest = event('41', 'alice', '@Research investigate')
    const prompt = roomPrompt('Research room', [...events, latest], latest, { characters: 1400, events: 24 },
      new Map([['human:alice', 'Alice']]))
    expect(prompt).toContain('event-41')
    expect(prompt).toContain('@Research investigate')
    expect(prompt).toContain('Alice')
    expect(prompt).toContain('Earlier room events omitted')
    expect(prompt.length).toBeLessThanOrEqual(1400)
    expect(prompt).not.toContain('event-1]')
  })

  it('retains the current source id and delivery instructions at the minimum context limit', () => {
    const latest = { ...event('1', 'alice', 'x'.repeat(1000)),
      event: { ...event('1', 'alice', '').event, id: 'a'.repeat(64), content: 'x'.repeat(1000) } }
    const prompt = roomPrompt('r'.repeat(80), [latest], latest, { characters: 500, events: 1 })
    expect(prompt).toContain(`[${latest.event.id}]`)
    expect(prompt).toContain('external messaging requires an explicit request.')
    expect(prompt.length).toBeLessThanOrEqual(500)
  })

  it('routes explicit employee mentions and blocks self loops or excessive hops', () => {
    const members = ['research', 'data', 'editor']
    expect(roomRecipients(event('1', 'research', '@Data please take over', [['dsh-hop', '1']]),
      members, [{ employeeId: 'data', displayName: 'Data' }, { employeeId: 'editor', displayName: 'Editor' }], 2)).toEqual(['data'])
    expect(roomRecipients(event('2', 'research', '@Research loop', [['dsh-hop', '1']]), members,
      [{ employeeId: 'research', displayName: 'Research' }], 2)).toEqual([])
    expect(roomRecipients(event('3', 'research', '@Data loop', [['dsh-hop', '2']]), members,
      [{ employeeId: 'data', displayName: 'Data' }], 2)).toEqual([])
    expect(roomRecipients(event('4', 'research', '@ALL discuss', [['dsh-hop', '1']]), members,
      [{ employeeId: 'research', displayName: 'Research' }, { employeeId: 'data', displayName: 'Data' },
        { employeeId: 'editor', displayName: 'Editor' }], 2)).toEqual(['data', 'editor'])
    expect(roomRecipients(event('5', 'research', '@ALLiance is our name', [['dsh-hop', '1']]), members,
      [{ employeeId: 'data', displayName: 'Data' }], 2)).toEqual([])
  })

  it('builds one persistent projection cursor from a native Session event', () => {
    expect(roomSourceCursor('session-1', 34)).toBe('session-1:34')
  })

  it('projects the final visible assistant text after the native turn closes', () => {
    const events = [
      { type: 'assistant/message', seq: 4, data: { turn: 1, message: { content: [{ type: 'text', text: 'Researching' }] } } },
      { type: 'assistant/message', seq: 9, data: { turn: 1, message: { content: [{ type: 'reasoning', text: 'private' },
        { type: 'text', text: 'Here is the answer' }] } } },
      { type: 'turn/end', seq: 10, data: { turn: 1, reason: { kind: 'completed' } } },
    ] as const
    expect(roomTurnPost(events, 1)).toEqual({ text: 'Here is the answer', sourceSeq: 9 })
  })

  it('projects a failed turn once with its durable end cursor', () => {
    expect(roomTurnPost([{ type: 'turn/end', seq: 6, data: { turn: 2, reason: { kind: 'error' } } }], 2))
      .toEqual({ text: 'Employee execution failed. See the linked Session for details.', sourceSeq: 6 })
  })

  it('projects only turns that consumed a signed room event in their own native boundary', () => {
    const id = 'a'.repeat(64)
    const events = [
      { type: 'turn/start', seq: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 2, data: { source: { surfaceId: 'room', rpcId: 'old-request' } } },
      { type: 'turn/end', seq: 3, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', seq: 4, data: { turn: 2 } },
      { type: 'user/message', seq: 5, data: { source: { surfaceId: 'room', rpcId: id } } },
      { type: 'turn/end', seq: 6, data: { turn: 2, reason: { kind: 'completed' } } },
    ] as const
    expect(roomTurnTriggers(events, 1, 'room')).toEqual([])
    expect(roomTurnTriggers(events, 2, 'room')).toEqual([id])
  })

  it('recovers the exact employee selection after the live Agent is disposed', () => {
    const events = [{ type: 'enterprise-employee/selected', data: { orgId: 'org', ownerUserId: 'alice',
      employeeId: 'research', releaseId: 'release-1' } }] as const
    expect(releasedRoomEmployee(events)).toEqual({ orgId: 'org', ownerUserId: 'alice',
      employeeId: 'research', releaseId: 'release-1' })
    expect(releasedRoomEmployee([...events, { type: 'enterprise-employee/cleared', data: {} }])).toBeUndefined()
  })

  it('projects tool start and result status without raw arguments or result content', () => {
    const events = [
      { type: 'tool/call', seq: 21, data: { turn: 3, callId: 'call-1', name: 'git_patch',
        arguments: '{"secret":"private-token"}' } },
      { type: 'tool/result', seq: 24, data: { turn: 3, message: { toolCallId: 'call-1', isError: true,
        content: [{ type: 'text', text: 'sensitive response' }] } } },
    ] as const
    expect(roomToolFact(events, events[0])).toEqual({ sourceSeq: 21, content: 'Tool git_patch started.' })
    expect(roomToolFact(events, events[1])).toEqual({ sourceSeq: 24, content: 'Tool git_patch failed.' })
    expect(JSON.stringify(events.map(event => roomToolFact(events, event)))).not.toMatch(/private-token|sensitive response/u)
  })
})
