/** Bounded completed-turn snapshot and strict enterprise-memory extraction output. */
import { inspectEnterpriseMemory } from '@deepseek-ai/dsh-enterprise-identity'
import type { Session } from '@deepseek-ai/dsh-session'

export type MemoryCandidateAction = 'skip' | 'create' | 'conflict'
export interface MemoryExtractionCandidate {
  readonly action: MemoryCandidateAction
  readonly scope: 'organization' | 'department'
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

/** Parse the extractor's complete JSON response and reject unsafe or ambiguous candidates. */
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
    const scope = item?.['scope']
    const kind = item?.['kind']
    const summary = item?.['summary']
    const confidence = item?.['confidence']
    const reason = item?.['reason']
    if (!['skip', 'create', 'conflict'].includes(String(action))
      || !['organization', 'department'].includes(String(scope))
      || !['business-fact', 'process', 'terminology', 'decision'].includes(String(kind))
      || typeof summary !== 'string' || summary.trim().length === 0 || summary.trim().length > 1_000
      || typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1
      || typeof reason !== 'string' || reason.trim().length === 0 || reason.trim().length > 500) {
      throw new Error(`enterprise memory extraction candidate ${String(index)} is invalid`)
    }
    const inspection = inspectEnterpriseMemory(summary)
    if (inspection.findings.length > 0) {
      throw new Error(`enterprise memory extraction privacy or credential check failed: ${inspection.findings.join(',')}`)
    }
    return {
      action: action as MemoryCandidateAction,
      scope: scope as MemoryExtractionCandidate['scope'], kind: kind as MemoryExtractionCandidate['kind'],
      summary: summary.trim(), confidence, reason: reason.trim(),
    }
  })
}

export const EXTRACTION_SYSTEM_PROMPT = [
  'Extract durable reusable enterprise knowledge from one completed conversation turn.',
  'Return JSON only: {"candidates":[{"action":"skip|create|conflict","scope":"organization|department","kind":"business-fact|process|terminology|decision","summary":"...","confidence":0.0,"reason":"..."}]}.',
  'Use create only for stable confirmed knowledge with long-term value. Use conflict for uncertainty or contradiction. Use skip for task status, one-time output, guesses, personal data, customer raw content, credentials, or knowledge already present.',
  'Choose organization only for explicitly company-wide knowledge; otherwise choose department.',
  'Never copy secrets or raw records. Prefer zero candidates over weak memory.',
].join(' ')
