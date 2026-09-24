/** Import validated V4 JSONL Session successors into an empty PostgreSQL session schema. */

import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { PostgresSessionPersistence } from '@deepseek-ai/dsh-session-persistence-postgres'
import { SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'

const root = process.argv[2]
const connectionString = process.env.DSH_SESSION_V4_DATABASE_URL
if (root === undefined || connectionString === undefined || connectionString === '') {
  throw new Error('Usage: DSH_SESSION_V4_DATABASE_URL=<URL> import-v4-jsonl-to-postgres.ts <sessions-dir>')
}

const sourceContext = new Context()
const targetContext = new Context()
try {
  await sourceContext.plugin(JsonlSessionPersistence, { root: resolve(root), compression: 'none' })
  const source = sourceContext.sessionPersistence
  const target = new PostgresSessionPersistence(targetContext, { connectionString })
  if ((await target.list()).length !== 0) throw new Error('V4 PostgreSQL session schema is not empty')
  const snapshots = await source.list()
  let eventCount = 0
  for (const snapshot of snapshots) {
    const reader = await source.open(snapshot.header.id, 'read')
    try {
      if (reader.header.version !== SESSION_FORMAT_VERSION) throw new Error('source Session is not V4')
      const events = (await reader.read()).events
      const writer = await target.create(reader.header, { inheritedEventCount: reader.inheritedEventCount })
      try {
        if (events.length > 0) await writer.append(events)
        await writer.flush()
      } finally {
        await writer.close()
      }
      const restored = await target.open(reader.id, 'read')
      try {
        assert.deepEqual(restored.header, reader.header)
        assert.equal(restored.inheritedEventCount, reader.inheritedEventCount)
        assert.deepEqual((await restored.read()).events, events)
      } finally {
        await restored.close()
      }
      eventCount += events.length
    } finally {
      await reader.close()
    }
  }
  assert.equal((await target.list()).length, snapshots.length)
  console.log(`imported_sessions=${snapshots.length} verified_events=${eventCount}`)
} finally {
  await sourceContext.fiber.dispose()
  await targetContext.fiber.dispose()
}
