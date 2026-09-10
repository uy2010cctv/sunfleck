/** Secure LDAP authentication adapter backed by ldapts. */

import { Client, type SearchResult } from 'ldapts'
import {
  escapeLdapFilterValue,
  mapSsoProfile,
  validateLdapConfig,
  type LdapProviderConfig,
  type SsoMappedIdentity,
  type SsoProfileMapping,
} from './security.ts'

/** Data used by `EnterpriseLdapConfig`. */
export interface EnterpriseLdapConfig extends LdapProviderConfig {
  readonly label: string
  readonly subjectAttribute: string
  readonly usernameAttribute: string
  readonly displayNameAttribute: string
  readonly groupsAttribute: string
  readonly mapping: SsoProfileMapping
}

/** Data used by `LdapClientSeam`. */
export interface LdapClientSeam {
  startTLS(options?: object): Promise<void>
  bind(dn: string, password?: string): Promise<void>
  search(baseDn: string, options: { scope: 'sub'; filter: string; attributes: string[] }): Promise<SearchResult>
  unbind(): Promise<void>
}

/** Data used by `LdapDependencies`. */
export interface LdapDependencies {
  readonly clientFactory?: (url: string) => LdapClientSeam
  readonly resolveCredential: (ref: string) => Promise<string | undefined>
}

/** Provides `EnterpriseLdapProvider` capabilities. */
export class EnterpriseLdapProvider {
  /** Current `EnterpriseLdapProvider.id` value. */
  readonly id: string
  /** Current `EnterpriseLdapProvider.label` value. */
  readonly label: string
  private readonly clientFactory: (url: string) => LdapClientSeam

  constructor(private readonly config: EnterpriseLdapConfig, private readonly deps: LdapDependencies) {
    validateLdapConfig(config)
    this.id = config.id
    this.label = config.label
    this.clientFactory = deps.clientFactory ?? (url => new Client({
      url, connectTimeout: 10_000, timeout: 10_000, strictDN: true,
      tlsOptions: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    }))
  }

  private async secure(client: LdapClientSeam): Promise<void> {
    if (this.config.startTls) await client.startTLS({ minVersion: 'TLSv1.2', rejectUnauthorized: true })
  }

  /** Executes `EnterpriseLdapProvider.authenticate` for this instance.
   * @param password - Input value used by this API.
   * @param username - Input value used by this API.
   * @returns Result produced by this API.
   */
  async authenticate(username: string, password: string): Promise<SsoMappedIdentity> {
    if (username === '' || password === '') throw new Error('LDAP username and password are required')
    const bindPassword = await this.deps.resolveCredential(this.config.bindPasswordRef)
    if (bindPassword === undefined) throw new Error('LDAP bind credential is not configured')
    const service = this.clientFactory(this.config.url)
    let entries: SearchResult['searchEntries']
    try {
      await this.secure(service)
      await service.bind(this.config.bindDn, bindPassword)
      const filter = this.config.userFilter.replace('{username}', escapeLdapFilterValue(username))
      entries = (await service.search(this.config.baseDn, {
        scope: 'sub', filter,
        attributes: [
          this.config.subjectAttribute, this.config.usernameAttribute,
          this.config.displayNameAttribute, this.config.groupsAttribute,
        ],
      })).searchEntries
    } finally {
      await service.unbind()
    }
    if (entries.length !== 1) throw new Error('LDAP user search must return exactly one entry')
    const entry = entries[0] as Readonly<Record<string, unknown>>
    const subject = this.config.subjectAttribute === 'dn' ? entry['dn'] : entry[this.config.subjectAttribute]
    if (typeof subject !== 'string' || subject === '') throw new Error('LDAP entry subject is missing')

    const user = this.clientFactory(this.config.url)
    try {
      await this.secure(user)
      await user.bind(subject, password)
    } finally {
      await user.unbind()
    }
    return mapSsoProfile({
      providerId: this.id,
      profile: {
        sub: subject,
        [this.config.mapping.usernameClaim]: entry[this.config.usernameAttribute],
        [this.config.mapping.displayNameClaim]: entry[this.config.displayNameAttribute],
        [this.config.mapping.groupsClaim]: entry[this.config.groupsAttribute],
      },
      mapping: this.config.mapping,
    })
  }
}
