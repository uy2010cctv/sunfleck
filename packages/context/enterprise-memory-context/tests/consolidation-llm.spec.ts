import { describe, expect, it } from 'vitest'
import type { EnterpriseMemoryEntry } from '@deepseek-ai/dsh-enterprise-identity'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { consolidationTunables } from '../src/consolidation.ts'
import {
  reflectOnPrivateNotes, summarizeCompartment, type ConsolidationLlm, type ConsolidationRefinementOptions,
} from '../src/consolidation-llm.ts'

/** Routing and budget shared by the refinement tests. */
const options: ConsolidationRefinementOptions = {
  provider: 'deepseek', model: 'v4', maxTokens: 512, timeoutMs: 5_000,
}

function note(summary: string, overrides: Partial<EnterpriseMemoryEntry> = {}): EnterpriseMemoryEntry {
  return {
    id: `note-${summary}`, orgId: 'org-a', scope: 'agent', kind: 'preference', status: 'approved',
    summary, sourceDigest: 'b'.repeat(64), privacyFindings: [], importance: 1,
    createdBy: 'user-1', revision: 1, createdAt: 1, updatedAt: 2,
    ...overrides,
  }
}

/** Split the response so the fake exercises multi-chunk delta assembly like a real stream. */
function textChunks(text: string): readonly StreamChunk[] {
  return [
    { type: 'text-delta', index: 0, text: text.slice(0, 4) },
    { type: 'text-delta', index: 0, text: text.slice(4) },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

/** Minimal stream stub following the adapter contract: it records every request, honors the
 * abort signal after its delay the way an adapter surfaces a timeout, then emits the scripted
 * text deltas and a normal stop. */
function fakeLlm(response: string, behavior: { delayMs?: number } = {}): ConsolidationLlm & { requests: GenerateOptions[] } {
  const requests: GenerateOptions[] = []
  return {
    requests,
    stream: (request): AsyncIterable<StreamChunk> => {
      requests.push(request)
      return (async function* (): AsyncGenerator<StreamChunk> {
        if (behavior.delayMs !== undefined) await new Promise(resolve => setTimeout(resolve, behavior.delayMs))
        if (request.signal?.aborted) throw new DOMException('consolidation refinement timed out', 'AbortError')
        yield* textChunks(response)
      })()
    },
  }
}

function requestText(request: GenerateOptions | undefined): string {
  const block = request?.messages[0]?.content[0]
  return block?.type === 'text' ? block.text : ''
}

describe('compartment digest refinement', () => {
  it('summarizes a compartment through one strict-JSON model call with the caller routing', async () => {
    const llm = fakeLlm('{"summary":"月度报表、术语表与流程摘要。"}')
    const digest = await summarizeCompartment(llm, 'Department memory', [note('a'), note('b')], {
      ...options, sessionId: SessionId('session-1'),
    })
    expect(digest).toBe('月度报表、术语表与流程摘要。')
    const request = llm.requests[0]
    expect(request?.provider).toBe('deepseek')
    expect(request?.model).toBe('v4')
    expect(request?.maxTokens).toBe(512)
    expect(request?.sessionId).toBe('session-1')
    expect(request?.signal).toBeInstanceOf(AbortSignal)
    expect(request?.system).toContain('{"summary":"..."}')
    expect(JSON.parse(requestText(request)) as Record<string, unknown>).toMatchObject({ compartment: 'Department memory' })
  })

  it('assembles the digest from completed blocks when no deltas streamed', async () => {
    const llm: ConsolidationLlm = {
      stream: () => (async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'block-end', index: 0, block: { type: 'text', text: '{"summary":"块装配摘要"}' } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      })(),
    }
    await expect(summarizeCompartment(llm, 'x', [note('a')], options)).resolves.toBe('块装配摘要')
  })

  it('strips a code fence around the JSON', async () => {
    const llm = fakeLlm('```json\n{"summary":"fenced digest"}\n```')
    await expect(summarizeCompartment(llm, 'x', [note('a')], options)).resolves.toBe('fenced digest')
  })

  it('skips the digest on any malformed or out-of-bound output', async () => {
    await expect(summarizeCompartment(fakeLlm('not json'), 'x', [note('a')], options)).resolves.toBeUndefined()
    await expect(summarizeCompartment(fakeLlm('{"digest":"other field"}'), 'x', [note('a')], options)).resolves.toBeUndefined()
    await expect(summarizeCompartment(fakeLlm('{"summary":"  "}'), 'x', [note('a')], options)).resolves.toBeUndefined()
    await expect(summarizeCompartment(fakeLlm(`{"summary":"${'长'.repeat(401)}"}`), 'x', [note('a')], options)).resolves.toBeUndefined()
  })

  it('skips the digest when the stream ends abnormally or times out', async () => {
    const ended: ConsolidationLlm = {
      stream: () => (async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'finish', reason: { kind: 'max-tokens' } }
      })(),
    }
    await expect(summarizeCompartment(ended, 'x', [note('a')], options)).resolves.toBeUndefined()
    await expect(summarizeCompartment(fakeLlm('{"summary":"late"}', { delayMs: 50 }), 'x', [note('a')], {
      ...options, timeoutMs: 5,
    })).resolves.toBeUndefined()
  })

  it('skips refinement when the stream ends without any finish chunk', async () => {
    const truncated: ConsolidationLlm = {
      stream: () => (async function* (): AsyncGenerator<StreamChunk> {
        yield { type: 'text-delta', index: 0, text: '{"summary":"partial"}' }
      })(),
    }
    await expect(summarizeCompartment(truncated, 'x', [note('a')], options)).resolves.toBeUndefined()
    await expect(reflectOnPrivateNotes(truncated, [note('a')], consolidationTunables(), options)).resolves.toEqual([])
  })

  it('skips an empty compartment without calling the model', async () => {
    const llm = fakeLlm('{"summary":"x"}')
    await expect(summarizeCompartment(llm, 'x', [], options)).resolves.toBeUndefined()
    expect(llm.requests).toHaveLength(0)
  })
})

