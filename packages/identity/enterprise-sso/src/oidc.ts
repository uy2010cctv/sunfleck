/** OIDC Authorization Code + PKCE adapter backed by openid-client. */

import * as oidc from 'openid-client'
import {
  OidcTransactionStore,
  assertSecureSsoUrl,
  mapSsoProfile,
  type SsoLoginResult,
  type SsoProfileMapping,
} from './security.ts'

/** Data used by `EnterpriseOidcConfig`. */
export interface EnterpriseOidcConfig {
  readonly id: string
  readonly label: string
  readonly issuer: string
  readonly clientId: string
  readonly clientSecret?: string
  readonly callbackUrl: string
  readonly scope?: string
  readonly mapping: SsoProfileMapping
}

interface OidcTokenResponse {
  claims(): Readonly<Record<string, unknown>> | undefined
}

/** Data used by `OidcClientSeam`. */
export interface OidcClientSeam {
  discovery(server: URL, clientId: string, clientSecret?: string): Promise<unknown>
  calculatePKCECodeChallenge(verifier: string): Promise<string>
  buildAuthorizationUrl(configuration: unknown, parameters: Record<string, string>): URL
  authorizationCodeGrant(
    configuration: unknown,
    callbackUrl: URL,
    checks: { pkceCodeVerifier: string; expectedState: string; expectedNonce: string },
  ): Promise<OidcTokenResponse>
}

const defaultOidcSeam: OidcClientSeam = {
  discovery: (server, clientId, clientSecret) => oidc.discovery(server, clientId, clientSecret),
  calculatePKCECodeChallenge: verifier => oidc.calculatePKCECodeChallenge(verifier),
  buildAuthorizationUrl: (configuration, parameters) =>
    oidc.buildAuthorizationUrl(configuration as oidc.Configuration, parameters),
  authorizationCodeGrant: (configuration, callbackUrl, checks) =>
    oidc.authorizationCodeGrant(configuration as oidc.Configuration, callbackUrl, checks),
}

/** Data used by `OidcBeginResult`. */
export interface OidcBeginResult {
  readonly url: URL
  readonly state: string
}

/** Provides `EnterpriseOidcProvider` capabilities. */
export class EnterpriseOidcProvider {
  /** Current `EnterpriseOidcProvider.id` value. */
  readonly id: string
  /** Current `EnterpriseOidcProvider.label` value. */
  readonly label: string
  private configuration: Promise<unknown> | undefined

  constructor(
    private readonly config: EnterpriseOidcConfig,
    private readonly transactions = new OidcTransactionStore(),
    private readonly client: OidcClientSeam = defaultOidcSeam,
  ) {
    this.id = config.id
    this.label = config.label
    assertSecureSsoUrl(config.issuer, 'OIDC issuer')
    assertSecureSsoUrl(config.callbackUrl, 'OIDC callback')
  }

  private discover(): Promise<unknown> {
    this.configuration ??= this.client.discovery(
      new URL(this.config.issuer), this.config.clientId, this.config.clientSecret,
    )
    return this.configuration
  }

  /** Executes `EnterpriseOidcProvider.begin` for this instance.
   * @param returnTo - Input value used by this API.
   * @returns Result produced by this API.
   */
  async begin(returnTo: string): Promise<OidcBeginResult> {
    const transaction = this.transactions.create(this.id, returnTo)
    const codeChallenge = await this.client.calculatePKCECodeChallenge(transaction.codeVerifier)
    const configuration = await this.discover()
    return {
      state: transaction.state,
      url: this.client.buildAuthorizationUrl(configuration, {
        redirect_uri: this.config.callbackUrl,
        scope: this.config.scope ?? 'openid profile email',
        response_type: 'code',
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state: transaction.state,
        nonce: transaction.nonce,
      }),
    }
  }

  /** Executes `EnterpriseOidcProvider.complete` for this instance.
   * @param callbackUrl - Input value used by this API.
   * @returns Result produced by this API.
   */
  async complete(callbackUrl: URL): Promise<SsoLoginResult> {
    const state = callbackUrl.searchParams.get('state')
    const transaction = state === null ? undefined : this.transactions.consume(state)
    if (transaction === undefined || transaction.providerId !== this.id) {
      throw new Error('OIDC transaction is absent, expired, or already consumed')
    }
    const tokens = await this.client.authorizationCodeGrant(await this.discover(), callbackUrl, {
      pkceCodeVerifier: transaction.codeVerifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
    })
    const profile = tokens.claims()
    if (profile === undefined) throw new Error('OIDC token response contained no ID Token claims')
    return {
      ...mapSsoProfile({ providerId: this.id, profile, mapping: this.config.mapping }),
      returnTo: transaction.returnTo,
    }
  }
}
