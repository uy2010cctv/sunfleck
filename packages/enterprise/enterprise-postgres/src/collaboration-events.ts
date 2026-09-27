/** Signed shared-room events and custodial public-key bindings. */
import { randomUUID } from 'node:crypto'
import { verifyEvent } from 'nostr-tools/pure'
import type { EnterprisePostgresDatabase } from './index.ts'

/** Trusted actor category for a server-custodied room signature. */
export type RoomActorKind = 'human' | 'employee' | 'service'

/** Exact NIP-01 signed event fields. */
export interface RoomNostrEvent {
  readonly id: string
  readonly pubkey: string
  readonly created_at: number
  readonly kind: number
  readonly tags: readonly (readonly string[])[]
  readonly content: string
  readonly sig: string
}

/** Trusted metadata supplied after authorization and signature verification. */
export interface RoomEventAppend {
  readonly orgId: string
  readonly surfaceId: string
  readonly event: RoomNostrEvent
  readonly authorKind: RoomActorKind
  readonly authorId: string
  readonly threadRoot?: string
  readonly requestId?: string
  readonly sourceSessionId?: string
  readonly sourceEventCursor?: string
  /** Authorized human manager for a service event that requests a Bot. */
  readonly requestedByUserId?: string
}

/** Persisted room event; sequence is a decimal string to preserve PostgreSQL BIGINT precision. */
export interface RoomEvent extends RoomEventAppend {
  readonly sequence: string
}

/** First public-key binding for one organization actor. */
export interface RoomActorKeyBinding {
  readonly orgId: string
  readonly actorKind: RoomActorKind
  readonly actorId: string
  readonly pubkey: string
}

/** Bounded event page after an exclusive sequence. */
export interface RoomEventPageOptions {
  readonly after?: string
  readonly before?: string
  readonly limit?: number
  readonly threadRoot?: string
}

/** One leased destination derived from a committed signed room event. */
export interface RoomDispatchClaim {
  readonly orgId: string
  readonly surfaceId: string
  readonly eventId: string
  readonly targetKind: 'employee' | 'team' | 'ingest'
  readonly targetId: string
  readonly requestedByUserId?: string
  readonly leaseToken: string
  readonly event: RoomEvent
}

/** A retry attempted to replace a committed signed event or source cursor. */
export class RoomEventConflictError extends Error {
  constructor() { super('room event idempotency conflict') }
}

/** A signing identity attempted to change its original public key. */
export class RoomActorKeyConflictError extends Error {
  constructor() { super('room actor public key conflict') }
}

interface EventRow extends Record<string, unknown> {
  readonly sequence: string
  readonly org_id: string
  readonly surface_id: string
  readonly event_id: string
  readonly event_json: unknown
  readonly author_kind: string
  readonly author_id: string
  readonly thread_root: string | null
  readonly request_id: string | null
  readonly source_session_id: string | null
  readonly source_event_cursor: string | null
  readonly requested_by_user_id: string | null
}

interface DispatchRow extends EventRow {
  readonly target_kind: string
  readonly target_id: string
  readonly lease_token: string
  readonly dispatch_requested_by_user_id: string | null
}

const HEX_64 = /^[0-9a-f]{64}$/
const HEX_128 = /^[0-9a-f]{128}$/
const DECIMAL = /^(0|[1-9][0-9]*)$/
const MAX_SEQUENCE = 9_223_372_036_854_775_807n

function actorKind(value: unknown): value is RoomActorKind {
  return value === 'human' || value === 'employee' || value === 'service'
}

function nonempty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`invalid room ${name}`)
}

/** Validate a signed wire event, including values read from durable JSON.
 * @param value - Signed event from a trusted signer or PostgreSQL.
 * @returns The event with exact NIP-01 fields.
 */
export function parseRoomNostrEvent(value: unknown): RoomNostrEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid room event')
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'content,created_at,id,kind,pubkey,sig,tags') throw new Error('invalid room event fields')
  if (typeof row['id'] !== 'string' || !HEX_64.test(row['id'])) throw new Error('invalid room event id')
  if (typeof row['pubkey'] !== 'string' || !HEX_64.test(row['pubkey'])) throw new Error('invalid room event pubkey')
  if (typeof row['sig'] !== 'string' || !HEX_128.test(row['sig'])) throw new Error('invalid room event signature')
  if (!Number.isSafeInteger(row['created_at']) || Number(row['created_at']) < 0) throw new Error('invalid room event timestamp')
  if (!Number.isSafeInteger(row['kind']) || Number(row['kind']) < 0) throw new Error('invalid room event kind')
  if (typeof row['content'] !== 'string') throw new Error('invalid room event content')
  const tags = row['tags']
  if (!Array.isArray(tags) || tags.some(tag => !Array.isArray(tag) || tag.some(item => typeof item !== 'string'))) {
    throw new Error('invalid room event tags')
  }
  const event = { id: row['id'], pubkey: row['pubkey'], sig: row['sig'], created_at: Number(row['created_at']),
    kind: Number(row['kind']), content: row['content'], tags: tags as string[][] }
  if (!verifyEvent({ ...event, tags: event.tags.map(tag => [...tag]) })) {
    throw new Error('invalid room event signature')
  }
  return event
}

