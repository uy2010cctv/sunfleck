import { describe, expect, it } from 'vitest'
import {
  OidcTransactionStore,
  assertSecureSsoUrl,
  createPasswordVerifier,
  escapeLdapFilterValue,
  mapSsoProfile,
  validateLdapConfig,
  validateSamlConfig,
  verifyPassword,
} from '../src/index.ts'

describe('local enterprise login', () => {
  it('stores a salted scrypt verifier and compares without exposing the password', () => {
    const verifier = createPasswordVerifier('correct horse battery staple', {
      salt: Buffer.alloc(16, 7),
    })
    expect(verifier).toMatch(/^scrypt\$/)
    expect(verifier).not.toContain('correct horse')
    expect(verifyPassword('correct horse battery staple', verifier)).toBe(true)
    expect(verifyPassword('wrong', verifier)).toBe(false)
    expect(verifyPassword('wrong', 'invalid')).toBe(false)
  })
})

describe('OIDC transaction security', () => {
  it('allows HTTPS and loopback callbacks but rejects insecure remote endpoints', () => {
    expect(() => assertSecureSsoUrl('https://id.example.com', 'issuer')).not.toThrow()
    expect(() => assertSecureSsoUrl('http://127.0.0.1:3081/auth/callback', 'callback')).not.toThrow()
    expect(() => assertSecureSsoUrl('http://intranet.example.com/auth/callback', 'callback'))
      .toThrow(/HTTPS/)
  })

  it('stores PKCE, state, and nonce in a one-time expiring transaction', () => {
    let now = 1000
    let random = 0
    const store = new OidcTransactionStore({
      now: () => now,
      random: () => `random-${String(++random)}`,
      ttlMs: 60_000,
    })
    const transaction = store.create('oidc-main', '/settings/users')
    expect(transaction).toEqual({
      providerId: 'oidc-main', state: 'random-1', nonce: 'random-2',
      codeVerifier: 'random-3', returnTo: '/settings/users', expiresAt: 61_000,
    })
    expect(store.consume(transaction.state)).toEqual(transaction)
    expect(store.consume(transaction.state)).toBeUndefined()

    const expired = store.create('oidc-main', '/')
    now = expired.expiresAt + 1
    expect(store.consume(expired.state)).toBeUndefined()
  })
})

describe('SAML and LDAP configuration', () => {
  it('requires a SAML IdP certificate and secure entry points', () => {
    expect(() => { validateSamlConfig({
      id: 'saml-main', entryPoint: 'https://id.example.com/sso', callbackUrl: 'https://dsh.example.com/auth/saml',
      issuer: 'dsh-enterprise', idpCert: '',
    }) }).toThrow(/certificate/)
    expect(() => { validateSamlConfig({
      id: 'saml-main', entryPoint: 'https://id.example.com/sso', callbackUrl: 'https://dsh.example.com/auth/saml',
      issuer: 'dsh-enterprise', idpCert: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
    }) }).not.toThrow()
  })

  it('requires LDAPS or StartTLS and escapes user-controlled LDAP filters', () => {
    expect(() => { validateLdapConfig({
      id: 'ldap-main', url: 'ldap://ldap.example.com', startTls: false,
      baseDn: 'dc=example,dc=com', bindDn: 'cn=service', bindPasswordRef: 'LDAP_BIND_PASSWORD',
      userFilter: '(uid={username})',
    }) }).toThrow(/LDAPS or StartTLS/)
    expect(() => { validateLdapConfig({
      id: 'ldap-main', url: 'ldap://ldap.example.com', startTls: true,
      baseDn: 'dc=example,dc=com', bindDn: 'cn=service', bindPasswordRef: 'LDAP_BIND_PASSWORD',
      userFilter: '(uid={username})',
    }) }).not.toThrow()
    expect(escapeLdapFilterValue('alice*)(uid=*)')).toBe('alice\\2a\\29\\28uid=\\2a\\29')
  })
})

describe('canonical SSO profile mapping', () => {
  it('maps provider claims into one external identity and filters unapproved roles', () => {
    expect(mapSsoProfile({
      providerId: 'oidc-main',
      profile: { sub: 'subject-1', email: 'alice@example.com', name: 'Alice', groups: ['admins', 'unknown'] },
      mapping: {
        organizationId: 'org-a', usernameClaim: 'email', displayNameClaim: 'name', groupsClaim: 'groups',
        roleByGroup: { admins: 'administrator', operators: 'operator' },
      },
    })).toEqual({
      providerId: 'oidc-main', subject: 'subject-1', organizationId: 'org-a',
      username: 'alice@example.com', displayName: 'Alice', roles: ['administrator'],
    })
  })
})