describe('private-note reflection refinement', () => {
  it('parses validated reflections and marks privacy-blocked proposals as dropped', async () => {
    const llm = fakeLlm(JSON.stringify({ reflections: [
      { summary: '公司统一使用电子合同签署。', targetScope: 'organization', rationale: '多个 notes 重复记录' },
      { summary: '联系 alice@example.com 确认付款。', targetScope: 'organization', rationale: '联系人知识' },
      { summary: '该部门结算周期为 T+N。', targetScope: 'department', rationale: '流程知识' },
    ] }))
    const outcomes = await reflectOnPrivateNotes(llm, [note('a')], consolidationTunables(), options)
    expect(outcomes).toEqual([
      { candidate: { summary: '公司统一使用电子合同签署。', targetScope: 'organization', rationale: '多个 notes 重复记录' } },
      {
        candidate: { summary: '联系 alice@example.com 确认付款。', targetScope: 'organization', rationale: '联系人知识' },
        dropped: 'privacy',
      },
      { candidate: { summary: '该部门结算周期为 T+N。', targetScope: 'department', rationale: '流程知识' } },
    ])
    const request = llm.requests[0]
    expect(request?.system).toContain('"targetScope":"organization|department"')
    expect(JSON.parse(requestText(request)) as Record<string, unknown>).toMatchObject({ limit: 3 })
  })

  it('skips reflection as a structured failure on any malformed output', async () => {
    const candidates = [note('a')]
    const tunables = consolidationTunables()
    await expect(reflectOnPrivateNotes(fakeLlm('nope'), candidates, tunables, options)).resolves.toEqual([])
    await expect(reflectOnPrivateNotes(fakeLlm('null'), candidates, tunables, options)).resolves.toEqual([])
    await expect(reflectOnPrivateNotes(fakeLlm('[]'), candidates, tunables, options)).resolves.toEqual([])
    await expect(reflectOnPrivateNotes(fakeLlm('{"reflections":"x"}'), candidates, tunables, options)).resolves.toEqual([])
    await expect(reflectOnPrivateNotes(
      fakeLlm('{"reflections":[{"summary":"s","targetScope":"pair","rationale":"r"}]}'), candidates, tunables, options,
    )).resolves.toEqual([])
    await expect(reflectOnPrivateNotes(
      fakeLlm('{"reflections":[{"summary":" ","targetScope":"organization","rationale":"r"}]}'), candidates, tunables, options,
    )).resolves.toEqual([])
    await expect(reflectOnPrivateNotes(
      fakeLlm(`{"reflections":[{"summary":"${'长'.repeat(2_001)}","targetScope":"organization","rationale":"r"}]}`),
      candidates, tunables, options,
    )).resolves.toEqual([])
    await expect(reflectOnPrivateNotes(
      fakeLlm('{"reflections":[{"summary":"s","targetScope":"organization","rationale":" "}]}'), candidates, tunables, options,
    )).resolves.toEqual([])
    await expect(reflectOnPrivateNotes(
      fakeLlm('{"reflections":[null]}'), candidates, tunables, options,
    )).resolves.toEqual([])
  })

  it('skips reflection when the model exceeds the batch limit or the call times out', async () => {
    const tunables = consolidationTunables({ reflectionBatchLimit: 1 })
    const reflection = { summary: 's', targetScope: 'organization', rationale: 'r' }
    await expect(reflectOnPrivateNotes(
      fakeLlm(JSON.stringify({ reflections: [reflection, reflection] })), [note('a')], tunables, options,
    )).resolves.toEqual([])
    await expect(reflectOnPrivateNotes(
      fakeLlm('{"summary":"late"}', { delayMs: 50 }), [note('a')], tunables, { ...options, timeoutMs: 5 },
    )).resolves.toEqual([])
  })

  it('skips an empty candidate list without calling the model', async () => {
    const llm = fakeLlm('{}')
    await expect(reflectOnPrivateNotes(llm, [], consolidationTunables(), options)).resolves.toEqual([])
    expect(llm.requests).toHaveLength(0)
  })
})