function parseRow(row: EventRow): RoomEvent {
  if (!DECIMAL.test(row.sequence) || BigInt(row.sequence) < 1n) throw new Error('invalid room event sequence')
  nonempty(row.org_id, 'organization')
  nonempty(row.surface_id, 'surface')
  nonempty(row.author_id, 'author')
  if (!actorKind(row.author_kind)) throw new Error('invalid room event author kind')
  const event = parseRoomNostrEvent(row.event_json)
  if (event.id !== row.event_id) throw new Error('room event identity mismatch')
  if (row.requested_by_user_id !== null) nonempty(row.requested_by_user_id, 'requester')
  return {
    sequence: row.sequence, orgId: row.org_id, surfaceId: row.surface_id, event,
    authorKind: row.author_kind, authorId: row.author_id,
    ...(row.thread_root === null ? {} : { threadRoot: row.thread_root }),
    ...(row.request_id === null ? {} : { requestId: row.request_id }),
    ...(row.source_session_id === null ? {} : { sourceSessionId: row.source_session_id }),
    ...(row.source_event_cursor === null ? {} : { sourceEventCursor: row.source_event_cursor }),
    ...(row.requested_by_user_id === null ? {} : { requestedByUserId: row.requested_by_user_id }),
  }
}

function sameEvent(old: RoomEvent, input: RoomEventAppend): boolean {
  return old.orgId === input.orgId && old.surfaceId === input.surfaceId
    && old.authorKind === input.authorKind && old.authorId === input.authorId
    && old.threadRoot === input.threadRoot && old.requestId === input.requestId
    && old.sourceSessionId === input.sourceSessionId && old.sourceEventCursor === input.sourceEventCursor
    && old.requestedByUserId === input.requestedByUserId
    && old.event.pubkey === input.event.pubkey && old.event.kind === input.event.kind
    && old.event.content === input.event.content && JSON.stringify(old.event.tags) === JSON.stringify(input.event.tags)
}

type DispatchTarget = { readonly kind: 'employee' | 'team' | 'ingest'; readonly id: string }

function dispatchTargets(event: RoomNostrEvent, authorKind: RoomActorKind): readonly DispatchTarget[] {
  const targets: DispatchTarget[] = []
  const seen = new Set<string>()
  let route: 'team' | 'ingest' | undefined
  for (const tag of event.tags) {
    if (tag[0] === 'dsh-target') {
      const id = tag[1]
      if (tag.length !== 2 || id === undefined || id.trim() !== id || id === '' || id.length > 128
        || seen.has(id)) throw new Error('invalid room dispatch target')
      seen.add(id)
      targets.push({ kind: 'employee', id })
    }
    if (tag[0] === 'dsh-route') {
      if (tag.length !== 2 || (tag[1] !== 'team' && tag[1] !== 'ingest') || route !== undefined) {
        throw new Error('invalid room dispatch route')
      }
      route = tag[1]
    }
  }
  if (targets.length > 16 || route !== undefined && targets.length > 0) throw new Error('ambiguous room dispatch')
  if (route !== undefined) {
    if (authorKind !== 'human' || event.kind !== 9) throw new Error('invalid room dispatch route author')
    return [{ kind: route, id: route }]
  }
  if (targets.length > 0 && event.kind !== 9 && event.kind !== 41000 && event.kind !== 41001) {
    throw new Error('invalid room dispatch event kind')
  }
  if (event.kind === 41001 && targets.length > 0) throw new Error('handoff dispatch requires ownership transfer')
  return targets
}

