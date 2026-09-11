import type { PostgresDatabase } from '@deepseek-ai/dsh-enterprise-operations'
import type { ComputerUseRun, Device, OperationPermit } from './index.ts'

export class PostgresDevicePlaneRepository {
  constructor(private readonly database: PostgresDatabase, private readonly now: () => number = Date.now) {}
  async heartbeat(device: Device): Promise<void> {
    const now = this.now()
    await this.database.query(`INSERT INTO dsh_enterprise_devices(
      device_id,org_id,user_id,device_name,platform,public_key,status,last_heartbeat_at,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$8)
      ON CONFLICT(device_id) DO UPDATE SET status=EXCLUDED.status,last_heartbeat_at=EXCLUDED.last_heartbeat_at,updated_at=EXCLUDED.updated_at`,
    [device.deviceId, device.orgId, device.userId, device.deviceName, device.platform, device.publicKey, device.status, now])
  }
  async saveRun(run: ComputerUseRun): Promise<void> {
    const now = this.now()
    await this.database.query(`INSERT INTO dsh_enterprise_computer_use_runs(
      run_id,org_id,user_id,device_id,workspace_id,session_id,mode,state,revision,created_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$9)`,
    [run.runId, run.orgId, run.userId, run.deviceId, run.workspaceId, run.sessionId, run.mode, run.status, now])
  }
  async savePermit(permit: OperationPermit, expiresAt: number): Promise<void> {
    const now = this.now()
    await this.database.query(`INSERT INTO dsh_enterprise_computer_use_permits(
      permit_id,org_id,user_id,device_id,run_id,operation_id,capability,expires_at,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [permit.permitId, permit.orgId, permit.userId, permit.deviceId, permit.runId, permit.operationId, permit.capability, expiresAt, now])
  }
  async consumePermit(input: Pick<OperationPermit, 'orgId' | 'userId' | 'deviceId' | 'runId' | 'operationId'>): Promise<boolean> {
    const result = await this.database.query(`UPDATE dsh_enterprise_computer_use_permits SET consumed_at=$1
      WHERE org_id=$2 AND user_id=$3 AND device_id=$4 AND run_id=$5 AND operation_id=$6
        AND consumed_at IS NULL AND expires_at >= $1 RETURNING permit_id`,
    [this.now(), input.orgId, input.userId, input.deviceId, input.runId, input.operationId])
    return result.rowCount === 1
  }
}
