/** Package-owned invariant companion for enterprise authentication. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-enterprise-auth-web'
export const name = 'enterprise-auth-web-invariant'
export const inject = ['invariants']

/** No runtime invariant: route/service lifecycle is already owned by one Cordis effect and repository constraints. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