function parseDispatch(row: DispatchRow): RoomDispatchClaim {
  if (row.target_kind !== 'employee' && row.target_kind !== 'team' && row.target_kind !== 'ingest') {
    throw new Error('invalid room dispatch kind')
  }
  nonempty(row.target_id, 'dispatch target')
  nonempty(row.lease_token, 'dispatch lease')
  const event = parseRow(row)
  if (row.dispatch_requested_by_user_id !== row.requested_by_user_id) {
    throw new Error('room dispatch requester mismatch')
  }
  return { orgId: event.orgId, surfaceId: event.surfaceId, eventId: event.event.id,
    targetKind: row.target_kind, targetId: row.target_id, leaseToken: row.lease_token,
    ...(row.requested_by_user_id === null ? {} : { requestedByUserId: row.requested_by_user_id }), event }
}

function pageLimit(limit: number | undefined): number {
  if (limit === undefined) return 50
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid room event limit')
  return limit
}

function cursor(after: string | undefined): string {
  if (after === undefined) return '0'
  if (!DECIMAL.test(after) || BigInt(after) > MAX_SEQUENCE) throw new Error('invalid room event cursor')
  return after
}

/** Repository for one signed, ordered room history per collaboration surface. Authorization stays with callers. */
export class PostgresRoomEventRepository {
  /** @param database - Shared enterprise database. */
  constructor(private readonly database: EnterprisePostgresDatabase) {}

  /** Classify unread signed posts for one current human member.
   * @param orgId - Authorized organization.
   * @param surfaceId - Authorized room.
   * @param userId - Current human member.
   * @returns New-post and explicit-mention attention plus the unread post count.
   */
  async attention(orgId: string, surfaceId: string,
    userId: string): Promise<{ newMessages: boolean; mentions: boolean; unread: number }> {
    const unread = async (mention: boolean): Promise<boolean> => {
      const rows = await this.database.query<EventRow>(`SELECT e.* FROM dsh_enterprise_collaboration_events e
        JOIN dsh_enterprise_collaboration_members m ON m.surface_id=e.surface_id AND m.user_id=$3
        LEFT JOIN dsh_enterprise_collaboration_read_cursors c
          ON c.org_id=e.org_id AND c.surface_id=e.surface_id AND c.user_id=m.user_id
        WHERE e.org_id=$1 AND e.surface_id=$2 AND e.sequence>coalesce(c.sequence,0)
          AND e.event_json->>'kind'='9' AND NOT (e.author_kind='human' AND e.author_id=$3)
          AND ($4::boolean=false OR e.event_json->'tags' @> $5::jsonb)
        ORDER BY e.sequence DESC LIMIT 1`,
      [orgId, surfaceId, userId, mention, JSON.stringify([['dsh-mention', userId]])])
      const found = rows.rows[0]
      if (found === undefined) return false
      const event = parseRow(found)
      return event.event.kind === 9 && (!mention || event.event.tags.some(tag => tag[0] === 'dsh-mention' && tag[1] === userId))
    }
    const counted = await this.database.query<{ unread: string | number }>(`SELECT count(*)::text AS unread FROM dsh_enterprise_collaboration_events e
      JOIN dsh_enterprise_collaboration_members m ON m.surface_id=e.surface_id AND m.user_id=$3
      LEFT JOIN dsh_enterprise_collaboration_read_cursors c
        ON c.org_id=e.org_id AND c.surface_id=e.surface_id AND c.user_id=m.user_id
      WHERE e.org_id=$1 AND e.surface_id=$2 AND e.sequence>coalesce(c.sequence,0)
        AND e.event_json->>'kind'='9' AND NOT (e.author_kind='human' AND e.author_id=$3)`,
    [orgId, surfaceId, userId])
    const unreadCount = Number(counted.rows[0]?.unread ?? 0)
    const newMessages = await unread(false)
    return { newMessages, mentions: newMessages && await unread(true), unread: unreadCount }
  }

  /** Advance a member's durable cursor only to an exact signed event in this room.
   * @param orgId - Authorized organization.
   * @param surfaceId - Authorized room.
   * @param userId - Current human member.
   * @param sequence - Last displayed event sequence.
   * @returns Whether the event belongs to this room and the human remains a member.
   */
  async markRead(orgId: string, surfaceId: string, userId: string, sequence: string): Promise<boolean> {
    if (!DECIMAL.test(sequence) || BigInt(sequence) < 1n || BigInt(sequence) > MAX_SEQUENCE) {
      throw new Error('invalid room read cursor')
    }
    return this.database.transaction(async (tx) => {
      const event = (await tx.query<EventRow>(`SELECT e.* FROM dsh_enterprise_collaboration_events e
        JOIN dsh_enterprise_collaboration_members m ON m.surface_id=e.surface_id AND m.user_id=$3
        WHERE e.org_id=$1 AND e.surface_id=$2 AND e.sequence=$4 FOR KEY SHARE OF m`,
      [orgId, surfaceId, userId, sequence])).rows[0]
      if (event === undefined) return false
      parseRow(event)
      const updated = await tx.query(`INSERT INTO dsh_enterprise_collaboration_read_cursors
        (org_id,surface_id,user_id,sequence)
        SELECT $1,$2,$3,$4 FROM dsh_enterprise_collaboration_members m
        JOIN dsh_enterprise_surface_directory d ON d.surface_id=m.surface_id AND d.org_id=$1
        WHERE m.surface_id=$2 AND m.user_id=$3
        ON CONFLICT(org_id,surface_id,user_id) DO UPDATE
        SET sequence=greatest(dsh_enterprise_collaboration_read_cursors.sequence,EXCLUDED.sequence)`,
      [orgId, surfaceId, userId, sequence])
      return updated.rowCount === 1
    })
  }

