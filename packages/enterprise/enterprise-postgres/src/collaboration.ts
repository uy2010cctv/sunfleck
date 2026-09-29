/** PostgreSQL routing, membership, topics, and native Session bindings for shared conversations. */
import { createHash, randomUUID } from 'node:crypto'
import type { EnterprisePostgresDatabase } from './index.ts'

/** Immutable routing choices for one conversation; employee ids reference published presets. */
export interface CollaborationConfig {
  readonly workspaceId: string
  readonly memberEmployeeIds: readonly string[]
  readonly dutyEmployeeIds: readonly string[]
  readonly teamDefinitionId?: string
  readonly projectId?: string
  readonly topicPolicy?: 'thread' | 'command' | 'lane'
  readonly respondPolicy?: 'mention_duty' | 'ingest_only'
}
/** Group management state; the creating human administers a group and may edit its notice. */
export interface CollaborationSettings {
  readonly adminUserId?: string
  readonly announcement?: string
}
/** Persisted organization-scoped conversation. */
export interface CollaborationRecord extends CollaborationConfig, CollaborationSettings {
  readonly id: string
  readonly orgId: string
  readonly kind: 'group' | 'channel'
  readonly name: string
  readonly memberUserIds: readonly string[]
  readonly archivedAt?: number
}
/** Topic lifecycle and the native Session it addresses. */
export interface CollaborationTopic {
  readonly id: string
  readonly title: string
  readonly state: 'open' | 'settled'
  readonly sessionId?: string
  readonly destinations?: readonly { readonly sessionId: string
    readonly employeeId: string }[]
}
/** Durable native Session destination. */
export interface CollaborationSession {
  readonly surfaceId: string
  readonly topicId: string
  readonly employeeId: string
  readonly sessionId: string
}

/** Validate durable JSON before using it for routing and group administration.
 * @param value - PostgreSQL JSON value.
 * @returns Validated routing choices and group settings.
 */
export function parseCollaborationConfig(value: unknown): CollaborationConfig & CollaborationSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid collaboration configuration')
  const row = value as Record<string, unknown>
  const strings = (field: string): string[] => {
    const items = row[field]
    if (!Array.isArray(items) || items.some(item => typeof item !== 'string' || item.trim() === '')) {
      throw new Error(`invalid collaboration ${field}`)
    }
    return items as string[]
  }
  const workspaceId = row['workspaceId']
  if (typeof workspaceId !== 'string' || workspaceId.trim() === '') throw new Error('invalid collaboration workspace')
  for (const field of ['teamDefinitionId', 'projectId']) {
    if (row[field] !== undefined && (typeof row[field] !== 'string' || row[field].trim() === '')) throw new Error(`invalid collaboration ${field}`)
  }
  const topicPolicy = row['topicPolicy']
  const respondPolicy = row['respondPolicy']
  if (topicPolicy !== undefined && topicPolicy !== 'thread' && topicPolicy !== 'command' && topicPolicy !== 'lane') throw new Error('invalid collaboration topic policy')
  if (respondPolicy !== undefined && respondPolicy !== 'mention_duty' && respondPolicy !== 'ingest_only') throw new Error('invalid collaboration respond policy')
  const adminUserId = row['adminUserId']
  if (adminUserId !== undefined && (typeof adminUserId !== 'string' || adminUserId.trim() === '')) throw new Error('invalid collaboration admin user')
  const announcement = row['announcement']
  if (announcement !== undefined && (typeof announcement !== 'string' || announcement.trim() === '')) throw new Error('invalid collaboration announcement')
  return {
    workspaceId, memberEmployeeIds: strings('memberEmployeeIds'), dutyEmployeeIds: strings('dutyEmployeeIds'),
    ...(typeof row['teamDefinitionId'] === 'string' ? { teamDefinitionId: row['teamDefinitionId'] } : {}),
    ...(typeof row['projectId'] === 'string' ? { projectId: row['projectId'] } : {}),
    ...(topicPolicy === undefined ? {} : { topicPolicy }), ...(respondPolicy === undefined ? {} : { respondPolicy }),
    ...(adminUserId === undefined ? {} : { adminUserId }), ...(announcement === undefined ? {} : { announcement }),
  }
}

