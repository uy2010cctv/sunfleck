/** Versioned channel YAML definitions and durable trigger/decision receipts. */
import { createHash, randomUUID } from 'node:crypto'
import type { EnterprisePostgresDatabase } from './index.ts'

/** Immutable workflow revision selected by one channel. */
export interface StoredChannelWorkflow {
  readonly id: string
  readonly revision: number
  readonly yaml: string
}
/** Persistent trigger identity; independent rooms cannot share one receipt. */
export interface ChannelWorkflowRun {
  readonly channelId: string
  readonly workflowId: string
  readonly revision: number
  readonly sourceEventId: string
}
/** Fenced worker claim; only this lease may settle or release a run. */
export interface ClaimedChannelWorkflowRun extends ChannelWorkflowRun {
  readonly leaseToken: string
}
/** Outcome retained until a human decision or completed action chain. */
export type ChannelWorkflowResult = { readonly state: 'completed' | 'rejected' }
  | { readonly state: 'waiting-human'; readonly decisionId: string; readonly nextStep: number }
/** One declared clock trigger resolved when a workflow revision is saved. */
export interface ChannelWorkflowSchedule {
  readonly triggerIndex: number
  readonly scheduleId: string
  readonly nextDueAt: number
  readonly intervalSeconds?: number
}
/** Durable scheduled occurrence claimed by one worker until acknowledged. */
export interface ChannelWorkflowDue extends ChannelWorkflowRun {
  readonly triggerIndex: number
  readonly scheduleId: string
  readonly scheduledAt: number
  readonly createdBy: string
}
/** One current human decision tied to an immutable workflow revision. */
export interface PendingChannelWorkflowDecision {
  readonly approvalId: string
  /** Enterprise approval CAS revision sent by the reviewer. */
  readonly revision: number
  readonly workflowRevision: number
  readonly yaml: string
  readonly nextStep: number
  readonly requestedBy: string
  readonly createdAt: number
  readonly state: 'pending'
}
/** Committed human verdict whose room continuation has not settled. */
export interface ReadyChannelWorkflowDecision {
  readonly orgId: string
  readonly channelId: string
  readonly approvalId: string
  readonly state: 'approved' | 'rejected'
  readonly reviewerUserId: string
}
/** Leased room event waiting for matching channel workflow evaluation. */
export interface RoomTriggerClaim {
  readonly orgId: string
  readonly channelId: string
  readonly eventId: string
  readonly authorId: string
  readonly leaseToken: string
  readonly revisions: readonly { readonly id: string; readonly revision: number }[]
}

/** Create additive workflow tables without changing the signed-room event schema version.
 * @param database - Shared enterprise PostgreSQL connection.
 */
export async function migrateChannelWorkflows(database: EnterprisePostgresDatabase): Promise<void> {
  await database.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [0x44534357])
    await tx.query('CREATE TABLE IF NOT EXISTS dsh_enterprise_channel_workflow_meta (version INTEGER NOT NULL)')
    const version = (await tx.query<{ version: number }>('SELECT version FROM dsh_enterprise_channel_workflow_meta')).rows[0]?.version
    if (version === 5) return
    if (version !== undefined && version !== 1 && version !== 2 && version !== 3 && version !== 4) {
      throw new Error(`unsupported channel workflow schema version ${version}`)
    }
    if (version === 4) {
      await upgradeTriggerRevisions(tx)
      await tx.query('UPDATE dsh_enterprise_channel_workflow_meta SET version=5')
      return
    }
    if (version === 3) {
      await tx.query('ALTER TABLE dsh_enterprise_channel_workflow_runs ADD COLUMN IF NOT EXISTS lease_token TEXT')
      await upgradeTriggerRevisions(tx)
      await tx.query('UPDATE dsh_enterprise_channel_workflow_meta SET version=5')
      return
    }
    if (version === 2) {
      await tx.query(triggerTable)
      await tx.query('ALTER TABLE dsh_enterprise_channel_workflow_runs ADD COLUMN IF NOT EXISTS lease_token TEXT')
      await tx.query('UPDATE dsh_enterprise_channel_workflow_meta SET version=5')
      return
    }
    if (version === 1) {
      await tx.query("ALTER TABLE dsh_enterprise_channel_workflow_schedules ADD COLUMN IF NOT EXISTS schedule_id TEXT NOT NULL DEFAULT ''")
      await tx.query(dueTable)
      await tx.query(dueIndex)
      await tx.query(scheduleIndex)
      await tx.query(triggerTable)
      await tx.query('ALTER TABLE dsh_enterprise_channel_workflow_runs ADD COLUMN IF NOT EXISTS lease_token TEXT')
      await tx.query('UPDATE dsh_enterprise_channel_workflow_meta SET version=5')
      return
    }
    await tx.query(`CREATE TABLE dsh_enterprise_channel_workflows (
      surface_id TEXT NOT NULL REFERENCES dsh_enterprise_surface_directory(surface_id) ON DELETE CASCADE,
      org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      workflow_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
      yaml TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), updated_at BIGINT NOT NULL,
      PRIMARY KEY(surface_id,workflow_id))`)
    await tx.query(`CREATE TABLE dsh_enterprise_channel_workflow_versions (
      surface_id TEXT NOT NULL, workflow_id TEXT NOT NULL, revision INTEGER NOT NULL,
      yaml TEXT NOT NULL, PRIMARY KEY(surface_id,workflow_id,revision),
      FOREIGN KEY(surface_id,workflow_id) REFERENCES dsh_enterprise_channel_workflows(surface_id,workflow_id) ON DELETE CASCADE)`)
    await tx.query(`CREATE TABLE dsh_enterprise_channel_workflow_runs (
      surface_id TEXT NOT NULL, workflow_id TEXT NOT NULL, revision INTEGER NOT NULL,
      source_event_id TEXT NOT NULL, state TEXT NOT NULL
        CHECK(state IN ('reserved','waiting-human','resuming','completed','rejected')),
      next_step INTEGER, decision_id TEXT, lease_until BIGINT, lease_token TEXT,
      PRIMARY KEY(surface_id,workflow_id,revision,source_event_id),
      FOREIGN KEY(surface_id,workflow_id,revision)
        REFERENCES dsh_enterprise_channel_workflow_versions(surface_id,workflow_id,revision) ON DELETE CASCADE)`)
    await tx.query(`CREATE UNIQUE INDEX dsh_enterprise_channel_workflow_decisions
      ON dsh_enterprise_channel_workflow_runs(surface_id,decision_id) WHERE decision_id IS NOT NULL`)
    await tx.query(`CREATE TABLE dsh_enterprise_channel_workflow_schedules (
      surface_id TEXT NOT NULL, workflow_id TEXT NOT NULL, trigger_index INTEGER NOT NULL, schedule_id TEXT NOT NULL,
      next_due_at BIGINT NOT NULL, interval_seconds INTEGER,
      PRIMARY KEY(surface_id,workflow_id,trigger_index),
      FOREIGN KEY(surface_id,workflow_id) REFERENCES dsh_enterprise_channel_workflows(surface_id,workflow_id) ON DELETE CASCADE)`)
    await tx.query(dueTable)
    await tx.query(dueIndex)
    await tx.query(scheduleIndex)
    await tx.query(triggerTable)
    await tx.query('INSERT INTO dsh_enterprise_channel_workflow_meta(version) VALUES(5)')
  })
}

