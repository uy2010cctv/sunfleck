import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { captureMemoryTurn, EXTRACTION_SYSTEM_PROMPT, parseExtractionOutput } from '../src/writeback-extraction.ts'

function completedTurn(): Session {
  const id = SessionId('memory-turn')
  const session = Session.create(id, [], {
    version: 3, id, createdAt: 1, cwd: '/managed/finance', isSeeded: false,
  })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', {
    id: MessageId('user-1'), role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: '公司报表每月 5 日前完成。' }],
  }, { surfaceOp: 'append' })
  session.append('user/message', {
    id: MessageId('plugin-1'), role: 'user', source: { kind: 'plugin', plugin: 'context' },
    content: [{ type: 'text', text: 'secret tool output' }],
  }, { surfaceOp: 'append' })
  session.append('assistant/message', {
    turn: 1, step: 1, stream: [],
    message: {
      id: MessageId('assistant-1'), role: 'assistant', source: { kind: 'model', provider: 'deepseek', model: 'v4' },
      content: [{ type: 'text', text: '已确认：月度报表截止日为每月 5 日。' }],
    },
  }, { surfaceOp: 'append' })
  return session
}

describe('enterprise memory turn extraction', () => {
  it('captures only direct user text and the final assistant answer with its route', () => {
    expect(captureMemoryTurn(completedTurn(), 1, 2_000)).toEqual({
      sessionId: 'memory-turn', turn: 1, workspaceRoot: '/managed/finance',
      provider: 'deepseek', model: 'v4',
      userText: '公司报表每月 5 日前完成。', assistantText: '已确认：月度报表截止日为每月 5 日。',
    })
  })

  it('skips turns without both direct user text and a final assistant answer', () => {
    const id = SessionId('empty-turn')
    const session = Session.create(id, [], { version: 3, id, createdAt: 1, cwd: '/managed', isSeeded: false })
    session.append('turn/start', { turn: 1 })
    expect(captureMemoryTurn(session, 1, 2_000)).toBeUndefined()
  })

  it('validates strict durable candidates and rejects malformed output', () => {
    expect(parseExtractionOutput(JSON.stringify({ candidates: [{
      action: 'create', target: 'department', kind: 'process',
      summary: '月度报表须在每月 5 日前完成。', confidence: 0.96, reason: '用户明确确认',
    }] }))).toEqual([{ action: 'create', target: 'department', kind: 'process',
      summary: '月度报表须在每月 5 日前完成。', confidence: 0.96, reason: '用户明确确认' }])
    expect(() => parseExtractionOutput('{"candidates":[{"action":"create","target":"department"}]}')).toThrow(/candidate/iu)
    expect(() => parseExtractionOutput(JSON.stringify({ candidates: [{
      action: 'create', target: 'company', kind: 'process', summary: '月度报表。', confidence: 1, reason: 'x',
    }] }))).toThrow(/candidate/iu)
  })

  it('defaults a missing target to private and keeps finding-bearing summaries for the worker policy', () => {
    expect(parseExtractionOutput(JSON.stringify({ candidates: [{
      action: 'skip', kind: 'decision', summary: '任务已完成。', confidence: 0.1, reason: '一次性输出',
    }] }))).toEqual([{ action: 'skip', target: 'private', kind: 'decision',
      summary: '任务已完成。', confidence: 0.1, reason: '一次性输出' }])
    expect(parseExtractionOutput(JSON.stringify({ candidates: [{
      action: 'create', target: 'organization', kind: 'process', summary: 'apiKey=sk-company-secret', confidence: 1, reason: 'x',
    }] }))).toEqual([{ action: 'create', target: 'organization', kind: 'process',
      summary: 'apiKey=sk-company-secret', confidence: 1, reason: 'x' }])
  })

  it('declares the target compartment contract to the extractor', () => {
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('"target":"private|organization|department|pair"')
    expect(EXTRACTION_SYSTEM_PROMPT).toContain('Choose target private by default')
  })
})