const taskOwnersTable = `CREATE TABLE IF NOT EXISTS dsh_enterprise_collaboration_task_owners (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  surface_id TEXT NOT NULL REFERENCES dsh_enterprise_surface_directory(surface_id) ON DELETE CASCADE,
  task_id TEXT NOT NULL, owner_id TEXT NOT NULL, last_event_id TEXT NOT NULL,
  PRIMARY KEY(org_id,surface_id,task_id))`

const dispatchTable = `CREATE TABLE dsh_enterprise_collaboration_dispatch (
  org_id TEXT NOT NULL, surface_id TEXT NOT NULL, event_id TEXT NOT NULL,
  target_kind TEXT NOT NULL CHECK(target_kind IN ('employee','team','ingest')),
  target_id TEXT NOT NULL, requested_by_user_id TEXT,
  state TEXT NOT NULL CHECK(state IN ('pending','processing','completed')),
  lease_token TEXT, lease_until BIGINT,
  PRIMARY KEY(org_id,surface_id,event_id,target_kind,target_id),
  FOREIGN KEY(org_id,surface_id,event_id)
    REFERENCES dsh_enterprise_collaboration_events(org_id,surface_id,event_id) ON DELETE CASCADE,
  CONSTRAINT dsh_enterprise_collaboration_dispatch_lease CHECK
    ((state='processing' AND lease_token IS NOT NULL AND lease_until IS NOT NULL)
      OR (state<>'processing' AND lease_token IS NULL AND lease_until IS NULL)))`

/** Per-user room preferences persisted beside the conversation. */
export interface RoomPrefs {
  readonly pinned: boolean
  readonly starred: boolean
  readonly muted: boolean
}

const prefsTable = `CREATE TABLE IF NOT EXISTS dsh_enterprise_collaboration_room_prefs (
  surface_id TEXT NOT NULL REFERENCES dsh_enterprise_collaboration_config(surface_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  pinned BOOLEAN NOT NULL DEFAULT FALSE,
  starred BOOLEAN NOT NULL DEFAULT FALSE,
  muted BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY(surface_id,user_id))`

const attachmentsTable = `CREATE TABLE IF NOT EXISTS dsh_enterprise_collaboration_attachments (
  surface_id TEXT NOT NULL REFERENCES dsh_enterprise_surface_directory(surface_id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL,
  uploader_user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size BIGINT NOT NULL CHECK (size >= 0),
  data BYTEA NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY(surface_id,attachment_id))`

/** Add collaboration tables under a monotonic, transaction-locked schema version.
 * @param database - Shared enterprise database.
 * @returns When schema initialization commits.
 */