  /** Persist the first public key for one organization actor, or return its existing binding.
   * @param input - Authenticated actor and derived public key.
   * @returns Persisted public key.
   */
  async ensureRoomActorKey(input: RoomActorKeyBinding): Promise<string> {
    nonempty(input.orgId, 'organization')
    nonempty(input.actorId, 'actor')
    if (!actorKind(input.actorKind) || !HEX_64.test(input.pubkey)) throw new Error('invalid room actor public key')
    const inserted = await this.database.query<{ pubkey: string }>(`INSERT INTO dsh_enterprise_collaboration_actor_keys
      (org_id,actor_kind,actor_id,pubkey) VALUES($1,$2,$3,$4)
      ON CONFLICT(org_id,actor_kind,actor_id) DO UPDATE SET pubkey=EXCLUDED.pubkey
      WHERE dsh_enterprise_collaboration_actor_keys.pubkey=EXCLUDED.pubkey RETURNING pubkey`,
    [input.orgId, input.actorKind, input.actorId, input.pubkey])
    if (inserted.rows[0]?.pubkey !== input.pubkey) throw new RoomActorKeyConflictError()
    return input.pubkey
  }

  /** Read a persisted public key without obtaining custodial private material.
   * @param orgId - Organization scope.
   * @param actorKind - Actor category.
   * @param actorId - Actor identity.
   * @returns Public key if bound.
   */
  async getRoomActorKey(orgId: string, actorKind: RoomActorKind, actorId: string): Promise<string | undefined> {
    const row = (await this.database.query<{ pubkey: string }>(`SELECT pubkey FROM dsh_enterprise_collaboration_actor_keys
      WHERE org_id=$1 AND actor_kind=$2 AND actor_id=$3`, [orgId, actorKind, actorId])).rows[0]
    if (row !== undefined && !HEX_64.test(row.pubkey)) throw new Error('invalid stored room actor public key')
    return row?.pubkey
  }

