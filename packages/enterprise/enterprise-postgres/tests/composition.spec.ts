import { describe, expect, it } from 'vitest'
import { EnterprisePostgresDatabase, createEnterprisePostgresComposition } from '../src/index.ts'

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
  it('rejects an empty production connection string before opening a pool', async () => {
    await expect(createEnterprisePostgresComposition({ connectionString: '   ' })).rejects.toThrow(/DATABASE_URL/i)
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
