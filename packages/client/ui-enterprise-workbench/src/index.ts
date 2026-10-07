/** Host loader configuration projected to the enterprise browser workbench. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Config } from './config.ts'

export { Config } from './config.ts'

/** Publish validated room settings before browser plugins activate.
 * @param ctx - Host context collecting browser initialization data.
 * @param config - Validated room entry page size.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.on('webserver/index-inject', (table) => {
    table.push({ kind: 'global', name: '__DSH_ENTERPRISE_WORKBENCH_CONFIG__', value: config })
  })
}
