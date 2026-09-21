import type { PostgresDatabase } from '@deepseek-ai/dsh-enterprise-operations'
import type {
  ComputerUseRun, Device, DeviceActionView, OperationPermit, QueuedDeviceAction,
  RecorderDevice, RecorderPairingChallenge,
} from './index.ts'

/** Durable PostgreSQL repository for Device Plane identity, runs, permits, and actions. */
export class PostgresDevicePlaneRepository {
  constructor(private readonly database: PostgresDatabase, private readonly now: () => number = Date.now) {}
  /** Pair one physical device idempotently by its owner-scoped public key.
   * @param device - Candidate identity allocated by the Host.
   * @returns the existing or newly inserted device identity.
   */
  async pairDevice(device: Device): Promise<Device> {
    const now = this.now()
    const result = await this.database.query<DeviceRow>(`INSERT INTO dsh_enterprise_devices(
      device_id,org_id,user_id,device_name,platform,public_key,status,last_heartbeat_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$8)
      ON CONFLICT(org_id,user_id,public_key) DO UPDATE SET
        status=EXCLUDED.status,last_heartbeat_at=EXCLUDED.last_heartbeat_at,updated_at=EXCLUDED.updated_at
      RETURNING *`,
    [device.deviceId, device.orgId, device.userId, device.deviceName, device.platform, device.publicKey, device.status, now])
    const paired = result.rows[0]
    if (paired === undefined) throw new Error('device pairing returned no row')
    return deviceFromRow(paired)
  }
  /** Upsert one device heartbeat without changing its owner or public key.
   * @param device - Paired device snapshot.
   */
  async heartbeat(device: Device): Promise<void> {
    const now = this.now()
    await this.database.query(`INSERT INTO dsh_enterprise_devices(
      device_id,org_id,user_id,device_name,platform,public_key,status,last_heartbeat_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$8)
      ON CONFLICT(device_id) DO UPDATE SET status=EXCLUDED.status,last_heartbeat_at=EXCLUDED.last_heartbeat_at,updated_at=EXCLUDED.updated_at`,
    [device.deviceId, device.orgId, device.userId, device.deviceName, device.platform, device.publicKey, device.status, now])
  }
  /** Read one paired device by identity.
   * @param deviceId - Server-assigned device identity.
   * @returns stored device or undefined.
   */
  async device(deviceId: string): Promise<Device | undefined> {
    const result = await this.database.query<DeviceRow>(
      'SELECT * FROM dsh_enterprise_devices WHERE device_id=$1', [deviceId],
    )
    const row = result.rows[0]
    return row === undefined ? undefined : deviceFromRow(row)
  }
  /** List devices for one organization user and derive stale online rows as offline.
   * @param orgId - Owning organization.
   * @param userId - Owning user.
   * @returns owner-scoped device snapshots.
   */
  async listDevices(orgId: string, userId: string): Promise<Device[]> {
    const result = await this.database.query<DeviceRow>(
      `SELECT * FROM dsh_enterprise_devices WHERE org_id=$1 AND user_id=$2
       ORDER BY updated_at DESC,device_id`, [orgId, userId],
    )
    const now = this.now()
    return result.rows.map((row) => {
      const device = deviceFromRow(row)
      return device.status === 'online' && (device.lastHeartbeatAt === undefined || now - device.lastHeartbeatAt > 45_000)
        ? { ...device, status: 'offline' }
        : device
    })
  }
  /** Persist one authenticated user's short-lived recorder pairing challenge. */
  async saveRecorderPairing(challenge: RecorderPairingChallenge): Promise<void> {
    await this.database.query(`INSERT INTO dsh_enterprise_recorder_pairings(
      pairing_id,org_id,user_id,code_hash,expires_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6)`,
    [challenge.pairingId, challenge.orgId, challenge.userId, challenge.codeHash, challenge.expiresAt, this.now()])
  }
  /** Consume one valid recorder pairing code and return its server-owned user scope. */
  async consumeRecorderPairing(pairingId: string, codeHash: string): Promise<RecorderPairingChallenge | undefined> {
    const now = this.now()
    const result = pairingId === ''
      ? await this.database.query<RecorderPairingRow>(
        `UPDATE dsh_enterprise_recorder_pairings SET consumed_at=$2
         WHERE pairing_id=(SELECT pairing_id FROM dsh_enterprise_recorder_pairings
           WHERE code_hash=$1 AND consumed_at IS NULL AND expires_at >= $2
           ORDER BY created_at DESC LIMIT 1)
         RETURNING *`, [codeHash, now],
      )
      : await this.database.query<RecorderPairingRow>(
        `UPDATE dsh_enterprise_recorder_pairings SET consumed_at=$3
         WHERE pairing_id=$1 AND code_hash=$2 AND consumed_at IS NULL AND expires_at >= $3
         RETURNING *`, [pairingId, codeHash, now],
      )
    return result.rows[0] === undefined ? undefined : recorderPairingFromRow(result.rows[0])
  }
  /** Pair one recorder idempotently for the challenge owner; a foreign owner conflict returns undefined. */
  async pairRecorder(recorder: RecorderDevice, serialHash: string, credentialHash: string): Promise<RecorderDevice | undefined> {
    const now = this.now()
    const result = await this.database.query<RecorderRow>(`INSERT INTO dsh_enterprise_recorder_devices(
      recorder_id,org_id,user_id,device_name,serial_hash,relay_public_key,credential_hash,status,last_seen_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9)
      ON CONFLICT(serial_hash) DO UPDATE SET last_seen_at=EXCLUDED.last_seen_at,updated_at=EXCLUDED.updated_at
      WHERE dsh_enterprise_recorder_devices.org_id=EXCLUDED.org_id
        AND dsh_enterprise_recorder_devices.user_id=EXCLUDED.user_id
      RETURNING *`, [
      recorder.recorderId, recorder.orgId, recorder.userId, recorder.deviceName, serialHash,
      recorder.relayPublicKey, credentialHash, recorder.status, now,
    ])
    return result.rows[0] === undefined ? undefined : recorderFromRow(result.rows[0])
  }
  /** List recorder devices owned by one authenticated organization user. */
  async listRecorders(orgId: string, userId: string): Promise<RecorderDevice[]> {
    const result = await this.database.query<RecorderRow>(
      `SELECT * FROM dsh_enterprise_recorder_devices WHERE org_id=$1 AND user_id=$2
       ORDER BY updated_at DESC,recorder_id`, [orgId, userId],
    )
    return result.rows.map(recorderFromRow)
  }
  /** Persist one newly authorized Computer Use run.
   * @param run - Active run snapshot.
   */
  async saveRun(run: ComputerUseRun): Promise<void> {
    const now = this.now()
    await this.database.query(`INSERT INTO dsh_enterprise_computer_use_runs(
      run_id,org_id,user_id,device_id,workspace_id,session_id,mode,state,revision,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9)`,
    [run.runId, run.orgId, run.userId, run.deviceId, run.workspaceId, run.sessionId, run.mode, run.status, now])
  }
  /** Read one Computer Use run by identity.
   * @param runId - Stable run identity.
   * @returns stored run or undefined.
   */
  async run(runId: string): Promise<ComputerUseRun | undefined> {
    const result = await this.database.query<RunRow>(
      'SELECT * FROM dsh_enterprise_computer_use_runs WHERE run_id=$1', [runId],
    )
    return result.rows[0] === undefined ? undefined : runFromRow(result.rows[0])
  }
  /** List recent Computer Use runs for one organization user.
   * @param orgId - Owning organization.
   * @param userId - Owning user.
   * @param limit - Maximum rows, clamped to the service bound.
   * @returns recent owner-scoped runs.
   */
  async listRuns(orgId: string, userId: string, limit: number = 20): Promise<ComputerUseRun[]> {
    const result = await this.database.query<RunRow>(
      `SELECT * FROM dsh_enterprise_computer_use_runs
       WHERE org_id=$1 AND user_id=$2 ORDER BY updated_at DESC,run_id LIMIT $3`,
      [orgId, userId, Math.max(1, Math.min(limit, 100))],
    )
    return result.rows.map(runFromRow)
  }
  /** Apply one legal owner-scoped run transition at the expected revision.
   * @param input - Owner, target state, and optimistic revision.
   * @returns transitioned run or undefined on conflict.
   */
  async transitionRun(input: {
    orgId: string
    userId: string
    runId: string
    state: ComputerUseRun['status']
    expectedRevision: number
  }): Promise<ComputerUseRun | undefined> {
    const allowedCurrent = input.state === 'active' ? "state='paused'"
      : input.state === 'paused' ? "state='active'" : "state IN ('active','paused')"
    const result = await this.database.query<RunRow>(
      `UPDATE dsh_enterprise_computer_use_runs SET state=$1,revision=revision+1,updated_at=$2
       WHERE org_id=$3 AND user_id=$4 AND run_id=$5 AND revision=$6 AND ${allowedCurrent} RETURNING *`,
      [input.state, this.now(), input.orgId, input.userId, input.runId, input.expectedRevision],
    )
    return result.rows[0] === undefined ? undefined : runFromRow(result.rows[0])
  }
  /** Persist a standalone single-use operation permit.
   * @param permit - Unconsumed permit.
   * @param expiresAt - Absolute expiration time.
   */
  async savePermit(permit: OperationPermit, expiresAt: number): Promise<void> {
    const now = this.now()
    await this.database.query(`INSERT INTO dsh_enterprise_computer_use_permits(
      permit_id,org_id,user_id,device_id,run_id,operation_id,capability,expires_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [permit.permitId, permit.orgId, permit.userId, permit.deviceId, permit.runId, permit.operationId, permit.capability, expiresAt, now])
  }
  /** Atomically persist a permit and its typed pending action.
   * @param permit - Unconsumed operation permit.
   * @param expiresAt - Absolute permit expiration.
   * @param action - Fixed adapter and operation payload.
   * @returns queued action identity and payload.
   */
  async enqueueAction(
    permit: OperationPermit,
    expiresAt: number,
    action: Pick<QueuedDeviceAction, 'adapter' | 'operation'>,
  ): Promise<QueuedDeviceAction> {
    const actionId = `action-${permit.permitId}`
    const now = this.now()
    await this.database.transaction(async (database) => {
      await database.query(`INSERT INTO dsh_enterprise_computer_use_permits(
        permit_id,org_id,user_id,device_id,run_id,operation_id,capability,expires_at,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [permit.permitId, permit.orgId, permit.userId, permit.deviceId, permit.runId,
        permit.operationId, permit.capability, expiresAt, now])
      await database.query(`INSERT INTO dsh_enterprise_computer_use_actions(
        action_id,org_id,user_id,device_id,run_id,operation_id,capability,adapter,operation_json,state,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'pending',$10,$10)`,
      [actionId, permit.orgId, permit.userId, permit.deviceId, permit.runId, permit.operationId,
        permit.capability, action.adapter, JSON.stringify(action.operation), now])
    })
    return { actionId, operationId: permit.operationId, runId: permit.runId, deviceId: permit.deviceId,
      capability: permit.capability, adapter: action.adapter, operation: action.operation }
  }
  /** Claim the oldest permitted action while its run is active.
   * @param device - Authenticated reporting device.
   * @returns claimed action or undefined when none is eligible.
   */
  async claimAction(device: Device): Promise<QueuedDeviceAction | undefined> {
    const result = await this.database.query<ActionRow>(`WITH candidate AS (
        SELECT action.*,run.mode AS confirmation_mode FROM dsh_enterprise_computer_use_actions action
        JOIN dsh_enterprise_computer_use_runs run
          ON run.org_id=action.org_id AND run.run_id=action.run_id
        JOIN dsh_enterprise_computer_use_permits permit
          ON permit.org_id=action.org_id AND permit.run_id=action.run_id AND permit.operation_id=action.operation_id
        WHERE action.org_id=$1 AND action.user_id=$2 AND action.device_id=$3 AND action.state='pending'
          AND run.state='active'
          AND permit.consumed_at IS NULL AND permit.expires_at >= $4
        ORDER BY action.created_at,action.action_id FOR UPDATE OF action SKIP LOCKED LIMIT 1
      ) UPDATE dsh_enterprise_computer_use_actions action SET state='claimed',claimed_at=$4,updated_at=$4
        FROM candidate WHERE action.action_id=candidate.action_id RETURNING action.*,candidate.confirmation_mode`,
    [device.orgId, device.userId, device.deviceId, this.now()])
    return result.rows[0] === undefined ? undefined : actionFromRow(result.rows[0])
  }
  /** Read one owner-scoped action using its stable operation identity.
   * @param orgId - Owning organization.
   * @param userId - Owning user.
   * @param operationId - Stable idempotent operation identity.
   * @returns action projection or undefined.
   */
  async action(orgId: string, userId: string, operationId: string): Promise<DeviceActionView | undefined> {
    const result = await this.database.query<ActionRow>(
      `SELECT * FROM dsh_enterprise_computer_use_actions
       WHERE org_id=$1 AND user_id=$2 AND operation_id=$3`, [orgId, userId, operationId],
    )
    return result.rows[0] === undefined ? undefined : actionViewFromRow(result.rows[0])
  }
  /** List recent action projections for one organization user.
   * @param orgId - Owning organization.
   * @param userId - Owning user.
   * @param limit - Maximum rows, clamped to the service bound.
   * @returns recent owner-scoped actions.
   */
  async listActions(orgId: string, userId: string, limit: number = 50): Promise<DeviceActionView[]> {
    const result = await this.database.query<ActionRow>(
      `SELECT * FROM dsh_enterprise_computer_use_actions
       WHERE org_id=$1 AND user_id=$2 ORDER BY updated_at DESC,action_id LIMIT $3`,
      [orgId, userId, Math.max(1, Math.min(limit, 100))],
    )
    return result.rows.map(actionViewFromRow)
  }
  /** Commit one terminal result for an action claimed by the reporting device.
   * @param input - Reporting device, operation identity, terminal state, and evidence.
   * @returns whether exactly one claimed action committed.
   */
  async completeAction(input: {
    device: Device
    runId: string
    operationId: string
    state: 'completed' | 'rejected' | 'paused' | 'failed'
    summary: string
    evidenceHash?: string
  }): Promise<boolean> {
    const result = await this.database.query(`UPDATE dsh_enterprise_computer_use_actions
      SET state=$1,result_summary=$2,evidence_hash=$3,completed_at=$4,updated_at=$4
      WHERE org_id=$5 AND user_id=$6 AND device_id=$7 AND run_id=$8 AND operation_id=$9 AND state='claimed'`,
    [input.state, input.summary, input.evidenceHash ?? null, this.now(), input.device.orgId,
      input.device.userId, input.device.deviceId, input.runId, input.operationId])
    return result.rowCount === 1
  }
  /** Consume one unexpired permit exactly once.
   * @param input - Exact operation ownership tuple.
   * @returns whether one permit was consumed.
   */
  async consumePermit(input: Pick<OperationPermit, 'orgId' | 'userId' | 'deviceId' | 'runId' | 'operationId'>): Promise<boolean> {
    const result = await this.database.query(`UPDATE dsh_enterprise_computer_use_permits SET consumed_at=$1
      WHERE org_id=$2 AND user_id=$3 AND device_id=$4 AND run_id=$5 AND operation_id=$6
        AND consumed_at IS NULL AND expires_at >= $1 RETURNING permit_id`,
    [this.now(), input.orgId, input.userId, input.deviceId, input.runId, input.operationId])
    return result.rowCount === 1
  }
  /** Claim a signed-request nonce exactly once for replay protection.
   * @param deviceId - Authenticated device identity.
   * @param nonce - Signed random request nonce.
   * @param expiresAt - Replay record expiration.
   * @returns whether the nonce was new.
   */
  async claimNonce(deviceId: string, nonce: string, expiresAt: number): Promise<boolean> {
    const result = await this.database.query(
      `INSERT INTO dsh_enterprise_device_nonces(device_id,nonce,expires_at) VALUES($1,$2,$3)
       ON CONFLICT(device_id,nonce) DO NOTHING`, [deviceId, nonce, expiresAt],
    )
    return result.rowCount === 1
  }
}

