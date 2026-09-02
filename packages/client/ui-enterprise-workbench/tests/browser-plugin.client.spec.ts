import { Context } from '@deepseek-ai/cordis'
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import {
  apply, CHANNEL_BINDING_BROADCAST_CHANNEL, channelBindingCallbackUri,
  completeChannelBindingCallback, inject,
} from '../src/client/index.ts'
import { apply as applyNode } from '../src/index.ts'
import { en, NS, zh } from '../src/client/locales.ts'

async function bench(declareSlots = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const declare = () => ctx.slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  if (declareSlots) declare()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.provide('sessions', {
    list: createSnapshotStore({
      ids: [], byId: {}, current: undefined, phase: 'ready',
      subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
    }),
    create: () => Promise.resolve('session-1'),
    open: () => {},
  } as never)
  ctx.provide('workspaces', {
    list: createSnapshotStore({
      items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
      baselinesReady: true, recentWorkspaceId: undefined,
    }),
  } as never)
  ctx.provide('connection', {} as never)
  const agentPresets = { list: () => Promise.resolve({ ok: true, value: { presets: [], authorable: false } }) }
  const enterpriseEmployee = {}
  const enterpriseAsset = {}
  const enterpriseTeam = {}
  const enterpriseOperation = {}
  const enterpriseTeamDefinition = {}
  const enterpriseTeamRun = {}
  const enterpriseTeamDecision = {}
  const enterpriseTeamAutonomy = {}
  const enterpriseChannel = {}
  const session = {}
  const pluginInventory = {}
  const cordisWorkspace = {}
  const cordisReview = {}
  const cordisGovernance = {}
  ctx.provide('remote', {
    agentPresets, enterpriseEmployee, enterpriseAsset, enterpriseTeam, enterpriseOperation,
    enterpriseTeamDefinition, enterpriseTeamRun, enterpriseTeamDecision, enterpriseTeamAutonomy,
    enterpriseChannel, session, pluginInventory,
    cordisWorkspace, cordisReview, cordisGovernance,
  } as never)
  ctx.provide('remote.agentPresets', agentPresets as never)
  ctx.provide('remote.enterpriseEmployee', enterpriseEmployee as never)
  ctx.provide('remote.enterpriseAsset', enterpriseAsset as never)
  ctx.provide('remote.enterpriseTeam', enterpriseTeam as never)
  ctx.provide('remote.enterpriseOperation', enterpriseOperation as never)
  ctx.provide('remote.enterpriseTeamDefinition', enterpriseTeamDefinition as never)
  ctx.provide('remote.enterpriseTeamRun', enterpriseTeamRun as never)
  ctx.provide('remote.enterpriseTeamDecision', enterpriseTeamDecision as never)
  ctx.provide('remote.enterpriseTeamAutonomy', enterpriseTeamAutonomy as never)
  ctx.provide('remote.enterpriseChannel', enterpriseChannel as never)
  ctx.provide('remote.session', session as never)
  ctx.provide('remote.pluginInventory', pluginInventory as never)
  ctx.provide('remote.cordisWorkspace', cordisWorkspace as never)
  ctx.provide('remote.cordisReview', cordisReview as never)
  ctx.provide('remote.cordisGovernance', cordisGovernance as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { ctx, fiber, declare }
}

describe('enterprise workbench browser plugin', () => {
  it('completes a marked callback with the canonical redirect, redacts it, notifies its opener, and closes', async () => {
    const requests: unknown[] = []
    const completeBinding = vi.fn((request: unknown) => {
      requests.push(request)
      return Promise.resolve({ result: { ok: true, value: {
        channelId: 'finance-wecom',
      } } })
    })
    const replaceState = vi.fn()
    const postMessage = vi.fn()
    const close = vi.fn()
    const handled = await completeChannelBindingCallback({ completeBinding } as never, {
      location: {
        origin: 'https://dsh.example', pathname: '/workbench',
        search: '?dsh_channel_binding=1&code=secret-code&state=opaque-state',
      },
      history: { replaceState }, opener: { postMessage }, close,
    })

    expect(handled).toBe(true)
    expect(completeBinding).toHaveBeenCalledWith(expect.objectContaining({
      code: 'secret-code', state: 'opaque-state',
      redirectUri: 'https://dsh.example/workbench?dsh_channel_binding=1',
    }))
    const completeRequest = requests[0] as { idempotencyKey: string }
    expect(completeRequest.idempotencyKey).toMatch(/^channel-binding-complete:/u)
    expect(postMessage).toHaveBeenCalledWith({
      type: 'dsh-channel-binding-complete', attemptId: 'opaque-state', channelId: 'finance-wecom',
    }, 'https://dsh.example')
    expect(replaceState).toHaveBeenCalledWith(null, '', '/workbench?dsh_channel_binding=1')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('redacts callback secrets before invoking a deferred complete Remote', async () => {
    const order: string[] = []
    let resolveComplete!: (value: { result: { ok: true; value: { channelId: string } } }) => void
    const completeBinding = vi.fn(() => {
      order.push('remote')
      return new Promise<{ result: { ok: true; value: { channelId: string } } }>((resolve) => {
        resolveComplete = resolve
      })
    })
    const pending = completeChannelBindingCallback({ completeBinding } as never, {
      location: {
        origin: 'https://dsh.example', pathname: '/workbench',
        search: '?dsh_channel_binding=1&code=sensitive-code&state=signed-state',
      },
      history: { replaceState: () => { order.push('redact') } }, opener: null, close: vi.fn(),
    })

    expect(order).toEqual(['redact', 'remote'])
    resolveComplete({ result: { ok: true, value: { channelId: 'finance-wecom' } } })
    await pending
  })

  it('publishes opener-independent success and failure with the exact callback attempt and closes each channel', async () => {
    const posts: unknown[] = []
    const closed: string[] = []
    class FakeBroadcastChannel {
      constructor(readonly name: string) {}
      postMessage(message: unknown): void { posts.push(message) }
      close(): void { closed.push(this.name) }
    }
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const browser = (state: string) => ({
      location: {
        origin: 'https://dsh.example', pathname: '/workbench',
        search: `?dsh_channel_binding=1&code=secret-code&state=${state}`,
      },
      history: { replaceState: vi.fn() }, opener: null, close: vi.fn(),
    })

    await completeChannelBindingCallback({ completeBinding: () => Promise.resolve({ result: {
      ok: true, value: { channelId: 'finance-wecom' },
    } }) } as never, browser('attempt-success'))
    await completeChannelBindingCallback({ completeBinding: () => Promise.reject(new Error('failed')) },
      browser('attempt-failure'))

    expect(posts).toEqual([
      { type: 'dsh-channel-binding-complete', attemptId: 'attempt-success', channelId: 'finance-wecom' },
      { type: 'dsh-channel-binding-failed', attemptId: 'attempt-failure' },
    ])
    expect(closed).toEqual([CHANNEL_BINDING_BROADCAST_CHANNEL, CHANNEL_BINDING_BROADCAST_CHANNEL])
    vi.unstubAllGlobals()
  })

  it('ignores ordinary pages without the callback marker', async () => {
    const completeBinding = vi.fn()
    const handled = await completeChannelBindingCallback({ completeBinding }, {
      location: { origin: 'https://dsh.example', pathname: '/workbench', search: '?code=x&state=y' },
      history: { replaceState: vi.fn() }, opener: null, close: vi.fn(),
    })
    expect(handled).toBe(false)
    expect(completeBinding).not.toHaveBeenCalled()
  })

  it('rejects empty or oversized callback values without calling the Remote', async () => {
    const completeBinding = vi.fn()
    const replaceState = vi.fn()
    await completeChannelBindingCallback({ completeBinding }, {
      location: {
        origin: 'https://dsh.example', pathname: '/workbench',
        search: `?dsh_channel_binding=1&code=${'x'.repeat(4097)}&state=`,
      },
      history: { replaceState }, opener: null, close: vi.fn(),
    })
    expect(completeBinding).not.toHaveBeenCalled()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/workbench?dsh_channel_binding=1&binding_error=1')
  })

  it('redacts failed callback secrets, reports a generic failure, and keeps the window open', async () => {
    const completeBinding = vi.fn(() => Promise.reject(new Error('exchange included secret-code')))
    const replaceState = vi.fn()
    const postMessage = vi.fn()
    const close = vi.fn()
    await completeChannelBindingCallback({ completeBinding }, {
      location: {
        origin: 'https://dsh.example', pathname: '/workbench',
        search: '?dsh_channel_binding=1&code=secret-code&state=opaque-state',
      },
      history: { replaceState }, opener: { postMessage }, close,
    })

    expect(replaceState).toHaveBeenCalledWith(null, '', '/workbench?dsh_channel_binding=1&binding_error=1')
    expect(postMessage).toHaveBeenCalledWith({
      type: 'dsh-channel-binding-failed', attemptId: 'opaque-state',
    }, 'https://dsh.example')
    expect(close).not.toHaveBeenCalled()
  })

  it('uses the same bounded idempotency key for retries of one signed state without including the code', async () => {
    const requests: Array<{ idempotencyKey: string }> = []
    const completeBinding = vi.fn((request: { idempotencyKey: string }) => {
      requests.push(request)
      return Promise.resolve({ result: { ok: true, value: { channelId: 'finance-wecom' } } })
    })
    const state = 's'.repeat(87)
    for (const code of ['first-code', 'retry-code']) {
      await completeChannelBindingCallback({ completeBinding } as never, {
        location: {
          origin: 'https://dsh.example', pathname: '/workbench',
          search: `?dsh_channel_binding=1&code=${code}&state=${state}`,
        },
        history: { replaceState: vi.fn() }, opener: null, close: vi.fn(),
      })
    }

    expect(requests).toHaveLength(2)
    expect(requests[0]?.idempotencyKey).toBe(requests[1]?.idempotencyKey)
    expect(requests[0]?.idempotencyKey.length).toBeLessThanOrEqual(128)
    expect(requests[0]?.idempotencyKey).not.toContain('first-code')
    expect(requests[0]?.idempotencyKey).not.toContain('retry-code')
  })

  it('builds the exact marker-only callback URI', () => {
    expect(channelBindingCallbackUri({ origin: 'https://dsh.example', pathname: '/workbench' }))
      .toBe('https://dsh.example/workbench?dsh_channel_binding=1')
  })

  it('declares its runtime dependencies', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'connection', 'sessions', 'workspaces', 'remote',
      'remote.agentPresets', 'remote.enterpriseEmployee', 'remote.enterpriseAsset',
      'remote.enterpriseTeam', 'remote.enterpriseOperation', 'remote.session',
      'remote.enterpriseTeamDefinition', 'remote.enterpriseTeamRun',
      'remote.enterpriseTeamDecision', 'remote.enterpriseTeamAutonomy',
      'remote.enterpriseChannel',
      'remote.pluginInventory',
      'remote.cordisWorkspace', 'remote.cordisReview', 'remote.cordisGovernance',
    ])
  })

  it('registers additive sidebar and overlay entries and removes them on teardown', async () => {
    const { ctx, fiber } = await bench()
    expect(ctx.slots.entries('sidebar.footer.action').map(entry => entry.options.id))
      .toContain('enterprise-workbench')
    expect(ctx.slots.entries('shell.overlay').map(entry => entry.options.id))
      .toContain('enterprise-workbench')

    await fiber.dispose()
    expect(ctx.slots.entries('sidebar.footer.action')).toHaveLength(0)
    expect(ctx.slots.entries('shell.overlay')).toHaveLength(0)
  })

  it('waits for parent slot declarations when browser plugins load concurrently', async () => {
    const { ctx, declare } = await bench(false)
    expect(ctx.slots.entries('sidebar.footer.action')).toHaveLength(0)

    declare()

    expect(ctx.slots.entries('sidebar.footer.action').map(entry => entry.options.id))
      .toContain('enterprise-workbench')
    expect(ctx.slots.entries('shell.overlay').map(entry => entry.options.id))
      .toContain('enterprise-workbench')
  })

  it('registers key-identical Chinese and English dictionaries', async () => {
    const { ctx } = await bench()
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
    ctx.locale.setLocale('zh')
    expect(ctx.locale.bind(NS)('title')).toBe(zh.title)
  })

  it('keeps the node half behavior-free', () => {
    expect(applyNode).not.toThrow()
  })
})
