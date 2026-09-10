/** Signed SAML 2.0 adapter backed by @node-saml/node-saml. */

import { SAML, ValidateInResponseTo, type Profile } from '@node-saml/node-saml'
import {
  mapSsoProfile,
  validateSamlConfig,
  type SamlProviderConfig,
  type SsoLoginResult,
  type SsoProfileMapping,
} from './security.ts'

/** Data used by `EnterpriseSamlConfig`. */
export interface EnterpriseSamlConfig extends SamlProviderConfig {
  readonly label: string
  readonly mapping: SsoProfileMapping
}

/** Data used by `SamlClientSeam`. */
export interface SamlClientSeam {
  getAuthorizeUrlAsync(relayState: string, host: string | undefined, options: object): Promise<string>
  validatePostResponseAsync(container: Record<string, string>): Promise<{
    profile: Profile | null
    loggedOut: boolean
  }>
}

/** Allowed values for `SamlFactory`. */
export type SamlFactory = (config: EnterpriseSamlConfig) => SamlClientSeam

const defaultSamlFactory: SamlFactory = config => new SAML({
  entryPoint: config.entryPoint,
  callbackUrl: config.callbackUrl,
  issuer: config.issuer,
  idpCert: config.idpCert,
  validateInResponseTo: ValidateInResponseTo.always,
  wantAssertionsSigned: true,
  wantAuthnResponseSigned: true,
  audience: config.issuer,
})

/** Provides `EnterpriseSamlProvider` capabilities. */
export class EnterpriseSamlProvider {
  /** Current `EnterpriseSamlProvider.id` value. */
  readonly id: string
  /** Current `EnterpriseSamlProvider.label` value. */
  readonly label: string
  private readonly saml: SamlClientSeam

  constructor(private readonly config: EnterpriseSamlConfig, factory: SamlFactory = defaultSamlFactory) {
    validateSamlConfig(config)
    this.id = config.id
    this.label = config.label
    this.saml = factory(config)
  }

  /** Executes `EnterpriseSamlProvider.begin` for this instance.
   * @param returnTo - Input value used by this API.
   * @returns Result produced by this API.
   */
  async begin(returnTo: string): Promise<{ url: URL; relayState: string }> {
    if (!returnTo.startsWith('/') || returnTo.startsWith('//')) throw new Error('SAML returnTo must be an absolute local path')
    const relayState = Buffer.from(returnTo).toString('base64url')
    return { url: new URL(await this.saml.getAuthorizeUrlAsync(relayState, undefined, {})), relayState }
  }

  /** Executes `EnterpriseSamlProvider.complete` for this instance.
   * @param container - Input value used by this API.
   * @returns Result produced by this API.
   */
  async complete(container: Record<string, string>): Promise<SsoLoginResult> {
    const result = await this.saml.validatePostResponseAsync(container)
    if (result.loggedOut || result.profile === null || result.profile.nameID === '') {
      throw new Error('SAML response did not contain an authenticated profile')
    }
    const profile = { ...result.profile, sub: result.profile.nameID }
    let returnTo = '/'
    const relayState = container['RelayState']
    if (relayState !== undefined) {
      try {
        const candidate = Buffer.from(relayState, 'base64url').toString('utf8')
        if (candidate.startsWith('/') && !candidate.startsWith('//')) returnTo = candidate
      } catch {
        // Invalid RelayState falls back to the application root.
      }
    }
    return { ...mapSsoProfile({ providerId: this.id, profile, mapping: this.config.mapping }), returnTo }
  }
}
