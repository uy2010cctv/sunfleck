/**
 * Cordis plugin that exposes the persistent employee account service as
 * `ctx.employeeAccounts`. The composition supplies the already-migrated
 * enterprise identity SQLite database; this package never opens or closes it.
 *
 * @module @deepseek-ai/dsh-employee-account
 */

import type { Context } from '@deepseek-ai/cordis'
import type { DatabaseSync } from 'node:sqlite'
import { EmployeeAccountService } from './service.ts'

export * from './ids.ts'
export * from './types.ts'
export { EmployeeAccountService } from './service.ts'

/** Cordis plugin name. */
export const name = 'employee-account'

/** The plugin contributes the service only and injects no other service. */
export const inject: readonly string[] = []

/** Data used by `Config`. */
export interface Config {
  /**
   * Migrated enterprise identity database backing the service. A live
   * `DatabaseSync` handle cannot be expressed in cordis.yml, so the composing
   * plugin passes it programmatically and owns the database lifecycle.
   */
  readonly database: DatabaseSync
}

/**
 * Mount the employee account service on the context. `ctx.provide` registers
 * the service as a lifecycle effect owned by this plugin's fiber, so an
 * unload/reload cycle un-provides and re-provides cleanly.
 * @param ctx - plugin context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.provide('employeeAccounts', new EmployeeAccountService(config.database))
}
