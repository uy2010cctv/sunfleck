import { describe, expect, it } from 'vitest'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import { EnterpriseRequestContext } from '../src/request-context.ts'

const principal = (userId: string): EnterprisePrincipal => ({
  userId,
  orgId: 'org-a',
  roles: ['member'],
})

describe('EnterpriseRequestContext', () => {
  it('rejects access when no authenticated request is active', () => {
    const context = new EnterpriseRequestContext()

    expect(context.current()).toBeUndefined()
    expect(() => context.requirePrincipal()).toThrow(/authenticated enterprise principal is required/)
  })

  it('exposes the principal only inside the run callback', async () => {
    const context = new EnterpriseRequestContext()
    const member = principal('member-1')

    expect(context.current()).toBeUndefined()
    await context.run(member, async () => {
      await Promise.resolve()
      expect(context.current()).toBe(member)
      expect(context.requirePrincipal()).toBe(member)
    })
    expect(context.current()).toBeUndefined()
  })

  it('isolates principals across concurrent requests', async () => {
    const context = new EnterpriseRequestContext()
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve })

    const first = context.run(principal('member-1'), async () => {
      await firstGate
      return context.requirePrincipal().userId
    })
    const second = context.run(principal('member-2'), async () => {
      releaseFirst()
      await secondGate
      return context.requirePrincipal().userId
    })
    releaseSecond()

    await expect(Promise.all([first, second])).resolves.toEqual(['member-1', 'member-2'])
    expect(context.current()).toBeUndefined()
  })
})
