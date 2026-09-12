import { describe, expect, it } from 'vitest'
import type { PostgresDatabase, PostgresQueryResult } from '@deepseek-ai/dsh-enterprise-operations'
import { PostgresDevicePlaneRepository } from '../src/postgres.ts'

class Database implements PostgresDatabase {
  result: PostgresQueryResult = { rows: [], rowCount: 0 }
  last?: { text: string; values: readonly unknown[] }
  query<Row extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<PostgresQueryResult<Row>> {
    this.last = { text, values }
    return Promise.resolve(this.result as PostgresQueryResult<Row>)
  }
  transaction<T>(operation: (database: PostgresDatabase) => Promise<T>): Promise<T> { return operation(this) }
}

describe('PostgresDevicePlaneRepository', () => {
  it('reuses an existing device when the same user pairs the same public key again', async () => {
    const database = new Database()
    database.result = { rows: [{
      device_id: 'device-existing', org_id: 'org-a', user_id: 'user-a', device_name: 'Kris Mac', platform: 'macos',
      public_key: 'pk', status: 'online', last_heartbeat_at: 20, created_at: 1, updated_at: 20,
    }], rowCount: 1 }
    const device = await new PostgresDevicePlaneRepository(database, () => 20).pairDevice({
      deviceId: 'device-candidate', orgId: 'org-a', userId: 'user-a', deviceName: 'KrisdeMac-mini.local',
      platform: 'macos', publicKey: 'pk', status: 'online',
    })
    expect(device.deviceId).toBe('device-existing')
    expect(device.deviceName).toBe('Kris Mac')
    expect(database.last?.text).toContain('ON CONFLICT(org_id,user_id,public_key)')
    expect(database.last?.text).not.toContain('device_name=EXCLUDED.device_name')
    expect(database.last?.text).toContain('RETURNING *')
  })

  it('lists only the requesting user devices', async () => {
    const database = new Database()
    database.result = { rows: [{
      device_id: 'device-1', org_id: 'org-a', user_id: 'user-a', device_name: 'Mac', platform: 'macos',
      public_key: 'pk', status: 'online', last_heartbeat_at: 10, created_at: 1, updated_at: 10,
    }], rowCount: 1 }
    const items = await new PostgresDevicePlaneRepository(database).listDevices('org-a', 'user-a')
    expect(items).toEqual([expect.objectContaining({ deviceId: 'device-1', userId: 'user-a', lastHeartbeatAt: 10 })])
    expect(database.last?.values).toEqual(['org-a', 'user-a'])
  })

  it('transitions a run only at the expected revision and owner scope', async () => {
    const database = new Database()
    database.result = { rows: [{
      run_id: 'run-1', org_id: 'org-a', user_id: 'user-a', device_id: 'device-1', workspace_id: 'ws-1',
      session_id: 'session-1', mode: 'confirm-each', state: 'paused', revision: 2, created_at: 1, updated_at: 20,
    }], rowCount: 1 }
    const value = await new PostgresDevicePlaneRepository(database, () => 20)
      .transitionRun({ orgId: 'org-a', userId: 'user-a', runId: 'run-1', state: 'paused', expectedRevision: 1 })
    expect(value).toMatchObject({ runId: 'run-1', status: 'paused', revision: 2 })
    expect(database.last?.text).toContain('revision=$6')
    expect(database.last?.text).toContain("state='active'")
  })

  it('lists recent runs and actions only for their owner', async () => {
    const database = new Database()
    const repository = new PostgresDevicePlaneRepository(database)
    await repository.listRuns('org-a', 'user-a')
    expect(database.last?.values).toEqual(['org-a', 'user-a', 20])
    expect(database.last?.text).toContain('dsh_enterprise_computer_use_runs')
    await repository.listActions('org-a', 'user-a')
    expect(database.last?.values).toEqual(['org-a', 'user-a', 50])
    expect(database.last?.text).toContain('dsh_enterprise_computer_use_actions')
  })

  it('claims actions only while their run remains active', async () => {
    const database = new Database()
    await new PostgresDevicePlaneRepository(database).claimAction({
      deviceId: 'device-1', orgId: 'org-a', userId: 'user-a', deviceName: 'Mac',
      platform: 'macos', publicKey: 'pk', status: 'online',
    })
    expect(database.last?.text).toContain("run.state='active'")
  })

  it('claims each signed request nonce only once', async () => {
    const database = new Database()
    database.result = { rows: [], rowCount: 1 }
    const claimed = await new PostgresDevicePlaneRepository(database, () => 20)
      .claimNonce('device-1', 'nonce-1', 80)
    expect(claimed).toBe(true)
    expect(database.last?.text).toContain('ON CONFLICT(device_id,nonce) DO NOTHING')
  })
})
