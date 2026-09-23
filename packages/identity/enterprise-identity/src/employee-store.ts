/** Durable employee-identity row store: the only module that executes SQL for persistent employees. */

import type { DatabaseSync } from 'node:sqlite'

/** One durable employee account row; `createdAt` and `updatedAt` are epoch milliseconds. */
export interface EmployeeAccountRow {
  readonly id: string
  readonly orgId: string
  readonly displayName: string
  readonly roleCard: string
  readonly activeReleaseId: string | null
  readonly state: 'active' | 'suspended' | 'archived'
  readonly homeWorkspacePath: string
  readonly createdAt: number
  readonly updatedAt: number
}

/** One durable direct-message surface row; `createdAt` is epoch milliseconds. */
export interface SurfaceRow {
  readonly id: string
  readonly orgId: string
  readonly kind: 'dm'
  readonly userId: string
  readonly employeeId: string
  readonly sessionId: string | null
  readonly createdAt: number
}

/** One durable employee inbox row; `createdAt` and `deliveredAt` are epoch milliseconds. */
export interface InboxRow {
  readonly id: string
  readonly orgId: string
  readonly employeeId: string
  readonly surfaceId: string
  readonly originActor: string
  readonly payloadText: string
  readonly state: 'queued' | 'delivered' | 'failed'
  readonly attempts: number
  readonly createdAt: number
  readonly deliveredAt: number | null
}

const EMPLOYEE_STATES = ['active', 'suspended', 'archived'] as const
const INBOX_STATES = ['queued', 'delivered', 'failed'] as const
const SURFACE_KINDS = ['dm'] as const

/** Read one closed-set text column. STRICT tables guarantee the stored type; the value set is
 * re-validated here because CHECK enforcement can be disabled and schema versions can drift.
 * @param row - Raw column map read from SQLite.
 * @param column - Column name, used in the failure message.
 * @param values - Closed value set the column may hold.
 * @returns The stored value narrowed to the closed set.
 */
function enumColumn<T extends string>(row: Record<string, unknown>, column: string, values: readonly T[]): T {
  const value = row[column]
  if (!values.includes(value as T)) {
    throw new Error(`enterprise identity database contains an invalid ${column} value: ${String(value)}`)
  }
  return value as T
}

/** Parse one employee_accounts row.
 * @param row - Raw column map read from SQLite.
 * @returns The parsed employee account.
 */
function employeeFromRow(row: Record<string, unknown>): EmployeeAccountRow {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    displayName: row.display_name as string,
    roleCard: row.role_card as string,
    activeReleaseId: row.active_release_id as string | null,
    state: enumColumn(row, 'state', EMPLOYEE_STATES),
    homeWorkspacePath: row.home_workspace_path as string,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

/** Parse one surfaces row.
 * @param row - Raw column map read from SQLite.
 * @returns The parsed surface.
 */
function surfaceFromRow(row: Record<string, unknown>): SurfaceRow {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    kind: enumColumn(row, 'kind', SURFACE_KINDS),
    userId: row.user_id as string,
    employeeId: row.employee_id as string,
    sessionId: row.session_id as string | null,
    createdAt: row.created_at as number,
  }
}

/** Parse one employee_inbox row.
 * @param row - Raw column map read from SQLite.
 * @returns The parsed inbox item.
 */
function inboxFromRow(row: Record<string, unknown>): InboxRow {
  return {
    id: row.id as string,
    orgId: row.org_id as string,
    employeeId: row.employee_id as string,
    surfaceId: row.surface_id as string,
    originActor: row.origin_actor as string,
    payloadText: row.payload_text as string,
    state: enumColumn(row, 'state', INBOX_STATES),
    attempts: row.attempts as number,
    createdAt: row.created_at as number,
    deliveredAt: row.delivered_at as number | null,
  }
}

/** Create one employee account row.
 * @param database - Migrated enterprise identity database.
 * @param row - Complete employee account row to insert.
 * @throws When an employee account with the same id already exists.
 */
