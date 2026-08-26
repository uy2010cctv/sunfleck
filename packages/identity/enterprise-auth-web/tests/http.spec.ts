import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnterpriseIdentityRepository } from '@deepseek-ai/dsh-enterprise-identity'
import { createPasswordVerifier } from '@deepseek-ai/dsh-enterprise-sso'
import { EnterpriseAuthHttpHandler, EnterpriseSecurity } from '../src/index.ts'

describe('EnterpriseAuthHttpHandler', () => {
  let root: string
  let repository: EnterpriseIdentityRepository
  let handler: EnterpriseAuthHttpHandler

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-auth-http-'))
    repository = new EnterpriseIdentityRepository(join(root, 'identity.sqlite'))
    repository.createOrganization({ id: 'org-a', name: 'Example' })
    repository.createUser({
      id: 'admin-1', orgId: 'org-a', username: 'admin', displayName: 'Admin', disabled: false,
    })
    repository.setRoles('admin-1', ['administrator'])
    repository.setPasswordVerifier('admin-1', createPasswordVerifier('enterprise-password'))
    let token = 0
    let id = 0
    const security = new EnterpriseSecurity(repository, {
      organizationId: 'org-a', sessionCookieName: 'dsh_session', sessionTtlMs: 60_000,
      secureCookies: true, autoProvisionSsoUsers: true,
    }, { randomToken: () => `token-${String(++token)}`, randomId: () => `generated-${String(++id)}` })
    handler = new EnterpriseAuthHttpHandler(security, {
      localEnabled: true,
      oidc: [{
        id: 'oidc-main', label: 'Company OIDC',
        begin: () => Promise.resolve({ url: new URL('https://id.example.com/authorize'), state: 'state' }),
        complete: () => Promise.resolve({
          providerId: 'oidc-main', subject: 'oidc-1', organizationId: 'org-a',
          username: 'oidc-user', displayName: 'OIDC User', roles: ['member'], returnTo: '/work',
        }),
      }],
      saml: [],
      ldap: [],
    })
  })

  afterEach(async () => {
    repository.close()
    await rm(root, { recursive: true, force: true })
  })

  it('reports anonymous status and available login providers', async () => {
    const response = await handler.fetch(new Request('https://dsh.example.com/auth/status'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      authenticated: false,
      organizationId: 'org-a',
      providers: [
        { id: 'local', kind: 'local', label: 'Local account' },
        { id: 'oidc-main', kind: 'oidc', label: 'Company OIDC' },
      ],
    })
  })

  it('logs in locally, returns the current principal, and revokes logout', async () => {
    const login = await handler.fetch(new Request('https://dsh.example.com/auth/login/local', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com' },
      body: JSON.stringify({ organizationId: 'org-a', username: 'admin', password: 'enterprise-password' }),
    }))
    expect(login.status).toBe(200)
    const cookie = login.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')

    const status = await handler.fetch(new Request('https://dsh.example.com/auth/status', {
      headers: { cookie },
    }))
    await expect(status.json()).resolves.toMatchObject({
      authenticated: true, principal: { userId: 'admin-1', roles: ['administrator'] },
    })

    const logout = await handler.fetch(new Request('https://dsh.example.com/auth/logout', {
      method: 'POST', headers: { cookie, origin: 'https://dsh.example.com' },
    }))
    expect(logout.status).toBe(204)
    const after = await handler.fetch(new Request('https://dsh.example.com/auth/status', { headers: { cookie } }))
    await expect(after.json()).resolves.toMatchObject({ authenticated: false })
  })

  it('starts OIDC and commits the validated external identity on callback', async () => {
    const start = await handler.fetch(new Request('https://dsh.example.com/auth/login/oidc-main?returnTo=/work'))
    expect(start.status).toBe(303)
    expect(start.headers.get('location')).toBe('https://id.example.com/authorize')

    const callback = await handler.fetch(new Request(
      'https://dsh.example.com/auth/callback/oidc-main?code=code&state=state',
    ))
    expect(callback.status).toBe(303)
    expect(callback.headers.get('location')).toBe('/work')
    expect(callback.headers.get('set-cookie')).toContain('HttpOnly')
    expect(repository.resolveExternalIdentity('oidc-main', 'oidc-1')).toMatchObject({ username: 'oidc-user' })
  })

  it('rejects cross-origin local login and unknown auth routes', async () => {
    const crossOrigin = await handler.fetch(new Request('https://dsh.example.com/auth/login/local', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' },
      body: '{}',
    }))
    expect(crossOrigin.status).toBe(403)
    expect((await handler.fetch(new Request('https://dsh.example.com/auth/nope'))).status).toBe(404)
  })

  it('serves user, role, resource-policy, and audit administration only to administrators', async () => {
    const login = await handler.fetch(new Request('https://dsh.example.com/auth/login/local', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com' },
      body: JSON.stringify({ organizationId: 'org-a', username: 'admin', password: 'enterprise-password' }),
    }))
    const cookie = login.headers.get('set-cookie') ?? ''

    const created = await handler.fetch(new Request('https://dsh.example.com/auth/admin/users', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com', cookie },
      body: JSON.stringify({
        id: 'operator-1', username: 'operator', displayName: 'Operator', roles: ['operator'],
      }),
    }))
    expect(created.status).toBe(201)
    const users = await handler.fetch(new Request('https://dsh.example.com/auth/admin/users', { headers: { cookie } }))
    await expect(users.json()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'operator-1', roles: ['operator'] }),
    ]))

    const policy = await handler.fetch(new Request('https://dsh.example.com/auth/admin/resource-policies', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com', cookie },
      body: JSON.stringify({
        resourceType: 'employee', resourceId: 'support', creatorUserId: 'admin-1',
        visibility: 'restricted', allowedUserIds: ['operator-1'],
      }),
    }))
    expect(policy.status).toBe(204)

    const asset = await handler.fetch(new Request('https://dsh.example.com/auth/admin/assets', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://dsh.example.com', cookie },
      body: JSON.stringify({
        type: 'channel', id: 'wecom-main', name: '企微主渠道',
        config: { provider: 'wecom-bot', employeeIds: ['support'] },
      }),
    }))
    expect(asset.status).toBe(201)
    expect(repository.listManagedAssets('org-a')).toEqual([
      expect.objectContaining({ type: 'channel', id: 'wecom-main' }),
    ])

    const audit = await handler.fetch(new Request('https://dsh.example.com/auth/admin/audit?limit=20', {
      headers: { cookie },
    }))
    expect(audit.status).toBe(200)
    expect((await audit.json() as unknown[]).length).toBeGreaterThan(0)
  })
})
