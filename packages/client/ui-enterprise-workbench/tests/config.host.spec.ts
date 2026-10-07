import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { Config, apply } from '../src/index.ts'

it('validates the latest room entry page size', () => {
  expect(Config({}).roomInitialPageSize).toBe(20)
  for (const roomInitialPageSize of [1, 100]) expect(Config({ roomInitialPageSize }).roomInitialPageSize).toBe(roomInitialPageSize)
  for (const roomInitialPageSize of [0, 101, 1.5, NaN, Infinity]) expect(() => Config({ roomInitialPageSize })).toThrow()
})

it('projects configured room entry settings into the browser page', async () => {
  const ctx = new Context()
  try {
    apply(ctx, Config({ roomInitialPageSize: 7 }))
    const table: import('@deepseek-ai/dsh-host-webserver').IndexInjection[] = []
    await ctx.parallel('webserver/index-inject', table)
    expect(table).toContainEqual({ kind: 'global', name: '__DSH_ENTERPRISE_WORKBENCH_CONFIG__', value: { roomInitialPageSize: 7 } })
  } finally { await ctx.fiber.dispose() }
})
