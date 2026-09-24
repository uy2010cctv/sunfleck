/** Read-only projection of the current Cordis Loader plugin entries. */

import type { Context, FiberState } from '@deepseek-ai/cordis'
import { readFileSync } from 'node:fs'
import type {} from '@deepseek-ai/cordis-plugin-loader'
// Type-only: the optional agent-preset roster resolved through `ctx.get`.
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-app-boot'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  AgentPresetPluginGroup,
  PluginEntryId,
  PluginFiberPhase,
  PluginInventoryEntry,
  PluginInventorySnapshot,
} from './types.ts'

export type * from './types.ts'

/** Data used by `Config`. */
export interface Config {
  /** Optional profile manifest whose declared dependencies enrich installation-source metadata. */
  readonly profileManifestPath?: string
  /** Loader entry ids the inventory exposes but refuses to remove or reload. */
  readonly protectedEntryIds?: readonly string[]
}

function installationKind(spec: string): NonNullable<PluginInventoryEntry['installSource']>['kind'] {
  if (/\.tgz(?:$|[#?])/iu.test(spec)) return 'tgz'
  if (/^(?:git\+|github:)|\.git(?:#|$)/iu.test(spec)) return 'git'
  if (/^(?:file:|link:|\.{0,2}\/)/u.test(spec)) return 'file'
  return 'registry'
}

function dependencies(path: string | undefined): Readonly<Record<string, string>> {
  if (path === undefined) return {}
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { dependencies?: unknown }
    if (typeof value.dependencies !== 'object' || value.dependencies === null) return {}
    return Object.fromEntries(Object.entries(value.dependencies).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}

/**
 * Brand an existing Loader-tree entry id at the owning boundary.
 * @param value - the entry id as the Loader tree spells it.
 * @returns the same id as the inventory's branded entry id.
 */
export function pluginEntryId(value: string): PluginEntryId {
  return value as PluginEntryId
}

/** Runtime mirror: FiberState is a cross-package const enum. */
const FIBER_STATE = {
  PENDING: 0 as FiberState.PENDING,
  LOADING: 1 as FiberState.LOADING,
  ACTIVE: 2 as FiberState.ACTIVE,
  FAILED: 3 as FiberState.FAILED,
  DISPOSED: 4 as FiberState.DISPOSED,
  UNLOADING: 5 as FiberState.UNLOADING,
} as const

/** Complete public projection of Cordis Fiber states. */
const FIBER_PHASE = {
  [FIBER_STATE.PENDING]: 'pending',
  [FIBER_STATE.LOADING]: 'loading',
  [FIBER_STATE.ACTIVE]: 'active',
  [FIBER_STATE.FAILED]: 'failed',
  [FIBER_STATE.DISPOSED]: null,
  [FIBER_STATE.UNLOADING]: 'unloading',
} as const satisfies Record<FiberState, PluginFiberPhase>

/** Remote-only service exposing the Loader's current non-group entry state. */
export class PluginInventoryGateway extends TypertRemoteService {
  static inject = ['loader']

  private readonly config: Config

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'pluginInventory')
    this.config = config
  }

  /**
   * Read the Loader directly on every call. Cordis's internal plugin/status
   * events already maintain Entry.fiber and Fiber.state, so a second cache
   * would only add another lifecycle truth to keep synchronized.
   *
   * When an agent-preset roster is composed, the snapshot also carries each
   * preset's composition rows, because those rows — not the Loader's own
   * entries — are where a deployment that mounts the roster runs its
   * model-facing plugins.
   * @returns Current non-group Loader entries in Loader order, with optional display metadata
   * and per-preset compositions when a roster is composed.
   */
  @Remote('list')
  async list(): Promise<PluginInventorySnapshot> {
    const snapshot = await readPluginInventory(this.ctx)
    const installed = dependencies(this.config.profileManifestPath)
    const protectedEntries = new Set(this.config.protectedEntryIds ?? [])
    const entries = snapshot.entries.map(entry => {
      const spec = installed[entry.moduleName]
      return {
        ...entry,
        ...(spec === undefined ? {} : { installSource: { kind: installationKind(spec) } }),
        ...(!(protectedEntries.has(entry.entryId) || protectedEntries.has(entry.moduleName))
          ? {}
          : { protectedProfile: true }),
      }
    })
    return { ...snapshot, entries }
  }
}

export default PluginInventoryGateway

/** Read current Loader entries and optional preset compositions.
 * @param ctx Context with the Loader service.
 * @returns Current inventory with optional display metadata and no separate runtime cache.
 */
export async function readPluginInventory(ctx: Context): Promise<PluginInventorySnapshot> {
  const entries: PluginInventoryEntry[] = []
  const packages = ctx.get('pluginPackages')
  for (const entry of ctx.loader.entries()) {
    if (entry.options.group) continue
    const base = entry.parent.tree.ctx.baseUrl
    const meta = base === undefined ? undefined : packages?.metaOf(entry.options.name, base)
    entries.push({
      entryId: pluginEntryId(entry.id),
      moduleName: entry.options.name,
      enabled: !entry.disabled,
      fiberPhase: entry.fiber === undefined ? null : FIBER_PHASE[entry.fiber.state],
      ...meta === undefined ? {} : { meta },
    })
  }
  const presets = ctx.get('agentPresets')
  const management = ctx.get('pluginManager') === undefined ? {} : { managementAvailable: true }
  if (presets === undefined) return { entries, ...management }
  const agentPresets: AgentPresetPluginGroup[] = (await presets.compositionInventory()).map(
    composition => ({
      ...composition,
      rows: composition.rows.map(({ fiberState, ...row }) => {
        const meta = ctx.baseUrl === undefined ? undefined : packages?.metaOf(row.moduleName, ctx.baseUrl)
        return {
          ...row,
          fiberPhase: fiberState === undefined ? null : FIBER_PHASE[fiberState],
          ...meta === undefined ? {} : { meta },
        }
      }),
    }),
  )
  return { entries, agentPresets, ...management }
}
