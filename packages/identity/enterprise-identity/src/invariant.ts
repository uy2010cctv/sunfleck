/** Package-owned invariant companion for enterprise identity persistence. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-enterprise-identity'
export const name = 'enterprise-identity-invariant'
export const inject = ['invariants']
/** No runtime invariant: SQLite constraints and repository boundary tests own the durable relations. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
