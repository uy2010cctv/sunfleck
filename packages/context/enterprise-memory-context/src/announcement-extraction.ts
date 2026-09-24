/** LLM extraction of durable memory candidates from ingest-only channel announcements, following
 * the strict-JSON one-shot pattern of `consolidation-llm.ts`. Shared by the enterprise-surface
 * channel intake, which owns the proposal writes and the fallback when extraction is unavailable. */
import { classifyPrivacyForScope, inspectEnterpriseMemory, type MemoryKind, type MemoryScope } from '@deepseek-ai/dsh-enterprise-identity'
import { completeRefinement, type ConsolidationLlm, type ConsolidationRefinementOptions } from './consolidation-llm.ts'
import { unfenceModelJson } from './writeback-extraction.ts'

/** One durable memory candidate the model extracted from one announcement. */
export interface AnnouncementCandidate {
  /** Proposed memory summary. */
  readonly summary: string
  /** Memory kind of the proposed entry; `summary` rows belong to consolidation and never extract. */
  readonly kind: Exclude<MemoryKind, 'summary'>
}

/** One parsed candidate with its privacy verdict: `dropped: 'privacy'` marks a candidate whose
 * summary carries findings that block the target shared compartment. Dropped candidates stay in
 * the list so the caller can count them; extraction never downgrades into a private compartment. */
export interface AnnouncementExtractionOutcome {
  readonly candidate: AnnouncementCandidate
  readonly dropped?: 'privacy'
}

/** Maximum candidates one announcement extraction may return. Announcements are short broadcast
 * messages, so three bounds the model without cutting a multi-fact notice; raised only with a
 * deployment reason because every candidate becomes a human-review proposal. */
export const ANNOUNCEMENT_CANDIDATE_LIMIT = 3

/** Maximum characters of one extracted candidate summary, matching the per-candidate bound of the
 * completed-turn extractor; the store's scope gate still rejects anything over 2000. */
const ANNOUNCEMENT_SUMMARY_MAX = 1_000

const ANNOUNCEMENT_EXTRACTION_SYSTEM_PROMPT = [
  'Extract durable reusable company knowledge from one enterprise broadcast announcement.',
  `Return JSON only: {"candidates":[{"kind":"business-fact|process|terminology|decision|preference","summary":"..."}]} with at most ${ANNOUNCEMENT_CANDIDATE_LIMIT} candidates.`,
  'Propose only statements with lasting company-wide value; skip meeting notices, one-time events, task asks, and chit-chat.',
  'Never include personal data, credentials, customer records, or raw announcement text. Prefer zero candidates over weak memory.',
].join(' ')

const WRITEABLE_KINDS: readonly string[] = ['business-fact', 'process', 'terminology', 'decision', 'preference']

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Strictly parse and validate the candidate list; anything outside the contract throws.
 * @param output - complete visible model output.
 * @param limit - maximum candidates the output may carry.
 * @returns the parsed candidates in model order.
 */
function parseAnnouncementCandidates(output: string, limit: number): AnnouncementCandidate[] {
  const parsed: unknown = JSON.parse(unfenceModelJson(output))
  const items = record(parsed)?.['candidates']
  if (!Array.isArray(items)) throw new Error('enterprise announcement extraction candidates must be an array')
  if (items.length > limit) throw new Error('enterprise announcement extraction returned more candidates than the limit')
  return items.map((value, index) => {
    const item = record(value)
    const kind = item?.['kind']
    const summary = item?.['summary']
    const text = typeof summary === 'string' ? summary.trim() : ''
    if (typeof kind !== 'string' || !WRITEABLE_KINDS.includes(kind)
      || text.length === 0 || text.length > ANNOUNCEMENT_SUMMARY_MAX) {
      throw new Error(`enterprise announcement extraction candidate ${String(index)} is invalid`)
    }
    return { summary: text, kind: kind as AnnouncementCandidate['kind'] }
  })
}

/** Extract durable memory candidates from one announcement text and classify each against the
 * target shared compartment. A stream failure, timeout, or malformed output resolves to
 * `undefined` as a structured skip, which the caller maps to its fallback; an empty array is a
 * valid extraction result meaning the announcement carried no durable knowledge.
 * @param llm - streaming model surface the call runs on.
 * @param text - the full announcement text, uncapped.
 * @param scope - shared compartment every candidate would propose into.
 * @param options - routing and budget of the model call; the source attributes to the caller's plugin.
 * @param limit - maximum candidates; defaults to {@link ANNOUNCEMENT_CANDIDATE_LIMIT}.
 * @returns one outcome per parsed candidate in model order, privacy drops marked, or undefined when extraction failed.
 */
export async function extractAnnouncementMemories(
  llm: ConsolidationLlm,
  text: string,
  scope: MemoryScope,
  options: ConsolidationRefinementOptions,
  limit: number = ANNOUNCEMENT_CANDIDATE_LIMIT,
): Promise<AnnouncementExtractionOutcome[] | undefined> {
  try {
    return parseAnnouncementCandidates(
      await completeRefinement(llm, options, ANNOUNCEMENT_EXTRACTION_SYSTEM_PROMPT, {
        limit,
        announcement: text,
      }),
      limit,
    ).map((candidate): AnnouncementExtractionOutcome => classifyPrivacyForScope(
      inspectEnterpriseMemory(candidate.summary).findings, scope,
    ).allowed ? { candidate } : { candidate, dropped: 'privacy' })
  } catch {
    // Malformed or failed extraction output is a structured skip: the caller falls back to the
    // truncated raw proposal, and nothing else can reach the failure.
  }
  return undefined
}
