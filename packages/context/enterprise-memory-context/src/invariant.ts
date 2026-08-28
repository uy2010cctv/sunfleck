/** Package-owned invariant companion for enterprise memory context. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-enterprise-memory-context'
export const name = 'enterprise-memory-context-invariant'
export const inject = ['invariants']

/** No runtime invariant: repository constraints own memory status, scope, and privacy evidence. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
