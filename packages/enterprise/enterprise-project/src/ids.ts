/**
 * Branded identifier owned by the project governance service.
 *
 * `Branded<B>` comes from the zero-dependency `@deepseek-ai/dsh-brand`; the
 * underlying value is the `projects.project_id` text column of the migrated
 * enterprise project database. Member rows are keyed by `(projectId,
 * principalType, principalId)` and carry no brand of their own: principal ids
 * belong to the identity and employee-account stores.
 *
 * @module @deepseek-ai/dsh-enterprise-project/ids
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Durable identifier of one enterprise project. */
export type ProjectId = Branded<'ProjectId'>

/**
 * Brand a string as a {@link ProjectId}.
 * @param value - the raw `projects.project_id` string.
 * @returns the same string, branded; no validation is performed.
 */
export function projectId(value: string): ProjectId {
  return value as ProjectId
}
