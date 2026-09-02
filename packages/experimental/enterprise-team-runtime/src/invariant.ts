/** Package-owned invariant companion for the enterprise Team runtime adapter. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-enterprise-team-runtime'

export const name = 'enterprise-team-runtime-invariant'
export const inject = ['invariants']

// No runtime invariant: Agent Teams validates the shared authoritative event
// stream, and this adapter adds no independent persisted state.
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
