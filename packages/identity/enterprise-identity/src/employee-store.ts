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

/** One durable direct-message surface row; `createdAt` is epoch milliseconds. Only dm rows carry
 * the user-employee pair; group and channel rows keep both columns NULL. */
export interface SurfaceRow {
  readonly id: string
  readonly orgId: string
  readonly kind: 'dm'
  readonly userId: string
  readonly employeeId: string
  readonly sessionId: string | null
  readonly createdAt: number
}

/** Columns shared by the group and channel surface rows; both keep the dm pair columns NULL. */
interface TeamSurfaceRowBase {
  readonly id: string
  readonly orgId: string
  readonly userId: null
  readonly employeeId: null
  readonly sessionId: string | null
  readonly createdAt: number
  readonly name: string
  readonly externalKey?: string
  readonly teamDefinitionId?: string
  readonly projectId?: string
  readonly dutyEmployeeIds: readonly string[]
}

/** One durable group surface row; `createdAt` is epoch milliseconds. */
export interface GroupSurfaceRow extends TeamSurfaceRowBase {
  readonly kind: 'group'
}

/** One durable channel surface row; `createdAt` is epoch milliseconds. */
export interface ChannelSurfaceRow extends TeamSurfaceRowBase {
  readonly kind: 'channel'
  readonly topicPolicy: 'thread' | 'command' | 'lane'
  readonly respondPolicy: 'mention_duty' | 'ingest_only'
}

/** One surface member principal; `roleId` is a deployment-defined role reference. */
export interface SurfaceMemberRow {
  readonly surfaceId: string
  readonly principalType: 'user' | 'employee'
  readonly principalId: string
  readonly roleId?: string
}

/** One channel topic row; `createdAt` and `settledAt` are epoch milliseconds. */
export interface ChannelTopicRow {
  readonly topicId: string
  readonly surfaceId: string
  readonly title: string
  readonly state: 'open' | 'settled' | 'archived'
  readonly sessionId?: string
  readonly createdBy: string
  readonly createdAt: number
  readonly settledAt?: number
}

/** Data used by `ensureGroupSurface`; rows without an `externalKey` are keyed by id alone. */
export interface EnsureGroupSurfaceRow {
  readonly id: string
  readonly orgId: string
  readonly name: string
  readonly externalKey?: string
  readonly teamDefinitionId?: string
  readonly projectId?: string
  readonly createdAt: number
}

/** Data used by `ensureChannelSurface`. */
export interface EnsureChannelSurfaceRow extends EnsureGroupSurfaceRow {
  readonly topicPolicy: 'thread' | 'command' | 'lane'
  readonly respondPolicy: 'mention_duty' | 'ingest_only'
  readonly dutyEmployeeIds: readonly string[]
}

/** Data used by `ensureTopic`; new topics start open with no settled time. */
export interface EnsureTopicRow {
  readonly topicId: string
  readonly surfaceId: string
  readonly title: string
  readonly createdBy: string
  readonly sessionId?: string
  readonly createdAt: number
}

