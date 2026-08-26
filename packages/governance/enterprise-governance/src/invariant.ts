/** Package-owned invariant companion for `@deepseek-ai/dsh-enterprise-governance`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-enterprise-governance'

export const name = 'enterprise-governance-invariant'
export const inject = ['invariants']

/** No runtime invariant: every exported decision is pure and owns no mutable service or event relation. */
const install: InvariantInstaller = () => {}

/** Register ownership of the pure, stateless enterprise policy surface. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
