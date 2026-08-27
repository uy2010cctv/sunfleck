/** Package-owned invariant companion for the PostgreSQL composition provider. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-enterprise-postgres'
export const name = 'enterprise-postgres-invariant'
export const inject = ['invariants']
/** No runtime invariant: composition safety is asserted by pool, migration, and integration tests. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
