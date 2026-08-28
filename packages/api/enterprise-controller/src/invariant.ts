/** Package-owned invariant companion for enterprise Remote controllers. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-api-enterprise-controller'
export const name = 'api-enterprise-controller-invariant'
export const inject = ['invariants']
/** No runtime invariant: repository constraints and mandatory authorization own the state. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
