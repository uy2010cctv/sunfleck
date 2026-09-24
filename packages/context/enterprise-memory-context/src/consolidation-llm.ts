/** LLM refinement for memory consolidation: compartment digests and privacy-gated private-note
 * reflections, following the strict-JSON one-shot pattern of `writeback-extraction.ts`. */
import type { EnterpriseMemoryEntry } from '@deepseek-ai/dsh-enterprise-identity'
import { classifyPrivacyForScope, inspectEnterpriseMemory } from '@deepseek-ai/dsh-enterprise-identity'
import { createUserMessage, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { ConsolidationTunables } from './consolidation.ts'
import { textFromModelStream, unfenceModelJson, type ModelStreamChunkView } from './writeback-extraction.ts'

/** Streaming surface of the harness `llm` service that consolidation refinement needs. */
export interface ConsolidationLlm {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/** Routing and budget of one consolidation refinement model call; the consolidation caller owns
 * these values so no routing or timing tunable hides in this module. */
export interface ConsolidationRefinementOptions {
  /** Registered provider route selecting the adapter instance. */
  readonly provider: string
  /** Model the refinement call runs on. */
  readonly model: string
  /** Maximum output tokens for one refinement call. */
  readonly maxTokens: number
  /** Wall-clock timeout for one refinement call, carried by the request abort signal. */
  readonly timeoutMs: number
  /** Session the call attributes to, when consolidation runs inside a session scope. */
  readonly sessionId?: GenerateOptions['sessionId']
  /** Plugin name the request message source carries; defaults to the consolidation runtime,
   * which owns this module. Cross-feature callers pass their own plugin name. */
  readonly plugin?: string
}

/** Shared compartment a reflection may propose. */
export type ReflectionTargetScope = 'organization' | 'department'

/** One reflection the model distilled from approved private notes. */
export interface ReflectionCandidate {
  /** Proposed shared-memory summary. */
  readonly summary: string
  /** Shared compartment the reflection proposes to enter. */
  readonly targetScope: ReflectionTargetScope
  /** Why this knowledge belongs beyond its writer; recorded for reviewers. */
  readonly rationale: string
}

/** One parsed reflection with its privacy verdict: `dropped: 'privacy'` marks a reflection whose
 * summary carries findings that block its target shared compartment. Dropped reflections stay in
 * the list so the caller can report them; reflection proposes shared knowledge only and never
 * downgrades into a private compartment. */
export interface ReflectionOutcome {
  readonly candidate: ReflectionCandidate
  readonly dropped?: 'privacy'
}

const COMPARTMENT_DIGEST_SYSTEM_PROMPT = [
  'Summarize the durable shared knowledge of one enterprise memory compartment for a periodic digest.',
  'Return JSON only: {"summary":"..."} with the summary in at most 400 characters.',
  'State the shared knowledge only; never include entry ids, personal data, credentials, or raw conversation text.',
].join(' ')

const REFLECTION_SYSTEM_PROMPT = [
  'Distill durable shared enterprise knowledge from an employee\'s approved private notes.',
  'Return JSON only: {"reflections":[{"summary":"...","targetScope":"organization|department","rationale":"..."}]} with at most the requested number of reflections.',
  'Propose only knowledge valuable beyond its writer. Never propose personal data, credentials, customer records, or private preferences.',
].join(' ')

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Stream one strict-JSON one-shot call to completion and return its visible text. Shared by the
 * consolidation passes, the announcement extractor, and the project distiller so every
 * enterprise-memory refinement call times out, finishes, and assembles text the same way.
 * @param llm - streaming model surface the call runs on.
 * @param options - routing and budget of the call.
 * @param system - strict-JSON system prompt.
 * @param user - JSON payload with the refinement inputs.
 * @returns the assembled visible text of the response.
 * @throws When the stream ends for any reason other than a normal stop, including a timeout abort.
 */
export async function completeRefinement(
  llm: ConsolidationLlm,
  options: ConsolidationRefinementOptions,
  system: string,
  user: Record<string, unknown>,
): Promise<string> {
  const request = createUserMessage({
    source: { kind: 'plugin', plugin: options.plugin ?? 'enterprise-memory-consolidation' },
    content: [{ type: 'text', text: JSON.stringify(user) }],
  })
  const chunks: ModelStreamChunkView[] = []
  for await (const chunk of llm.stream({
    provider: options.provider, model: options.model, messages: [request], system,
    maxTokens: options.maxTokens, ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    signal: AbortSignal.timeout(options.timeoutMs),
  })) chunks.push(chunk)
  const finish = chunks.findLast(chunk => chunk.type === 'finish')
  if (finish?.reason?.kind !== 'stop') {
    throw new Error(`enterprise memory consolidation refinement ended with ${finish?.reason?.kind ?? 'no finish'}`)
  }
  return textFromModelStream(chunks)
}

/** Strictly validate one compartment digest; anything outside the contract throws.
 * @param output - complete visible model output.
 * @returns the trimmed digest of at most 400 characters.
 */
function parseCompartmentDigest(output: string): string {
  const parsed: unknown = JSON.parse(unfenceModelJson(output))
  const value = record(parsed)?.['summary']
  const summary = typeof value === 'string' ? value.trim() : ''
  if (summary.length === 0 || summary.length > 400) throw new Error('enterprise memory consolidation digest is invalid')
  return summary
}

/** Summarize one memory compartment into a digest of at most 400 characters. An empty
 * compartment, a stream failure or timeout, and malformed or out-of-bound output all resolve to
 * undefined: the caller skips the digest and consolidation continues without it.
 * @param llm - streaming model surface the call runs on.
 * @param compartmentName - human-readable compartment label the digest describes.
 * @param entries - the compartment entries feeding the digest.
 * @param options - routing and budget of the model call.
 * @returns the trimmed digest, or undefined when the compartment is empty or the refinement fails.
 */
export async function summarizeCompartment(
  llm: ConsolidationLlm,
  compartmentName: string,
  entries: readonly EnterpriseMemoryEntry[],
  options: ConsolidationRefinementOptions,
): Promise<string | undefined> {
  if (entries.length === 0) return undefined
  try {
    return parseCompartmentDigest(await completeRefinement(llm, options, COMPARTMENT_DIGEST_SYSTEM_PROMPT, {
      compartment: compartmentName,
      entries: entries.map(entry => ({ id: entry.id, kind: entry.kind, summary: entry.summary })),
    }))
  } catch {
    // Any refinement failure — abort, timeout, non-stop finish, malformed output — skips this
    // digest; consolidation continues without it and nothing else can reach the failure.
  }
  return undefined
}

/** One refined shared-memory candidate shared by the reflection and distillation parsers. */
export interface RefinedCandidate {
  /** Proposed shared-memory summary. */
  readonly summary: string
  /** Shared compartment the candidate proposes to enter. */
  readonly targetScope: ReflectionTargetScope
  /** Why this knowledge belongs beyond its writer; recorded for reviewers. */
  readonly rationale: string
}

/** Strictly parse one refined candidate list whose items carry `summary`, `targetScope`, and
 * `rationale`; anything outside the contract throws. Shared by the reflection and project
 * distillation parsers, whose callers swallow the throw into a structured skip.
 * @param output - complete visible model output.
 * @param limit - maximum candidates the output may carry.
 * @param key - JSON field holding the candidate array.
 * @param label - store-domain label the thrown errors name.
 * @param maxSummary - maximum characters of one candidate summary.
 * @returns the parsed candidates in model order.
 */
export function parseRefinedCandidates(
  output: string,
  limit: number,
  key: string,
  label: string,
  maxSummary: number,
): RefinedCandidate[] {
  const parsed: unknown = JSON.parse(unfenceModelJson(output))
  const items = record(parsed)?.[key]
  if (!Array.isArray(items)) throw new Error(`${label} must be an array`)
  if (items.length > limit) throw new Error(`${label} exceeded the batch limit`)
  return items.map((value, index) => {
    const item = record(value)
    const summary = item?.['summary']
    const targetScope = item?.['targetScope']
    const rationale = item?.['rationale']
    const text = typeof summary === 'string' ? summary.trim() : ''
    const reason = typeof rationale === 'string' ? rationale.trim() : ''
    if ((targetScope !== 'organization' && targetScope !== 'department')
      || text.length === 0 || text.length > maxSummary || reason.length === 0) {
      throw new Error(`${label} candidate ${String(index)} is invalid`)
    }
    return { summary: text, targetScope, rationale: reason }
  })
}

/** Strictly validate one reflection list; anything outside the contract throws.
 * @param output - complete visible model output.
 * @param limit - maximum reflections the output may carry.
 * @returns the parsed candidates in model order.
 */
function parseReflections(output: string, limit: number): ReflectionCandidate[] {
  return parseRefinedCandidates(output, limit, 'reflections', 'enterprise memory consolidation reflections', 2_000)
}

/** Reflect approved private notes into shared-memory proposals: the model distills at most
 * `reflectionBatchLimit` reflections, every proposal passes the scope-aware privacy policy for
 * its target compartment, and proposals with blocking findings are returned marked `dropped` —
 * reflection proposes shared knowledge only and never downgrades into a private compartment. A
 * stream failure, timeout, or any malformed output resolves to [] as a structured skip.
 * @param llm - streaming model surface the call runs on.
 * @param entries - reflection candidates from `reflectionCandidates`, oldest first.
 * @param tunables - resolved consolidation thresholds; the batch limit bounds the output.
 * @param options - routing and budget of the model call.
 * @returns one outcome per parsed reflection, in model order, with privacy drops marked.
 */
export async function reflectOnPrivateNotes(
  llm: ConsolidationLlm,
  entries: readonly EnterpriseMemoryEntry[],
  tunables: ConsolidationTunables,
  options: ConsolidationRefinementOptions,
): Promise<ReflectionOutcome[]> {
  if (entries.length === 0) return []
  try {
    return parseReflections(
      await completeRefinement(llm, options, REFLECTION_SYSTEM_PROMPT, {
        limit: tunables.reflectionBatchLimit,
        notes: entries.map(entry => ({ id: entry.id, kind: entry.kind, summary: entry.summary })),
      }),
      tunables.reflectionBatchLimit,
    ).map((candidate): ReflectionOutcome => classifyPrivacyForScope(
      inspectEnterpriseMemory(candidate.summary).findings, candidate.targetScope,
    ).allowed ? { candidate } : { candidate, dropped: 'privacy' })
  } catch {
    // Malformed or failed reflection output is a structured skip: consolidation proceeds with no
    // reflections, and nothing else can reach the failure.
  }
  return []
}
