/** Fetch-native enterprise authentication routes, mounted under `/auth`. */

import type {
  EnterpriseLdapProvider, EnterpriseOidcProvider, EnterpriseSamlProvider, SsoLoginResult,
} from '@deepseek-ai/dsh-enterprise-sso'
import { createPasswordVerifier } from '@deepseek-ai/dsh-enterprise-sso'
import type { SsoMappedIdentity } from '@deepseek-ai/dsh-enterprise-sso'
import { randomUUID } from 'node:crypto'
import type { EnterpriseRole } from '@deepseek-ai/dsh-enterprise-governance'
import { memorySourceDigest } from '@deepseek-ai/dsh-enterprise-identity'
import { clearSessionCookie } from './cookies.ts'
import type { EnterpriseSecurity } from './security.ts'
import type { EnterpriseWorkspaceProvisioner } from './workspace-provisioner.ts'

interface OidcProviderLike extends Pick<EnterpriseOidcProvider, 'id' | 'label' | 'begin' | 'complete'> {}
interface SamlProviderLike extends Pick<EnterpriseSamlProvider, 'id' | 'label' | 'begin' | 'complete'> {}
interface LdapProviderLike extends Pick<EnterpriseLdapProvider, 'id' | 'label' | 'authenticate'> {}

/** Data used by `EnterpriseAuthProviders`. */
export interface EnterpriseAuthProviders {
  readonly localEnabled: boolean
  readonly oidc: readonly OidcProviderLike[]
  readonly saml: readonly SamlProviderLike[]
  readonly ldap: readonly LdapProviderLike[]
}

/** Data used by `EnterpriseAuthHttpOptions`. */
export interface EnterpriseAuthHttpOptions {
  readonly workspaceProvisioner?: Partial<Pick<
    EnterpriseWorkspaceProvisioner,
    'ensurePersonal' | 'ensureDepartment' | 'ensureWorkspace' | 'createPersonal'
  >>
  readonly memoryWriteback?: () => {
    list(orgId: string, limit?: number): Promise<readonly unknown[]>
    retry(orgId: string, sourceKey: string): Promise<unknown>
  } | undefined
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

function validUsername(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && /^\S{2,64}$/u.test(value)
}

function validDisplayName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 1 && value.trim().length <= 100
}

function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128
}

function validOrganizationId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{1,63}$/u.test(value)
}

