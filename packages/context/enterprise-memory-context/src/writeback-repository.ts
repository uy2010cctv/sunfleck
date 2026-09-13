/** Durable PostgreSQL outbox for completed-turn enterprise-memory extraction. */
import { randomUUID } from 'node:crypto'
import type { MemoryTurnSnapshot } from './writeback-extraction.ts'
import type { MemoryWritebackJob, MemoryWritebackResult } from './writeback-worker.ts'

export type MemoryWritebackState = 'queued' | 'running' | 'completed' | 'failed'
export interface MemoryWritebackView {
  readonly sourceKey: string
  readonly sessionId: string
  readonly turn: number
  readonly state: MemoryWritebackState
  readonly attempts: number
  readonly nextAttemptAt: number
  readonly error?: string
  readonly result?: MemoryWritebackResult
  readonly createdAt: number
  readonly updatedAt: number
}

export interface MemoryWritebackDatabase {
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- query result rows are selected by each call.
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string, values?: readonly unknown[],
  ): Promise<{ readonly rows: readonly Row[]; readonly rowCount: number | null }>
  transaction<T>(operation: (database: MemoryWritebackDatabase) => Promise<T>): Promise<T>
}

interface JobRow extends Record<string, unknown> {
  source_key: string
  org_id: string
  workspace_id: string
  department_id: string | null
  actor_user_id: string
  session_id: string
  turn_number: string | number
  provider: string
  model: string
  user_text: string
  assistant_text: string
  state: MemoryWritebackState
  attempts: string | number
  next_attempt_at: string | number
  lease_owner: string | null
  lease_expires_at: string | number | null
  error_text: string | null
  result_json: unknown
  created_at: string | number
  updated_at: string | number
}

function integer(value: string | number, name: string): number {
  const result = Number(value)
  if (!Number.isSafeInteger(result)) throw new Error(`enterprise memory writeback ${name} is invalid`)
  return result
}
function parsed(value: unknown): unknown {
  if (value === null || value === undefined) return undefined
  return typeof value === 'string' ? JSON.parse(value) as unknown : value
}
function view(row: JobRow): MemoryWritebackView {
  const error = row.error_text
  const result = parsed(row.result_json) as MemoryWritebackResult | undefined
  return {
    sourceKey: row.source_key, sessionId: row.session_id, turn: integer(row.turn_number, 'turn'), state: row.state,
    attempts: integer(row.attempts, 'attempt count'), nextAttemptAt: integer(row.next_attempt_at, 'next attempt time'),
    ...(error === null ? {} : { error }), ...(result === undefined ? {} : { result }),
    createdAt: integer(row.created_at, 'creation time'), updatedAt: integer(row.updated_at, 'update time'),
  }
}
function job(row: JobRow): MemoryWritebackJob {
  return {
    sourceKey: row.source_key, orgId: row.org_id, workspaceId: row.workspace_id,
    ...(row.department_id === null ? {} : { departmentId: row.department_id }), actorUserId: row.actor_user_id,
    sessionId: row.session_id, turn: integer(row.turn_number, 'turn'), provider: row.provider, model: row.model,
    userText: row.user_text, assistantText: row.assistant_text, attempts: integer(row.attempts, 'attempt count'),
    leaseOwner: row.lease_owner ?? (() => { throw new Error('enterprise memory writeback lease owner is missing') })(),
  }
}

export function memoryWritebackRetryAt(now: number, attempts: number): number {
  const delays = [5_000, 15_000, 60_000, 180_000] as const
  return now + (delays[Math.min(delays.length - 1, Math.max(0, attempts - 1))] ?? delays[0])
}

/** PostgreSQL queue with idempotent enqueue, expiring leases and bounded retry state. */
export class EnterpriseMemoryWritebackRepository {
  private initialized: Promise<void> | undefined
  constructor(private readonly database: MemoryWritebackDatabase, private readonly now: () => number = Date.now) {}

  initialize(): Promise<void> {
    return this.initialized ??= this.database.transaction(async (database) => {
      await database.query(`CREATE TABLE IF NOT EXISTS dsh_enterprise_memory_writeback_jobs (
        source_key TEXT PRIMARY KEY, org_id TEXT NOT NULL, workspace_id TEXT NOT NULL, department_id TEXT,
        actor_user_id TEXT NOT NULL, session_id TEXT NOT NULL, turn_number BIGINT NOT NULL,
        provider TEXT NOT NULL, model TEXT NOT NULL, user_text TEXT, assistant_text TEXT,
        state TEXT NOT NULL CHECK (state IN ('queued','running','completed','failed')),
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at BIGINT NOT NULL DEFAULT 0,
        lease_owner TEXT, lease_expires_at BIGINT, error_text TEXT, result_json JSONB,
        created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
        UNIQUE(session_id, turn_number)
      )`)
      await database.query(`CREATE INDEX IF NOT EXISTS dsh_enterprise_memory_writeback_ready
        ON dsh_enterprise_memory_writeback_jobs(state,next_attempt_at,created_at)`)
      await database.query(`CREATE INDEX IF NOT EXISTS dsh_enterprise_memory_writeback_org_recent
        ON dsh_enterprise_memory_writeback_jobs(org_id,created_at DESC)`)
    })
  }

