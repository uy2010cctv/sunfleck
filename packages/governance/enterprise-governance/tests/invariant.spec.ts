import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as GovernanceInvariant from '../src/invariant.ts'

describe('enterprise governance invariant companion', () => {
  it('registers package ownership for the pure policy surface', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(GovernanceInvariant).await()).resolves.toBeDefined()
  })
})
