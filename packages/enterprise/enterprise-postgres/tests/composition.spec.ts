import { describe, expect, it } from 'vitest'
import { EnterprisePostgresDatabase, createEnterprisePostgresComposition, enterpriseSessionBound } from '../src/index.ts'

function fakePool() {
  const calls: string[] = []
  const client = {
    async query(text: string) { calls.push(`client:${text}`); return { rows: [], rowCount: 0 } },
    release() { calls.push('release') },
  }
  return {
    calls,
    async query(text: string) { calls.push(`pool:${text}`); return { rows: [], rowCount: 0 } },
    async connect() { return client },
    async end() { calls.push('end') },
  }
}

describe('enterprise PostgreSQL composition', () => {
  it('resolves an employee work record through the authorized Session Workspace binding', async () => {
    const queries: Array<{ text: string; values: readonly unknown[] }> = []
    const database = {
      query: async (text: string, values: readonly unknown[]) => {
        queries.push({ text, values })
        return { rows: [{ present: 1 }], rowCount: 1 }
      },
    }
    await expect(enterpriseSessionBound(database as never, 'org-a', 'session-v4')).resolves.toBe(true)
    expect(queries).toHaveLength(1)
    expect(queries[0]?.text).toContain('enterprise_session_workspaces')
    expect(queries[0]?.values).toEqual(['session-v4', 'org-a'])
    expect(queries[0]?.text).not.toContain('dsh_session_headers')
  })
  it('requires a stable catalog cursor signing key', async () => {
    await expect(createEnterprisePostgresComposition({
      connectionString: 'postgresql:///unused', cursorSigningKey: '',
    })).rejects.toThrow(/cursor signing key/i)
  })

  it('rejects short and low-entropy catalog cursor signing keys before opening a pool', async () => {
    await expect(createEnterprisePostgresComposition({
      connectionString: 'postgresql:///unused', cursorSigningKey: Buffer.from([1]),
    })).rejects.toThrow(/at least 32 bytes/i)
    await expect(createEnterprisePostgresComposition({
      connectionString: 'postgresql:///unused', cursorSigningKey: Buffer.alloc(32, 1),
    })).rejects.toThrow(/entropy/i)
  })

  it('rejects an empty production connection string before opening a pool', async () => {
    await expect(createEnterprisePostgresComposition({
      connectionString: '   ', cursorSigningKey: Buffer.from('0123456789abcdef0123456789abcdef'),
    })).rejects.toThrow(/DATABASE_URL/i)
  })

  it('commits successful transactions and rolls back failures', async () => {
    const pool = fakePool()
    const database = new EnterprisePostgresDatabase(pool as never)
    await database.transaction(async (transaction) => { await transaction.query('SELECT 1') })
    await expect(database.transaction(async () => { throw new Error('boom') })).rejects.toThrow('boom')
    expect(pool.calls).toEqual(['client:BEGIN', 'client:SELECT 1', 'client:COMMIT', 'release', 'client:BEGIN', 'client:ROLLBACK', 'release'])
  })

  it('closes one shared pool only once across repeated disposal', async () => {
    const pool = fakePool()
    const database = new EnterprisePostgresDatabase(pool as never)

    await Promise.all([database.end(), database.end()])
    await database.end()

    expect(pool.calls).toEqual(['end'])
  })
})