/** Refuse old pending triggers whose original workflow revision was never recorded.
 * @param transaction - Version-locked workflow schema transaction.
 */
async function upgradeTriggerRevisions(transaction: EnterprisePostgresDatabase): Promise<void> {
  await transaction.query('ALTER TABLE dsh_enterprise_channel_workflow_trigger_inbox ADD COLUMN IF NOT EXISTS revision_refs JSONB')
  const pending = (await transaction.query<{ count: string }>(`SELECT count(*)::text AS count
    FROM dsh_enterprise_channel_workflow_trigger_inbox
    WHERE state IN ('pending','processing') AND revision_refs IS NULL`)).rows[0]
  if (Number(pending?.count ?? '0') > 0) {
    throw new Error('channel workflow migration has an unversioned pending trigger; preserve and review it before upgrading')
  }
  await transaction.query(`UPDATE dsh_enterprise_channel_workflow_trigger_inbox
    SET revision_refs='[]'::jsonb WHERE revision_refs IS NULL AND state='completed'`)
  await transaction.query('ALTER TABLE dsh_enterprise_channel_workflow_trigger_inbox ALTER COLUMN revision_refs SET NOT NULL')
}

const dueTable = `CREATE TABLE IF NOT EXISTS dsh_enterprise_channel_workflow_due (
  source_event_id TEXT PRIMARY KEY, org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  surface_id TEXT NOT NULL, workflow_id TEXT NOT NULL, revision INTEGER NOT NULL,
  trigger_index INTEGER NOT NULL, schedule_id TEXT NOT NULL, scheduled_at BIGINT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','processing','completed')),
  lease_until BIGINT, created_by TEXT NOT NULL REFERENCES users(id),
  FOREIGN KEY(surface_id,workflow_id,revision)
    REFERENCES dsh_enterprise_channel_workflow_versions(surface_id,workflow_id,revision) ON DELETE CASCADE)`
const dueIndex = `CREATE INDEX IF NOT EXISTS dsh_enterprise_channel_workflow_due_poll
  ON dsh_enterprise_channel_workflow_due(org_id,state,lease_until,scheduled_at)`
const scheduleIndex = `CREATE INDEX IF NOT EXISTS dsh_enterprise_channel_workflow_schedule_poll
  ON dsh_enterprise_channel_workflow_schedules(next_due_at)`
const triggerTable = `CREATE TABLE IF NOT EXISTS dsh_enterprise_channel_workflow_trigger_inbox (
  org_id TEXT NOT NULL, surface_id TEXT NOT NULL, event_id TEXT NOT NULL,
  author_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('pending','processing','completed')),
  lease_until BIGINT, lease_token TEXT, created_at BIGINT NOT NULL, revision_refs JSONB NOT NULL,
  PRIMARY KEY(org_id,surface_id,event_id),
  FOREIGN KEY(org_id,surface_id,event_id)
    REFERENCES dsh_enterprise_collaboration_events(org_id,surface_id,event_id) ON DELETE CASCADE)`

