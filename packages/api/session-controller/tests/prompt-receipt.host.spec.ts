import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { hasSessionPromptRequest } from '../src/commands.ts'
import type { SessionRequestId } from '../src/types.ts'

function receipt(outcome?: 'canceled') {
  const session = Session.create(SessionId('prompt-receipt'))
  const requestId = brandString<SessionRequestId>('request-1')
  const message = createUserMessage({ content: [{ type: 'text', text: 'Run this' }], source: { kind: 'user', rpcId: requestId } })
  session.append('agent/inbox/spliced', { target: 'next-step', start: 0, inserted: [message] })
  session.append('agent/inbox/spliced', {
    target: 'next-step', start: 0, removedCount: 1, inserted: [], ...(outcome === undefined ? {} : { outcome }),
  })
  return { agent: { session, inbox: { nextTurn: [], nextStep: [] } } as never as Agent, requestId }
}

describe('native prompt durable receipts', () => {
  it('recognizes a durable claim before the first user/message is appended', () => {
    const { agent, requestId } = receipt()
    expect(hasSessionPromptRequest(agent, requestId)).toBe(true)
  })
  it('does not acknowledge a queued request canceled before claim', () => {
    const { agent, requestId } = receipt('canceled')
    expect(hasSessionPromptRequest(agent, requestId)).toBe(false)
  })
})