export async function migrateCollaboration(database: EnterprisePostgresDatabase): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [0x4453434f])
    await tx.query('CREATE TABLE IF NOT EXISTS dsh_enterprise_collaboration_meta (version INTEGER NOT NULL)')
    const version = (await tx.query<{ version: number }>('SELECT version FROM dsh_enterprise_collaboration_meta')).rows[0]?.version
    if (version !== undefined && version !== 1 && version !== 2 && version !== 3 && version !== 4) {
      throw new Error(`unsupported collaboration schema version ${version}`)
    }
    if (version === undefined) {
      await tx.query(`CREATE TABLE dsh_enterprise_collaboration_config (
      surface_id TEXT PRIMARY KEY REFERENCES dsh_enterprise_surface_directory(surface_id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES enterprise_workspace_grants(workspace_id), config_json JSONB NOT NULL)`)
      await tx.query(`CREATE TABLE dsh_enterprise_collaboration_members (
      surface_id TEXT NOT NULL REFERENCES dsh_enterprise_collaboration_config(surface_id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id), PRIMARY KEY(surface_id,user_id))`)
      await tx.query(`CREATE TABLE dsh_enterprise_collaboration_topics (
      surface_id TEXT NOT NULL REFERENCES dsh_enterprise_collaboration_config(surface_id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL, title TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('open','settled')),
      created_at BIGINT NOT NULL, PRIMARY KEY(surface_id,topic_id))`)
      await tx.query(`CREATE TABLE dsh_enterprise_collaboration_sessions (
      surface_id TEXT NOT NULL REFERENCES dsh_enterprise_collaboration_config(surface_id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL DEFAULT '', employee_id TEXT NOT NULL DEFAULT '', session_id TEXT NOT NULL UNIQUE,
      PRIMARY KEY(surface_id,topic_id,employee_id))`)
      await tx.query('INSERT INTO dsh_enterprise_collaboration_meta(version) VALUES (1)')
    }
    // Additive tables depend on the base room configuration and must also
    // exist when a version-4 database resumes.
    await tx.query(attachmentsTable)
    await tx.query(prefsTable)
    if (version === 4) return
    if (version === undefined || version === 1) {
      await tx.query(`CREATE TABLE dsh_enterprise_collaboration_actor_keys (
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      actor_kind TEXT NOT NULL CHECK(actor_kind IN ('human','employee','service')),
      actor_id TEXT NOT NULL, pubkey TEXT NOT NULL UNIQUE CHECK(pubkey ~ '^[0-9a-f]{64}$'),
      PRIMARY KEY(org_id,actor_kind,actor_id))`)
      await tx.query(`CREATE TABLE dsh_enterprise_collaboration_events (
      sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      surface_id TEXT NOT NULL REFERENCES dsh_enterprise_surface_directory(surface_id) ON DELETE CASCADE,
      event_id TEXT NOT NULL, event_json JSONB NOT NULL,
      author_kind TEXT NOT NULL CHECK(author_kind IN ('human','employee','service')),
      author_id TEXT NOT NULL, thread_root TEXT, request_id TEXT,
      source_session_id TEXT, source_event_cursor TEXT,
      search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple',coalesce(event_json->>'content',''))) STORED,
      CONSTRAINT dsh_enterprise_collaboration_event_source_pair CHECK
        ((source_session_id IS NULL) = (source_event_cursor IS NULL)),
      UNIQUE(org_id,surface_id,event_id))`)
      await tx.query(`CREATE INDEX dsh_enterprise_collaboration_events_order
      ON dsh_enterprise_collaboration_events(org_id,surface_id,sequence)`)
      await tx.query(`CREATE UNIQUE INDEX dsh_enterprise_collaboration_events_request
      ON dsh_enterprise_collaboration_events(org_id,surface_id,author_kind,author_id,request_id)
      WHERE request_id IS NOT NULL`)
      await tx.query(`CREATE UNIQUE INDEX dsh_enterprise_collaboration_events_source
      ON dsh_enterprise_collaboration_events(org_id,source_session_id,source_event_cursor)
      WHERE source_session_id IS NOT NULL`)
      await tx.query(`CREATE INDEX dsh_enterprise_collaboration_events_search
      ON dsh_enterprise_collaboration_events USING GIN(search_vector)`)
      await tx.query(taskOwnersTable)
      await tx.query('UPDATE dsh_enterprise_collaboration_meta SET version=2 WHERE version=1')
    }
    if (version === undefined || version === 1 || version === 2) {
      await tx.query(taskOwnersTable)
      await tx.query('ALTER TABLE dsh_enterprise_collaboration_events ADD COLUMN requested_by_user_id TEXT')
      await tx.query(dispatchTable)
      await tx.query(`CREATE INDEX dsh_enterprise_collaboration_dispatch_poll
        ON dsh_enterprise_collaboration_dispatch(state,lease_until,org_id,surface_id,event_id)`)
      await tx.query('UPDATE dsh_enterprise_collaboration_meta SET version=3 WHERE version=2')
    }
    await tx.query(`CREATE TABLE dsh_enterprise_collaboration_read_cursors (
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      surface_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      sequence BIGINT NOT NULL CHECK(sequence>0),
      PRIMARY KEY(org_id,surface_id,user_id),
      FOREIGN KEY(surface_id,user_id) REFERENCES dsh_enterprise_collaboration_members(surface_id,user_id) ON DELETE CASCADE)`)
    await tx.query(`CREATE INDEX dsh_enterprise_collaboration_event_mentions
      ON dsh_enterprise_collaboration_events USING GIN ((event_json->'tags'))`)
    if (version !== undefined) {
      await tx.query(`INSERT INTO dsh_enterprise_collaboration_read_cursors(org_id,surface_id,user_id,sequence)
        SELECT d.org_id,m.surface_id,m.user_id,max(e.sequence)
        FROM dsh_enterprise_collaboration_members m
        JOIN dsh_enterprise_surface_directory d ON d.surface_id=m.surface_id
        JOIN dsh_enterprise_collaboration_events e ON e.org_id=d.org_id AND e.surface_id=m.surface_id
        GROUP BY d.org_id,m.surface_id,m.user_id`)
    }
    await tx.query('UPDATE dsh_enterprise_collaboration_meta SET version=4 WHERE version=3')
  })
}

