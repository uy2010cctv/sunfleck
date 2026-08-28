/** Package-owned invariant companion for the enterprise knowledge repository. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-knowledge-pgvector'
export const name = 'knowledge-pgvector-invariant'
export const inject = ['invariants']
/** No runtime invariant: repository contracts enforce transaction and ACL safety. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
