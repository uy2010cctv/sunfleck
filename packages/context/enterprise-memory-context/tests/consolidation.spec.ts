import { describe, expect, it } from 'vitest'
import type { EnterpriseMemoryEntry } from '@deepseek-ai/dsh-enterprise-identity'
import {
  consolidationTunables, decayImportance, groupDuplicates, reflectionCandidates, retirePlan, supersedePlan,
} from '../src/consolidation.ts'

/** One day in epoch milliseconds. */
const DAY_MS = 86_400_000
let sequence = 0

/** Build one memory entry; ids increase with call order so id tie-breaks stay predictable. */
function entry(overrides: Partial<EnterpriseMemoryEntry> & { summary: string }): EnterpriseMemoryEntry {
  sequence += 1
  return {
    id: `memory-${String(sequence)}`, orgId: 'org-a', scope: 'department', kind: 'process', status: 'approved',
    sourceDigest: 'a'.repeat(64), privacyFindings: [], importance: 0,
    createdBy: 'user-1', revision: 1, createdAt: 1, updatedAt: 2,
    ...overrides,
  }
}

describe('consolidation tunables', () => {
  it('resolves every omitted tunable to its documented default', () => {
    expect(consolidationTunables()).toEqual({
      duplicateJaccardThreshold: 0.6, halfLifeDays: 30, retireBelowImportance: 0.1,
      retireGraceDays: 14, reflectionMinImportance: 0.5, reflectionBatchLimit: 3,
    })
  })

  it('overrides individual tunables and rejects invalid ones loudly', () => {
    expect(consolidationTunables({ reflectionBatchLimit: 5, halfLifeDays: 7 })).toMatchObject({
      reflectionBatchLimit: 5, halfLifeDays: 7,
    })
    expect(() => consolidationTunables({ duplicateJaccardThreshold: 1.5 })).toThrow(/threshold/iu)
    expect(() => consolidationTunables({ duplicateJaccardThreshold: 0 })).toThrow(/threshold/iu)
    expect(() => consolidationTunables({ halfLifeDays: Number.NaN })).toThrow(/finite/iu)
    expect(() => consolidationTunables({ halfLifeDays: 0 })).toThrow(/half-life/iu)
    expect(() => consolidationTunables({ retireBelowImportance: -1 })).toThrow(/importance floor/iu)
    expect(() => consolidationTunables({ retireGraceDays: -1 })).toThrow(/grace/iu)
    expect(() => consolidationTunables({ reflectionMinImportance: Number.POSITIVE_INFINITY })).toThrow(/finite/iu)
    expect(() => consolidationTunables({ reflectionMinImportance: -1 })).toThrow(/importance floor/iu)
    expect(() => consolidationTunables({ reflectionBatchLimit: 0 })).toThrow(/batch limit/iu)
    expect(() => consolidationTunables({ reflectionBatchLimit: 1.5 })).toThrow(/batch limit/iu)
  })
})

