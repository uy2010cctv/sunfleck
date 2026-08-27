/** Fetch-native enterprise authentication routes, mounted under `/auth`. */

import type {
  EnterpriseLdapProvider, EnterpriseOidcProvider, EnterpriseSamlProvider, SsoLoginResult,
} from '@deepseek-ai/dsh-enterprise-sso'
import type { SsoMappedIdentity } from '@deepseek-ai/dsh-enterprise-sso'
import { randomUUID } from 'node:crypto'
import type { EnterpriseRole } from '@deepseek-ai/dsh-enterprise-governance'
import { clearSessionCookie } from './cookies.ts'
import type { EnterpriseSecurity } from './security.ts'

interface OidcProviderLike extends Pick<EnterpriseOidcProvider, 'id' | 'label' | 'begin' | 'complete'> {}
interface SamlProviderLike extends Pick<EnterpriseSamlProvider, 'id' | 'label' | 'begin' | 'complete'> {}
interface LdapProviderLike extends Pick<EnterpriseLdapProvider, 'id' | 'label' | 'authenticate'> {}

export interface EnterpriseAuthProviders {
  readonly localEnabled: boolean
  readonly oidc: readonly OidcProviderLike[]
  readonly saml: readonly SamlProviderLike[]
  readonly ldap: readonly LdapProviderLike[]
}

function json(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('content-type', 'application/json; charset=utf-8')
  responseHeaders.set('cache-control', 'no-store')
  return new Response(JSON.stringify(value), {
    status,
    headers: responseHeaders,
  })
}

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return origin !== null && origin === new URL(request.url).origin
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('JSON body required')
  const value: unknown = await request.json()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('JSON object required')
  return value as Record<string, unknown>
}

