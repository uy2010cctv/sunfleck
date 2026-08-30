import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context, type Plugin } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import PluginInventoryGateway from '../src/index.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const activePlugin: Plugin.Function = () => {}
const pendingPlugin: Plugin.Object = {
  inject: ['neverReady'],
  apply() {},
}

async function harness(): Promise<{
  ctx: Context
  inventory: PluginInventoryGateway
}> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Loader)
  ctx.loader.builtins.active = activePlugin
  ctx.loader.builtins.pending = pendingPlugin
  await ctx.plugin(PluginInventoryGateway)
  const inventory = ctx.get('pluginInventory') as PluginInventoryGateway
  return { ctx, inventory }
}

describe('PluginInventoryGateway', () => {
  it('publishes one direct list method under the pluginInventory namespace', async () => {
    const { inventory } = await harness()
    expect(inventory.typertRemote).toMatchObject({
      serviceKey: 'pluginInventory',
      namespace: 'pluginInventory',
    })
    expect(remoteMethods(inventory)).toEqual([
      { method: 'list', invocation: { kind: 'direct' } },
    ])
  })

  it('projects current non-group Loader entries without a second cache', async () => {
    const { ctx, inventory } = await harness()
    const activeId = await ctx.loader.create({ name: 'cordis:active' })
    const pendingId = await ctx.loader.create({ name: 'cordis:pending' })
    const disabledId = await ctx.loader.create({
      name: 'cordis:not-installed',
      disabled: true,
    })
    await ctx.loader.create({ name: 'cordis:active', group: true })

    const snapshot = inventory.list()
    expect(snapshot.entries).toHaveLength(3)
    expect(snapshot.entries).toEqual(expect.arrayContaining([
      {
        entryId: activeId,
        moduleName: 'cordis:active',
        enabled: true,
        fiberPhase: 'active',
      },
      {
        entryId: pendingId,
        moduleName: 'cordis:pending',
        enabled: true,
        fiberPhase: 'pending',
      },
      {
        entryId: disabledId,
        moduleName: 'cordis:not-installed',
        enabled: false,
        fiberPhase: null,
      },
    ]))

    await ctx.loader.update(activeId, { disabled: true })
    expect(inventory.list().entries.find(entry => entry.entryId === activeId)).toEqual({
      entryId: activeId,
      moduleName: 'cordis:active',
      enabled: false,
      fiberPhase: null,
    })

    await ctx.loader.remove(pendingId)
    expect(inventory.list().entries.some(entry => entry.entryId === pendingId)).toBe(false)
  })

  it('marks private Registry/tgz dependencies and protected Profile entries without exposing source specs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-inventory-'))
    roots.push(root)
    const manifest = join(root, 'package.json')
    await writeFile(manifest, JSON.stringify({ dependencies: {
      'cordis:orders': '^2.4.0',
      'cordis:audit': 'file:./artifacts/dsh-audit-1.0.0.tgz',
    } }))
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(Loader)
    ctx.loader.builtins.orders = activePlugin
    ctx.loader.builtins.audit = activePlugin
    ctx.loader.builtins.protected = activePlugin
    await ctx.loader.create({ name: 'cordis:orders' })
    await ctx.loader.create({ name: 'cordis:audit' })
    await ctx.loader.create({ name: 'cordis:protected' })
    await ctx.plugin(PluginInventoryGateway, {
      profileManifestPath: manifest,
      protectedEntryIds: ['cordis:protected'],
    })

    const rows = (ctx.get('pluginInventory') as PluginInventoryGateway).list().entries
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ moduleName: 'cordis:orders', installSource: { kind: 'registry' } }),
      expect.objectContaining({ moduleName: 'cordis:audit', installSource: { kind: 'tgz' } }),
      expect.objectContaining({ moduleName: 'cordis:protected', protectedProfile: true }),
    ]))
    expect(JSON.stringify(rows)).not.toContain('^2.4.0')
    expect(JSON.stringify(rows)).not.toContain('artifacts/dsh-audit')
  })
})
