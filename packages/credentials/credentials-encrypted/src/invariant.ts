/** Package-owned invariant companion for encrypted credentials. */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-credentials-encrypted'
export const name = 'credentials-encrypted-invariant'
export const inject = ['invariants']

/** No runtime invariant: CredentialProvider events and file commits are covered by the seam and provider tests. */
const install: InvariantInstaller = () => {}

export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
