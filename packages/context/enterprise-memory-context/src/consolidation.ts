/** Pure consolidation planning: duplicate grouping, importance decay, supersede, retire and
 * reflection selection. Deterministic only — every threshold arrives through
 * {@link ConsolidationTunables} and every clock through a `now` parameter. */
import type { EnterpriseMemoryEntry } from '@deepseek-ai/dsh-enterprise-identity'

/** One day in epoch milliseconds. */
const DAY_MS = 86_400_000

/** Deployment-varying consolidation thresholds, resolved once per consolidation run through
 * {@link consolidationTunables}. */
export interface ConsolidationTunables {
  /** Token-set Jaccard similarity at or above which two summaries share one duplicate group. */
  readonly duplicateJaccardThreshold: number
  /** Importance half-life in days: aging `halfLifeDays` without access halves the decayed weight. */
  readonly halfLifeDays: number
  /** Decayed importance strictly below which an entry may retire. */
  readonly retireBelowImportance: number
  /** Days of no access after which retirement becomes eligible. */
  readonly retireGraceDays: number
  /** Decayed importance at or above which an approved agent note becomes a reflection candidate. */
  readonly reflectionMinImportance: number
  /** Maximum reflection candidates one consolidation run selects. */
  readonly reflectionBatchLimit: number
}

/** The single home of the consolidation tunable defaults. */
const TUNABLE_DEFAULTS: ConsolidationTunables = {
  duplicateJaccardThreshold: 0.6,
  halfLifeDays: 30,
  retireBelowImportance: 0.1,
  retireGraceDays: 14,
  reflectionMinImportance: 0.5,
  reflectionBatchLimit: 3,
}

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new Error(`enterprise memory consolidation ${name} must be a finite number`)
  return value
}

/** Resolve the consolidation tunables, filling every omitted field with its documented default
 * from `TUNABLE_DEFAULTS` and rejecting invalid overrides at this configuration boundary.
 * @param partial - explicit overrides; every omitted field takes its default.
 * @returns the complete tunables.
 * @throws When an override is not finite, the Jaccard threshold leaves (0, 1], the half-life is
 *   not positive, a retirement or reflection weight is negative, or the batch limit is not a
 *   positive integer.
 */
export function consolidationTunables(partial: Partial<ConsolidationTunables> = {}): ConsolidationTunables {
  const duplicateJaccardThreshold = finite(partial.duplicateJaccardThreshold ?? TUNABLE_DEFAULTS.duplicateJaccardThreshold, 'duplicate Jaccard threshold')
  const halfLifeDays = finite(partial.halfLifeDays ?? TUNABLE_DEFAULTS.halfLifeDays, 'importance half-life')
  const retireBelowImportance = finite(partial.retireBelowImportance ?? TUNABLE_DEFAULTS.retireBelowImportance, 'retirement importance floor')
  const retireGraceDays = finite(partial.retireGraceDays ?? TUNABLE_DEFAULTS.retireGraceDays, 'retirement grace period')
  const reflectionMinImportance = finite(partial.reflectionMinImportance ?? TUNABLE_DEFAULTS.reflectionMinImportance, 'reflection importance floor')
  const reflectionBatchLimit = finite(partial.reflectionBatchLimit ?? TUNABLE_DEFAULTS.reflectionBatchLimit, 'reflection batch limit')
  if (duplicateJaccardThreshold <= 0 || duplicateJaccardThreshold > 1) throw new Error('enterprise memory consolidation duplicate Jaccard threshold must be within (0, 1]')
  if (halfLifeDays <= 0) throw new Error('enterprise memory consolidation importance half-life must be positive')
  if (retireBelowImportance < 0) throw new Error('enterprise memory consolidation retirement importance floor must not be negative')
  if (retireGraceDays < 0) throw new Error('enterprise memory consolidation retirement grace period must not be negative')
  if (reflectionMinImportance < 0) throw new Error('enterprise memory consolidation reflection importance floor must not be negative')
  if (!Number.isSafeInteger(reflectionBatchLimit) || reflectionBatchLimit < 1) {
    throw new Error('enterprise memory consolidation reflection batch limit must be a positive integer')
  }
  return { duplicateJaccardThreshold, halfLifeDays, retireBelowImportance, retireGraceDays, reflectionMinImportance, reflectionBatchLimit }
}

/** Case-, punctuation-, and whitespace-insensitive form of one summary used for exact duplicate
 * match: NFKC, lowercased, punctuation replaced by spaces, whitespace collapsed. */
function normalizedSummary(summary: string): string {
  return summary.normalize('NFKC').toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s]/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
}

/** Distinct normalized word tokens of one summary. */
function summaryTokens(summary: string): ReadonlySet<string> {
  return new Set(normalizedSummary(summary).split(' ').filter(token => token !== ''))
}

/** Token-set Jaccard similarity of two token sets. Two empty sets only co-occur with exact
 * normalized equality, which {@link groupDuplicates} short-circuits on before calling this. */
function jaccardSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  return shared / (left.size + right.size - shared)
}

/** One entry with its precomputed duplicate-match inputs. */
interface PreparedEntry {
  readonly entry: EnterpriseMemoryEntry
  /** Input position; breaks ordering ties and lets absorbed members keep input order. */
  readonly index: number
  readonly normalized: string
  readonly tokens: ReadonlySet<string>
}

/** Group duplicate memories for superseding: exact normalized matches merge, and token-set
 * Jaccard similarity at or above `duplicateJaccardThreshold` links two entries into the same
 * group transitively, so a middle entry bridges two dissimilar endpoints. Singleton groups are
 * kept. Groups order by their earliest member and members keep input order.
 * @param entries - candidate memories of one compartment, in fetch order.
 * @param tunables - resolved consolidation thresholds.
 * @returns one array per duplicate group, in deterministic first-appearance order.
 */
