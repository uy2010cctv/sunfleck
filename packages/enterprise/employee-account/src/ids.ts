/**
 * Branded identifiers owned by the persistent employee account service.
 *
 * `Branded<B>` comes from the zero-dependency `@deepseek-ai/dsh-brand`; the
 * underlying values are the `employee_accounts.id`, `surfaces.id`, and
 * `employee_inbox.id` text columns of the migrated enterprise identity
 * database.
 *
 * @module @deepseek-ai/dsh-employee-account/ids
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Durable identifier of one persistent digital employee. */
export type EmployeeId = Branded<'EmployeeId'>

/** Durable identifier of one direct-message surface between a user and an employee. */
export type SurfaceId = Branded<'SurfaceId'>

/** Durable identifier of one queued employee inbox item. */
export type InboxItemId = Branded<'InboxItemId'>

/**
 * Brand a string as an {@link EmployeeId}.
 * @param value - the raw `employee_accounts.id` string.
 * @returns the same string, branded; no validation is performed.
 */
export function employeeId(value: string): EmployeeId {
  return value as EmployeeId
}

/**
 * Brand a string as a {@link SurfaceId}.
 * @param value - the raw `surfaces.id` string.
 * @returns the same string, branded; no validation is performed.
 */
export function surfaceId(value: string): SurfaceId {
  return value as SurfaceId
}

/**
 * Brand a string as an {@link InboxItemId}.
 * @param value - the raw `employee_inbox.id` string.
 * @returns the same string, branded; no validation is performed.
 */
export function inboxItemId(value: string): InboxItemId {
  return value as InboxItemId
}