interface DeviceRow extends Record<string, unknown> {
  device_id: string
  org_id: string
  user_id: string
  device_name: string
  platform: string
  public_key: string
  status: string
  last_heartbeat_at: number | string | null
  created_at: number | string
  updated_at: number | string
}

interface RecorderPairingRow extends Record<string, unknown> {
  pairing_id: string
  org_id: string
  user_id: string
  code_hash: string
  expires_at: number | string
  consumed_at: number | string | null
}

interface RecorderRow extends Record<string, unknown> {
  recorder_id: string
  org_id: string
  user_id: string
  device_name: string
  serial_hash: string
  relay_public_key: string
  credential_hash: string
  status: string
  last_seen_at: number | string | null
}

interface RunRow extends Record<string, unknown> {
  run_id: string
  org_id: string
  user_id: string
  device_id: string
  workspace_id: string
  session_id: string
  mode: string
  state: string
  revision: number | string
  created_at: number | string
  updated_at: number | string
}

interface ActionRow extends Record<string, unknown> {
  action_id: string
  operation_id: string
  run_id: string
  device_id: string
  capability: string
  adapter: string
  operation_json: unknown
  state: string
  result_summary: string | null
  evidence_hash: string | null
  created_at: number | string
  updated_at: number | string
  confirmation_mode?: string | null
}