export function groupDuplicates(
  entries: readonly EnterpriseMemoryEntry[],
  tunables: ConsolidationTunables,
): EnterpriseMemoryEntry[][] {
  const prepared: PreparedEntry[] = entries.map((entry, index) => ({
    entry, index, normalized: normalizedSummary(entry.summary), tokens: summaryTokens(entry.summary),
  }))
  const duplicates = (left: PreparedEntry, right: PreparedEntry): boolean =>
    left.normalized === right.normalized
    || jaccardSimilarity(left.tokens, right.tokens) >= tunables.duplicateJaccardThreshold
  const groups: PreparedEntry[][] = []
  for (const item of prepared) {
    const target = groups.find(group => group.some(member => duplicates(member, item)))
    if (target === undefined) {
      groups.push([item])
      continue
    }
    target.push(item)
    // A transitive link can bridge two existing groups; absorb every other matching group so
    // equivalence stays closed under the similarity relation.
    for (const absorbed of groups.filter(candidate => candidate !== target
      && candidate.some(member => duplicates(member, item)))) {
      target.push(...absorbed)
      groups.splice(groups.indexOf(absorbed), 1)
    }
  }
  return groups.map(group => group
    .sort((left, right) => left.index - right.index)
    .map(({ entry }) => entry))
}

/** Decay one entry's importance by its access age: `importance × 0.5^(ageDays / halfLifeDays)`,
 * where age counts from `lastAccessAt ?? updatedAt`. A future timestamp counts as age zero and
 * the result never goes below zero.
 * @param entry - the memory whose importance decays.
 * @param now - current time in epoch milliseconds.
 * @param halfLifeDays - positive importance half-life in days.
 * @returns the decayed weight, clamped at zero.
 * @throws When `halfLifeDays` is not a positive finite number.
 */
export function decayImportance(entry: EnterpriseMemoryEntry, now: number, halfLifeDays: number): number {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) {
    throw new Error('enterprise memory consolidation importance half-life must be a positive finite number of days')
  }
  const ageDays = Math.max(0, now - (entry.lastAccessAt ?? entry.updatedAt)) / DAY_MS
  return Math.max(0, entry.importance * 0.5 ** (ageDays / halfLifeDays))
}

/** Survivor and superseded split of one duplicate group. */
export interface SupersedePlan {
  /** The entry that keeps its row: latest `updatedAt`, greatest id on a tie. */
  readonly survivor: EnterpriseMemoryEntry
  /** Every other group member in input order, to retire through `supersedeMemory`. */
  readonly superseded: readonly EnterpriseMemoryEntry[]
}

/** Plan the supersede of one duplicate group: the most recent entry survives and every other
 * member is superseded by it. A single-entry group yields the survivor with nothing superseded.
 * @param group - one duplicate group from {@link groupDuplicates}.
 * @returns the survivor and the entries it supersedes.
 * @throws When the group is empty.
 */
export function supersedePlan(group: readonly EnterpriseMemoryEntry[]): SupersedePlan {
  // Group ids are unique row ids, so the id comparison never sees one entry twice and a
  // two-way ordering suffices.
  const ranked = [...group].sort((left, right) =>
    right.updatedAt - left.updatedAt || (left.id > right.id ? -1 : 1))
  const survivor = ranked[0]
  if (survivor === undefined) throw new Error('enterprise memory consolidation supersede plan requires a non-empty duplicate group')
  return { survivor, superseded: group.filter(entry => entry !== survivor) }
}

/** Whether one entry may retire: its decayed importance is strictly below
 * `retireBelowImportance` and its last access (falling back to `updatedAt`) lies before the
 * `retireGraceDays` cutoff — an access exactly `retireGraceDays` old still counts as grace.
 * @param entry - the memory under review.
 * @param now - current time in epoch milliseconds.
 * @param tunables - resolved consolidation thresholds.
 * @returns true when the entry is decayed and stale enough to retire.
 */
export function retirePlan(entry: EnterpriseMemoryEntry, now: number, tunables: ConsolidationTunables): boolean {
  const decayed = decayImportance(entry, now, tunables.halfLifeDays)
  const cutoff = now - tunables.retireGraceDays * DAY_MS
  return decayed < tunables.retireBelowImportance && (entry.lastAccessAt ?? entry.updatedAt) < cutoff
}

/** Select private-note reflection candidates: approved `agent` entries that are not already
 * summaries, carry no superseding row, and still hold decayed importance at or above
 * `reflectionMinImportance`, oldest access first, capped at `reflectionBatchLimit`.
 * @param privateEntries - entries fetched from the agent compartment.
 * @param now - current time in epoch milliseconds, anchoring both the decay and the oldest-first order.
 * @param tunables - resolved consolidation thresholds.
 * @returns the selected candidates, oldest first.
 */
export function reflectionCandidates(
  privateEntries: readonly EnterpriseMemoryEntry[],
  now: number,
  tunables: ConsolidationTunables,
): EnterpriseMemoryEntry[] {
  return privateEntries
    .map((entry, index) => ({ entry, index, accessAt: entry.lastAccessAt ?? entry.updatedAt }))
    .filter(({ entry }) => entry.scope === 'agent'
      && entry.kind !== 'summary'
      && entry.invalidatedBy === undefined
      && entry.status === 'approved'
      && decayImportance(entry, now, tunables.halfLifeDays) >= tunables.reflectionMinImportance)
    .sort((left, right) => left.accessAt - right.accessAt || left.index - right.index)
    .slice(0, tunables.reflectionBatchLimit)
    .map(({ entry }) => entry)
}