/** A creation retry reused its key for different resolved conversation values. */
export class CollaborationCreationConflictError extends Error {
  constructor() { super('collaboration creation idempotency conflict') }
}

function creationFingerprint(input: Omit<CollaborationRecord, 'id'>): string {
  // Group administration state is excluded: the stored id already commits the creator, and rows
  // recorded before it existed must stay valid retry targets.
  return JSON.stringify({
    orgId: input.orgId, kind: input.kind, name: input.name, workspaceId: input.workspaceId,
    memberEmployeeIds: input.memberEmployeeIds, memberUserIds: [...new Set(input.memberUserIds)].sort(),
    dutyEmployeeIds: input.dutyEmployeeIds, teamDefinitionId: input.teamDefinitionId, projectId: input.projectId,
    topicPolicy: input.topicPolicy, respondPolicy: input.respondPolicy,
  })
}

/** Durable collaboration repository. Caller authorization is enforced by the HTTP and native Session policies. */
export class PostgresCollaborationRepository {
  /** @param database - Shared enterprise database. */
  constructor(private readonly database: EnterprisePostgresDatabase) {}

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- Each SQL caller declares its selected result fields.
  private async query<Row extends Record<string, unknown>>(text: string,
    values: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number | null }> {
    return this.database.query<Row>(text, values)
  }

  /** Store one conversation and its explicit human membership atomically.
   * @param input - Validated organization, workspace, and routing choices.
   * @param retry - Optional authenticated creator and retry key; changed values conflict without mutation.
   * @returns The persisted conversation, reusing the original for a matching retry.
   */
  async create(input: Omit<CollaborationRecord, 'id'>,
    retry?: { readonly creatorUserId: string; readonly idempotencyKey: string }): Promise<CollaborationRecord> {
    const id = retry === undefined ? randomUUID()
      : `surface-${createHash('sha256').update(JSON.stringify([input.orgId, retry.creatorUserId, retry.idempotencyKey])).digest('hex')}`
    const { orgId, kind, name, memberUserIds, ...config } = input
    return this.database.transaction(async (tx) => {
      const inserted = await tx.query(`INSERT INTO dsh_enterprise_surface_directory(surface_id,org_id,kind,name,member_count,created_at)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(surface_id) DO NOTHING`,
      [id, orgId, kind, name, config.memberEmployeeIds.length, Date.now()])
      if (inserted.rowCount === 0) {
        const existing = await new PostgresCollaborationRepository(tx).get(orgId, id)
        if (existing === undefined || creationFingerprint(existing) !== creationFingerprint(input)) {
          throw new CollaborationCreationConflictError()
        }
        return existing
      }
      await tx.query('INSERT INTO dsh_enterprise_collaboration_config(surface_id,workspace_id,config_json) VALUES($1,$2,$3::jsonb)',
        [id, config.workspaceId, JSON.stringify(config)])
      for (const userId of new Set(memberUserIds)) {
        await tx.query('INSERT INTO dsh_enterprise_collaboration_members(surface_id,user_id) VALUES($1,$2)', [id, userId])
      }
      return { id, ...input, memberUserIds: [...new Set(memberUserIds)].sort() }
    })
  }