  /** Append one signed event, converging exact request and source retries.
   * @param input - Authorized, verified event and trusted author/source metadata.
   * @returns Persisted room event with its monotonic sequence.
   */
  async append(input: RoomEventAppend): Promise<RoomEvent> {
    nonempty(input.orgId, 'organization')
    nonempty(input.surfaceId, 'surface')
    nonempty(input.authorId, 'author')
    if (!actorKind(input.authorKind)) throw new Error('invalid room author kind')
    if ((input.sourceSessionId === undefined) !== (input.sourceEventCursor === undefined)) throw new Error('incomplete room source cursor')
    for (const [name, value] of [['thread root', input.threadRoot], ['request id', input.requestId],
      ['source Session', input.sourceSessionId], ['source event cursor', input.sourceEventCursor],
      ['requester', input.requestedByUserId]] as const) {
      if (value !== undefined) nonempty(value, name)
    }
    const event = parseRoomNostrEvent(input.event)
    if (input.authorKind === 'human' && (event.kind === 9 || event.kind === 7)) {
      const signedRequests = event.tags.filter(tag => tag[0] === 'dsh-request')
      const signedRequest = signedRequests[0]
      if (input.requestId === undefined ? signedRequests.length !== 0
        : signedRequests.length !== 1 || signedRequest === undefined || signedRequest.length !== 2
          || signedRequest[1] !== input.requestId) {
        throw new Error('room signed request identity mismatch')
      }
    }
    if (event.tags.filter(tag => tag[0] === 'h').length !== 1
      || !event.tags.some(tag => tag[0] === 'h' && tag[1] === input.surfaceId)) {
      throw new Error('room event has no matching room tag')
    }
    const targets = dispatchTargets(event, input.authorKind)
    if (input.authorKind === 'service' && targets.length > 0 && input.requestedByUserId === undefined) {
      throw new Error('room service dispatch requester is required')
    }
    if (input.requestedByUserId !== undefined && input.authorKind !== 'service') {
      throw new Error('room dispatch requester requires service author')
    }
    return this.database.transaction(async (tx) => {
      const result = await tx.query<EventRow>(`INSERT INTO dsh_enterprise_collaboration_events
        (org_id,surface_id,event_id,event_json,author_kind,author_id,thread_root,request_id,
          source_session_id,source_event_cursor,requested_by_user_id)
        SELECT d.org_id,d.surface_id,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$12
        FROM dsh_enterprise_surface_directory d
        JOIN dsh_enterprise_collaboration_actor_keys k ON k.org_id=d.org_id AND k.actor_kind=$5 AND k.actor_id=$6 AND k.pubkey=$11
        WHERE d.org_id=$1 AND d.surface_id=$2 AND ($12::text IS NULL OR EXISTS (
          SELECT 1 FROM dsh_enterprise_collaboration_members m
          WHERE m.surface_id=d.surface_id AND m.user_id=$12))
        ON CONFLICT DO NOTHING RETURNING *`,
      [input.orgId, input.surfaceId, event.id, JSON.stringify(event), input.authorKind, input.authorId,
        input.threadRoot ?? null, input.requestId ?? null, input.sourceSessionId ?? null, input.sourceEventCursor ?? null,
        event.pubkey, input.requestedByUserId ?? null])
      const inserted = result.rows[0]
      if (inserted !== undefined) {
        if (input.authorKind === 'human' && (event.kind === 9 || event.kind === 7)) {
          await tx.query(`INSERT INTO dsh_enterprise_channel_workflow_trigger_inbox
            (org_id,surface_id,event_id,author_id,state,created_at,revision_refs)
            SELECT d.org_id,d.surface_id,$3,$4,'pending',$5,
              (SELECT jsonb_agg(jsonb_build_object('id',w.workflow_id,'revision',w.revision)
                ORDER BY w.workflow_id) FROM dsh_enterprise_channel_workflows w
                WHERE w.org_id=d.org_id AND w.surface_id=d.surface_id)
            FROM dsh_enterprise_surface_directory d
            WHERE d.org_id=$1 AND d.surface_id=$2 AND d.kind='channel'
              AND EXISTS (SELECT 1 FROM dsh_enterprise_channel_workflows w
                WHERE w.org_id=d.org_id AND w.surface_id=d.surface_id)
            ON CONFLICT(org_id,surface_id,event_id) DO NOTHING`,
          [input.orgId, input.surfaceId, event.id, input.authorId, Date.now()])
        }
        for (const target of targets) {
          await tx.query(`INSERT INTO dsh_enterprise_collaboration_dispatch
            (org_id,surface_id,event_id,target_kind,target_id,requested_by_user_id,state)
            VALUES($1,$2,$3,$4,$5,$6,'pending')`,
          [input.orgId, input.surfaceId, event.id, target.kind, target.id, input.requestedByUserId ?? null])
        }
        return parseRow(inserted)
      }
      const existing = await tx.query<EventRow>(`SELECT * FROM dsh_enterprise_collaboration_events
        WHERE org_id=$1 AND (
          (surface_id=$2 AND event_id=$3)
          OR (surface_id=$2 AND author_kind=$4 AND author_id=$5 AND request_id=$6 AND $6::text IS NOT NULL)
          OR (source_session_id=$7 AND source_event_cursor=$8 AND $7::text IS NOT NULL))
        ORDER BY sequence LIMIT 1`,
      [input.orgId, input.surfaceId, event.id, input.authorKind, input.authorId, input.requestId ?? null,
        input.sourceSessionId ?? null, input.sourceEventCursor ?? null])
      const old = existing.rows[0]
      if (old !== undefined) {
        const saved = parseRow(old)
        if (sameEvent(saved, input)) return saved
        throw new RoomEventConflictError()
      }
      throw new Error('room surface or actor key is unavailable')
    })
  }

  /** Claim pending or expired routes in durable event order for a background worker.
   * @param now - Current Unix epoch milliseconds.
   * @param limit - Maximum destinations to claim.
   * @param leaseMs - Validated worker lease duration.
   * @returns Fenced delivery claims carrying verified signed events.
   */
  async claimDispatch(now: number, limit: number, leaseMs: number): Promise<readonly RoomDispatchClaim[]> {
    return this.claim(now, limit, leaseMs)
  }

