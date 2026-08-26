import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as ChannelKernelInvariant from '../src/invariant.ts'

describe('channel kernel invariant companion', () => {
  it('registers package ownership for the pure decision surface', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ChannelKernelInvariant).await()).resolves.toBeDefined()
  })
})
