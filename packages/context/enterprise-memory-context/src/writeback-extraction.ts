/** Bounded completed-turn snapshot and strict enterprise-memory extraction output. */
import type { Session } from '@deepseek-ai/dsh-session'

export type MemoryCandidateAction = 'skip' | 'create' | 'conflict'

/** Closed set of extraction targets; the extractor may omit the field and defaults to `private`. */
const EXTRACTION_TARGETS = ['private', 'organization', 'department', 'pair'] as const
/** Compartment one extracted candidate is destined for. */
export type MemoryExtractionTarget = (typeof EXTRACTION_TARGETS)[number]

export interface MemoryExtractionCandidate {
  readonly action: MemoryCandidateAction
  /** Destination compartment; `private` keeps the fact out of shared review entirely. */
  readonly target: MemoryExtractionTarget
  readonly kind: 'business-fact' | 'process' | 'terminology' | 'decision'
  readonly summary: string
  readonly confidence: number
  readonly reason: string
}

export interface MemoryTurnSnapshot {
  readonly sessionId: string
  readonly turn: number
  readonly workspaceRoot: string
  readonly provider: string
  readonly model: string
  readonly userText: string
  readonly assistantText: string
}

function text(content: readonly { type: string; text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
}

/** Capture only direct user messages and the last visible assistant answer from one turn. */
export function captureMemoryTurn(session: Session, turn: number, maxChars: number): MemoryTurnSnapshot | undefined {
  const events = session.snapshotEvents()
  const userText = events
    .filter(event => event.type === 'user/message' && event.data.source.kind === 'user')
    .filter((event) => {
      const start = events.findLast(item => item.type === 'turn/start' && item.seq < event.seq)
      return start?.type === 'turn/start' && start.data.turn === turn
    })
    .map(event => event.type === 'user/message' ? text(event.data.content) : '')
    .filter(Boolean).join('\n\n')
  const assistant = events.findLast(event => event.type === 'assistant/message'
    && event.data.turn === turn && event.data.interrupted !== true && text(event.data.message.content).length > 0)
  const cwd = session.header.cwd
  if (assistant?.type !== 'assistant/message' || cwd === undefined || userText.length === 0) return undefined
  const source = assistant.data.message.source
  if (typeof source.provider !== 'string' || typeof source.model !== 'string') return undefined
  const userLimit = Math.max(1, Math.floor(maxChars * .4))
  const assistantLimit = Math.max(1, maxChars - userLimit)
  return {
    sessionId: String(session.id), turn, workspaceRoot: cwd, provider: source.provider, model: source.model,
    userText: userText.slice(0, userLimit), assistantText: text(assistant.data.message.content).slice(0, assistantLimit),
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Parse the extractor's complete JSON response and reject candidates whose fields leave the
 * contract. Privacy classification stays with the worker's scope-aware policy, so candidates with
 * findings reach the router and a personal preference downgrades into a private compartment
 * instead of failing the whole extraction. A missing `target` defaults to `private`; a `target`
 * outside the closed set rejects the candidate like any other invalid field.
 * @param output - Input value used by this API.
 * @returns Result produced by this API.
 */
export function parseExtractionOutput(output: string): MemoryExtractionCandidate[] {
  const unfenced = output.trim().replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '')
  let parsed: unknown
  try { parsed = JSON.parse(unfenced) } catch { throw new Error('enterprise memory extraction output is not JSON') }
  const items = record(parsed)?.['candidates']
  if (!Array.isArray(items)) throw new Error('enterprise memory extraction candidates must be an array')
  if (items.length > 8) throw new Error('enterprise memory extraction returned more than 8 candidates')
  return items.map((value, index) => {
    const item = record(value)
    const action = item?.['action']
    const target = item?.['target']
    const kind = item?.['kind']
    const summary = item?.['summary']
    const confidence = item?.['confidence']
    const reason = item?.['reason']
    if ((target !== undefined && !EXTRACTION_TARGETS.includes(target as MemoryExtractionTarget))
      || !['skip', 'create', 'conflict'].includes(String(action))
      || !['business-fact', 'process', 'terminology', 'decision'].includes(String(kind))
      || typeof summary !== 'string' || summary.trim().length === 0 || summary.trim().length > 1_000
      || typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
      || typeof reason !== 'string' || reason.trim().length === 0 || reason.trim().length > 500) {
      throw new Error(`enterprise memory extraction candidate ${String(index)} is invalid`)
    }
    return {
      action: action as MemoryCandidateAction,
      target: target === undefined ? 'private' : target as MemoryExtractionTarget,
      kind: kind as MemoryExtractionCandidate['kind'],
      summary: summary.trim(), confidence, reason: reason.trim(),
    }
  })
}

export const EXTRACTION_SYSTEM_PROMPT = [
  'Extract durable reusable enterprise knowledge from one completed conversation turn.',
  'Return JSON only: {"candidates":[{"action":"skip|create|conflict","target":"private|organization|department|pair","kind":"business-fact|process|terminology|decision","summary":"...","confidence":0.0,"reason":"..."}]}.',
  'Use create only for stable confirmed knowledge with long-term value. Use conflict for uncertainty or contradiction. Use skip for task status, one-time output, guesses, personal data, customer raw content, credentials, or knowledge already present.',
  'Choose target private by default; it holds the fact for this employee and user only. Choose organization or department only for explicitly company-wide or department-wide reusable facts. Choose pair only for a stated user-specific collaboration preference.',
  'Never copy secrets or raw records. Prefer zero candidates over weak memory.',
].join(' ')