interface WorkflowRow extends Record<string, unknown> {
  readonly workflow_id: string
  readonly revision: number
  readonly yaml: string
}
interface DecisionRow extends WorkflowRow {
  readonly surface_id: string
  readonly source_event_id: string
  readonly next_step: number
  readonly lease_token: string
}

/** Organization-scoped PostgreSQL workflow definitions and delivery receipts. */
export class PostgresChannelWorkflowLedger {
  /** Claim one just-appended channel event for immediate workflow evaluation.
   * @param database - Shared enterprise database.
   * @param orgId - Authorized organization.
   * @param channelId - Authorized room.
   * @param eventId - Signed message or reaction.
   * @param now - Unix epoch milliseconds.
   * @param leaseMs - Recovery lease duration.
   * @returns Fenced claim, or undefined when another worker owns it.
   */
  static async claimRoomTriggerForEvent(database: EnterprisePostgresDatabase, orgId: string,
    channelId: string, eventId: string, now: number, leaseMs: number): Promise<RoomTriggerClaim | undefined> {
    return (await this.claimRoomTriggerRows(database, now, 1, leaseMs, { orgId, channelId, eventId }))[0]
  }

  /** Claim bounded pending or expired channel triggers across organizations.
   * @param database - Shared enterprise database.
   * @param now - Unix epoch milliseconds.
   * @param limit - Maximum events.
   * @param leaseMs - Recovery lease duration.
   * @returns Fenced trigger claims.
   */
  static async claimRoomTriggers(database: EnterprisePostgresDatabase, now: number,
    limit: number, leaseMs: number): Promise<readonly RoomTriggerClaim[]> {
    return this.claimRoomTriggerRows(database, now, limit, leaseMs)
  }