/** Data used by `setSurfaceMembers`; the stored set is deduplicated on the principal pair. */
export interface SurfaceMemberInput {
  readonly principalType: 'user' | 'employee'
  readonly principalId: string
  readonly roleId?: string
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
const SURFACE_KINDS = ['dm', 'group', 'channel'] as const
const TOPIC_POLICIES = ['thread', 'command', 'lane'] as const
const RESPOND_POLICIES = ['mention_duty', 'ingest_only'] as const
const TOPIC_STATES = ['open', 'settled', 'archived'] as const
const PRINCIPAL_TYPES = ['user', 'employee'] as const

/** Read one closed-set text column. STRICT tables guarantee the stored type; the value set is
 * re-validated here because CHECK enforcement can be disabled and schema versions can drift.
 * @param row - Raw column map read from SQLite.
 * @param column - Column name, used in the failure message.
 * @param values - Closed value set the column may hold.
 * @returns The stored value narrowed to the closed set.
 */
export function enumColumn<T extends string>(row: object, column: string, values: readonly T[]): T {
  const value = (row as Record<string, unknown>)[column]
  if (!values.includes(value as T)) {
    throw new Error(`enterprise identity database contains an invalid ${column} value: ${String(value)}`)
  }
  return value as T
}

/** Parse one nullable JSON string-array column such as `duty_employee_ids`; the array values are
 * app-validated on write and re-validated here because the column carries no CHECK.
 * @param row - Raw column map read from SQLite.
 * @param column - Column name, used in the failure message.
 * @returns The parsed string array; empty when the column is NULL.
 */
function jsonStringArray(row: Record<string, unknown>, column: string): string[] {
  const value = row[column]
  if (value === null || value === undefined) return []
  // The column is app-written JSON text; STRICT typing guarantees the stored string.
  const text = value as string
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause: unknown) {
    throw new Error(`enterprise identity database contains an invalid ${column} value: ${text}`, { cause })
  }
  if (!Array.isArray(parsed) || parsed.some(item => typeof item !== 'string')) {
    throw new Error(`enterprise identity database contains an invalid ${column} value: ${text}`)
  }
  return parsed as string[]
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

/** Parse one surfaces row of any kind into its closed row type.
 * @param row - Raw column map read from SQLite.
 * @returns The parsed surface, narrowed on the stored kind.
 */
function surfaceFromRow(row: Record<string, unknown>): SurfaceRow | GroupSurfaceRow | ChannelSurfaceRow {
  const kind = enumColumn(row, 'kind', SURFACE_KINDS)
  if (kind === 'dm') {
    return {
      id: row.id as string,
      orgId: row.org_id as string,
      kind,
      userId: row.user_id as string,
      employeeId: row.employee_id as string,
      sessionId: row.session_id as string | null,
      createdAt: row.created_at as number,
    }
  }
  const team = {
    id: row.id as string,
    orgId: row.org_id as string,
    userId: null,
    employeeId: null,
    sessionId: row.session_id as string | null,
    createdAt: row.created_at as number,
    name: row.name as string,
    ...(row.external_key === null ? {} : { externalKey: row.external_key as string }),
    ...(row.team_definition_id === null ? {} : { teamDefinitionId: row.team_definition_id as string }),
    ...(row.project_id === null ? {} : { projectId: row.project_id as string }),
    dutyEmployeeIds: jsonStringArray(row, 'duty_employee_ids'),
  }
  if (kind === 'group') return { ...team, kind }
  return {
    ...team,
    kind,
    topicPolicy: enumColumn(row, 'topic_policy', TOPIC_POLICIES),
    respondPolicy: enumColumn(row, 'respond_policy', RESPOND_POLICIES),
  }
}

/** Parse one dm surfaces row, rejecting group and channel rows so dm callers keep their pair
 * contract; the surfaces query of every dm reader already filters on kind, so this only fires on
 * a corrupted row.
 * @param row - Raw column map read from SQLite.
 * @returns The parsed direct-message surface.
 */
function dmSurfaceFromRow(row: Record<string, unknown>): SurfaceRow {
  const surface = surfaceFromRow(row)
  if (surface.kind !== 'dm') {
    throw new Error(`enterprise surface ${surface.id} is a ${surface.kind} surface, not a dm surface`)
  }
  return surface
}

/** Parse one surface_members row.
 * @param row - Raw column map read from SQLite.
 * @returns The parsed surface member.
 */
function surfaceMemberFromRow(row: Record<string, unknown>): SurfaceMemberRow {
  return {
    surfaceId: row.surface_id as string,
    principalType: enumColumn(row, 'principal_type', PRINCIPAL_TYPES),
    principalId: row.principal_id as string,
    ...(row.role_id === null ? {} : { roleId: row.role_id as string }),
  }
}

/** Parse one channel_topics row.
 * @param row - Raw column map read from SQLite.
 * @returns The parsed channel topic.
 */
function channelTopicFromRow(row: Record<string, unknown>): ChannelTopicRow {
  return {
    topicId: row.topic_id as string,
    surfaceId: row.surface_id as string,
    title: row.title as string,
    state: enumColumn(row, 'state', TOPIC_STATES),
    ...(row.session_id === null ? {} : { sessionId: row.session_id as string }),
    createdBy: row.created_by as string,
    createdAt: row.created_at as number,
    ...(row.settled_at === null ? {} : { settledAt: row.settled_at as number }),
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

/** Read the employee account whose home workspace is one path.
 * @param database - Migrated enterprise identity database.
 * @param homeWorkspacePath - Absolute home workspace path to look up.
 * @returns The first non-archived stored account in insertion order, or undefined when only
 * archived accounts claim that path. Matching is exact string equality on the stored column,
 * mirroring `workspaceGrantByRootPath`; no path normalization runs on either side. Archived
 * accounts are excluded so a retired employee cannot shadow an active account bound to the same
 * home workspace.
 */
export function employeeByHomeWorkspacePath(
  database: DatabaseSync,
  homeWorkspacePath: string,
): EmployeeAccountRow | undefined {
  const row = database.prepare(
    "SELECT * FROM employee_accounts WHERE home_workspace_path = ? AND state != 'archived'",
  ).get(homeWorkspacePath) as Record<string, unknown> | undefined
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
  if (existing !== undefined) return dmSurfaceFromRow(existing)
  database.prepare(`INSERT INTO surfaces(id, org_id, kind, user_id, employee_id, session_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    row.id, row.orgId, row.kind, row.userId, row.employeeId, row.sessionId, row.createdAt,
  )
  return row
}

/** Look up one group or channel surface by external key or id, creating it when absent. The
 * external-key lookup wins over the requested id (an existing row is returned even when the
 * caller generated a fresh id); without an external key the id alone keys the row.
 * @param database - Migrated enterprise identity database.
 * @param kind - Surface kind to ensure.
 * @param row - Shared group/channel row values.
 * @param policies - Channel policy columns; both NULL for group rows.
 * @returns The durable surface row of the requested kind.
 * Single-writer assumption: the lookup and the insert are one check-then-act pair, atomic only
 * under the current single-connection in-process usage (docs/defensive-patterns.md).
 */
function ensureTeamSurface(
  database: DatabaseSync,
  kind: 'group' | 'channel',
  row: EnsureGroupSurfaceRow,
  policies: {
    readonly topicPolicy: 'thread' | 'command' | 'lane' | null
    readonly respondPolicy: 'mention_duty' | 'ingest_only' | null
    readonly dutyEmployeeIds: readonly string[]
  },
): SurfaceRow | GroupSurfaceRow | ChannelSurfaceRow {
  const existing = (row.externalKey === undefined
    ? database.prepare('SELECT * FROM surfaces WHERE id = ?').get(row.id)
    : database.prepare('SELECT * FROM surfaces WHERE org_id = ? AND kind = ? AND external_key = ?')
      .get(row.orgId, kind, row.externalKey)) as Record<string, unknown> | undefined
  if (existing !== undefined) return surfaceFromRow(existing)
  // The dm pair columns stay NULL for team rows, so the UNIQUE(user_id, employee_id) pair key
  // never constrains them.
  database.prepare(`INSERT INTO surfaces(id, org_id, kind, user_id, employee_id, session_id, created_at,
      team_definition_id, project_id, external_key, name, topic_policy, respond_policy, duty_employee_ids)
    VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    row.id, row.orgId, kind, row.createdAt, row.teamDefinitionId ?? null, row.projectId ?? null,
    row.externalKey ?? null, row.name, policies.topicPolicy, policies.respondPolicy,
    JSON.stringify([...new Set(policies.dutyEmployeeIds)]),
  )
  const inserted = database.prepare('SELECT * FROM surfaces WHERE id = ?').get(row.id) as Record<string, unknown>
  return surfaceFromRow(inserted)
}

/** Return the existing group surface for an organization and external key (or id when no external
 * key is given), creating it when absent.
 * @param database - Migrated enterprise identity database.
 * @param row - Group surface row to insert when absent.
 * @returns The durable group surface; an existing row wins over the requested id.
 * @throws When the keyed row exists with another kind.
 */
export function ensureGroupSurface(database: DatabaseSync, row: EnsureGroupSurfaceRow): GroupSurfaceRow {
  const surface = ensureTeamSurface(database, 'group', row, {
    topicPolicy: null, respondPolicy: null, dutyEmployeeIds: [],
  })
  if (surface.kind !== 'group') {
    throw new Error(`enterprise surface ${surface.id} is a ${surface.kind} surface, not a group surface`)
  }
  return surface
}

/** Return the existing channel surface for an organization and external key (or id when no
 * external key is given), creating it when absent.
 * @param database - Migrated enterprise identity database.
 * @param row - Channel surface row to insert when absent.
 * @returns The durable channel surface; an existing row wins over the requested id.
 * @throws When the keyed row exists with another kind.
 */
export function ensureChannelSurface(database: DatabaseSync, row: EnsureChannelSurfaceRow): ChannelSurfaceRow {
  const surface = ensureTeamSurface(database, 'channel', row, {
    topicPolicy: row.topicPolicy, respondPolicy: row.respondPolicy, dutyEmployeeIds: row.dutyEmployeeIds,
  })
  if (surface.kind !== 'channel') {
    throw new Error(`enterprise surface ${surface.id} is a ${surface.kind} surface, not a channel surface`)
  }
  return surface
}

/** Replace one surface's member set; the previous members are dropped as one transaction.
 * @param database - Migrated enterprise identity database.
 * @param surfaceId - Surface id whose member set is replaced.
 * @param members - The complete new member set, deduplicated on the principal pair.
 * @throws When the surface is missing.
 */
export function setSurfaceMembers(
  database: DatabaseSync,
  surfaceId: string,
  members: readonly SurfaceMemberInput[],
): void {
  database.exec('BEGIN IMMEDIATE')
  try {
    const surface = database.prepare('SELECT id FROM surfaces WHERE id = ?').get(surfaceId)
    if (surface === undefined) throw new Error('enterprise surface is missing')
    database.prepare('DELETE FROM surface_members WHERE surface_id = ?').run(surfaceId)
    const insert = database.prepare(`INSERT INTO surface_members(surface_id, principal_type, principal_id, role_id)
      VALUES (?, ?, ?, ?)`)
    const seen = new Set<string>()
    for (const member of members) {
      const key = `${member.principalType}:${member.principalId}`
      if (seen.has(key)) continue
      seen.add(key)
      insert.run(surfaceId, member.principalType, member.principalId, member.roleId ?? null)
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

/** List one surface's members ordered by principal type and id.
 * @param database - Migrated enterprise identity database.
 * @param surfaceId - Surface id whose members are listed.
 * @returns The stored members in principal order.
 */
export function surfaceMembers(database: DatabaseSync, surfaceId: string): SurfaceMemberRow[] {
  const rows = database.prepare(`SELECT * FROM surface_members WHERE surface_id = ?
    ORDER BY principal_type, principal_id`).all(surfaceId) as unknown as Record<string, unknown>[]
  return rows.map(surfaceMemberFromRow)
}

/** Return the existing channel topic, creating it open when absent.
 * @param database - Migrated enterprise identity database.
 * @param row - Topic row to insert when the id is unknown.
 * @returns The durable topic row; an existing row wins over the requested values.
 * @throws When the topic names a missing surface.
 * Single-writer assumption: the lookup and the insert are one check-then-act pair, atomic only
 * under the current single-connection in-process usage (docs/defensive-patterns.md).
 */
export function ensureTopic(database: DatabaseSync, row: EnsureTopicRow): ChannelTopicRow {
  const existing = database.prepare('SELECT * FROM channel_topics WHERE topic_id = ?')
    .get(row.topicId) as Record<string, unknown> | undefined
  if (existing !== undefined) return channelTopicFromRow(existing)
  database.prepare(`INSERT INTO channel_topics(topic_id, surface_id, title, state, session_id, created_by, created_at, settled_at)
    VALUES (?, ?, ?, 'open', ?, ?, ?, NULL)`).run(
    row.topicId, row.surfaceId, row.title, row.sessionId ?? null, row.createdBy, row.createdAt,
  )
  const inserted = database.prepare('SELECT * FROM channel_topics WHERE topic_id = ?')
    .get(row.topicId) as Record<string, unknown>
  return channelTopicFromRow(inserted)
}

/** Settle one open channel topic; settled and archived topics are terminal in this direction.
 * @param database - Migrated enterprise identity database.
 * @param topicId - Topic id to settle.
 * @param at - Settlement time in epoch milliseconds.
 * @returns The settled topic row.
 * @throws When the topic is missing or not open.
 * Single-writer assumption: the state check and the update are one check-then-act pair, atomic
 * only under the current single-connection in-process usage (docs/defensive-patterns.md).
 */
export function settleTopic(database: DatabaseSync, topicId: string, at: number): ChannelTopicRow {
  const current = database.prepare('SELECT state FROM channel_topics WHERE topic_id = ?')
    .get(topicId) as Record<string, unknown> | undefined
  if (current === undefined) throw new Error('enterprise topic is missing')
  const state = enumColumn(current, 'state', TOPIC_STATES)
  if (state !== 'open') throw new Error(`enterprise topic ${topicId} is ${state} and cannot settle`)
  database.prepare("UPDATE channel_topics SET state = 'settled', settled_at = ? WHERE topic_id = ?")
    .run(at, topicId)
  const settled = database.prepare('SELECT * FROM channel_topics WHERE topic_id = ?')
    .get(topicId) as Record<string, unknown>
  return channelTopicFromRow(settled)
}

/** List one surface's topics in creation order.
 * @param database - Migrated enterprise identity database.
 * @param surfaceId - Surface id whose topics are listed.
 * @returns The stored topics ordered by creation time and topic id.
 */
export function topicsBySurface(database: DatabaseSync, surfaceId: string): ChannelTopicRow[] {
  const rows = database.prepare(`SELECT * FROM channel_topics WHERE surface_id = ?
    ORDER BY created_at, topic_id`).all(surfaceId) as unknown as Record<string, unknown>[]
  return rows.map(channelTopicFromRow)
}

/** Read one channel topic by id.
 * @param database - Migrated enterprise identity database.
 * @param topicId - Topic id to read.
 * @returns The topic row, or undefined when the id is unknown.
 */
export function channelTopic(database: DatabaseSync, topicId: string): ChannelTopicRow | undefined {
  const row = database.prepare('SELECT * FROM channel_topics WHERE topic_id = ?')
    .get(topicId) as Record<string, unknown> | undefined
  return row === undefined ? undefined : channelTopicFromRow(row)
}

/** Attach one live session to a channel topic, replacing any previous binding.
 * @param database - Migrated enterprise identity database.
 * @param topicId - Topic id the session serves.
 * @param sessionId - Session id now serving the topic.
 * @throws When the topic is missing.
 */
export function attachTopicSession(database: DatabaseSync, topicId: string, sessionId: string): void {
  const result = database.prepare('UPDATE channel_topics SET session_id = ? WHERE topic_id = ?')
    .run(sessionId, topicId)
  if (Number(result.changes) === 0) throw new Error('enterprise topic is missing')
}

/** Read the topic anchored to one live session.
 * @param database - Migrated enterprise identity database.
 * @param sessionId - Session id the topic was created with.
 * @returns The topic row, or undefined when no topic anchors that session.
 */
export function topicBySession(database: DatabaseSync, sessionId: string): ChannelTopicRow | undefined {
  const row = database.prepare('SELECT * FROM channel_topics WHERE session_id = ?')
    .get(sessionId) as Record<string, unknown> | undefined
  return row === undefined ? undefined : channelTopicFromRow(row)
}

/** Replace one surface's duty roster with the given employee ids, deduplicated in stored order.
 * @param database - Migrated enterprise identity database.
 * @param surfaceId - Surface id whose roster is replaced.
 * @param employeeIds - Employee account ids on duty, in routing order.
 * @throws When the surface is missing.
 */
export function setDutyRoster(database: DatabaseSync, surfaceId: string, employeeIds: readonly string[]): void {
  const result = database.prepare('UPDATE surfaces SET duty_employee_ids = ? WHERE id = ?')
    .run(JSON.stringify([...new Set(employeeIds)]), surfaceId)
  if (Number(result.changes) === 0) throw new Error('enterprise surface is missing')
}

/** Read one surface's duty roster in routing order.
 * @param database - Migrated enterprise identity database.
 * @param surfaceId - Surface id whose roster is read.
 * @returns The stored employee ids; empty when no roster is set.
 * @throws When the surface is missing.
 */
export function dutyRoster(database: DatabaseSync, surfaceId: string): string[] {
  const row = database.prepare('SELECT duty_employee_ids FROM surfaces WHERE id = ?')
    .get(surfaceId) as { duty_employee_ids: string | null } | undefined
  if (row === undefined) throw new Error('enterprise surface is missing')
  return jsonStringArray(row, 'duty_employee_ids')
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

/** Bind one employee's group-surface session, replacing any previous binding for the pair.
 * @param database - Migrated enterprise identity database.
 * @param surfaceId - Group surface the session serves.
 * @param employeeId - Employee account the anchored session belongs to.
 * @param sessionId - Session id now serving the (surface, employee) pair.
 * @throws When the surface is missing (the foreign key fails loud).
 */
export function attachGroupSurfaceSession(
  database: DatabaseSync,
  surfaceId: string,
  employeeId: string,
  sessionId: string,
): void {
  database.prepare(`INSERT INTO surface_sessions(surface_id, employee_id, session_id) VALUES (?, ?, ?)
    ON CONFLICT(surface_id, employee_id) DO UPDATE SET session_id = excluded.session_id`)
    .run(surfaceId, employeeId, sessionId)
}

/** Read the session bound to one (group surface, employee) pair.
 * @param database - Migrated enterprise identity database.
 * @param surfaceId - Group surface whose member session is read.
 * @param employeeId - Employee account whose group session is read.
 * @returns The bound session id, or undefined when the pair has none yet.
 */
export function groupSurfaceSession(database: DatabaseSync, surfaceId: string, employeeId: string): string | undefined {
  const row = database.prepare('SELECT session_id FROM surface_sessions WHERE surface_id = ? AND employee_id = ?')
    .get(surfaceId, employeeId) as { session_id: string } | undefined
  return row?.session_id
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

/** Read the direct-message surface anchored to one live session. Group and channel surfaces carry
 * no dm pair, so a session attached to one of those kinds fails loud here instead of resolving.
 * @param database - Migrated enterprise identity database.
 * @param sessionId - Session id the surface was attached with `attachSurfaceSession`.
 * @returns The dm surface row, or undefined when no surface anchors that session.
 * @throws When the anchored surface is a group or channel surface.
 */
export function surfaceBySession(database: DatabaseSync, sessionId: string): SurfaceRow | undefined {
  const row = database.prepare('SELECT * FROM surfaces WHERE session_id = ?')
    .get(sessionId) as Record<string, unknown> | undefined
  return row === undefined ? undefined : dmSurfaceFromRow(row)
}
