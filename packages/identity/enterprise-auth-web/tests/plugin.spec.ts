import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, inject } from '../src/plugin.ts'

describe('enterprise auth Web plugin', () => {
  let root = ''

  afterEach(async () => {
    if (root !== '') await rm(root, { recursive: true, force: true })
  })

  it('bootstraps one administrator from a credential ref and mounts /auth', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-auth-plugin-'))
    const routes: WebRoute[] = []
    const ctx = new Context()
    ctx.provide('webServer', {
      register: (route: WebRoute) => { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } },
    } as WebServer)
    ctx.provide('credentials', {
      resolve: () => Promise.resolve({ value: 'enterprise-password', source: 'test' }),
    } as unknown as CredentialProvider)
    ctx.provide('enterprisePostgres', {} as never)
    const fiber = ctx.plugin({ inject: [...inject], apply }, {
      databasePath: join(root, 'identity.sqlite'),
      organizationId: 'org-a', organizationName: 'Example',
      sessionCookieName: 'dsh_session', sessionTtlMs: 60_000, secureCookies: false,
      autoProvisionSsoUsers: true, localEnabled: true,
      bootstrapAdmin: {
        userId: 'admin-1', username: 'admin', displayName: 'Admin', passwordRef: 'DSH_ADMIN_PASSWORD',
      },
      oidc: [], saml: [], ldap: [],
    })
    await fiber.await()

    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({ kind: 'prefix', path: '/auth' })
    expect(ctx.enterpriseSecurity.repository.listUsers('org-a')).toEqual([
      expect.objectContaining({ id: 'admin-1', roles: ['administrator'] }),
    ])
    expect(ctx.enterpriseRequestContext.current()).toBeUndefined()
    expect(ctx.enterpriseSecurity.loginLocal('org-a', 'admin', 'enterprise-password')).toBeDefined()

    await fiber.dispose()
    expect(routes).toHaveLength(0)
  })

  it('accepts an injected identity store without opening a SQLite database', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-auth-injected-'))
    const routes: WebRoute[] = []
    const ctx = new Context()
    ctx.provide('webServer', {
      register: (route: WebRoute) => { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } },
    } as WebServer)
    ctx.provide('credentials', {
      resolve: () => Promise.resolve({ value: 'enterprise-password', source: 'test' }),
    } as unknown as CredentialProvider)
    const injected = new (await import('@deepseek-ai/dsh-enterprise-identity')).EnterpriseIdentityRepository(
      join(root, 'injected.sqlite'),
    )
    ctx.provide('enterprisePostgres', { identity: injected } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply }, {
      identityStore: injected,
      organizationId: 'org-a', organizationName: 'Example',
      sessionCookieName: 'dsh_session', sessionTtlMs: 60_000, secureCookies: false,
      autoProvisionSsoUsers: true, localEnabled: true,
      oidc: [], saml: [], ldap: [],
    })
    await fiber.await()

    expect(ctx.enterpriseSecurity.repository).toBe(injected)
    expect(injected.listOrganizations()).toEqual([{ id: 'org-a', name: 'Example' }])
    await fiber.dispose()
    expect(routes).toHaveLength(0)
  })
})