  /** Read only conversations naming this human as a member.
   * @param orgId - Authenticated organization.
   * @param userId - Authenticated human.
   * @returns Membership-scoped conversations.
   */
  async list(orgId: string, userId: string): Promise<readonly CollaborationRecord[]> {
    const result = await this.query<{ surface_id: string }>(`SELECT d.surface_id FROM dsh_enterprise_surface_directory d
      JOIN dsh_enterprise_collaboration_members m USING(surface_id) WHERE d.org_id=$1 AND m.user_id=$2 AND d.archived_at IS NULL
      ORDER BY d.created_at,d.surface_id`, [orgId, userId])
    const rows = await Promise.all(result.rows.map(row => this.get(orgId, row.surface_id)))
    return rows.filter((row): row is CollaborationRecord => row !== undefined)
  }

  /** Read one conversation within its organization.
   * @param orgId - Organization scope.
   * @param id - Conversation identity.
   * @returns Stored conversation, or undefined for foreign or absent ids.
   */
  async get(orgId: string, id: string): Promise<CollaborationRecord | undefined> {
    const row = (await this.query<{ kind: string; name: string; archived_at: string | number | null; config_json: unknown }>(`SELECT d.kind,d.name,d.archived_at,c.config_json FROM dsh_enterprise_surface_directory d
      JOIN dsh_enterprise_collaboration_config c USING(surface_id) WHERE d.org_id=$1 AND d.surface_id=$2`, [orgId, id])).rows[0]
    if (row === undefined) return undefined
    if (row.kind !== 'group' && row.kind !== 'channel') throw new Error('invalid collaboration kind')
    const members = await this.query<{ user_id: string }>('SELECT user_id FROM dsh_enterprise_collaboration_members WHERE surface_id=$1 ORDER BY user_id', [id])
    return { id, orgId, kind: row.kind, name: row.name, ...parseCollaborationConfig(row.config_json),
      memberUserIds: members.rows.map(member => member.user_id),
      ...(row.archived_at === null ? {} : { archivedAt: Number(row.archived_at) }) }
  }

  /** Archive one conversation; its content stays stored but it leaves the active lists.
   * @param orgId - Organization scope.
   * @param id - Conversation identity.
   * @returns Whether the conversation exists.
   */
  async archive(orgId: string, id: string): Promise<boolean> {
    return (await this.query('UPDATE dsh_enterprise_surface_directory SET archived_at=$3 WHERE org_id=$1 AND surface_id=$2 AND archived_at IS NULL',
      [orgId, id, Date.now()])).rowCount === 1
  }

  /** Rename one conversation within its organization.
   * @param orgId - Organization scope.
   * @param id - Conversation identity.
   * @param name - Trimmed non-empty stored name.
   * @returns Whether the conversation exists.
   */
  async rename(orgId: string, id: string, name: string): Promise<boolean> {
    return (await this.query('UPDATE dsh_enterprise_surface_directory SET name=$3 WHERE org_id=$1 AND surface_id=$2',
      [orgId, id, name])).rowCount === 1
  }

  /** Replace the stored group announcement.
   * @param surfaceId - Authorized conversation.
   * @param announcement - Trimmed notice text, or undefined to remove the notice.
   */
  async setAnnouncement(surfaceId: string, announcement: string | undefined): Promise<void> {
    if (announcement === undefined) {
      await this.database.query("UPDATE dsh_enterprise_collaboration_config SET config_json = config_json - 'announcement' WHERE surface_id=$1", [surfaceId])
      return
    }
    await this.database.query('UPDATE dsh_enterprise_collaboration_config SET config_json = config_json || $2::jsonb WHERE surface_id=$1',
      [surfaceId, JSON.stringify({ announcement })])
  }