  private static async claimRoomTriggerRows(database: EnterprisePostgresDatabase, now: number,
    limit: number, leaseMs: number, filter?: { orgId: string; channelId: string; eventId: string }): Promise<RoomTriggerClaim[]> {
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
      || !Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 300_000) {
      throw new Error('invalid channel workflow trigger lease')
    }
    const token = randomUUID()
    const rows = await database.query<{ org_id: string
      surface_id: string
      event_id: string
      author_id: string
      lease_token: string
      revision_refs: unknown }>(`WITH claim AS (
        SELECT org_id,surface_id,event_id FROM dsh_enterprise_channel_workflow_trigger_inbox
        WHERE (state='pending' OR (state='processing' AND lease_until<$1))
          AND ($4::text IS NULL OR org_id=$4)
          AND ($5::text IS NULL OR surface_id=$5)
          AND ($6::text IS NULL OR event_id=$6)
        ORDER BY created_at,event_id LIMIT $2 FOR UPDATE SKIP LOCKED)
      UPDATE dsh_enterprise_channel_workflow_trigger_inbox i
      SET state='processing',lease_until=$3,lease_token=$7 FROM claim
      WHERE i.org_id=claim.org_id AND i.surface_id=claim.surface_id AND i.event_id=claim.event_id
      RETURNING i.org_id,i.surface_id,i.event_id,i.author_id,i.lease_token,i.revision_refs`,
    [now, limit, now + leaseMs, filter?.orgId ?? null, filter?.channelId ?? null,
      filter?.eventId ?? null, token])
    return rows.rows.map((row) => {
      if (typeof row.org_id !== 'string' || typeof row.surface_id !== 'string'
        || typeof row.event_id !== 'string' || typeof row.author_id !== 'string'
        || typeof row.lease_token !== 'string' || !Array.isArray(row.revision_refs)) {
        throw new Error('invalid stored workflow trigger claim')
      }
      const revisions = row.revision_refs.map((value: unknown) => {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new Error('invalid stored workflow revision reference')
        }
        const entry = value as Record<string, unknown>
        if (typeof entry['id'] !== 'string' || typeof entry['revision'] !== 'number'
          || !Number.isSafeInteger(entry['revision']) || entry['revision'] < 1) {
          throw new Error('invalid stored workflow revision reference')
        }
        return { id: entry['id'], revision: entry['revision'] }
      })
      return { orgId: row.org_id, channelId: row.surface_id, eventId: row.event_id,
        authorId: row.author_id, leaseToken: row.lease_token, revisions }
    })
  }

  /** Complete only the worker's own trigger claim.
   * @param database - Shared enterprise database.
   * @param claim - Original fenced claim.
   */
  static async completeRoomTrigger(database: EnterprisePostgresDatabase, claim: RoomTriggerClaim): Promise<void> {
    const result = await database.query(`UPDATE dsh_enterprise_channel_workflow_trigger_inbox
      SET state='completed',lease_until=NULL,lease_token=NULL
      WHERE org_id=$1 AND surface_id=$2 AND event_id=$3 AND state='processing' AND lease_token=$4`,
    [claim.orgId, claim.channelId, claim.eventId, claim.leaseToken])
    if (result.rowCount !== 1) throw new Error('workflow trigger lease lost')
  }

  /** Release a failed trigger for another bounded retry.
   * @param database - Shared enterprise database.
   * @param claim - Original fenced claim.
   */
  static async releaseRoomTrigger(database: EnterprisePostgresDatabase, claim: RoomTriggerClaim): Promise<void> {
    const result = await database.query(`UPDATE dsh_enterprise_channel_workflow_trigger_inbox
      SET state='pending',lease_until=NULL,lease_token=NULL
      WHERE org_id=$1 AND surface_id=$2 AND event_id=$3 AND state='processing' AND lease_token=$4`,
    [claim.orgId, claim.channelId, claim.eventId, claim.leaseToken])
    if (result.rowCount !== 1) throw new Error('workflow trigger lease lost')
  }
  /** Find committed verdicts awaiting room publication or workflow continuation.
   * @param database - Shared Enterprise database.
   * @param limit - Maximum decisions for one recovery tick.
   * @returns Reviewer identities and channel addresses; callers recheck current access.
   */
  static async decisionsReady(database: EnterprisePostgresDatabase,
    limit: number): Promise<readonly ReadyChannelWorkflowDecision[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('invalid workflow decision limit')
    const rows = await database.query<{ org_id: string
      surface_id: string
      decision_id: string
      state: string
      reviewer_user_id: string }>(`SELECT a.org_id,r.surface_id,r.decision_id,a.state,a.reviewer_user_id
      FROM dsh_enterprise_channel_workflow_runs r
      JOIN dsh_enterprise_approval_requests a ON a.approval_id=r.decision_id
      WHERE a.org_id IN (SELECT org_id FROM dsh_enterprise_surface_directory WHERE surface_id=r.surface_id)
        AND a.subject_type='channel-workflow' AND a.subject_id=r.surface_id
        AND a.state IN ('approved','rejected') AND a.reviewer_user_id IS NOT NULL
        AND (r.state='waiting-human' OR (r.state='resuming' AND r.lease_until<$1))
      ORDER BY a.updated_at,r.decision_id LIMIT $2`, [Date.now(), limit])
    return rows.rows.map((row) => {
      if (typeof row.org_id !== 'string' || typeof row.surface_id !== 'string'
        || typeof row.decision_id !== 'string' || typeof row.reviewer_user_id !== 'string'
        || row.state !== 'approved' && row.state !== 'rejected') {
        throw new Error('invalid stored workflow verdict')
      }
      return { orgId: row.org_id, channelId: row.surface_id, approvalId: row.decision_id,
        state: row.state, reviewerUserId: row.reviewer_user_id }
    })
  }
  /** Enumerate current channel definitions for authenticated provider deliveries.
   * The caller parses YAML and filters exact source and repository fields.
   * @param database - Shared enterprise database.
   * @returns Definitions with their configured manager and organization.
   */
  static async gitSubscriptions(database: EnterprisePostgresDatabase): Promise<readonly {
    readonly orgId: string
    readonly channelId: string
    readonly workflowId: string
    readonly revision: number
    readonly yaml: string
    readonly createdBy: string
  }[]> {
    const rows = await database.query<{ org_id: string
      surface_id: string
      workflow_id: string
      revision: number
      yaml: string
      created_by: string }>(`SELECT w.org_id,w.surface_id,w.workflow_id,
      w.revision,w.yaml,w.created_by FROM dsh_enterprise_channel_workflows w
      JOIN dsh_enterprise_surface_directory d ON d.surface_id=w.surface_id AND d.org_id=w.org_id
      WHERE d.kind='channel' ORDER BY w.org_id,w.surface_id,w.workflow_id`)
    return rows.rows.map((row) => {
      if (typeof row.org_id !== 'string' || typeof row.surface_id !== 'string'
        || typeof row.workflow_id !== 'string' || typeof row.revision !== 'number'
        || typeof row.yaml !== 'string' || typeof row.created_by !== 'string') {
        throw new Error('invalid stored channel workflow subscription')
      }
      return { orgId: row.org_id, channelId: row.surface_id, workflowId: row.workflow_id,
        revision: row.revision, yaml: row.yaml, createdBy: row.created_by }
    })
  }
  /** List organizations with a due clock or an unacknowledged occurrence.
   * @param database - Shared enterprise database.
   * @param now - Current Unix epoch milliseconds.
   * @returns Bounded organization ids for this scheduler tick.
   */
  static async dueOrganizations(database: EnterprisePostgresDatabase, now: number): Promise<readonly string[]> {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid channel workflow due query')
    const rows = await database.query<{ org_id: string }>(`SELECT org_id FROM (
      SELECT w.org_id FROM dsh_enterprise_channel_workflow_schedules s
        JOIN dsh_enterprise_channel_workflows w USING(surface_id,workflow_id)
        WHERE s.next_due_at<=$1
      UNION
      SELECT org_id FROM dsh_enterprise_channel_workflow_due
        WHERE state='pending' OR (state='processing' AND lease_until<$1)
    ) due ORDER BY org_id LIMIT 100`, [now])
    return rows.rows.map((row) => {
      if (typeof row.org_id !== 'string') throw new Error('invalid stored workflow organization')
      return row.org_id
    })
  }
  /** @param database - Shared enterprise database.
   * @param orgId - Authenticated or trusted scheduler organization.
   */
  constructor(private readonly database: EnterprisePostgresDatabase, private readonly orgId: string) {}

  /** Store a new immutable revision after compare-and-swap.
   * @param input - Authorized channel, author, YAML, and expected revision.
   * @returns Saved revision.
   */
  async save(input: { readonly channelId: string
    readonly id: string
    readonly yaml: string
    readonly expectedRevision: number
    readonly createdBy: string
    readonly schedules?: readonly ChannelWorkflowSchedule[] }): Promise<StoredChannelWorkflow> {
    return this.database.transaction(async (tx) => {
      const room = (await tx.query<{ kind: string }>(
        'SELECT kind FROM dsh_enterprise_surface_directory WHERE surface_id=$1 AND org_id=$2',
        [input.channelId, this.orgId])).rows[0]
      if (room?.kind !== 'channel') throw new Error('channel workflow channel unavailable')
      const prior = (await tx.query<WorkflowRow>(`SELECT workflow_id,revision,yaml
        FROM dsh_enterprise_channel_workflows WHERE surface_id=$1 AND workflow_id=$2 FOR UPDATE`,
      [input.channelId, input.id])).rows[0]
      if (prior?.revision !== input.expectedRevision && !(prior === undefined && input.expectedRevision === 0)) {
        throw new Error('channel workflow revision conflict')
      }
      const revision = input.expectedRevision + 1
      try {
        if (prior === undefined) {
          await tx.query(`INSERT INTO dsh_enterprise_channel_workflows
            (surface_id,org_id,workflow_id,revision,yaml,created_by,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [input.channelId, this.orgId, input.id, revision, input.yaml, input.createdBy, Date.now()])
        } else {
          await tx.query(`UPDATE dsh_enterprise_channel_workflows
            SET revision=$3,yaml=$4,updated_at=$5,created_by=$6
            WHERE surface_id=$1 AND workflow_id=$2`,
          [input.channelId, input.id, revision, input.yaml, Date.now(), input.createdBy])
        }
      } catch (error) {
        if ((error as { code?: string }).code === '23505') throw new Error('channel workflow revision conflict')
        throw error
      }
      await tx.query(`INSERT INTO dsh_enterprise_channel_workflow_versions
        (surface_id,workflow_id,revision,yaml) VALUES($1,$2,$3,$4)`,
      [input.channelId, input.id, revision, input.yaml])
      await tx.query('DELETE FROM dsh_enterprise_channel_workflow_schedules WHERE surface_id=$1 AND workflow_id=$2',
        [input.channelId, input.id])
      for (const schedule of input.schedules ?? []) {
        if (!Number.isSafeInteger(schedule.triggerIndex) || schedule.triggerIndex < 0
          || schedule.scheduleId.trim() === '' || !Number.isSafeInteger(schedule.nextDueAt)
          || schedule.nextDueAt < 0 || schedule.intervalSeconds !== undefined
            && (!Number.isSafeInteger(schedule.intervalSeconds) || schedule.intervalSeconds < 60)) {
          throw new Error('invalid channel workflow schedule')
        }
        await tx.query(`INSERT INTO dsh_enterprise_channel_workflow_schedules
          (surface_id,workflow_id,trigger_index,schedule_id,next_due_at,interval_seconds)
          VALUES($1,$2,$3,$4,$5,$6)`,
        [input.channelId, input.id, schedule.triggerIndex, schedule.scheduleId, schedule.nextDueAt,
          schedule.intervalSeconds ?? null])
      }
      return { id: input.id, revision, yaml: input.yaml }
    })
  }

  /** Read current definitions in one organization channel.
   * @param channelId - Authorized channel.
   * @returns Current revisions.
   */
  async list(channelId: string): Promise<readonly StoredChannelWorkflow[]> {
    const rows = await this.database.query<WorkflowRow>(`SELECT w.workflow_id,w.revision,w.yaml
      FROM dsh_enterprise_channel_workflows w JOIN dsh_enterprise_surface_directory d ON d.surface_id=w.surface_id
      WHERE w.surface_id=$1 AND d.org_id=$2 AND d.kind='channel' ORDER BY w.workflow_id`, [channelId, this.orgId])
    return rows.rows.map((row) => {
      if (typeof row.workflow_id !== 'string' || typeof row.revision !== 'number'
        || typeof row.yaml !== 'string') throw new Error('invalid stored channel workflow')
      return { id: row.workflow_id, revision: row.revision, yaml: row.yaml }
    })
  }

  /** Load exactly the immutable workflow revisions captured with a signed room event.
   * @param channelId - Authorized channel.
   * @param refs - Workflow ids and revisions recorded when the room event committed.
   * @returns Definitions in captured order; missing revisions fail closed.
   */
  async listRevisions(channelId: string,
    refs: readonly { readonly id: string; readonly revision: number }[]): Promise<readonly StoredChannelWorkflow[]> {
    if (refs.length === 0) return []
    for (const ref of refs) {
      if (ref.id.trim() === '' || !Number.isSafeInteger(ref.revision) || ref.revision < 1) {
        throw new Error('invalid workflow revision reference')
      }
    }
    const rows = await this.database.query<WorkflowRow>(`SELECT v.workflow_id,v.revision,v.yaml
      FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY input(value,ordinal)
      JOIN dsh_enterprise_channel_workflow_versions v
        ON v.surface_id=$1 AND v.workflow_id=input.value->>'id'
        AND v.revision=(input.value->>'revision')::integer
      JOIN dsh_enterprise_surface_directory d ON d.surface_id=v.surface_id AND d.org_id=$2
      ORDER BY input.ordinal`, [channelId, this.orgId, JSON.stringify(refs)])
    if (rows.rows.length !== refs.length) throw new Error('workflow revision unavailable')
    return rows.rows.map((row) => {
      if (typeof row.workflow_id !== 'string' || typeof row.revision !== 'number'
        || typeof row.yaml !== 'string') throw new Error('invalid stored workflow revision')
      return { id: row.workflow_id, revision: row.revision, yaml: row.yaml }
    })
  }

  /** List current pending decisions in an authorized organization channel.
   * @param channelId - Channel already checked for member access by the API.
   * @returns Pending approvals with immutable YAML for their summary.
   */
  async pendingDecisions(channelId: string): Promise<readonly PendingChannelWorkflowDecision[]> {
    const rows = await this.database.query<{ decision_id: string
      approval_revision: string
      workflow_revision: number
      yaml: string
      next_step: number
      requested_by: string
      created_at: string }>(`SELECT r.decision_id,a.revision AS approval_revision,
        r.revision AS workflow_revision,v.yaml,r.next_step,a.requested_by,a.created_at
      FROM dsh_enterprise_channel_workflow_runs r
      JOIN dsh_enterprise_channel_workflow_versions v
        ON v.surface_id=r.surface_id AND v.workflow_id=r.workflow_id AND v.revision=r.revision
      JOIN dsh_enterprise_approval_requests a ON a.approval_id=r.decision_id
      JOIN dsh_enterprise_surface_directory d ON d.surface_id=r.surface_id
      WHERE r.surface_id=$1 AND d.org_id=$2 AND d.kind='channel'
        AND a.org_id=$2 AND a.subject_type='channel-workflow' AND a.subject_id=$1
        AND r.state='waiting-human' AND a.state='pending'
      ORDER BY a.created_at,r.decision_id`, [channelId, this.orgId])
    return rows.rows.map((row) => {
      if (typeof row.decision_id !== 'string' || !Number.isSafeInteger(Number(row.approval_revision))
        || typeof row.workflow_revision !== 'number'
        || typeof row.yaml !== 'string' || typeof row.next_step !== 'number'
        || typeof row.requested_by !== 'string' || !Number.isSafeInteger(Number(row.created_at))) {
        throw new Error('invalid stored workflow decision')
      }
      return { approvalId: row.decision_id, revision: Number(row.approval_revision),
        workflowRevision: row.workflow_revision, yaml: row.yaml,
        nextStep: row.next_step, requestedBy: row.requested_by,
        createdAt: Number(row.created_at), state: 'pending' as const }
    })
  }

  /** Atomically reserve a trigger, including expired unfinished deliveries.
   * @param run - Immutable workflow revision and source event.
   * @param leaseMs - Configured worker claim duration.
   * @returns Fencing token when this caller owns an execution attempt.
   */
  async reserve(run: ChannelWorkflowRun, leaseMs: number): Promise<string | undefined> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 600_000) {
      throw new Error('invalid workflow run lease')
    }
    const token = randomUUID()
    const result = await this.database.query<{ lease_token: string }>(`INSERT INTO dsh_enterprise_channel_workflow_runs
      (surface_id,workflow_id,revision,source_event_id,state,lease_until,lease_token)
      SELECT $1,$2,$3,$4,'reserved',$6,$8 FROM dsh_enterprise_channel_workflow_versions v
      JOIN dsh_enterprise_surface_directory d ON d.surface_id=v.surface_id
      WHERE v.surface_id=$1 AND v.workflow_id=$2 AND v.revision=$3 AND d.org_id=$5
      ON CONFLICT(surface_id,workflow_id,revision,source_event_id)
        DO UPDATE SET lease_until=$6,lease_token=$8
      WHERE dsh_enterprise_channel_workflow_runs.state='reserved'
        AND dsh_enterprise_channel_workflow_runs.lease_until < $7 RETURNING lease_token`,
    [run.channelId, run.workflowId, run.revision, run.sourceEventId, this.orgId,
      Date.now() + leaseMs, Date.now(), token])
    return result.rows[0]?.lease_token
  }

  /** Read one trigger reservation before deciding whether inbox work may settle.
   * @param run - Immutable workflow and signed source identity.
   * @returns Durable lifecycle state, or undefined for an absent or foreign run.
   */
  async state(run: ChannelWorkflowRun): Promise<'reserved' | 'resuming' | 'waiting-human' | 'completed' | 'rejected' | undefined> {
    const row = (await this.database.query<{ state: string }>(`SELECT r.state
      FROM dsh_enterprise_channel_workflow_runs r
      JOIN dsh_enterprise_surface_directory d ON d.surface_id=r.surface_id
      WHERE d.org_id=$5 AND r.surface_id=$1 AND r.workflow_id=$2 AND r.revision=$3
        AND r.source_event_id=$4`,
    [run.channelId, run.workflowId, run.revision, run.sourceEventId, this.orgId])).rows[0]
    if (row === undefined) return undefined
    if (row.state !== 'reserved' && row.state !== 'resuming' && row.state !== 'waiting-human'
      && row.state !== 'completed' && row.state !== 'rejected') throw new Error('invalid stored workflow run state')
    return row.state
  }

  /** Persist an action-chain result and its pending human decision.
   * @param run - Reserved source event.
   * @param result - Completed, rejected, or human-gated outcome.
   */
  async record(run: ClaimedChannelWorkflowRun, result: ChannelWorkflowResult): Promise<void> {
    const updated = await this.database.query(`UPDATE dsh_enterprise_channel_workflow_runs r SET
      state=$5,next_step=$6,decision_id=$7,lease_until=NULL,lease_token=NULL
      FROM dsh_enterprise_surface_directory d WHERE r.surface_id=d.surface_id AND d.org_id=$8
      AND r.surface_id=$1 AND r.workflow_id=$2 AND r.revision=$3 AND r.source_event_id=$4
      AND r.lease_token=$9 AND r.state IN ('reserved','resuming')`,
    [run.channelId, run.workflowId, run.revision, run.sourceEventId, result.state,
      result.state === 'waiting-human' ? result.nextStep : null,
      result.state === 'waiting-human' ? result.decisionId : null, this.orgId, run.leaseToken])
    if (updated.rowCount !== 1) throw new Error('channel workflow run lease lost')
  }

  /** Release a failed initial reservation for idempotent retry.
   * @param run - Failed source event.
   */
  async release(run: ClaimedChannelWorkflowRun): Promise<void> {
    await this.database.query(`DELETE FROM dsh_enterprise_channel_workflow_runs r
      USING dsh_enterprise_surface_directory d WHERE r.surface_id=d.surface_id AND d.org_id=$5
      AND r.surface_id=$1 AND r.workflow_id=$2 AND r.revision=$3 AND r.source_event_id=$4
      AND r.state='reserved' AND r.lease_token=$6`,
    [run.channelId, run.workflowId, run.revision, run.sourceEventId, this.orgId, run.leaseToken])
  }

  /** Reserve one pending decision for a single human response.
   * @param channelId - Authorized channel.
   * @param decisionId - Existing Enterprise decision.
   * @returns Immutable workflow revision and continuation cursor.
   */
  async takeDecision(channelId: string, decisionId: string, leaseMs: number): Promise<{
    readonly workflow: StoredChannelWorkflow
    readonly run: ClaimedChannelWorkflowRun
    readonly nextStep: number
  } | undefined> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1000 || leaseMs > 600_000) {
      throw new Error('invalid workflow run lease')
    }
    const token = randomUUID()
    const claimed = await this.database.query<DecisionRow>(`UPDATE dsh_enterprise_channel_workflow_runs r
      SET state='resuming',lease_until=$4,lease_token=$6 FROM dsh_enterprise_surface_directory d,
      dsh_enterprise_channel_workflow_versions v
      WHERE r.surface_id=d.surface_id AND d.org_id=$3 AND d.kind='channel'
      AND r.surface_id=$1 AND r.decision_id=$2 AND
        (r.state='waiting-human' OR (r.state='resuming' AND r.lease_until < $5))
      AND v.surface_id=r.surface_id AND v.workflow_id=r.workflow_id AND v.revision=r.revision
      RETURNING r.surface_id,r.workflow_id,r.revision,r.source_event_id,r.next_step,r.lease_token,v.yaml`,
    [channelId, decisionId, this.orgId, Date.now() + leaseMs, Date.now(), token])
    const row = claimed.rows[0]
    return row === undefined ? undefined : {
      workflow: { id: row.workflow_id, revision: row.revision, yaml: row.yaml },
      run: { channelId: row.surface_id, workflowId: row.workflow_id, revision: row.revision,
        sourceEventId: row.source_event_id, leaseToken: row.lease_token }, nextStep: row.next_step,
    }
  }

  /** Restore one failed continuation while preserving its approval identity.
   * @param run - Claimed workflow decision whose next action failed.
   */
  async releaseDecision(run: ClaimedChannelWorkflowRun): Promise<void> {
    await this.database.query(`UPDATE dsh_enterprise_channel_workflow_runs r
      SET state='waiting-human',lease_until=NULL,lease_token=NULL
      FROM dsh_enterprise_surface_directory d WHERE r.surface_id=d.surface_id AND d.org_id=$5
      AND r.surface_id=$1 AND r.workflow_id=$2 AND r.revision=$3 AND r.source_event_id=$4
      AND r.state='resuming' AND r.lease_token=$6`,
    [run.channelId, run.workflowId, run.revision, run.sourceEventId, this.orgId, run.leaseToken])
  }

  /** Stage due occurrences while advancing the saved clock inside one transaction.
   * @param now - Current Unix epoch milliseconds.
   * @param limit - Maximum schedules examined in this tick.
   * @returns Count of newly staged occurrences.
   */
  async stageDue(now: number, limit: number): Promise<number> {
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('invalid channel workflow due query')
    }
    return this.database.transaction(async (tx) => {
      const schedules = await tx.query<{ surface_id: string
        workflow_id: string
        revision: number
        trigger_index: number
        schedule_id: string
        next_due_at: string
        interval_seconds: number | null
        created_by: string }>(`SELECT s.surface_id,s.workflow_id,w.revision,s.trigger_index,s.schedule_id,
        s.next_due_at,s.interval_seconds,w.created_by FROM dsh_enterprise_channel_workflow_schedules s
        JOIN dsh_enterprise_channel_workflows w USING(surface_id,workflow_id)
        WHERE w.org_id=$1 AND s.next_due_at<=$2 ORDER BY s.next_due_at,s.surface_id LIMIT $3 FOR UPDATE OF s SKIP LOCKED`,
      [this.orgId, now, limit])
      for (const row of schedules.rows) {
        const scheduledAt = Number(row.next_due_at)
        if (!Number.isSafeInteger(scheduledAt)) throw new Error('invalid stored workflow due time')
        const sourceEventId = createHash('sha256').update(JSON.stringify([
          row.surface_id, row.workflow_id, row.revision, row.trigger_index, scheduledAt,
        ])).digest('hex')
        await tx.query(`INSERT INTO dsh_enterprise_channel_workflow_due
          (source_event_id,org_id,surface_id,workflow_id,revision,trigger_index,schedule_id,scheduled_at,state,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9) ON CONFLICT(source_event_id) DO NOTHING`,
        [sourceEventId, this.orgId, row.surface_id, row.workflow_id, row.revision, row.trigger_index,
          row.schedule_id, scheduledAt, row.created_by])
        if (row.interval_seconds === null) {
          await tx.query(`DELETE FROM dsh_enterprise_channel_workflow_schedules
            WHERE surface_id=$1 AND workflow_id=$2 AND trigger_index=$3`,
          [row.surface_id, row.workflow_id, row.trigger_index])
        } else {
          const intervalMs = row.interval_seconds * 1000
          const next = scheduledAt + (Math.floor((now - scheduledAt) / intervalMs) + 1) * intervalMs
          await tx.query(`UPDATE dsh_enterprise_channel_workflow_schedules SET next_due_at=$4
            WHERE surface_id=$1 AND workflow_id=$2 AND trigger_index=$3`,
          [row.surface_id, row.workflow_id, row.trigger_index, next])
        }
      }
      return schedules.rows.length
    })
  }

  /** Claim staged schedule events or reclaim an expired worker lease.
   * @param now - Current Unix epoch milliseconds.
   * @param limit - Maximum occurrences claimed.
   * @returns Claimed immutable trigger facts.
   */
  async takeDue(now: number, limit: number): Promise<readonly ChannelWorkflowDue[]> {
    if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('invalid channel workflow due query')
    }
    const claimed = await this.database.query<{ surface_id: string
      workflow_id: string
      revision: number
      source_event_id: string
      trigger_index: number
      schedule_id: string
      scheduled_at: string
      created_by: string }>(`WITH claim AS (
        SELECT source_event_id FROM dsh_enterprise_channel_workflow_due
        WHERE org_id=$1 AND (state='pending' OR (state='processing' AND lease_until<$2))
        ORDER BY scheduled_at,source_event_id LIMIT $3 FOR UPDATE SKIP LOCKED)
      UPDATE dsh_enterprise_channel_workflow_due d SET state='processing',lease_until=$4
      FROM claim WHERE d.source_event_id=claim.source_event_id
      RETURNING d.surface_id,d.workflow_id,d.revision,d.source_event_id,d.trigger_index,
        d.schedule_id,d.scheduled_at,d.created_by`,
    [this.orgId, now, limit, now + 60_000])
    return claimed.rows.map((row) => {
      if (typeof row.surface_id !== 'string' || typeof row.workflow_id !== 'string'
        || typeof row.revision !== 'number' || typeof row.source_event_id !== 'string'
        || typeof row.trigger_index !== 'number' || typeof row.schedule_id !== 'string'
        || typeof row.created_by !== 'string' || !Number.isSafeInteger(Number(row.scheduled_at))) {
        throw new Error('invalid stored workflow due occurrence')
      }
      return { channelId: row.surface_id, workflowId: row.workflow_id,
        revision: row.revision, sourceEventId: row.source_event_id, triggerIndex: row.trigger_index,
        scheduleId: row.schedule_id, scheduledAt: Number(row.scheduled_at), createdBy: row.created_by }
    })
  }

  /** Acknowledge one fully handled clock trigger.
   * @param sourceEventId - Staged source event identity.
   */
  async completeDue(sourceEventId: string): Promise<void> {
    await this.database.query(`UPDATE dsh_enterprise_channel_workflow_due
      SET state='completed',lease_until=NULL WHERE org_id=$1 AND source_event_id=$2 AND state='processing'`,
    [this.orgId, sourceEventId])
  }
}
