import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply, inject } from '../src/client/index.ts'
import { GovernanceSettingsSlot } from '../src/client/slots.tsx'

function response(value: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }))
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

async function bench(roles: readonly string[]) {
  const fetcher = vi.fn((input: RequestInfo | URL) => {
    const path = requestUrl(input)
    if (path === '/auth/status') {
      return response({
        authenticated: true,
        organizationId: 'default-enterprise',
        principal: {
          userId: 'user-1', orgId: 'default-enterprise', username: 'admin',
          displayName: 'Admin', roles,
        },
        providers: [],
      })
    }
    return response([])
  })
  vi.stubGlobal('fetch', fetcher)
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  await vi.waitFor(() => {
    expect(fetcher).toHaveBeenCalledWith('/auth/status', expect.anything())
  })
  return { ctx, fiber }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('enterprise governance browser plugin', () => {
  it('moves the administrator entry into Settings and leaves no sidebar action', async () => {
    const { ctx, fiber } = await bench(['administrator'])
    await vi.waitFor(() => {
      expect(ctx.slots.entries('settings.section').map(entry => entry.options.id))
        .toContain('enterprise-governance')
    })
    const entry = ctx.slots.entries('settings.section')
      .find(candidate => candidate.options.id === 'enterprise-governance')!
    expect(entry.component).toBe(GovernanceSettingsSlot)
    expect(entry.options).toMatchObject({ order: 100, label: '企业管理' })
    expect(ctx.slots.entries('sidebar.footer.action')).toHaveLength(0)

    await fiber.dispose()
    expect(ctx.slots.entries('settings.section')).toHaveLength(0)
  })

  it('does not expose the Settings entry to a non-administrator', async () => {
    const { ctx, fiber } = await bench(['member'])
    await new Promise((resolve) => { setTimeout(resolve, 0) })
    expect(ctx.slots.entries('settings.section')).toHaveLength(0)
    expect(ctx.slots.entries('shell.overlay').map(entry => entry.options.id))
      .toContain('enterprise-auth-gate')
    await fiber.dispose()
  })
})
