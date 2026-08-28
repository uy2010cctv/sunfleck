/** Package-owned invariant companion for `@deepseek-ai/dsh-channel-wecom`. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-channel-wecom'

/** Cordis companion plugin name. */
export const name = 'channel-wecom-invariant'
/** Invariant registry required by the companion. */
export const inject = ['invariants']

/**
 * No runtime invariant: this adapter exposes stateless provider wire-format
 * contracts; durable inbox/outbox and transport ownership live in the Host.
 */
const install: InvariantInstaller = () => {}

/** Register the package-owned invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