function validUserId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/u.test(value)
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

  constructor(
    private readonly security: EnterpriseSecurity,
    private readonly providers: EnterpriseAuthProviders,
    private readonly options: EnterpriseAuthHttpOptions = {},
  ) {
    for (const provider of providers.oidc) this.oidc.set(provider.id, provider)
    for (const provider of providers.saml) this.saml.set(provider.id, provider)
    for (const provider of providers.ldap) this.ldap.set(provider.id, provider)
  }

  /** Executes `EnterpriseAuthHttpHandler.fetch` for this instance.
   * @param request - Input value used by this API.
   * @returns Result produced by this API.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.split('/').filter(Boolean)
    if (path[0] !== 'auth') return new Response('not found', { status: 404 })

    if (request.method === 'GET' && path.length === 2 && path[1] === 'status') {
      const principal = await this.security.authenticateCookieAsync(request.headers.get('cookie') ?? '')
      return json({
        authenticated: principal !== undefined,
        organizationId: principal?.orgId ?? this.security.config.organizationId,
        defaultOrganizationId: this.security.config.organizationId,
        platformAdministrator: principal !== undefined && this.security.isPlatformAdministrator(principal),
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
        if (login !== undefined) await this.ensurePersonalWorkspace(login.principal.orgId, login.principal.username)
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

    if (path[1] === 'workspaces') return this.workspaces(request, path)
    if (path[1] === 'departments') return this.departments(request, path)
    if (path[1] === 'admin') return this.admin(request, url, path)

    return new Response('not found', { status: 404 })
  }

  private async departments(request: Request, path: string[]): Promise<Response> {
    if (request.method !== 'GET' || path.length !== 2) return new Response('not found', { status: 404 })
    const principal = await this.security.authenticateCookieAsync(request.headers.get('cookie') ?? '')
    if (principal === undefined) return new Response('unauthorized', { status: 401 })
    const endpoint = 'enterpriseEmployee.list'
    const decision = await this.security.authorizeApiAsync(principal, endpoint, {})
    await this.security.auditApiAsync(
      principal, endpoint, {}, decision, request.headers.get('x-request-id') ?? randomUUID(),
    )
    if (!decision.allowed) return new Response('forbidden', { status: 403 })
    return json(await this.security.repository.listDepartments(principal.orgId))
  }

  private async admin(request: Request, url: URL, path: string[]): Promise<Response> {
    const principal = await this.security.authenticateCookieAsync(request.headers.get('cookie') ?? '')
    if (principal === undefined) return new Response('unauthorized', { status: 401 })
    const memoryRoute = path[2] === 'memories'
    if (!memoryRoute || request.method === 'GET') {
      const endpoint = memoryRoute
        ? 'enterpriseMemory.list'
        : path[2] === 'audit' ? 'enterpriseAudit.list' : `enterpriseAdmin.${path[2] ?? 'unknown'}`
      const decision = await this.security.authorizeApiAsync(principal, endpoint, {})
      await this.security.auditApiAsync(
        principal, endpoint, {}, decision, request.headers.get('x-request-id') ?? randomUUID(),
      )
      if (!decision.allowed) return new Response('forbidden', { status: 403 })
    }

    if (request.method === 'GET' && path.length === 3 && path[2] === 'memory-writeback') {
      return json(await this.options.memoryWriteback?.()?.list(principal.orgId, 50) ?? [])
    }
    if (request.method === 'POST' && path.length === 5 && path[2] === 'memory-writeback' && path[4] === 'retry') {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      const runtime = this.options.memoryWriteback?.()
      if (runtime === undefined) return json({ error: 'unavailable' }, 503)
      try { return json(await runtime.retry(principal.orgId, decodeURIComponent(path[3] as string))) }
      catch (error) { return json({ error: 'not-retryable', message: error instanceof Error ? error.message : String(error) }, 409) }
    }

    if (request.method === 'GET' && path.length === 3 && path[2] === 'organizations') {
      return json(this.security.isPlatformAdministrator(principal)
        ? await this.security.repository.listOrganizations()
        : (await this.security.repository.listOrganizations()).filter(item => item.id === principal.orgId))
    }
    if (request.method === 'POST' && path.length === 3 && path[2] === 'organizations') {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      if (!this.security.isPlatformAdministrator(principal)) return new Response('forbidden', { status: 403 })
      const body = await jsonBody(request)
      const id = body['id']
      const name = body['name']
      const administratorId = body['administratorId']
      const administratorUsername = body['administratorUsername']
      const administratorDisplayName = body['administratorDisplayName']
      const password = body['password']
      if (!validOrganizationId(id) || !validDisplayName(name) || !validUserId(administratorId)
        || !validUsername(administratorUsername) || !validDisplayName(administratorDisplayName)
        || !validPassword(password)) return json({ error: 'bad-request' }, 400)
      try {
        await this.security.repository.createOrganizationWithAdministrator({
          organization: { id, name: name.trim() },
          administrator: {
            id: administratorId, orgId: id, username: administratorUsername,
            displayName: administratorDisplayName.trim(), disabled: false,
          },
          passwordVerifier: createPasswordVerifier(password),
        })
        const administrator = await this.security.repository.findUser(id, administratorUsername)
        if (administrator !== undefined) await this.options.workspaceProvisioner?.ensurePersonal?.(administrator)
        return json({ id, name: name.trim(), administratorId }, 201)
      } catch (error) {
        return json({ error: 'conflict', message: error instanceof Error ? error.message : String(error) }, 409)
      }
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
      const password = body['password']
      const roles = this.roles(body['roles'])
      if (typeof id !== 'string' || !validUsername(username) || !validDisplayName(displayName)
        || !validPassword(password) || roles === undefined) {
        return json({ error: 'bad-request' }, 400)
      }
      try {
        await this.security.repository.createUser({
          id, orgId: principal.orgId, username, displayName: displayName.trim(), disabled: false,
        }, { passwordVerifier: createPasswordVerifier(password) })
      } catch (error) {
        return json({ error: 'conflict', message: error instanceof Error ? error.message : String(error) }, 409)
      }
      await this.security.repository.setRoles(id, roles)
      const user = await this.security.repository.findUser(principal.orgId, username)
      if (user !== undefined) await this.options.workspaceProvisioner?.ensurePersonal?.(user)
      return json(user, 201)
    }
    if (request.method === 'PATCH' && path.length === 4 && path[2] === 'users') {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      const userId = path[3] as string
      const body = await jsonBody(request)
      const current = (await this.security.repository.listUsers(principal.orgId)).find(user => user.id === userId)
      if (current === undefined) return json({ error: 'not-found' }, 404)
      const username = body['username']
      const displayName = body['displayName']
      const password = body['password']
      if ((username !== undefined && !validUsername(username))
        || (displayName !== undefined && !validDisplayName(displayName))
        || (password !== undefined && !validPassword(password))) return json({ error: 'bad-request' }, 400)
      if (username !== undefined || displayName !== undefined || password !== undefined) {
        try {
          await this.security.repository.updateUserProfile({
            orgId: principal.orgId, userId,
            username: username ?? current.username,
            displayName: displayName?.trim() ?? current.displayName,
            ...(password === undefined ? {} : { passwordVerifier: createPasswordVerifier(password) }),
          })
        } catch (error) {
          return json({ error: 'conflict', message: error instanceof Error ? error.message : String(error) }, 409)
        }
      }
      if (body['roles'] !== undefined) {
        const roles = this.roles(body['roles'])
        if (roles === undefined) return json({ error: 'bad-request' }, 400)
        await this.security.repository.setRoles(userId, roles)
      }
      if (typeof body['disabled'] === 'boolean') {
        await this.security.repository.setUserDisabled(userId, body['disabled'])
      }
      if (body['departmentIds'] !== undefined) {
        const departmentIds = body['departmentIds']
        const primaryDepartmentId = body['primaryDepartmentId']
        const expectedRevision = body['expectedRevision']
        if (!Array.isArray(departmentIds) || departmentIds.some(id => typeof id !== 'string')
          || (primaryDepartmentId !== undefined && typeof primaryDepartmentId !== 'string')
          || !Number.isSafeInteger(expectedRevision)) return json({ error: 'bad-request' }, 400)
        try {
          await this.security.repository.setUserDepartments({
            orgId: principal.orgId, userId, departmentIds,
            ...(primaryDepartmentId === undefined ? {} : { primaryDepartmentId }),
            expectedRevision: expectedRevision as number,
          })
        } catch (error) {
          return json({ error: 'conflict', message: error instanceof Error ? error.message : String(error) }, 409)
        }
      }
      return new Response(null, { status: 204 })
    }
    if (request.method === 'GET' && path.length === 3 && path[2] === 'departments') {
      return json(await this.security.repository.listDepartments(principal.orgId))
    }
    if ((request.method === 'POST' && path.length === 3 && path[2] === 'departments')
      || (request.method === 'PATCH' && path.length === 4 && path[2] === 'departments')) {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      const body = await jsonBody(request)
      const id = request.method === 'PATCH' ? path[3] : body['id']
      const name = body['name']
      const parentId = body['parentId']
      const sortOrder = body['sortOrder']
      const expectedRevision = body['expectedRevision']
      if (typeof id !== 'string' || typeof name !== 'string'
        || (parentId !== null && typeof parentId !== 'string')
        || !Number.isSafeInteger(sortOrder) || !Number.isSafeInteger(expectedRevision)) {
        return json({ error: 'bad-request' }, 400)
      }
      try {
        const previous = (await this.security.repository.listDepartments(principal.orgId))
          .find(department => department.id === id)
        const department = await this.security.repository.saveDepartment({
          id, orgId: principal.orgId, name, parentId, sortOrder: sortOrder as number,
          expectedRevision: expectedRevision as number,
        })
        await this.options.workspaceProvisioner?.ensureDepartment?.(department, previous?.name)
        return json(department, request.method === 'POST' ? 201 : 200)
      } catch (error) {
        return json({ error: 'conflict', message: error instanceof Error ? error.message : String(error) }, 409)
      }
    }
    if (request.method === 'GET' && path.length === 3 && path[2] === 'workspaces') {
      return json(await this.security.repository.listOrganizationWorkspaceGrants(principal.orgId))
    }
    if (request.method === 'PATCH' && path.length === 4 && path[2] === 'workspaces') {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      const body = await jsonBody(request)
      const name = body['name']
      const sandboxMode = body['sandboxMode']
      const expectedRevision = body['expectedRevision']
      if ((name !== undefined && (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > 100))
        || (sandboxMode !== undefined && sandboxMode !== 'read-only' && sandboxMode !== 'workspace-write')
        || (name === undefined && sandboxMode === undefined)
        || !Number.isSafeInteger(expectedRevision)) return json({ error: 'bad-request' }, 400)
      const current = await this.security.repository.workspaceGrant(path[3] as string)
      if (current === undefined || current.orgId !== principal.orgId) return json({ error: 'not-found' }, 404)
      try {
        const updated = await this.security.repository.saveWorkspaceGrant({
          workspaceId: current.workspaceId, orgId: current.orgId,
          name: typeof name === 'string' ? name.trim() : current.name, kind: current.kind,
          ...(current.ownerUserId === undefined ? {} : { ownerUserId: current.ownerUserId }),
          ...(current.departmentId === undefined ? {} : { departmentId: current.departmentId }),
          rootPath: current.rootPath,
          sandboxMode: sandboxMode === 'read-only' || sandboxMode === 'workspace-write'
            ? sandboxMode : current.sandboxMode,
          expectedRevision: expectedRevision as number,
        })
        await this.options.workspaceProvisioner?.ensureWorkspace?.(updated)
        return json(updated)
      } catch (error) {
        return json({ error: 'conflict', message: error instanceof Error ? error.message : String(error) }, 409)
      }
    }
    if (request.method === 'GET' && path.length === 3 && path[2] === 'memories') {
      const status = url.searchParams.get('status')
      const statuses = status === null ? undefined : status.split(',').filter((candidate): candidate is
        'proposed' | 'approved' | 'rejected' | 'retired' =>
        ['proposed', 'approved', 'rejected', 'retired'].includes(candidate))
      const memories = await this.security.repository.listMemories({
        orgId: principal.orgId, ...(statuses === undefined ? {} : { statuses }),
        departmentIds: (await this.security.repository.listDepartments(principal.orgId)).map(item => item.id),
      })
      const visible = await Promise.all(memories.map(async memory =>
        (await this.security.authorizeResourceAsync(principal, 'memory.read', {
          orgId: memory.orgId, visibility: 'organization',
          scope: memory.scope === 'organization'
            ? { type: 'organization' }
            : { type: 'department', departmentId: memory.departmentId as string },
        })).allowed ? memory : undefined))
      return json(visible.filter((memory): memory is typeof memories[number] => memory !== undefined))
    }
    if (request.method === 'POST' && path.length === 3 && path[2] === 'memories') {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      const body = await jsonBody(request)
      const id = typeof body['id'] === 'string' ? body['id'] : randomUUID()
      const scope = body['scope']
      const departmentId = body['departmentId']
      const kind = body['kind']
      const summary = body['summary']
      const providedSourceDigest = body['sourceDigest']
      if ((scope !== 'organization' && scope !== 'department')
        || (departmentId !== undefined && typeof departmentId !== 'string')
        || !['business-fact', 'process', 'terminology', 'decision'].includes(String(kind))
        || typeof summary !== 'string'
        || (body['needsConfirmation'] !== undefined && typeof body['needsConfirmation'] !== 'boolean')
        || (providedSourceDigest !== undefined && typeof providedSourceDigest !== 'string')) {
        return json({ error: 'bad-request' }, 400)
      }
      if (scope === 'department' && departmentId === undefined) return json({ error: 'bad-request' }, 400)
      const authorization = await this.security.authorizeResourceAsync(principal, 'memory.manage', {
        orgId: principal.orgId, visibility: 'organization',
        scope: scope === 'organization'
          ? { type: 'organization' }
          : { type: 'department', departmentId: departmentId as string },
      })
      await this.security.auditApiResourceAsync(
        principal, 'enterpriseMemory.save', { id }, authorization,
        request.headers.get('x-request-id') ?? randomUUID(),
        { type: 'enterprise-memory', id },
      )
      if (!authorization.allowed) return new Response('forbidden', { status: 403 })
      const sourceDigest = providedSourceDigest ?? memorySourceDigest(JSON.stringify([
        scope, departmentId ?? null, kind, summary.trim(),
      ]))
      try {
        const memory = await this.security.repository.proposeMemory({
          id, orgId: principal.orgId, scope,
          ...(departmentId === undefined ? {} : { departmentId }),
          kind: kind as 'business-fact' | 'process' | 'terminology' | 'decision',
          summary, sourceDigest, createdBy: principal.userId,
        })
        if (body['needsConfirmation'] === true) return json(memory, 201)
        const activated = await this.security.repository.reviewMemory({
          id: memory.id, orgId: principal.orgId, decision: 'approved', reviewedBy: principal.userId,
          reason: '用户主动保存并启用', expectedRevision: memory.revision,
        })
        return json(activated, 201)
      } catch (error) {
        return json({ error: 'memory-rejected', message: error instanceof Error ? error.message : String(error) }, 400)
      }
    }
    if (request.method === 'PATCH' && path.length === 4 && path[2] === 'memories') {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      const body = await jsonBody(request)
      const decision = body['decision']
      const reason = body['reason']
      const expectedRevision = body['expectedRevision']
      if (!['approved', 'rejected', 'retired'].includes(String(decision))
        || typeof reason !== 'string' || !Number.isSafeInteger(expectedRevision)) return json({ error: 'bad-request' }, 400)
      const memoryId = path[3] as string
      const memory = (await this.security.repository.listMemories({
        orgId: principal.orgId,
        departmentIds: (await this.security.repository.listDepartments(principal.orgId)).map(item => item.id),
      })).find(item => item.id === memoryId)
      if (memory === undefined) return json({ error: 'not-found' }, 404)
      const authorization = await this.security.authorizeResourceAsync(principal, 'memory.manage', {
        orgId: memory.orgId, visibility: 'organization',
        scope: memory.scope === 'organization'
          ? { type: 'organization' }
          : { type: 'department', departmentId: memory.departmentId as string },
      })
      await this.security.auditApiResourceAsync(
        principal, 'enterpriseMemory.review', { memoryId }, authorization,
        request.headers.get('x-request-id') ?? randomUUID(),
        { type: 'enterprise-memory', id: memoryId },
      )
      if (!authorization.allowed) return new Response('forbidden', { status: 403 })
      try {
        return json(await this.security.repository.reviewMemory({
          id: memoryId, orgId: principal.orgId,
          decision: decision as 'approved' | 'rejected' | 'retired', reviewedBy: principal.userId,
          reason, expectedRevision: expectedRevision as number,
        }))
      } catch (error) {
        return json({ error: 'conflict', message: error instanceof Error ? error.message : String(error) }, 409)
      }
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

  private async workspaces(request: Request, path: string[]): Promise<Response> {
    const principal = await this.security.authenticateCookieAsync(request.headers.get('cookie') ?? '')
    if (principal === undefined) return new Response('unauthorized', { status: 401 })
    const endpoint = request.method === 'GET' ? 'enterpriseWorkspace.list' : 'enterpriseWorkspace.create'
    const decision = await this.security.authorizeApiAsync(principal, endpoint, {})
    await this.security.auditApiAsync(
      principal, endpoint, {}, decision, request.headers.get('x-request-id') ?? randomUUID(),
    )
    if (!decision.allowed) return new Response('forbidden', { status: 403 })
    if (request.method === 'GET' && path.length === 2) {
      return json(await this.security.repository.listWorkspaceGrants({ orgId: principal.orgId, userId: principal.userId }))
    }
    if (request.method === 'POST' && path.length === 2) {
      if (!sameOrigin(request)) return new Response('forbidden', { status: 403 })
      if (this.options.workspaceProvisioner?.createPersonal === undefined) {
        return json({ error: 'workspace-unavailable' }, 503)
      }
      const body = await jsonBody(request)
      const name = body['name']
      const idempotencyKey = body['idempotencyKey']
      if (typeof name !== 'string' || typeof idempotencyKey !== 'string') return json({ error: 'bad-request' }, 400)
      const user = await this.security.repository.findUser(principal.orgId, principal.username)
      if (user === undefined) return new Response('unauthorized', { status: 401 })
      try {
        return json(await this.options.workspaceProvisioner.createPersonal(user, name, idempotencyKey), 201)
      } catch (error) {
        return json({ error: 'workspace-create-failed', message: error instanceof Error ? error.message : String(error) }, 400)
      }
    }
    return new Response('not found', { status: 404 })
  }

  private async commitLogin(identity: SsoLoginResult): Promise<Response> {
    return this.commitIdentity(identity, identity.returnTo)
  }

  private async commitIdentity(identity: SsoMappedIdentity, returnTo: string): Promise<Response> {
    const login = await this.security.loginExternalAsync(identity)
    await this.ensurePersonalWorkspace(login.principal.orgId, login.principal.username)
    return new Response(null, {
      status: 303,
      headers: { location: returnTo, 'set-cookie': login.cookie, 'cache-control': 'no-store' },
    })
  }

  private async ensurePersonalWorkspace(orgId: string, username: string): Promise<void> {
    if (this.options.workspaceProvisioner?.ensurePersonal === undefined) return
    const user = await this.security.repository.findUser(orgId, username)
    if (user !== undefined) await this.options.workspaceProvisioner.ensurePersonal(user)
  }
}