  async enqueue(input: MemoryTurnSnapshot & {
    orgId: string
    workspaceId: string
    departmentId?: string
    actorUserId: string
  }): Promise<MemoryWritebackView> {
    await this.initialize()
    const at = this.now()
    const sourceKey = `${input.sessionId}:${String(input.turn)}`
    const result = await this.database.query<JobRow>(
      `INSERT INTO dsh_enterprise_memory_writeback_jobs(
        source_key,org_id,workspace_id,department_id,actor_user_id,session_id,turn_number,provider,model,
        user_text,assistant_text,state,attempts,next_attempt_at,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'queued',0,0,$12,$12)
       ON CONFLICT(source_key) DO UPDATE SET source_key=EXCLUDED.source_key RETURNING *`,
      [sourceKey, input.orgId, input.workspaceId, input.departmentId ?? null, input.actorUserId,
        input.sessionId, input.turn, input.provider, input.model, input.userText, input.assistantText, at],
    )
    const row = result.rows[0]
    if (row === undefined) throw new Error('enterprise memory writeback enqueue returned no row')
    return view(row)
  }

  async claim(leaseMs: number): Promise<MemoryWritebackJob | undefined> {
    await this.initialize()
    return this.database.transaction(async (database) => {
      const at = this.now()
      const owner = randomUUID()
      const result = await database.query<JobRow>(
        `SELECT * FROM dsh_enterprise_memory_writeback_jobs
         WHERE (state='queued' AND next_attempt_at <= $1)
            OR (state='running' AND lease_expires_at <= $1)
         ORDER BY created_at,source_key FOR UPDATE SKIP LOCKED LIMIT 1`, [at],
      )
      const row = result.rows[0]
      if (row === undefined) return undefined
      const claimed = await database.query<JobRow>(
        `UPDATE dsh_enterprise_memory_writeback_jobs SET state='running',attempts=attempts+1,
         lease_owner=$1,lease_expires_at=$2,updated_at=$3,error_text=NULL WHERE source_key=$4 RETURNING *`,
        [owner, at + leaseMs, at, row.source_key],
      )
      const value = claimed.rows[0]
      return value === undefined ? undefined : job(value)
    })
  }

  async complete(work: Pick<MemoryWritebackJob, 'sourceKey' | 'leaseOwner'>, result: MemoryWritebackResult): Promise<void> {
    const at = this.now()
    const updated = await this.database.query(
      `UPDATE dsh_enterprise_memory_writeback_jobs SET state='completed',user_text=NULL,assistant_text=NULL,
       lease_owner=NULL,lease_expires_at=NULL,error_text=NULL,result_json=$1::jsonb,updated_at=$2
       WHERE source_key=$3 AND state='running' AND lease_owner=$4`, [JSON.stringify(result), at, work.sourceKey, work.leaseOwner],
    )
    if (updated.rowCount !== 1) throw new Error('enterprise memory writeback completion lost its lease')
  }

  async fail(work: Pick<MemoryWritebackJob, 'sourceKey' | 'leaseOwner' | 'attempts'>, error: unknown): Promise<void> {
    const at = this.now()
    const exhausted = work.attempts >= 5
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_000)
    const updated = await this.database.query(
      `UPDATE dsh_enterprise_memory_writeback_jobs SET state=$1,next_attempt_at=$2,
       lease_owner=NULL,lease_expires_at=NULL,error_text=$3,updated_at=$4
       WHERE source_key=$5 AND state='running' AND lease_owner=$6`,
      [exhausted ? 'failed' : 'queued', exhausted ? 0 : memoryWritebackRetryAt(at, work.attempts), message, at,
        work.sourceKey, work.leaseOwner],
    )
    if (updated.rowCount !== 1) throw new Error('enterprise memory writeback failure lost its lease')
  }

  async list(orgId: string, limit = 50): Promise<readonly MemoryWritebackView[]> {
    await this.initialize()
    const bounded = Math.min(100, Math.max(1, limit))
    const result = await this.database.query<JobRow>(
      `SELECT source_key,session_id,turn_number,state,attempts,next_attempt_at,error_text,result_json,created_at,updated_at,
       org_id,workspace_id,department_id,actor_user_id,provider,model,'' AS user_text,'' AS assistant_text,
       NULL AS lease_owner,NULL AS lease_expires_at
       FROM dsh_enterprise_memory_writeback_jobs WHERE org_id=$1 ORDER BY created_at DESC,source_key DESC LIMIT $2`,
      [orgId, bounded],
    )
    return result.rows.map(view)
  }

  async retry(orgId: string, sourceKey: string): Promise<MemoryWritebackView> {
    await this.initialize()
    const at = this.now()
    const result = await this.database.query<JobRow>(
      `UPDATE dsh_enterprise_memory_writeback_jobs SET state='queued',attempts=0,next_attempt_at=0,
       lease_owner=NULL,lease_expires_at=NULL,error_text=NULL,updated_at=$1
       WHERE org_id=$2 AND source_key=$3 AND state='failed' RETURNING *`, [at, orgId, sourceKey],
    )
    const row = result.rows[0]
    if (row === undefined) throw new Error('enterprise memory writeback job is not failed or does not exist')
    return view(row)
  }
}
