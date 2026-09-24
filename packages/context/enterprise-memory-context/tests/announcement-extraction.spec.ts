import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { ANNOUNCEMENT_CANDIDATE_LIMIT, extractAnnouncementMemories } from '../src/announcement-extraction.ts'
import type { ConsolidationLlm, ConsolidationRefinementOptions } from '../src/consolidation-llm.ts'

const OPTIONS: ConsolidationRefinementOptions = {
  provider: 'deepseek', model: 'v4', maxTokens: 512, timeoutMs: 5_000, plugin: 'enterprise-surface',
}

/** Split the response so the fake exercises multi-chunk delta assembly like a real stream. */
function textChunks(text: string): readonly StreamChunk[] {
  return [
    { type: 'text-delta', index: 0, text: text.slice(0, 5) },
    { type: 'text-delta', index: 0, text: text.slice(5) },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Stream stub recording every request and replaying one scripted response per call. */
function fakeLlm(responses: string[]): ConsolidationLlm & { requests: GenerateOptions[] } {
  const requests: GenerateOptions[] = []
  return {
    requests,
    stream: (request): AsyncIterable<StreamChunk> => {
      requests.push(request)
      const response = responses.shift() ?? ''
      return (async function* (): AsyncGenerator<StreamChunk> {
        if (request.signal?.aborted) throw new DOMException('announcement extraction timed out', 'AbortError')
        yield* textChunks(response)
      })()
    },
  }
}

describe('announcement memory extraction', () => {
  it('extracts durable candidates and marks privacy-blocked ones without dropping the batch', async () => {
    const llm = fakeLlm([JSON.stringify({ candidates: [
      { kind: 'business-fact', summary: '公司下季度统一启用新版合同模板。' },
      { kind: 'process', summary: '报销审批迁移至新流程平台。' },
      { kind: 'business-fact', summary: '联系 alice@example.com 索取模板。' },
    ] })])

    const outcomes = await extractAnnouncementMemories(llm, '公告正文', 'organization', OPTIONS)

    expect(outcomes).toHaveLength(3)
    expect(outcomes?.map(outcome => outcome.dropped)).toEqual([undefined, undefined, 'privacy'])
    expect(outcomes?.[0]?.candidate).toEqual({ kind: 'business-fact', summary: '公司下季度统一启用新版合同模板。' })
    expect(outcomes?.[1]?.candidate.kind).toBe('process')
    expect(llm.requests).toHaveLength(1)
    // The request carries the caller's plugin attribution and the raw announcement text.
    const request = llm.requests[0]
    if (request === undefined) throw new Error('extraction sent no model request')
    expect(request.system).toContain('"candidates"')
    expect(request.provider).toBe('deepseek')
    expect(request.maxTokens).toBe(512)
  })

  it('unfences a code-fenced response and enforces the candidate limit', async () => {
    const payload = { candidates: [{ kind: 'terminology', summary: '新平台内部简称北斗。' }] }
    const fenced = fakeLlm([`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``])

    await expect(extractAnnouncementMemories(fenced, '公告', 'organization', OPTIONS))
      .resolves.toEqual([{ candidate: { kind: 'terminology', summary: '新平台内部简称北斗。' } }])

    const overLimit = fakeLlm([JSON.stringify({ candidates: Array.from(
      { length: ANNOUNCEMENT_CANDIDATE_LIMIT + 1 },
      () => ({ kind: 'business-fact', summary: '有效知识。' }),
    ) })])
    await expect(extractAnnouncementMemories(overLimit, '公告', 'organization', OPTIONS))
      .resolves.toBeUndefined()
  })

  it('resolves undefined on malformed output, invalid kinds, and stream failures', async () => {
    for (const response of [
      'not json at all',
      JSON.stringify({ reflections: [] }),
      JSON.stringify({ candidates: [{ kind: 'summary', summary: '摘要不属于抽取。' }] }),
      JSON.stringify({ candidates: [{ kind: 'business-fact', summary: '' }] }),
      JSON.stringify({ candidates: [{ kind: 'business-fact', summary: '超限。'.repeat(700) }] }),
    ]) {
      await expect(extractAnnouncementMemories(fakeLlm([response]), '公告', 'organization', OPTIONS))
        .resolves.toBeUndefined()
    }
    const failing: ConsolidationLlm = {
      stream: () => (async function* (): AsyncGenerator<StreamChunk> {
        yield* textChunks('{"candidates":[]}')
        throw new Error('stream exploded')
      })(),
    }
    await expect(extractAnnouncementMemories(failing, '公告', 'organization', OPTIONS))
      .resolves.toBeUndefined()
  })

  it('returns an empty list when the announcement carries no durable knowledge', async () => {
    const llm = fakeLlm([JSON.stringify({ candidates: [] })])

    await expect(extractAnnouncementMemories(llm, '周五下午团建。', 'organization', OPTIONS))
      .resolves.toEqual([])
  })
})