function localReturnTo(url: URL): string {
  const value = url.searchParams.get('returnTo') ?? '/'
  return value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

const ENTERPRISE_ROLES = new Set<EnterpriseRole>([
  'administrator', 'creator', 'operator', 'auditor', 'member',
])

/** Authentication route handler; protocol adapters are registered explicitly by deployment. */
export class EnterpriseAuthHttpHandler {
  private readonly oidc = new Map<string, OidcProviderLike>()
  private readonly saml = new Map<string, SamlProviderLike>()
  private readonly ldap = new Map<string, LdapProviderLike>()

  constructor(private readonly security: EnterpriseSecurity, private readonly providers: EnterpriseAuthProviders) {
    for (const provider of providers.oidc) this.oidc.set(provider.id, provider)
    for (const provider of providers.saml) this.saml.set(provider.id, provider)
    for (const provider of providers.ldap) this.ldap.set(provider.id, provider)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.split('/').filter(Boolean)
    if (path[0] !== 'auth') return new Response('not found', { status: 404 })

    if (request.method === 'GET' && path.length === 2 && path[1] === 'status') {
      const principal = await this.security.authenticateCookieAsync(request.headers.get('cookie') ?? '')
      return json({
        authenticated: principal !== undefined,
        organizationId: this.security.config.organizationId,
        ...principal === undefined ? {} : { principal },
        providers: [
          ...(this.providers.localEnabled ? [{ id: 'local', kind: 'local', label: 'Local account' }] : []),
          ...this.providers.oidc.map(provider => ({ id: provider.id, kind: 'oidc', label: provider.label })),
          ...this.providers.saml.map(provider => ({ id: provider.id, kind: 'saml', label: provider.label })),
          ...this.providers.ldap.map(provider => ({ id: provider.id, kind: 'ldap', label: provider.label })),
        ],
      })
    }

    if (request.method === 'POST' && path.length === 2 && path[1] === 'logout') {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      await this.security.logoutAsync(request.headers.get('cookie') ?? '')
      return new Response(null, {
        status: 204,
        headers: {
          'set-cookie': clearSessionCookie(
            this.security.config.sessionCookieName, this.security.config.secureCookies,
          ),
        },
      })
    }

    if (request.method === 'POST' && path.length === 3 && path[1] === 'login' && path[2] === 'local') {
      if (!this.providers.localEnabled) return new Response('not found', { status: 404 })
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      try {
        const body = await jsonBody(request)
        const organizationId = body['organizationId']
        const username = body['username']
        const password = body['password']
        if (typeof organizationId !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
          return json({ error: 'invalid-credentials' }, 401)
        }
        const login = await this.security.loginLocalAsync(organizationId, username, password)
        return login === undefined
          ? json({ error: 'invalid-credentials' }, 401)
          : json({ principal: login.principal }, 200, { 'set-cookie': login.cookie })
      } catch {
        return json({ error: 'bad-request' }, 400)
      }
    }

    if (request.method === 'GET' && path.length === 3 && path[1] === 'login') {
      const providerId = path[2] as string
      const oidc = this.oidc.get(providerId)
      if (oidc !== undefined) {
        const begun = await oidc.begin(localReturnTo(url))
        return Response.redirect(begun.url, 303)
      }
      const saml = this.saml.get(providerId)
      if (saml !== undefined) {
        const begun = await saml.begin(localReturnTo(url))
        return Response.redirect(begun.url, 303)
      }
    }

    if (request.method === 'POST' && path.length === 3 && path[1] === 'login') {
      const ldap = this.ldap.get(path[2] as string)
      if (ldap !== undefined) {
        if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
        try {
          const body = await jsonBody(request)
          const username = body['username']
          const password = body['password']
          if (typeof username !== 'string' || typeof password !== 'string') return json({ error: 'invalid-credentials' }, 401)
          return await this.commitIdentity(await ldap.authenticate(username, password), '/')
        } catch {
          return json({ error: 'invalid-credentials' }, 401)
        }
      }
    }

    if (request.method === 'GET' && path.length === 3 && path[1] === 'callback') {
      const provider = this.oidc.get(path[2] as string)
      if (provider !== undefined) return await this.commitLogin(await provider.complete(url))
    }

    if (request.method === 'POST' && path.length === 3 && path[1] === 'callback') {
      const provider = this.saml.get(path[2] as string)
      if (provider !== undefined) {
        const form = await request.formData()
        const container: Record<string, string> = {}
        for (const [key, value] of form) if (typeof value === 'string') container[key] = value
        return await this.commitLogin(await provider.complete(container))
      }
    }

    if (path[1] === 'admin') return this.admin(request, url, path)

    return new Response('not found', { status: 404 })
  }

  private async admin(request: Request, url: URL, path: string[]): Promise<Response> {
    const principal = await this.security.authenticateCookieAsync(request.headers.get('cookie') ?? '')
    if (principal === undefined) return new Response('unauthorized', { status: 401 })
    const endpoint = path[2] === 'audit' ? 'enterpriseAudit.list' : `enterpriseAdmin.${path[2] ?? 'unknown'}`
    const decision = await this.security.authorizeApiAsync(principal, endpoint, {})
    await this.security.auditApiAsync(
      principal, endpoint, {}, decision, request.headers.get('x-request-id') ?? randomUUID(),
    )
    if (!decision.allowed) return new Response('forbidden', { status: 403 })

    if (request.method === 'GET' && path.length === 3 && path[2] === 'organizations') {
      return json(await this.security.repository.listOrganizations())
    }
    if (request.method === 'POST' && path.length === 3 && path[2] === 'organizations') {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      const body = await jsonBody(request)
      if (typeof body['id'] !== 'string' || typeof body['name'] !== 'string') return json({ error: 'bad-request' }, 400)
      await this.security.repository.createOrganization({ id: body['id'], name: body['name'] })
      return json({ id: body['id'], name: body['name'] }, 201)
    }
    if (request.method === 'GET' && path.length === 3 && path[2] === 'users') {
      return json(await this.security.repository.listUsers(principal.orgId))
    }
    if (request.method === 'POST' && path.length === 3 && path[2] === 'users') {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      const body = await jsonBody(request)
      const id = body['id']
      const username = body['username']
      const displayName = body['displayName']
      const roles = this.roles(body['roles'])
      if (typeof id !== 'string' || typeof username !== 'string' || typeof displayName !== 'string' || roles === undefined) {
        return json({ error: 'bad-request' }, 400)
      }
      await this.security.repository.createUser({
        id, orgId: principal.orgId, username, displayName, disabled: false,
      })
      await this.security.repository.setRoles(id, roles)
      return json(await this.security.repository.findUser(principal.orgId, username), 201)
    }
    if (request.method === 'PATCH' && path.length === 4 && path[2] === 'users') {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      const userId = path[3] as string
      const body = await jsonBody(request)
      if (body['roles'] !== undefined) {
        const roles = this.roles(body['roles'])
        if (roles === undefined) return json({ error: 'bad-request' }, 400)
        await this.security.repository.setRoles(userId, roles)
      }
      if (typeof body['disabled'] === 'boolean') {
        await this.security.repository.setUserDisabled(userId, body['disabled'])
      }
      return new Response(null, { status: 204 })
    }
    if (request.method === 'GET' && path.length === 3 && path[2] === 'resource-policies') {
      return json(await this.security.repository.listResourcePolicies(principal.orgId))
    }
    if (request.method === 'GET' && path.length === 3 && path[2] === 'assets') {
      return json(await this.security.repository.listManagedAssets(principal.orgId))
    }
    if (request.method === 'POST' && path.length === 3 && path[2] === 'assets') {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      const body = await jsonBody(request)
      const type = body['type']
      const id = body['id']
      const name = body['name']
      const config = body['config']
      if ((type !== 'channel' && type !== 'model' && type !== 'capability')
        || typeof id !== 'string' || typeof name !== 'string'
        || typeof config !== 'object' || config === null || Array.isArray(config)) {
        return json({ error: 'bad-request' }, 400)
      }
      try {
        await this.security.repository.putManagedAsset({
          orgId: principal.orgId, type, id, name, config: config as Record<string, unknown>,
        })
      } catch {
        return json({ error: 'secret-field-rejected' }, 400)
      }
      return json({ type, id, name }, 201)
    }
    if (request.method === 'POST' && path.length === 3 && path[2] === 'resource-policies') {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      const body = await jsonBody(request)
      const resourceType = body['resourceType']
      const resourceId = body['resourceId']
      const creatorUserId = body['creatorUserId']
      const visibility = body['visibility']
      const allowedUserIds = body['allowedUserIds']
      if (typeof resourceType !== 'string' || typeof resourceId !== 'string'
        || (creatorUserId !== undefined && typeof creatorUserId !== 'string')
        || (visibility !== 'organization' && visibility !== 'private' && visibility !== 'restricted')
        || !Array.isArray(allowedUserIds) || allowedUserIds.some(id => typeof id !== 'string')) {
        return json({ error: 'bad-request' }, 400)
      }
      await this.security.repository.putResourcePolicy({
        resourceType, resourceId, orgId: principal.orgId,
        ...creatorUserId === undefined ? {} : { creatorUserId },
        visibility, allowedUserIds,
      })
      return new Response(null, { status: 204 })
    }
    if (request.method === 'GET' && path.length === 3 && path[2] === 'audit') {
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 100), 1), 500)
      const actorUserId = url.searchParams.get('actorUserId') ?? undefined
      const action = url.searchParams.get('action') as import('@deepseek-ai/dsh-enterprise-governance').EnterpriseAction | null
      return json(await this.security.repository.listAudit({
        orgId: principal.orgId,
        limit,
        ...actorUserId === undefined ? {} : { actorUserId },
        ...action === null ? {} : { action },
      }))
    }
    return new Response('not found', { status: 404 })
  }

  private roles(value: unknown): EnterpriseRole[] | undefined {
    if (!Array.isArray(value) || value.some(role => typeof role !== 'string' || !ENTERPRISE_ROLES.has(role as EnterpriseRole))) {
      return undefined
    }
    return [...new Set(value as EnterpriseRole[])]
  }

  private async commitLogin(identity: SsoLoginResult): Promise<Response> {
    return this.commitIdentity(identity, identity.returnTo)
  }

  private async commitIdentity(identity: SsoMappedIdentity, returnTo: string): Promise<Response> {
    const login = await this.security.loginExternalAsync(identity)
    return new Response(null, {
      status: 303,
      headers: { location: returnTo, 'set-cookie': login.cookie, 'cache-control': 'no-store' },
    })
  }
}
