/**
 * Cordis plugin that exposes the project governance service as
 * `ctx.enterpriseProjects`. The composition supplies the PostgreSQL handle;
 * the repository migrates the project tables lazily on first use and the
 * composition owns the handle's lifecycle.
 *
 * @module @deepseek-ai/dsh-enterprise-project
 */

import type { Context } from '@deepseek-ai/cordis'
import { EnterpriseProjectRepository } from './repository.ts'
import { EnterpriseProjectService } from './service.ts'
import type { PostgresDatabase } from './types.ts'

export * from './ids.ts'
export * from './types.ts'
export { EnterpriseProjectError, EnterpriseProjectRepository } from './repository.ts'
export { EnterpriseProjectService, resolveCreateProjectSpec, visibleToListing } from './service.ts'
export type { EnterpriseProjectStore, ResolvedCreateProjectSpec } from './service.ts'
export { ENTERPRISE_PROJECT_SCHEMA_VERSION, migrateEnterpriseProject } from './schema.ts'

/** Cordis plugin name. */
export const name = 'enterprise-project'

/** The plugin contributes the service only and injects no other service. */
export const inject: readonly string[] = []

/** Data used by `Config`. */
export interface Config {
  /**
   * PostgreSQL handle backing the project tables. A live database handle
   * cannot be expressed in cordis.yml, so the composing plugin passes it
   * programmatically and owns the database lifecycle; the `organizations` FK
   * target must already exist in that database.
   */
  readonly database: PostgresDatabase
}

/**
 * Mount the project governance service on the context. `ctx.provide` registers
 * the service as a lifecycle effect owned by this plugin's fiber, so an
 * unload/reload cycle un-provides and re-provides cleanly.
 * @param ctx - plugin context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.provide('enterpriseProjects', new EnterpriseProjectService(new EnterpriseProjectRepository(config.database)))
}