export function createEmployee(database: DatabaseSync, row: EmployeeAccountRow): void {
  database.prepare(`INSERT INTO employee_accounts(
      id, org_id, display_name, role_card, active_release_id, state,
      home_workspace_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    row.id, row.orgId, row.displayName, row.roleCard, row.activeReleaseId, row.state,
    row.homeWorkspacePath, row.createdAt, row.updatedAt,
  )
}

/** Read one employee account by id.
 * @param database - Migrated enterprise identity database.
 * @param id - Employee account id.
 * @returns The stored employee account, or undefined when the id is unknown.
 */
export function getEmployee(database: DatabaseSync, id: string): EmployeeAccountRow | undefined {
  const row = database.prepare('SELECT * FROM employee_accounts WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row === undefined ? undefined : employeeFromRow(row)
}

/** List one organization's employee accounts in creation order.
 * @param database - Migrated enterprise identity database.
 * @param orgId - Organization id whose employees are listed.
 * @param options - Pass `includeArchived` to also return archived accounts.
 * @returns The matching employee accounts ordered by creation time and id.
 */
export function listEmployees(
  database: DatabaseSync,
  orgId: string,
  options?: { includeArchived?: boolean },
): EmployeeAccountRow[] {
  const archivedClause = (options?.includeArchived ?? false) ? '' : " AND state != 'archived'"
  const rows = database.prepare(
    `SELECT * FROM employee_accounts WHERE org_id = ?${archivedClause} ORDER BY created_at, id`,
  ).all(orgId) as unknown as Record<string, unknown>[]
  return rows.map(employeeFromRow)
}

/** Move one employee account to a new lifecycle state; `archived` is terminal.
 * @param database - Migrated enterprise identity database.
 * @param id - Employee account id.
 * @param state - New lifecycle state.
 * @param at - State-change time in epoch milliseconds.
 * @throws When the employee account is missing or already archived.
 * Single-writer assumption: the archived check and the update are one check-then-act pair, atomic
 * only under the current single-connection in-process usage (docs/defensive-patterns.md).
 */
export function updateEmployeeState(
  database: DatabaseSync,
  id: string,
  state: 'active' | 'suspended' | 'archived',
  at: number,
): void {
  const current = database.prepare('SELECT state FROM employee_accounts WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  if (current === undefined) throw new Error('enterprise employee is missing')
  if (enumColumn(current, 'state', EMPLOYEE_STATES) === 'archived') {
    throw new Error(`enterprise employee ${id} is archived and cannot change state`)
  }
  database.prepare('UPDATE employee_accounts SET state = ?, updated_at = ? WHERE id = ?').run(state, at, id)
}

/** Return the existing direct-message surface for a (user, employee) pair, creating it when absent.
 * @param database - Migrated enterprise identity database.
 * @param row - Surface row to insert when the pair is not yet bound.
 * @returns The durable surface row for the pair; an existing row wins over the requested id.
 * Single-writer assumption: the lookup and the insert are one check-then-act pair, atomic only
 * under the current single-connection in-process usage (docs/defensive-patterns.md).
 */
export function ensureSurface(database: DatabaseSync, row: SurfaceRow): SurfaceRow {
  const existing = database.prepare('SELECT * FROM surfaces WHERE user_id = ? AND employee_id = ?')
    .get(row.userId, row.employeeId) as Record<string, unknown> | undefined
  if (existing !== undefined) return surfaceFromRow(existing)
  database.prepare(`INSERT INTO surfaces(id, org_id, kind, user_id, employee_id, session_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    row.id, row.orgId, row.kind, row.userId, row.employeeId, row.sessionId, row.createdAt,
  )
  return row
}

/** Attach one live session to a direct-message surface.
 * @param database - Migrated enterprise identity database.
 * @param id - Surface id.
 * @param sessionId - Session id now serving the surface.
 * @throws When the surface is missing.
 */
export function attachSurfaceSession(database: DatabaseSync, id: string, sessionId: string): void {
  const result = database.prepare('UPDATE surfaces SET session_id = ? WHERE id = ?').run(sessionId, id)
  if (Number(result.changes) === 0) throw new Error('enterprise surface is missing')
}

/** Insert one queued employee inbox row.
 * @param database - Migrated enterprise identity database.
 * @param row - Complete inbox row; callers enqueue in the queued state.
 */
export function enqueueInbox(database: DatabaseSync, row: InboxRow): void {
  database.prepare(`INSERT INTO employee_inbox(
      id, org_id, employee_id, surface_id, origin_actor, payload_text, state, attempts, created_at, delivered_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    row.id, row.orgId, row.employeeId, row.surfaceId, row.originActor, row.payloadText,
    row.state, row.attempts, row.createdAt, row.deliveredAt,
  )
}

/** Take an employee's queued inbox rows in creation order and mark them delivered.
 * @param database - Migrated enterprise identity database.
 * @param employeeId - Employee account whose inbox is claimed.
 * @param limit - Maximum number of rows to take; must be non-negative (SQLite treats a negative limit as unlimited).
 * @param at - Delivery time in epoch milliseconds.
 * @returns The claimed rows in creation order, updated to the delivered state.
 */
export function claimInbox(database: DatabaseSync, employeeId: string, limit: number, at: number): InboxRow[] {
  const rows = database.prepare(`
    UPDATE employee_inbox SET state = 'delivered', delivered_at = ?
    WHERE id IN (
      SELECT id FROM employee_inbox
      WHERE employee_id = ? AND state = 'queued'
      ORDER BY created_at, id
      LIMIT ?
    )
    RETURNING *`).all(at, employeeId, limit) as unknown as Record<string, unknown>[]
  return rows.map(inboxFromRow)
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
}

/** Mark one inbox row failed after a delivery attempt so later claims skip it.
 * @param database - Migrated enterprise identity database.
 * @param id - Inbox row id.
 * @param at - Failure time in epoch milliseconds, recorded in `delivered_at` as the row's terminal time.
 * @throws When the inbox row is missing.
 */
export function failInboxItem(database: DatabaseSync, id: string, at: number): void {
  const result = database.prepare(
    "UPDATE employee_inbox SET state = 'failed', delivered_at = ? WHERE id = ?",
  ).run(at, id)
  if (Number(result.changes) === 0) throw new Error('enterprise inbox item is missing')
}

/** Bind one actor key to an employee account, replacing any previous binding for the pair.
 * @param database - Migrated enterprise identity database.
 * @param orgId - Organization the actor key belongs to.
 * @param actorKey - Opaque actor key whose requests stick to one employee.
 * @param employeeId - Employee account the actor key binds to.
 * @param at - Binding time in epoch milliseconds.
 */
export function bindSticky(
  database: DatabaseSync,
  orgId: string,
  actorKey: string,
  employeeId: string,
  at: number,
): void {
  database.prepare(`INSERT INTO sticky_bindings(org_id, actor_key, employee_id, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(org_id, actor_key) DO UPDATE SET
      employee_id = excluded.employee_id,
      updated_at = excluded.updated_at`).run(orgId, actorKey, employeeId, at)
}

/** Read the employee account an actor key is bound to.
 * @param database - Migrated enterprise identity database.
 * @param orgId - Organization the actor key belongs to.
 * @param actorKey - Opaque actor key to resolve.
 * @returns The bound employee account id, or undefined when the key is unbound.
 */
export function resolveSticky(database: DatabaseSync, orgId: string, actorKey: string): string | undefined {
  const row = database.prepare(
    'SELECT employee_id FROM sticky_bindings WHERE org_id = ? AND actor_key = ?',
  ).get(orgId, actorKey) as { employee_id: string } | undefined
  return row?.employee_id
}