function deviceFromRow(row: DeviceRow): Device {
  return {
    deviceId: row.device_id, orgId: row.org_id, userId: row.user_id, deviceName: row.device_name,
    platform: row.platform as Device['platform'], publicKey: row.public_key, status: row.status as Device['status'],
    ...(row.last_heartbeat_at === null ? {} : { lastHeartbeatAt: Number(row.last_heartbeat_at) }),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

function recorderPairingFromRow(row: RecorderPairingRow): RecorderPairingChallenge {
  return {
    pairingId: row.pairing_id, orgId: row.org_id, userId: row.user_id, codeHash: row.code_hash,
    expiresAt: Number(row.expires_at), ...(row.consumed_at === null ? {} : { consumedAt: Number(row.consumed_at) }),
  }
}

function recorderFromRow(row: RecorderRow): RecorderDevice {
  return {
    recorderId: row.recorder_id, orgId: row.org_id, userId: row.user_id, deviceName: row.device_name,
    recorderSerial: row.serial_hash, relayPublicKey: row.relay_public_key,
    status: row.status as RecorderDevice['status'],
    ...(row.last_seen_at === null ? {} : { lastSeenAt: Number(row.last_seen_at) }),
  }
}

function runFromRow(row: RunRow): ComputerUseRun {
  return {
    runId: row.run_id, orgId: row.org_id, userId: row.user_id, deviceId: row.device_id,
    workspaceId: row.workspace_id, sessionId: row.session_id,
    mode: row.mode as ComputerUseRun['mode'], status: row.state as ComputerUseRun['status'],
    revision: Number(row.revision), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}

function actionFromRow(row: ActionRow): QueuedDeviceAction {
  const operation = typeof row.operation_json === 'string' ? JSON.parse(row.operation_json) : row.operation_json
  return {
    actionId: row.action_id, operationId: row.operation_id, runId: row.run_id, deviceId: row.device_id,
    capability: row.capability as QueuedDeviceAction['capability'],
    adapter: row.adapter as QueuedDeviceAction['adapter'], operation: operation as QueuedDeviceAction['operation'],
    ...(row.confirmation_mode === 'observe' || row.confirmation_mode === 'confirm-each' || row.confirmation_mode === 'delegated'
      ? { confirmationMode: row.confirmation_mode }
      : {}),
  }
}

function actionViewFromRow(row: ActionRow): DeviceActionView {
  return {
    ...actionFromRow(row), state: row.state as DeviceActionView['state'],
    ...(row.result_summary === null ? {} : { summary: row.result_summary }),
    ...(row.evidence_hash === null ? {} : { evidenceHash: row.evidence_hash }),
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at),
  }
}
