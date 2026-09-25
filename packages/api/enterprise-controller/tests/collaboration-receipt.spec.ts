import { describe, expect, it } from 'vitest'
import { findCollaborationRequest } from '../src/collaboration-receipt.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

const bindings = [{ surfaceId: 'surface-a', topicId: 'run-old', employeeId: '', sessionId: 'root-old' }]
const request = { surfaceId: 'surface-a', actorUserId: 'alice', requestId: 'followup-1' }
const message = {
  type: 'user/message', data: { source: { kind: 'user', rpcId: 'followup-1', runId: 'run-old', originSurfaceId: 'surface-a', actorUserId: 'alice' } },
} as never as SessionEvent

function events(state: 'completed' | 'waiting-human') {
  return async function* (_id: string) {
    yield message
    yield { type: 'team/run', data: { state } } as never as SessionEvent
  }
}

describe('durable TeamRun collaboration receipt lookup', () => {
  it.each(['completed', 'waiting-human'] as const)('finds a delivered follow-up after the run becomes %s', async (state) => {
    expect(await findCollaborationRequest(bindings, request, events(state))).toBe('root-old')
  })
  it('does not reuse another actor or conversation receipt with the same request id', async () => {
    expect(await findCollaborationRequest(bindings, { ...request, actorUserId: 'bob' }, events('completed'))).toBeUndefined()
    expect(await findCollaborationRequest(bindings, { ...request, surfaceId: 'surface-b' }, events('completed'))).toBeUndefined()
  })
})
