import { describe, expect, it, vi } from 'vitest'
import {
  EnterpriseLdapProvider,
  EnterpriseOidcProvider,
  EnterpriseSamlProvider,
  OidcTransactionStore,
} from '../src/index.ts'

const mapping = {
  organizationId: 'org-a', usernameClaim: 'email', displayNameClaim: 'name', groupsClaim: 'groups',
  roleByGroup: { admins: 'administrator' as const },
}

describe('EnterpriseOidcProvider', () => {
  it('uses discovery, PKCE, state, nonce, and validated claims', async () => {
    const grant = vi.fn(() => Promise.resolve({
      claims: () => ({ sub: 'oidc-1', email: 'alice@example.com', name: 'Alice', groups: ['admins'] }),
    }))
    const seam = {
      discovery: vi.fn(() => Promise.resolve({ server: 'configuration' })),
      calculatePKCECodeChallenge: vi.fn(() => Promise.resolve('challenge')),
      buildAuthorizationUrl: vi.fn((_configuration: unknown, parameters: Record<string, string>) => {
        const url = new URL('https://id.example.com/authorize')
        for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value)
        return url
      }),
      authorizationCodeGrant: grant,
    }
    let random = 0
    const provider = new EnterpriseOidcProvider({
      id: 'oidc-main', label: 'Company OIDC', issuer: 'https://id.example.com', clientId: 'dsh',
      clientSecret: 'client-secret', callbackUrl: 'https://dsh.example.com/auth/oidc/callback', mapping,
    }, new OidcTransactionStore({ random: () => `random-${String(++random)}` }), seam)

    const begun = await provider.begin('/settings/users')
    expect(begun.url.searchParams.get('code_challenge')).toBe('challenge')
    expect(begun.url.searchParams.get('state')).toBe('random-1')
    expect(begun.url.searchParams.get('nonce')).toBe('random-2')

    await expect(provider.complete(
      new URL(`https://dsh.example.com/auth/oidc/callback?code=code&state=${begun.state}`),
    )).resolves.toMatchObject({ subject: 'oidc-1', roles: ['administrator'] })
    expect(grant).toHaveBeenCalledWith(
      { server: 'configuration' }, expect.any(URL),
      { pkceCodeVerifier: 'random-3', expectedState: 'random-1', expectedNonce: 'random-2' },
    )
  })
})

describe('EnterpriseSamlProvider', () => {
  it('uses signed-response validation and maps the NameID subject', async () => {
    const validatePostResponseAsync = vi.fn(() => Promise.resolve({
      loggedOut: false,
      profile: {
        issuer: 'https://id.example.com', nameID: 'saml-1', nameIDFormat: 'persistent',
        email: 'alice@example.com', name: 'Alice', groups: ['admins'],
      },
    }))
    const provider = new EnterpriseSamlProvider({
      id: 'saml-main', label: 'Company SAML', entryPoint: 'https://id.example.com/sso',
      callbackUrl: 'https://dsh.example.com/auth/saml/callback', issuer: 'dsh-enterprise',
      idpCert: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----', mapping,
    }, () => ({
      getAuthorizeUrlAsync: () => Promise.resolve('https://id.example.com/sso?SAMLRequest=request'),
      validatePostResponseAsync,
    }))

    await expect(provider.begin('/settings/users')).resolves.toMatchObject({
      url: new URL('https://id.example.com/sso?SAMLRequest=request'),
    })
    await expect(provider.complete({ SAMLResponse: 'signed-assertion' }))
      .resolves.toMatchObject({ subject: 'saml-1', username: 'alice@example.com' })
    expect(validatePostResponseAsync).toHaveBeenCalledWith({ SAMLResponse: 'signed-assertion' })
  })
})

describe('EnterpriseLdapProvider', () => {
  it('binds the service account, searches one DN, then verifies the user password over TLS', async () => {
    const calls: string[] = []
    const service = {
      startTLS: () => { calls.push('service:starttls'); return Promise.resolve() },
      bind: (dn: string) => { calls.push(`service:bind:${dn}`); return Promise.resolve() },
      search: () => Promise.resolve({
        searchEntries: [{ dn: 'uid=alice,dc=example,dc=com', uid: 'alice', cn: 'Alice', memberOf: ['admins'] }],
        searchReferences: [],
      }),
      unbind: () => { calls.push('service:unbind'); return Promise.resolve() },
    }
    const user = {
      startTLS: () => { calls.push('user:starttls'); return Promise.resolve() },
      bind: (dn: string, password?: string) => {
        calls.push(`user:bind:${dn}:${password === 'password' ? 'supplied' : 'missing'}`)
        return Promise.resolve()
      },
      search: () => Promise.resolve({ searchEntries: [], searchReferences: [] }),
      unbind: () => { calls.push('user:unbind'); return Promise.resolve() },
    }
    let created = 0
    const provider = new EnterpriseLdapProvider({
      id: 'ldap-main', label: 'Company LDAP', url: 'ldap://ldap.example.com', startTls: true,
      baseDn: 'dc=example,dc=com', bindDn: 'cn=service', bindPasswordRef: 'LDAP_BIND_PASSWORD',
      userFilter: '(uid={username})', subjectAttribute: 'dn', usernameAttribute: 'uid',
      displayNameAttribute: 'cn', groupsAttribute: 'memberOf', mapping,
    }, {
      clientFactory: () => (++created === 1 ? service : user),
      resolveCredential: () => Promise.resolve('service-password'),
    })

    await expect(provider.authenticate('alice', 'password')).resolves.toMatchObject({
      subject: 'uid=alice,dc=example,dc=com', username: 'alice', displayName: 'Alice',
      roles: ['administrator'],
    })
    expect(calls).toEqual([
      'service:starttls', 'service:bind:cn=service', 'service:unbind',
      'user:starttls', 'user:bind:uid=alice,dc=example,dc=com:supplied', 'user:unbind',
    ])
  })
})