describe('duplicate grouping', () => {
  it('merges exact normalized duplicates across case, punctuation and whitespace', () => {
    const first = entry({ summary: '月度报表于每月 5 日前完成。' })
    const second = entry({ summary: '月度报表于每月 5 日前完成' })
    const other = entry({ summary: '完全不同的另一条记忆内容' })
    expect(groupDuplicates([first, second, other], consolidationTunables())).toEqual([[first, second], [other]])
  })

  it('groups entries at the Jaccard threshold and keeps dissimilar pairs in singletons', () => {
    const first = entry({ summary: 'alpha beta gamma delta' })
    const atThreshold = entry({ summary: 'alpha beta gamma epsilon' })
    const dissimilar = entry({ summary: 'zeta eta theta iota' })
    expect(groupDuplicates([first, atThreshold, dissimilar], consolidationTunables()))
      .toEqual([[first, atThreshold], [dissimilar]])
    const belowThreshold = entry({ summary: 'alpha beta epsilon zeta' })
    expect(groupDuplicates([first, belowThreshold], consolidationTunables())).toEqual([[first], [belowThreshold]])
  })

  it('chains transitively so a bridge entry merges two otherwise dissimilar groups', () => {
    const first = entry({ summary: 'alpha beta gamma delta' })
    const second = entry({ summary: 'gamma delta epsilon zeta' })
    const bridge = entry({ summary: 'alpha beta gamma delta epsilon zeta' })
    expect(groupDuplicates([first, second, bridge], consolidationTunables())).toEqual([[first, second, bridge]])
  })

  it('keeps groups and members in deterministic input order', () => {
    const dissimilar = entry({ summary: 'zeta eta theta iota' })
    const second = entry({ summary: 'alpha beta gamma epsilon' })
    const first = entry({ summary: 'alpha beta gamma delta' })
    expect(groupDuplicates([dissimilar, second, first], consolidationTunables()))
      .toEqual([[dissimilar], [second, first]])
  })

  it('merges punctuation-only summaries through exact normalized equality', () => {
    const first = entry({ summary: '!!!' })
    const second = entry({ summary: '。；' })
    expect(groupDuplicates([first, second], consolidationTunables())).toEqual([[first, second]])
  })

  it('moves the grouping boundary when the threshold tunable changes', () => {
    const first = entry({ summary: 'alpha beta gamma delta' })
    const second = entry({ summary: 'alpha beta gamma epsilon' })
    expect(groupDuplicates([first, second], consolidationTunables({ duplicateJaccardThreshold: 0.7 })))
      .toEqual([[first], [second]])
    expect(groupDuplicates([first, second], consolidationTunables({ duplicateJaccardThreshold: 0.6 })))
      .toEqual([[first, second]])
  })

  it('returns no groups for an empty compartment', () => {
    expect(groupDuplicates([], consolidationTunables())).toEqual([])
  })
})

describe('importance decay', () => {
  it('halves the weight per elapsed half-life from the last access or update time', () => {
    const now = 1_000 * DAY_MS
    const accessed = entry({ summary: 'a', importance: 1, lastAccessAt: now - 30 * DAY_MS })
    expect(decayImportance(accessed, now, 30)).toBeCloseTo(0.5)
    const neverAccessed = entry({ summary: 'b', importance: 2, updatedAt: now - 60 * DAY_MS })
    expect(decayImportance(neverAccessed, now, 30)).toBeCloseTo(0.5)
  })

  it('treats future timestamps as age zero and never returns a negative weight', () => {
    const now = 1_000 * DAY_MS
    const future = entry({ summary: 'f', importance: 0.75, lastAccessAt: now + DAY_MS })
    expect(decayImportance(future, now, 30)).toBe(0.75)
    expect(decayImportance(entry({ summary: 'z', importance: 0, updatedAt: now - 90 * DAY_MS }), now, 30)).toBe(0)
  })

  it('rejects a non-positive half-life', () => {
    expect(() => decayImportance(entry({ summary: 'x', importance: 1 }), 1, 0)).toThrow(/half-life/iu)
  })
})

describe('supersede planning', () => {
  it('keeps the most recent entry and supersedes the rest in input order', () => {
    const oldest = entry({ summary: 'a', updatedAt: 10 })
    const newest = entry({ summary: 'b', updatedAt: 30 })
    const middle = entry({ summary: 'c', updatedAt: 20 })
    const plan = supersedePlan([oldest, newest, middle])
    expect(plan.survivor).toBe(newest)
    expect(plan.superseded).toEqual([oldest, middle])
  })

  it('breaks an updated-at tie by the greater id', () => {
    const earlierId = entry({ summary: 'a', updatedAt: 10 })
    const laterId = entry({ summary: 'z', updatedAt: 10 })
    expect(supersedePlan([earlierId, laterId]).survivor).toBe(laterId)
    expect(supersedePlan([laterId, earlierId]).survivor).toBe(laterId)
  })

  it('returns a lone entry without superseded rows and rejects an empty group', () => {
    const only = entry({ summary: 'only' })
    expect(supersedePlan([only])).toEqual({ survivor: only, superseded: [] })
    expect(() => supersedePlan([])).toThrow(/group/iu)
  })
})

