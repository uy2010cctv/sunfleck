/** Package-owned invariant companion for enterprise SSO adapters. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
const PACKAGE_NAME = '@deepseek-ai/dsh-enterprise-sso'
export const name = 'enterprise-sso-invariant'
export const inject = ['invariants']
/** No runtime invariant: provider objects are immutable adapters with no shared service or event relation. */
const install: InvariantInstaller = () => {}
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
