/** Privacy and prompt-safety gate for shared enterprise memory candidates. */

import { createHash } from 'node:crypto'

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

/** Produce an immutable source reference without retaining the source body.
 * @param source - Input value used by this API.
 * @returns Result produced by this API.
 */
export function memorySourceDigest(source: string): string {
  return createHash('sha256').update(source).digest('hex')
}
