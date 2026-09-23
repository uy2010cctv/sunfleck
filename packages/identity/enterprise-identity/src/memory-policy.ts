/** Privacy and prompt-safety gate for enterprise memory candidates. */

import { createHash } from 'node:crypto'
import type { MemoryScope } from './repository.ts'

/** Allowed values for `EnterpriseMemoryPrivacyFinding`. */
export type EnterpriseMemoryPrivacyFinding =
  | 'email-address'
  | 'telephone-number'
  | 'government-identifier'
  | 'credential-shaped-content'
  | 'personal-preference'
  | 'prompt-injection'
  | 'summary-too-long'

/** Data used by `EnterpriseMemoryInspection`. */
export interface EnterpriseMemoryInspection {
  readonly allowed: boolean
  readonly findings: readonly EnterpriseMemoryPrivacyFinding[]
}

const RULES: ReadonlyArray<readonly [EnterpriseMemoryPrivacyFinding, RegExp]> = [
  ['email-address', /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
  ['telephone-number', /(?:\+?86[- ]?)?1[3-9]\d{9}|\+\d{7,15}/u],
  ['government-identifier', /\b\d{17}[\dX]\b/iu],
  ['credential-shaped-content', /(?:api[_ -]?key|password|passwd|secret|token|bearer|private[_ -]?key)\s*[:=]\s*\S+/iu],
  ['personal-preference', /(?:我(?:喜欢|不喜欢|偏好|的生日|的家庭|的住址|的性格)|I\s+(?:prefer|dislike)|my\s+(?:birthday|home address|family))/iu],
  ['prompt-injection', /(?:ignore\s+(?:all\s+)?previous\s+instructions|system\s+prompt|忽略(?:以上|之前|所有)指令|系统提示词)/iu],
]

/** Inspect only a proposed summary and return finding names without matched values.
 * @param summary - Input value used by this API.
 * @returns Result produced by this API.
 */
export function inspectEnterpriseMemory(summary: string): EnterpriseMemoryInspection {
  const findings: EnterpriseMemoryPrivacyFinding[] = []
  if (summary.length > 2_000) findings.push('summary-too-long')
  for (const [finding, pattern] of RULES) if (pattern.test(summary)) findings.push(finding)
  return { allowed: findings.length === 0, findings }
}

/** Compartments whose memories reach people beyond their writer; `project` is stored from P1
 * without writers yet and still counts as shared. */
const SHARED_SCOPES: readonly MemoryScope[] = ['organization', 'department', 'project']
/** Findings that block a memory write in every compartment. */
const UNIVERSAL_BLOCKS: readonly EnterpriseMemoryPrivacyFinding[] = ['prompt-injection', 'summary-too-long']

/** Data used by `EnterpriseMemoryScopeDecision`. */
export interface EnterpriseMemoryScopeDecision {
  /** Whether the content may be written into the requested scope. */
  readonly allowed: boolean
  /** Findings that blocked the write; empty when allowed. */
  readonly blocked: readonly EnterpriseMemoryPrivacyFinding[]
}

/** Classify one memory candidate's findings against its target compartment. `prompt-injection` and
 * `summary-too-long` block every scope. The shared scopes (organization, department, project) block
 * every remaining finding too, so personal preferences and recorded personal data never enter
 * shared memory, while the private `agent` and `pair` compartments record them without blocking.
 * @param findings - Findings reported by `inspectEnterpriseMemory` for the candidate summary.
 * @param scope - Compartment the candidate would be written into.
 * @returns The write decision carrying the blocking findings.
 */
export function classifyPrivacyForScope(
  findings: readonly EnterpriseMemoryPrivacyFinding[],
  scope: MemoryScope,
): EnterpriseMemoryScopeDecision {
  const blocked = SHARED_SCOPES.includes(scope)
    ? [...findings]
    : findings.filter(finding => UNIVERSAL_BLOCKS.includes(finding))
  return { allowed: blocked.length === 0, blocked }
}

/** Produce an immutable source reference without retaining the source body.
 * @param source - Input value used by this API.
 * @returns Result produced by this API.
 */
export function memorySourceDigest(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}
