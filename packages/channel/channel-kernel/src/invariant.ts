/** Package-owned invariant companion for `@deepseek-ai/dsh-channel-kernel`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-channel-kernel'

export const name = 'channel-kernel-invariant'
export const inject = ['invariants']

/** No runtime invariant: every exported operation is pure and owns no mutable service or event relation. */
const install: InvariantInstaller = () => {}

/** Register ownership of the pure, stateless Channel Kernel decision surface. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