  /** Claim only destinations of one freshly committed room event.
   * @param orgId - Authenticated organization.
   * @param surfaceId - Authorized room.
   * @param eventId - Committed signed event identity.
   * @param now - Current Unix epoch milliseconds.
   * @param leaseMs - Validated worker lease duration.
   * @returns Fenced delivery claims for immediate native routing.
   */
  async claimEventDispatch(orgId: string, surfaceId: string, eventId: string, now: number,
    leaseMs: number): Promise<readonly RoomDispatchClaim[]> {
    nonempty(orgId, 'organization')
    nonempty(surfaceId, 'surface')
    if (!HEX_64.test(eventId)) throw new Error('invalid room dispatch event id')
    return this.claim(now, 16, leaseMs, { orgId, surfaceId, eventId })
  }

  private async claim(now: number, limit: number, leaseMs: number,
    scope?: { readonly orgId: string; readonly surfaceId: string; readonly eventId: string }): Promise<readonly RoomDispatchClaim[]> {
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 3_600_000
      || !Number.isSafeInteger(now + leaseMs)) throw new Error('invalid room dispatch lease')
    const leaseToken = randomUUID()
    const rows = await this.database.query<DispatchRow>(`WITH chosen AS (
      SELECT o.org_id,o.surface_id,o.event_id,o.target_kind,o.target_id
      FROM dsh_enterprise_collaboration_dispatch o
      JOIN dsh_enterprise_collaboration_events e
        ON e.org_id=o.org_id AND e.surface_id=o.surface_id AND e.event_id=o.event_id
      WHERE (o.state='pending' OR (o.state='processing' AND o.lease_until<$1))
        AND ($3::text IS NULL OR (o.org_id=$3 AND o.surface_id=$4 AND o.event_id=$5))
      ORDER BY e.sequence,o.target_kind,o.target_id LIMIT $2 FOR UPDATE OF o SKIP LOCKED)
      UPDATE dsh_enterprise_collaboration_dispatch o
      SET state='processing',lease_token=$6,lease_until=$7
      FROM chosen c,dsh_enterprise_collaboration_events e
      WHERE o.org_id=c.org_id AND o.surface_id=c.surface_id AND o.event_id=c.event_id
        AND o.target_kind=c.target_kind AND o.target_id=c.target_id
        AND e.org_id=o.org_id AND e.surface_id=o.surface_id AND e.event_id=o.event_id
      RETURNING e.*,o.target_kind,o.target_id,o.lease_token,
        o.requested_by_user_id AS dispatch_requested_by_user_id`,
    [now, limit, scope?.orgId ?? null, scope?.surfaceId ?? null, scope?.eventId ?? null,
      leaseToken, now + leaseMs])
    return rows.rows.map(parseDispatch).sort((a, b) => BigInt(a.event.sequence) < BigInt(b.event.sequence) ? -1
      : BigInt(a.event.sequence) > BigInt(b.event.sequence) ? 1 : a.targetId.localeCompare(b.targetId))
  }

  /** Mark one claimed destination delivered only while its lease token still owns the row.
   * @param claim - Original fenced claim.
   * @returns Whether this claim acknowledged the route.
   */
  async completeDispatch(claim: RoomDispatchClaim): Promise<boolean> {
    return this.setDispatchState(claim, 'completed')
  }

  /** Return one failed claim to the pending queue without affecting a newer worker.
   * @param claim - Original fenced claim.
   * @returns Whether this claim released the route.
   */
  async releaseDispatch(claim: RoomDispatchClaim): Promise<boolean> {
    return this.setDispatchState(claim, 'pending')
  }

  private async setDispatchState(claim: RoomDispatchClaim, state: 'pending' | 'completed'): Promise<boolean> {
    const result = await this.database.query(`UPDATE dsh_enterprise_collaboration_dispatch
      SET state=$7,lease_token=NULL,lease_until=NULL
      WHERE org_id=$1 AND surface_id=$2 AND event_id=$3 AND target_kind=$4 AND target_id=$5
        AND state='processing' AND lease_token=$6`,
    [claim.orgId, claim.surfaceId, claim.eventId, claim.targetKind, claim.targetId, claim.leaseToken, state])
    return result.rowCount === 1
  }

  /** Find one signed event by its NIP-01 event id within the authorized room.
   * @param orgId - Authorized organization.
   * @param surfaceId - Authorized room.
   * @param eventId - Signed event identity.
   * @returns Matching event, if present.
   */
  async getByEventId(orgId: string, surfaceId: string, eventId: string): Promise<RoomEvent | undefined> {
    const row = (await this.database.query<EventRow>(`SELECT * FROM dsh_enterprise_collaboration_events
      WHERE org_id=$1 AND surface_id=$2 AND event_id=$3`, [orgId, surfaceId, eventId])).rows[0]
    return row === undefined ? undefined : parseRow(row)
  }

  /** Recover a previously committed authenticated request before signing a retry.
   * @param orgId - Authorized organization.
   * @param surfaceId - Authorized room.
   * @param authorKind - Authenticated actor category.
   * @param authorId - Authenticated actor identity.
   * @param requestId - Stable request identity.
   * @returns Original event, if committed.
   */
  async findByRequest(orgId: string, surfaceId: string, authorKind: RoomActorKind, authorId: string,
    requestId: string): Promise<RoomEvent | undefined> {
    const row = (await this.database.query<EventRow>(`SELECT * FROM dsh_enterprise_collaboration_events
      WHERE org_id=$1 AND surface_id=$2 AND author_kind=$3 AND author_id=$4 AND request_id=$5`,
    [orgId, surfaceId, authorKind, authorId, requestId])).rows[0]
    return row === undefined ? undefined : parseRow(row)
  }

  /** Recover an employee post after a native Session event is replayed.
   * @param orgId - Authorized organization.
   * @param surfaceId - Authorized room.
   * @param sourceSessionId - Native Session identity.
   * @param sourceEventCursor - Native Session event cursor.
   * @returns Original event, if projected.
   */
  async findBySourceCursor(orgId: string, surfaceId: string, sourceSessionId: string,
    sourceEventCursor: string): Promise<RoomEvent | undefined> {
    const row = (await this.database.query<EventRow>(`SELECT * FROM dsh_enterprise_collaboration_events
      WHERE org_id=$1 AND surface_id=$2 AND source_session_id=$3 AND source_event_cursor=$4`,
    [orgId, surfaceId, sourceSessionId, sourceEventCursor])).rows[0]
    return row === undefined ? undefined : parseRow(row)
  }

  /** Establish a task's first owner only when its source event belongs to this room.
   * @param orgId - Authorized organization.
   * @param surfaceId - Authorized room.
   * @param taskId - Durable workflow task identity.
   * @param ownerId - Initial employee owner.
   * @param sourceEventId - Signed room event creating the task.
   * @returns Persisted owner; a concurrent claim keeps its first owner.
   */
  async ensureTaskOwner(orgId: string, surfaceId: string, taskId: string, ownerId: string,
    sourceEventId: string): Promise<string | undefined> {
    for (const [name, value] of [['task id', taskId], ['owner id', ownerId], ['source event id', sourceEventId]] as const) {
      nonempty(value, name)
    }
    await this.database.query(`INSERT INTO dsh_enterprise_collaboration_task_owners
      (org_id,surface_id,task_id,owner_id,last_event_id)
      SELECT e.org_id,e.surface_id,$3,$4,$5 FROM dsh_enterprise_collaboration_events e
      WHERE e.org_id=$1 AND e.surface_id=$2 AND e.event_id=$5
      ON CONFLICT(org_id,surface_id,task_id) DO NOTHING`, [orgId, surfaceId, taskId, ownerId, sourceEventId])
    const row = (await this.database.query<{ owner_id: string }>(`SELECT owner_id FROM dsh_enterprise_collaboration_task_owners
      WHERE org_id=$1 AND surface_id=$2 AND task_id=$3`, [orgId, surfaceId, taskId])).rows[0]
    return row?.owner_id
  }

  /** Transfer one task when the stored owner still matches the signed handoff's sender.
   * @param orgId - Authorized organization.
   * @param surfaceId - Authorized room.
   * @param taskId - Durable workflow task identity.
   * @param expectedOwnerId - Current owner required by the handoff.
   * @param newOwnerId - Receiving employee.
   * @param sourceEventId - Signed handoff event in the same room.
   * @returns Whether this handoff committed or was already applied.
   */
  async transferOwner(orgId: string, surfaceId: string, taskId: string, expectedOwnerId: string,
    newOwnerId: string, sourceEventId: string): Promise<boolean> {
    for (const [name, value] of [['task id', taskId], ['current owner', expectedOwnerId],
      ['new owner', newOwnerId], ['source event id', sourceEventId]] as const) nonempty(value, name)
    return this.database.transaction(async (tx) => {
      const source = (await tx.query<EventRow>(`SELECT * FROM dsh_enterprise_collaboration_events
        WHERE org_id=$1 AND surface_id=$2 AND event_id=$3`, [orgId, surfaceId, sourceEventId])).rows[0]
      if (source === undefined) return false
      const event = parseRow(source)
      const tasks = event.event.tags.filter(tag => tag[0] === 'task')
      const targets = event.event.tags.filter(tag => tag[0] === 'target')
      if (event.authorKind !== 'employee' || event.authorId !== expectedOwnerId || event.event.kind !== 41001
        || tasks.length !== 1 || tasks[0]?.length !== 2 || tasks[0][1] !== taskId
        || targets.length !== 1 || targets[0]?.length !== 2 || targets[0][1] !== newOwnerId) return false
      const updated = await tx.query(`UPDATE dsh_enterprise_collaboration_task_owners
        SET owner_id=$5,last_event_id=$6
        WHERE org_id=$1 AND surface_id=$2 AND task_id=$3 AND owner_id=$4`,
      [orgId, surfaceId, taskId, expectedOwnerId, newOwnerId, sourceEventId])
      if (updated.rowCount !== 1) {
        const current = (await tx.query<{ owner_id: string; last_event_id: string }>(
          `SELECT owner_id,last_event_id FROM dsh_enterprise_collaboration_task_owners
          WHERE org_id=$1 AND surface_id=$2 AND task_id=$3`, [orgId, surfaceId, taskId])).rows[0]
        if (current?.owner_id !== newOwnerId || current.last_event_id !== sourceEventId) return false
      }
      await tx.query(`INSERT INTO dsh_enterprise_collaboration_dispatch
        (org_id,surface_id,event_id,target_kind,target_id,state)
        VALUES($1,$2,$3,'employee',$4,'pending')
        ON CONFLICT(org_id,surface_id,event_id,target_kind,target_id) DO NOTHING`,
      [orgId, surfaceId, sourceEventId, newOwnerId])
      return true
    })
  }

  /** Read the latest page or a bounded page before/after an exclusive sequence.
   * @param orgId - Authorized organization.
   * @param surfaceId - Authorized room.
   * @param options - Exclusive cursor, upper bound, and optional thread root.
   * @returns Events in append order.
   */
  async list(orgId: string, surfaceId: string, options: RoomEventPageOptions = {}): Promise<readonly RoomEvent[]> {
    if (options.after !== undefined && options.before !== undefined) throw new Error('room event cursors are exclusive')
    const forward = options.after !== undefined
    const boundary = options.after === undefined && options.before === undefined
      ? null : cursor(options.after ?? options.before)
    const limit = pageLimit(options.limit)
    const rows = await this.database.query<EventRow>(`SELECT e.* FROM dsh_enterprise_collaboration_events e
      JOIN dsh_enterprise_surface_directory d ON d.surface_id=e.surface_id AND d.org_id=e.org_id
      WHERE e.org_id=$1 AND e.surface_id=$2
        AND ($3::bigint IS NULL OR e.sequence ${forward ? '>' : '<'} $3::bigint)
        AND ($4::text IS NULL OR e.thread_root=$4)
      ORDER BY e.sequence ${forward ? 'ASC' : 'DESC'} LIMIT $5`,
    [orgId, surfaceId, boundary, options.threadRoot ?? null, limit])
    const events = rows.rows.map(parseRow)
    return forward ? events : events.reverse()
  }

  /** Search bounded room content with PostgreSQL full-text indexing.
   * @param orgId - Authorized organization.
   * @param surfaceId - Authorized room.
   * @param query - Plain-text search terms.
   * @param options - Exclusive cursor and upper bound.
   * @returns Matching events in append order.
   */
  async search(orgId: string, surfaceId: string, query: string,
    options: { readonly after?: string; readonly limit?: number } = {}): Promise<readonly RoomEvent[]> {
    if (query.trim() === '' || query.length > 200) throw new Error('invalid room search query')
    const after = cursor(options.after), limit = pageLimit(options.limit)
    const rows = await this.database.query<EventRow>(`SELECT e.* FROM dsh_enterprise_collaboration_events e
      JOIN dsh_enterprise_surface_directory d ON d.surface_id=e.surface_id AND d.org_id=e.org_id
      WHERE e.org_id=$1 AND e.surface_id=$2 AND e.sequence>$3::bigint
        AND (e.search_vector @@ plainto_tsquery('simple',$4)
          OR strpos(lower(e.event_json->>'content'),lower($4))>0)
      ORDER BY e.sequence LIMIT $5`, [orgId, surfaceId, after, query, limit])
    return rows.rows.map(parseRow)
  }
}