  /** Add human and employee members; repeats stay absent and the directory count mirrors stored employees.
   * @param surfaceId - Authorized conversation.
   * @param input - Human ids for the members table and employee ids for routing.
   */
  async addMembers(surfaceId: string,
    input: { readonly userIds: readonly string[]; readonly employeeIds: readonly string[] }): Promise<void> {
    await this.database.transaction(async (tx) => {
      await this.mergeEmployeeRoster(tx, surfaceId,
        current => [...new Set([...current, ...input.employeeIds])])
      for (const userId of new Set(input.userIds)) {
        await tx.query('INSERT INTO dsh_enterprise_collaboration_members(surface_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [surfaceId, userId])
      }
    })
  }

  /** Remove human and employee members; absent ids stay absent.
   * @param surfaceId - Authorized conversation.
   * @param input - Human and employee ids to drop from the conversation.
   */
  async removeMembers(surfaceId: string,
    input: { readonly userIds: readonly string[]; readonly employeeIds: readonly string[] }): Promise<void> {
    await this.database.transaction(async (tx) => {
      const removed = new Set(input.employeeIds)
      await this.mergeEmployeeRoster(tx, surfaceId, current => current.filter(id => !removed.has(id)))
      if (input.userIds.length > 0) {
        await tx.query('DELETE FROM dsh_enterprise_collaboration_members WHERE surface_id=$1 AND user_id=ANY($2::text[])',
          [surfaceId, [...new Set(input.userIds)]])
      }
    })
  }

  /** Apply one employee-roster change to the stored configuration and the directory count under a row lock. */
  private async mergeEmployeeRoster(tx: EnterprisePostgresDatabase, surfaceId: string,
    next: (current: readonly string[]) => readonly string[]): Promise<void> {
    const row = (await tx.query<{ config_json: unknown }>(
      'SELECT config_json FROM dsh_enterprise_collaboration_config WHERE surface_id=$1 FOR UPDATE', [surfaceId])).rows[0]
    if (row === undefined) throw new Error('collaboration configuration is missing')
    const config = parseCollaborationConfig(row.config_json)
    const employeeIds = [...new Set(next(config.memberEmployeeIds))]
    const dutyEmployeeIds = config.dutyEmployeeIds.filter(id => employeeIds.includes(id))
    await tx.query(`UPDATE dsh_enterprise_collaboration_config
      SET config_json = config_json || $2::jsonb WHERE surface_id=$1`,
    [surfaceId, JSON.stringify({ memberEmployeeIds: employeeIds, dutyEmployeeIds })])
    await tx.query('UPDATE dsh_enterprise_surface_directory SET member_count=$2 WHERE surface_id=$1', [surfaceId, employeeIds.length])
  }

  /** Store duty only while every selected employee remains in the locked channel roster.
   * @param surfaceId - Authorized channel identity.
   * @param employeeIds - Explicit duty selection.
   * @returns Whether all selected employees were current channel members.
   */
  async setDuty(surfaceId: string, employeeIds: readonly string[]): Promise<boolean> {
    return this.database.transaction(async (tx) => {
      const row = (await tx.query<{ config_json: unknown }>(
        'SELECT config_json FROM dsh_enterprise_collaboration_config WHERE surface_id=$1 FOR UPDATE', [surfaceId])).rows[0]
      if (row === undefined) return false
      const config = parseCollaborationConfig(row.config_json)
      if (employeeIds.some(id => !config.memberEmployeeIds.includes(id))) return false
      await tx.query('UPDATE dsh_enterprise_collaboration_config SET config_json=config_json || $2::jsonb WHERE surface_id=$1',
        [surfaceId, JSON.stringify({ dutyEmployeeIds: [...new Set(employeeIds)] })])
      return true
    })
  }

  /** List topic state with its native transcript binding.
   * @param id - Authorized conversation.
   * @returns Stored topics in creation order.
   */
  async topics(id: string): Promise<readonly CollaborationTopic[]> {
    const result = await this.query<{ topic_id: string; title: string; state: 'open' | 'settled' }>(
      'SELECT topic_id,title,state FROM dsh_enterprise_collaboration_topics WHERE surface_id=$1 ORDER BY created_at,topic_id', [id])
    const sessions = await this.sessions(id)
    return result.rows.map((row) => {
      const destinations = sessions.filter(value => value.topicId === row.topic_id)
        .map(value => ({ sessionId: value.sessionId, employeeId: value.employeeId }))
      return { id: row.topic_id, title: row.title, state: row.state, destinations,
        ...(destinations.length === 1 && destinations[0] !== undefined ? { sessionId: destinations[0].sessionId } : {}) }
    })
  }

  /** Idempotently create an open topic, preserving an existing lifecycle state.
   * @param surfaceId - Authorized conversation.
   * @param id - Stable topic identity.
   * @param title - Topic title.
   */
  async ensureTopic(surfaceId: string, id: string, title: string): Promise<void> {
    await this.database.query(`INSERT INTO dsh_enterprise_collaboration_topics(surface_id,topic_id,title,state,created_at)
      VALUES($1,$2,$3,'open',$4) ON CONFLICT(surface_id,topic_id) DO NOTHING`, [surfaceId, id, title, Date.now()])
  }

  /** Settle an existing open topic.
   * @param surfaceId - Authorized conversation.
   * @param id - Topic identity.
   * @returns Whether this call performed the transition.
   */
  async settle(surfaceId: string, id: string): Promise<boolean> {
    return (await this.database.query("UPDATE dsh_enterprise_collaboration_topics SET state='settled' WHERE surface_id=$1 AND topic_id=$2 AND state='open'", [surfaceId, id])).rowCount === 1
  }

  /** Read all durable native destinations for one conversation.
   * @param surfaceId - Authorized conversation.
   * @returns Native destination bindings.
   */
  async sessions(surfaceId: string): Promise<readonly CollaborationSession[]> {
    const result = await this.query<{ surface_id: string; topic_id: string; employee_id: string; session_id: string }>('SELECT * FROM dsh_enterprise_collaboration_sessions WHERE surface_id=$1', [surfaceId])
    return result.rows.map(row => ({ surfaceId: row.surface_id, topicId: row.topic_id, employeeId: row.employee_id,
      sessionId: row.session_id }))
  }

  /** Resolve a native composer back to its durable routing owner.
   * @param sessionId - Native Session identity.
   * @returns Destination binding if the Session belongs to a collaboration conversation.
   */
  async bySession(sessionId: string): Promise<CollaborationSession | undefined> {
    const row = (await this.query<{ surface_id: string; topic_id: string; employee_id: string; session_id: string }>('SELECT * FROM dsh_enterprise_collaboration_sessions WHERE session_id=$1', [sessionId])).rows[0]
    return row === undefined ? undefined : { surfaceId: row.surface_id, topicId: row.topic_id, employeeId: row.employee_id,
      sessionId: row.session_id }
  }

  /** Persist a native destination; races may only agree on the same deterministic Session.
   * @param value - Created and authorized native Session binding.
   */
  async bind(value: CollaborationSession): Promise<void> {
    const result = await this.database.query(`INSERT INTO dsh_enterprise_collaboration_sessions(surface_id,topic_id,employee_id,session_id)
      VALUES($1,$2,$3,$4) ON CONFLICT(surface_id,topic_id,employee_id) DO UPDATE SET session_id=EXCLUDED.session_id
      WHERE dsh_enterprise_collaboration_sessions.session_id=EXCLUDED.session_id`, [value.surfaceId, value.topicId, value.employeeId, value.sessionId])
    if (result.rowCount !== 1) throw new Error('collaboration destination is already bound to another Session')
  }

  /** Store one uploaded room attachment; the id is assigned by the caller and validated for uniqueness by the key.
   * @param value - Uploaded bytes and metadata, scoped to one conversation.
   */
  async putAttachment(value: { readonly surfaceId: string
    readonly attachmentId: string
    readonly uploaderUserId: string
    readonly name: string
    readonly mimeType: string
    readonly data: Buffer }): Promise<void> {
    await this.database.query(`INSERT INTO dsh_enterprise_collaboration_attachments
      (surface_id,attachment_id,uploader_user_id,name,mime_type,size,data,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(surface_id,attachment_id) DO NOTHING`,
    [value.surfaceId, value.attachmentId, value.uploaderUserId, value.name, value.mimeType, value.data.length,
      value.data, Date.now()])
  }

  /** Read one member preferences for the listed conversations; absent rows mean all-false.
   * @param userId - Room member.
   * @param surfaceIds - Conversations to read.
   * @returns Preferences keyed by conversation id.
   */
  async roomPrefs(userId: string, surfaceIds: readonly string[]): Promise<Map<string, RoomPrefs>> {
    const prefs = new Map<string, RoomPrefs>()
    if (surfaceIds.length === 0) return prefs
    const rows = await this.query<{ surface_id: string; pinned: boolean; starred: boolean; muted: boolean }>(
      'SELECT surface_id,pinned,starred,muted FROM dsh_enterprise_collaboration_room_prefs WHERE user_id=$1 AND surface_id=ANY($2::text[])',
      [userId, [...surfaceIds]])
    for (const row of rows.rows) {
      prefs.set(row.surface_id, { pinned: row.pinned, starred: row.starred, muted: row.muted })
    }
    return prefs
  }

  /** Merge one member preferences for one conversation; omitted flags keep their stored value.
   * @param surfaceId - Authorized conversation.
   * @param userId - Room member.
   * @param patch - Flags to change.
   * @returns The merged stored preferences.
   */
  async setRoomPrefs(surfaceId: string, userId: string,
    patch: { readonly pinned?: boolean; readonly starred?: boolean; readonly muted?: boolean }): Promise<RoomPrefs> {
    return this.database.transaction(async (tx) => {
      const current = (await tx.query<{ pinned: boolean; starred: boolean; muted: boolean }>(
        'SELECT pinned,starred,muted FROM dsh_enterprise_collaboration_room_prefs WHERE surface_id=$1 AND user_id=$2 FOR UPDATE',
        [surfaceId, userId])).rows[0] ?? { pinned: false, starred: false, muted: false }
      const merged = {
        pinned: patch.pinned ?? current.pinned,
        starred: patch.starred ?? current.starred,
        muted: patch.muted ?? current.muted,
      }
      await tx.query(`INSERT INTO dsh_enterprise_collaboration_room_prefs
        (surface_id,user_id,pinned,starred,muted,updated_at) VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(surface_id,user_id) DO UPDATE SET pinned=$3,starred=$4,muted=$5,updated_at=$6`,
      [surfaceId, userId, merged.pinned, merged.starred, merged.muted, Date.now()])
      return merged
    })
  }

  /** Read one uploaded room attachment within its conversation.
   * @param surfaceId - Authorized conversation.
   * @param attachmentId - Upload identity.
   * @returns Attachment metadata and bytes, or undefined for foreign or absent ids.
   */
  async getAttachment(surfaceId: string, attachmentId: string): Promise<{ readonly attachmentId: string
    readonly uploaderUserId: string
    readonly name: string
    readonly mimeType: string
    readonly size: number
    readonly data: Buffer } | undefined> {
    const row = (await this.query<{
      attachment_id: string
      uploader_user_id: string
      name: string
      mime_type: string
      size: string | number
      data: Buffer
    }>(`SELECT attachment_id,uploader_user_id,name,mime_type,size,data
        FROM dsh_enterprise_collaboration_attachments WHERE surface_id=$1 AND attachment_id=$2`, [surfaceId, attachmentId])).rows[0]
    if (row === undefined) return undefined
    return { attachmentId: row.attachment_id, uploaderUserId: row.uploader_user_id, name: row.name,
      mimeType: row.mime_type, size: Number(row.size), data: row.data }
  }
}
