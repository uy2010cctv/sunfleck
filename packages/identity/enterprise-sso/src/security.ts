/** Shared SSO endpoint, transaction, LDAP, SAML, and claim-mapping policy. */

import type { EnterpriseRole } from '@deepseek-ai/dsh-enterprise-governance'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

/** Require HTTPS for every non-loopback SSO endpoint. */
export function assertSecureSsoUrl(value: string, label: string): URL {
  const url = new URL(value)
  if (url.username !== '' || url.password !== '') throw new Error(`${label} URL must not contain credentials`)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname))) {
    throw new Error(`${label} URL must use HTTPS except on loopback`)
  }
  return url
}

export interface OidcTransaction {
  readonly providerId: string
  readonly state: string
  readonly nonce: string
  readonly codeVerifier: string
  readonly returnTo: string
  readonly expiresAt: number
}

export interface OidcTransactionStoreOptions {
  readonly now?: () => number
  readonly random?: () => string
  readonly ttlMs?: number
}

/** Process-local one-time OIDC state; callers may replace it with a distributed adapter. */
export class OidcTransactionStore {
  private readonly transactions = new Map<string, OidcTransaction>()
  private readonly now: () => number
  private readonly random: () => string
  private readonly ttlMs: number

  constructor(options: OidcTransactionStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.random = options.random ?? randomUUID
    this.ttlMs = options.ttlMs ?? 10 * 60_000
  }

  create(providerId: string, returnTo: string): OidcTransaction {
    if (!returnTo.startsWith('/') || returnTo.startsWith('//')) throw new Error('OIDC returnTo must be an absolute local path')
    const transaction = {
      providerId,
      state: this.random(),
      nonce: this.random(),
      codeVerifier: this.random(),
      returnTo,
      expiresAt: this.now() + this.ttlMs,
    }
    this.transactions.set(transaction.state, transaction)
    return transaction
  }

  consume(state: string): OidcTransaction | undefined {
    const transaction = this.transactions.get(state)
    this.transactions.delete(state)
    return transaction === undefined || transaction.expiresAt < this.now() ? undefined : transaction
  }
}

export interface SamlProviderConfig {
  readonly id: string
  readonly entryPoint: string
  readonly callbackUrl: string
  readonly issuer: string
  readonly idpCert: string
}

export function validateSamlConfig(config: SamlProviderConfig): void {
  assertSecureSsoUrl(config.entryPoint, 'SAML entry point')
  assertSecureSsoUrl(config.callbackUrl, 'SAML callback')
  if (config.issuer.trim() === '') throw new Error('SAML issuer is required')
  if (!config.idpCert.includes('BEGIN CERTIFICATE')) throw new Error('SAML IdP certificate is required')
}

export interface LdapProviderConfig {
  readonly id: string
  readonly url: string
  readonly startTls: boolean
  readonly baseDn: string
  readonly bindDn: string
  readonly bindPasswordRef: string
  readonly userFilter: string
}

export function validateLdapConfig(config: LdapProviderConfig): void {
  const url = new URL(config.url)
  if (url.protocol !== 'ldaps:' && !(url.protocol === 'ldap:' && config.startTls)) {
    throw new Error('LDAP requires LDAPS or StartTLS')
  }
  if (!config.userFilter.includes('{username}')) throw new Error('LDAP userFilter must contain {username}')
  if (config.baseDn.trim() === '') throw new Error('LDAP baseDn is required')
  if (config.bindDn.trim() === '') throw new Error('LDAP bindDn is required')
  if (config.bindPasswordRef.trim() === '') throw new Error('LDAP bindPasswordRef is required')
}

/** RFC 4515 filter assertion-value escaping. */
export function escapeLdapFilterValue(value: string): string {
  return value.replace(/[\0()*\\]/gu, character => `\\${character.codePointAt(0)?.toString(16).padStart(2, '0')}`)
}

export interface SsoProfileMapping {
  readonly organizationId: string
  readonly usernameClaim: string
  readonly displayNameClaim: string
  readonly groupsClaim: string
  readonly roleByGroup: Readonly<Record<string, EnterpriseRole>>
}

export interface SsoMappedIdentity {
  readonly providerId: string
  readonly subject: string
  readonly organizationId: string
  readonly username: string
  readonly displayName: string
  readonly roles: readonly EnterpriseRole[]
}

export interface SsoLoginResult extends SsoMappedIdentity {
  readonly returnTo: string
}

/** Normalize OIDC/SAML/LDAP attributes into the canonical external-identity shape. */
export function mapSsoProfile(input: {
  providerId: string
  profile: Readonly<Record<string, unknown>>
  mapping: SsoProfileMapping
}): SsoMappedIdentity {
  const subject = input.profile['sub']
  const username = input.profile[input.mapping.usernameClaim]
  const displayName = input.profile[input.mapping.displayNameClaim]
  const groups = input.profile[input.mapping.groupsClaim]
  if (typeof subject !== 'string' || subject === '') throw new Error('SSO profile subject is required')
  if (typeof username !== 'string' || username === '') throw new Error('SSO profile username is required')
  if (typeof displayName !== 'string' || displayName === '') throw new Error('SSO profile display name is required')
  const roles = Array.isArray(groups)
    ? [...new Set(groups.flatMap(group => typeof group === 'string' && input.mapping.roleByGroup[group] !== undefined
      ? [input.mapping.roleByGroup[group]]
      : []))].sort()
    : []
  return {
    providerId: input.providerId,
    subject,
    organizationId: input.mapping.organizationId,
    username,
    displayName,
    roles,
  }
}
