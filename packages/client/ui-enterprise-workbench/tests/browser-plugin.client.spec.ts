import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { apply, inject } from '../src/client/index.ts'
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
  const session = {}
  const pluginInventory = {}
  const cordisWorkspace = {}
  const cordisReview = {}
  const cordisGovernance = {}
  ctx.provide('remote', {
    agentPresets, enterpriseEmployee, enterpriseAsset, enterpriseTeam, enterpriseOperation,
    enterpriseTeamDefinition, enterpriseTeamRun, enterpriseTeamDecision, enterpriseTeamAutonomy, session, pluginInventory,
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
  it('declares its runtime dependencies', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'connection', 'sessions', 'workspaces', 'remote',
      'remote.agentPresets', 'remote.enterpriseEmployee', 'remote.enterpriseAsset',
      'remote.enterpriseTeam', 'remote.enterpriseOperation', 'remote.session',
      'remote.enterpriseTeamDefinition', 'remote.enterpriseTeamRun',
      'remote.enterpriseTeamDecision', 'remote.enterpriseTeamAutonomy',
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
