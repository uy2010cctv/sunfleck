import type { EnterpriseMemoryEntry } from '@deepseek-ai/dsh-enterprise-identity'

const SCOPE_BONUS: Readonly<Record<EnterpriseMemoryEntry['scope'], number>> = {
  organization: 0,
  department: 0.1,
  user: 0.2,
}

function terms(value: string): Set<string> {
  const normalized = value.normalize('NFKC').toLocaleLowerCase()
  const result = new Set(normalized.match(/[a-z0-9][a-z0-9_-]+/gu) ?? [])
  for (const sequence of normalized.match(/[\p{Script=Han}]+/gu) ?? []) {
    for (const char of sequence) result.add(char)
    for (let index = 0; index + 1 < sequence.length; index++) result.add(sequence.slice(index, index + 2))
  }
  return result
}

/** Select an ACL-filtered, deterministic memory pack for the current task text. */
export function selectRelevantMemory(
  entries: readonly EnterpriseMemoryEntry[],
  query: string,
  limit: number,
): EnterpriseMemoryEntry[] {
  if (limit <= 0) return []
  const queryTerms = terms(query)
  if (queryTerms.size === 0) {
    return entries.toSorted((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
      .slice(0, limit)
  }
  return entries.map((entry) => {
    let overlap = 0
    for (const term of terms(entry.summary)) if (queryTerms.has(term)) overlap++
    return { entry, score: overlap + SCOPE_BONUS[entry.scope] }
  }).filter(candidate => candidate.score > SCOPE_BONUS[candidate.entry.scope])
    .toSorted((left, right) => right.score - left.score
      || right.entry.updatedAt - left.entry.updatedAt
      || left.entry.id.localeCompare(right.entry.id))
    .slice(0, limit)
    .map(candidate => candidate.entry)
}
