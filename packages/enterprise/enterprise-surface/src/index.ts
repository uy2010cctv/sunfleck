/**
 * Cordis plugin that exposes the enterprise conversation-surface registry as
 * `ctx.surfaces`. The composition supplies the already-migrated enterprise
 * identity SQLite database; this package never opens or closes it. Delivery
 * carries an authenticated inbound dm message into the employee's anchored
 * session through the injected agent-host services.
 *
 * @module @deepseek-ai/dsh-enterprise-surface
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DatabaseSync } from 'node:sqlite'
import { DmSurfaceRegistry } from './dm.ts'

export * from './types.ts'
export { DmSurfaceRegistry } from './dm.ts'

/** Cordis plugin name. */
export const name = 'enterprise-surface'

/** Services required to anchor dm surfaces to live employee sessions. */
export const inject: readonly string[] = [
  'agentDefaultModel',
  'agentPresets',
  'agents',
  'employeeAccounts',
  'sessionTitle',
  'sessions',
  'workspaceRegistry',
]

/** Data used by `Config`. */
export interface Config {
  /**
   * Migrated enterprise identity database backing surface and inbox rows. A
   * live `DatabaseSync` handle cannot be expressed in cordis.yml, so the
   * composing plugin passes it programmatically and owns the database
   * lifecycle.
   */
  readonly database: DatabaseSync
  /**
   * Agent preset composed into every anchored employee session. P0 resolves
   * the preset directly from this field; release-driven resolution is
   * deferred.
   */
  readonly defaultAgentPreset: string
}

/**
 * Mount the surface registry on the context. `ctx.provide` registers the
 * service as a lifecycle effect owned by this plugin's fiber, so an
 * unload/reload cycle un-provides and re-provides cleanly.
 * @param ctx - plugin context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  if (config.defaultAgentPreset.trim() === '') {
    throw new TypeError('enterprise surfaces defaultAgentPreset must not be empty')
  }
  ctx.provide('surfaces', new DmSurfaceRegistry(ctx, config.database, config.defaultAgentPreset))
}
