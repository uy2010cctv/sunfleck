import { describe, expect, it } from 'vitest'
import { projectTeamRoomFact, teamTurnSourceIds } from '../src/collaboration-team-room.ts'

const roster = [
  { sessionId: 'lead-session', employeeId: 'research', name: 'Research' },
  { sessionId: 'data-session', employeeId: 'data', name: 'Data' },
]

describe('TeamRun facts in one signed room timeline', () => {
  it('attributes a durable peer message to its actual sender Bot', () => {
    expect(projectTeamRoomFact({ type: 'team/message/queued', seq: 9,
      data: { message: { senderId: 'data-session', targetId: 'lead-session', senderName: 'Data',
        content: [{ type: 'text', text: 'The metrics table is ready.' }] } } }, roster))
      .toEqual({ kind: 'text', authorKind: 'employee', authorId: 'data', sourceSeq: 9,
        content: 'To Research: The metrics table is ready.' })
  })

  it('records a task transition as Team state when the mutating actor is absent', () => {
    expect(projectTeamRoomFact({ type: 'team/task', seq: 12,
      data: { task: { id: 'task-1', subject: 'Draft', status: 'in_progress', ownerId: 'data-session' } } }, roster))
      .toEqual({ kind: 'workflow', authorKind: 'service', authorId: 'team', sourceSeq: 12,
        content: 'Task Draft: in_progress; owner Data.' })
  })

  it('attributes an answered decision to the human who answered', () => {
    expect(projectTeamRoomFact({ type: 'team/decision', seq: 16,
      data: { decision: { question: 'Publish?', state: 'answered', answer: 'Approve',
        respondedBy: { userId: 'alice', displayName: 'Alice' } } } }, roster))
      .toEqual({ kind: 'workflow', authorKind: 'human', authorId: 'alice', sourceSeq: 16,
        content: 'Decision Publish?: Approve.' })
  })

  it('does not claim a Bot author when a peer has no pinned employee release', () => {
    expect(projectTeamRoomFact({ type: 'team/message/queued', seq: 20,
      data: { message: { senderId: 'unknown', targetId: 'lead-session', senderName: 'Unknown',
        content: [{ type: 'text', text: 'Result' }] } } }, roster)).toBeUndefined()
  })

  it('links a teammate reply only to a queued message consumed in that turn', () => {
    const events = [
      { type: 'turn/start', seq: 1, data: { turn: 1 } },
      { type: 'user/message', seq: 2, data: { source: { kind: 'team-message', messageId: 'first' } } },
      { type: 'turn/end', seq: 3, data: { turn: 1 } },
      { type: 'turn/start', seq: 4, data: { turn: 2 } },
      { type: 'user/message', seq: 5, data: { source: { kind: 'team-message', messageId: 'second' } } },
      { type: 'turn/end', seq: 6, data: { turn: 2 } },
    ] as const
    expect(teamTurnSourceIds(events, 1)).toEqual(['first'])
    expect(teamTurnSourceIds(events, 2)).toEqual(['second'])
  })
})
