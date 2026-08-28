import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as WeComInvariant from '../src/invariant.ts'

describe('channel-wecom invariant companion', () => {
  it('registers its package-owned companion without runtime state', async () => {
    expect(WeComInvariant.name).toBe('channel-wecom-invariant')
    expect(WeComInvariant.inject).toEqual(['invariants'])
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(WeComInvariant).await()).resolves.toBeDefined()
  })
})
