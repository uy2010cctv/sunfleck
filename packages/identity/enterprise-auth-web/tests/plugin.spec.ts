import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { WebRoute, WebServer } from '@deepseek-ai/dsh-host-webserver'
import { apply, inject } from '../src/plugin.ts'
import { EnterpriseRequestContext } from '../src/request-context.ts'

describe('enterprise auth Web plugin', () => {
  let root = ''

  afterEach(async () => {
    if (root !== '') await rm(root, { recursive: true, force: true })
  })

  it('bootstraps one administrator from a credential ref and mounts /auth', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-auth-plugin-'))
    const routes: WebRoute[] = []
    const ctx = new Context()
    ctx.provide('workspaceRegistry', {
      create: async (path: string, title?: string) => ({ id: 'workspace-admin', path, title: title ?? 'workspace' }),
    } as never)
    ctx.provide('webServer', {
      register: (route: WebRoute) => { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } },
    } as WebServer)
    ctx.provide('credentials', {
      resolve: () => Promise.resolve({ value: 'enterprise-password', source: 'test' }),
    } as unknown as CredentialProvider)
    ctx.provide('enterprisePostgres', {} as never)
    const fiber = ctx.plugin({ inject: [...inject], apply }, {
      databasePath: join(root, 'identity.sqlite'),
      workspaceRoot: join(root, 'managed-workspaces'),
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
    expect(ctx.enterpriseSecurity.repository.listWorkspaceGrants({ orgId: 'org-a', userId: 'admin-1' }))
      .toEqual([expect.objectContaining({ workspaceId: 'workspace-admin', ownerUserId: 'admin-1' })])
    expect(ctx.enterpriseRequestContext.current()).toBeUndefined()
    expect(ctx.enterpriseSecurity.loginLocal('org-a', 'admin', 'enterprise-password')).toBeDefined()
    const closeOwnedRepository = vi.spyOn(ctx.enterpriseSecurity.repository, 'close')

    const firstRequestContext = ctx.enterpriseRequestContext
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const pending = firstRequestContext.run({ userId: 'admin-1', orgId: 'org-a', roles: ['administrator'] }, async () => {
      await gate
      return firstRequestContext.current()
    })
    await fiber.dispose()
    expect(closeOwnedRepository).toHaveBeenCalledTimes(1)
    closeOwnedRepository.mockRestore()
    release()
    await expect(pending).resolves.toBeUndefined()
    expect(routes).toHaveLength(0)

    const replacement = ctx.plugin({ inject: [...inject], apply }, {
      databasePath: join(root, 'identity.sqlite'),
      organizationId: 'org-a', organizationName: 'Example',
      sessionCookieName: 'dsh_session', sessionTtlMs: 60_000, secureCookies: false,
      autoProvisionSsoUsers: true, localEnabled: true,
      oidc: [], saml: [], ldap: [],
    })
    await replacement.await()
    expect(ctx.enterpriseRequestContext).not.toBe(firstRequestContext)
    await replacement.dispose()
    expect(routes).toHaveLength(0)
  })

  it('does not recreate an established bootstrap administrator when its configured username changes', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-auth-bootstrap-restart-'))
    const ctx = new Context()
    ctx.provide('workspaceRegistry', {} as never)
    ctx.provide('webServer', { register: () => () => {} } as unknown as WebServer)
    ctx.provide('credentials', {
      resolve: () => Promise.resolve({ value: 'enterprise-password', source: 'test' }),
    } as unknown as CredentialProvider)
    ctx.provide('enterprisePostgres', {} as never)
    const base = {
      databasePath: join(root, 'identity.sqlite'), organizationId: 'org-a', organizationName: 'Example',
      sessionCookieName: 'dsh_session', sessionTtlMs: 60_000, secureCookies: false,
      autoProvisionSsoUsers: true, localEnabled: true, oidc: [], saml: [], ldap: [],
    }
    const first = ctx.plugin({ inject: [...inject], apply }, {
      ...base,
      bootstrapAdmin: {
        userId: 'admin-1', username: 'former-admin', displayName: 'Former Admin', passwordRef: 'DSH_ADMIN_PASSWORD',
      },
    })
    await first.await()
    await first.dispose()

    const restarted = ctx.plugin({ inject: [...inject], apply }, {
      ...base,
      bootstrapAdmin: {
        userId: 'admin-1', username: 'admin', displayName: 'Enterprise Administrator', passwordRef: 'DSH_ADMIN_PASSWORD',
      },
    })
    await restarted.await()
    await restarted.dispose()
  })

  it('accepts an injected identity store without opening a SQLite database', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-auth-injected-'))
    const routes: WebRoute[] = []
    const ctx = new Context()
    ctx.provide('workspaceRegistry', {} as never)
    ctx.provide('webServer', {
      register: (route: WebRoute) => { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } },
    } as WebServer)
    ctx.provide('credentials', {
      resolve: () => Promise.resolve({ value: 'enterprise-password', source: 'test' }),
    } as unknown as CredentialProvider)
    const injected = new (await import('@deepseek-ai/dsh-enterprise-identity')).EnterpriseIdentityRepository(
      join(root, 'injected.sqlite'),
    )
    ctx.provide('enterprisePostgres', {
      identity: injected,
      catalog: {
        getDraft: async (presetId: string, orgId: string) => presetId === 'owned' && orgId === 'org-a'
          ? { ownerUserId: 'creator-1', visibility: 'private' as const }
          : undefined,
      },
    } as never)
    const fiber = ctx.plugin({ inject: [...inject], apply }, {
      identityStore: injected,
      databaseMode: 'postgres',
      organizationId: 'org-a', organizationName: 'Example',
      sessionCookieName: 'dsh_session', sessionTtlMs: 60_000, secureCookies: false,
      autoProvisionSsoUsers: true, localEnabled: true,
      oidc: [], saml: [], ldap: [],
    })
    await fiber.await()

    expect(ctx.enterpriseSecurity.repository).toBe(injected)
    expect(injected.listOrganizations()).toEqual([{ id: 'org-a', name: 'Example' }])
    await expect(ctx.enterpriseSecurity.authorizeApiAsync(
      { userId: 'creator-1', orgId: 'org-a', roles: ['creator'] },
      'enterpriseEmployee.publish',
      { presetId: 'owned' },
    )).resolves.toMatchObject({ allowed: true })
    await fiber.dispose()
    expect(routes).toHaveLength(0)
    expect(injected.listOrganizations()).toEqual([{ id: 'org-a', name: 'Example' }])
    injected.close()
  })

  it('disposes the request context when OIDC initialization fails', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-enterprise-auth-failed-init-'))
    const dispose = vi.spyOn(EnterpriseRequestContext.prototype, 'dispose')
    const ctx = new Context()
    ctx.provide('workspaceRegistry', {} as never)
    ctx.provide('webServer', { register: () => () => {} } as unknown as WebServer)
    ctx.provide('credentials', {
      resolve: () => Promise.resolve(undefined),
    } as unknown as CredentialProvider)
    const injected = new (await import('@deepseek-ai/dsh-enterprise-identity')).EnterpriseIdentityRepository(
      join(root, 'failed-init.sqlite'),
    )
    ctx.provide('enterprisePostgres', { identity: injected } as never)

    try {
      const fiber = ctx.plugin({ inject: [...inject], apply }, {
        databaseMode: 'postgres',
        organizationId: 'org-a', organizationName: 'Example',
        sessionCookieName: 'dsh_session', sessionTtlMs: 60_000, secureCookies: false,
        autoProvisionSsoUsers: true, localEnabled: false,
        oidc: [{
          id: 'company', label: 'Company', issuer: 'https://id.example.com',
          clientId: 'client', clientSecretRef: 'OIDC_SECRET', callbackUrl: 'https://app.example.com/auth/callback',
          mapping: {
            organizationId: 'org-a', usernameClaim: 'email', displayNameClaim: 'name',
            groupsClaim: 'groups', roleByGroup: {},
          },
        }],
        saml: [], ldap: [],
      })

      await expect(fiber).rejects.toThrow('OIDC provider company client secret is not configured')
      expect(dispose).toHaveBeenCalledTimes(1)
      expect(injected.listOrganizations()).toEqual([{ id: 'org-a', name: 'Example' }])
    } finally {
      dispose.mockRestore()
      try { injected.close() } catch {}
    }
  })
})