describe('retirement planning', () => {
  const now = 1_000 * DAY_MS
  const tunables = consolidationTunables()

  it('retires entries decayed below the floor whose last access predates the grace cutoff', () => {
    const stale = entry({ summary: 's', importance: 0.2, updatedAt: now - 90 * DAY_MS })
    expect(retirePlan(stale, now, tunables)).toBe(true)
  })

  it('keeps entries accessed within the grace window even when fully decayed', () => {
    const fresh = entry({ summary: 'f', importance: 0.2, updatedAt: now - 7 * DAY_MS })
    expect(retirePlan(fresh, now, tunables)).toBe(false)
  })

  it('keeps entries whose decayed importance still reaches the floor', () => {
    const important = entry({ summary: 'i', importance: 4, updatedAt: now - 90 * DAY_MS })
    expect(retirePlan(important, now, tunables)).toBe(false)
  })

  it('counts an access exactly at the grace cutoff as within grace', () => {
    expect(retirePlan(
      entry({ summary: 't', importance: 0, updatedAt: now - 90 * DAY_MS, lastAccessAt: now - 14 * DAY_MS }),
      now, tunables,
    )).toBe(false)
    expect(retirePlan(
      entry({ summary: 'u', importance: 0, updatedAt: now - 90 * DAY_MS, lastAccessAt: now - 14 * DAY_MS - 1 }),
      now, tunables,
    )).toBe(true)
  })

  it('keeps entries whose decayed importance lands exactly on the floor', () => {
    expect(retirePlan(
      entry({ summary: 'e', importance: 0.2, updatedAt: now - 30 * DAY_MS }),
      now, tunables,
    )).toBe(false)
  })
})

describe('reflection candidate selection', () => {
  const now = 1_000 * DAY_MS
  const tunables = consolidationTunables()

  it('selects approved, non-superseded agent notes above the decayed floor, oldest first, capped', () => {
    const rejected = entry({ summary: 'r', scope: 'agent', status: 'rejected', importance: 1, updatedAt: now - DAY_MS })
    const summaryKind = entry({ summary: 'k', scope: 'agent', kind: 'summary', importance: 1, updatedAt: now - DAY_MS })
    const superseded = entry({ summary: 'v', scope: 'agent', importance: 1, updatedAt: now - DAY_MS, invalidatedBy: 'memory-9' })
    const shared = entry({ summary: 's', scope: 'department', importance: 1, updatedAt: now - DAY_MS })
    const weak = entry({ summary: 'w', scope: 'agent', importance: 0.25, updatedAt: now - 20 * DAY_MS })
    const old = entry({ summary: 'old', scope: 'agent', importance: 2, updatedAt: now - 10 * DAY_MS, lastAccessAt: now - 40 * DAY_MS })
    const newer = entry({ summary: 'new', scope: 'agent', importance: 1, updatedAt: now - 5 * DAY_MS })
    const extra = entry({ summary: 'extra', scope: 'agent', importance: 1, updatedAt: now - 2 * DAY_MS })
    expect(reflectionCandidates([rejected, summaryKind, superseded, shared, weak, newer, old, extra], now, tunables))
      .toEqual([old, newer, extra])
  })

  it('honors the batch limit and importance floor tunables', () => {
    const first = entry({ summary: 'a', scope: 'agent', importance: 0.65, updatedAt: now - 10 * DAY_MS })
    const second = entry({ summary: 'b', scope: 'agent', importance: 0.65, updatedAt: now - 5 * DAY_MS })
    expect(reflectionCandidates([second, first], now, consolidationTunables({ reflectionBatchLimit: 1 })))
      .toEqual([first])
    expect(reflectionCandidates([first, second], now, consolidationTunables({ reflectionMinImportance: 0.55 })))
      .toEqual([second])
  })

  it('breaks an access-time tie by input order', () => {
    const laterInput = entry({ summary: 'a', scope: 'agent', importance: 1, lastAccessAt: now })
    const earlierInput = entry({ summary: 'b', scope: 'agent', importance: 1, lastAccessAt: now })
    expect(reflectionCandidates([laterInput, earlierInput], now, consolidationTunables({ reflectionBatchLimit: 1 })))
      .toEqual([laterInput])
  })

  it('selects nothing from an empty compartment', () => {
    expect(reflectionCandidates([], now, tunables)).toEqual([])
  })
})
