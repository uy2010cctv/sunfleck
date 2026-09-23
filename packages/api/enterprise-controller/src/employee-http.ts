/**
 * Authenticated employee dm endpoints for the enterprise Web console, mounted
 * by the enterprise controller. The routes sit behind the existing enterprise
 * cookie authentication and the shared authorization policy; this module adds
 * no authentication mechanism of its own. Responses carry governance fields
 * only: the home workspace path and inbox payloads stay internal.
 *
 * Routes (mounted under the `/enterprise/employees` prefix):
 * - `GET /` lists the caller organization's employees (archived excluded).
 * - `POST /` creates one employee (displayName, roleCard, and
 *   homeWorkspacePath required; activeReleaseId optional).
 * - `GET /sticky` resolves the caller's sticky employee.
 * - `GET /:id` reads one employee's detail.
 * - `POST /:id/messages` delivers one dm text and binds the sticky employee
 *   to the authenticated user on success.
 *
 * Status mapping: 401 unauthenticated, 403 denied by the shared policy, 400
 * invalid body, 404 missing or cross-organization employee (existence is not
 * revealed), 409 non-active employee, 502 enterprise-surface delivery
 * failure, 500 other failures.
 *
 * @module @deepseek-ai/dsh-api-enterprise-controller/employee-http
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { employeeId } from '@deepseek-ai/dsh-employee-account'
import type { EmployeeAccount, EmployeeAccounts, EmployeeId } from '@deepseek-ai/dsh-employee-account'
import { EnterpriseSurfaceError } from '@deepseek-ai/dsh-enterprise-surface'
import type {
  EnterpriseSurfaceErrorCode, EnterpriseSurfaces,
} from '@deepseek-ai/dsh-enterprise-surface'
import type {
  EnterpriseAction, EnterpriseAuthorizationDecision, EnterprisePrincipal, EnterpriseResource,
} from '@deepseek-ai/dsh-enterprise-governance'

/** Cordis service keys the employee dm endpoints require from the composition. */
export const inject: readonly string[] = ['employeeAccounts', 'surfaces']

/** Narrow enterprise-security seam behind which the routes run. */
export interface EmployeeHttpSecurity {
  /**
   * Authenticate one request through its cookie header.
   * @param cookieHeader - Incoming Cookie header.
   * @returns the active principal, or `undefined` when unauthenticated.
   */
  authenticateCookieAsync(cookieHeader: string): Promise<EnterprisePrincipal | undefined>
  /**
   * Authorize one already-resolved enterprise operation through the shared policy.
   * @param principal - Authenticated caller.
   * @param action - Classified enterprise action.
   * @param resource - Resource organization and visibility.
   * @returns the authorization decision.
   */
  authorizeResourceAsync(
    principal: EnterprisePrincipal,
    action: EnterpriseAction,
    resource: EnterpriseResource,
  ): Promise<EnterpriseAuthorizationDecision>
  /**
   * Append one authorization decision to the enterprise audit sink.
   * @param principal - Authenticated caller.
   * @param endpoint - Route-named endpoint identifier.
   * @param input - Parsed request fields used only for resource addressing.
   * @param decision - Previously computed authorization decision.
   * @param correlationId - Request-scoped correlation identity.
   * @param resource - Explicit resource address without secrets.
   */
  auditApiResourceAsync(
    principal: EnterprisePrincipal,
    endpoint: string,
    input: unknown,
    decision: EnterpriseAuthorizationDecision,
    correlationId: string,
    resource: { readonly type: string; readonly id: string },
  ): Promise<void>
}

/** Governance projection of one employee account; the only employee response body. */
export interface EmployeeAccountView {
  /** Durable employee identifier. */
  readonly id: EmployeeId
  /** Human-readable employee name. */
  readonly displayName: string
  /** Role-card preset text that seeds the employee's persona. */
  readonly roleCard: string
  /** Current lifecycle state. */
  readonly state: EmployeeAccount['state']
}

/** Surface error codes that mean the employee does not exist for the caller. */
const EMPLOYEE_NOT_FOUND_CODES: ReadonlySet<EnterpriseSurfaceErrorCode> = new Set([
  'employee-missing', 'employee-cross-org',
])

function failure(status: number, code: string): Response {
  return Response.json({ error: code }, { status })
}

/** Reject one unsupported method while advertising the methods the route accepts. */
function methodFailure(allow: string): Response {
  return Response.json({ error: 'method-not-allowed' }, { status: 405, headers: { allow } })
}

/** Project one account to its governance fields. */
function presentAccount(account: EmployeeAccount): EmployeeAccountView {
  return { id: account.id, displayName: account.displayName, roleCard: account.roleCard, state: account.state }
}

/** Read one non-empty trimmed string field from a parsed request body. */
function stringField(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Parse one JSON object request body; `undefined` for absent, malformed, or non-object bodies. */
async function jsonObjectBody(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = await request.json()
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : undefined
  } catch {
    // Invalid JSON and body-stream failures both mean one unreadable request payload.
    return undefined
  }
}

/** Employee dm HTTP boundary owned by the enterprise controller. */
export class EmployeeHttpHandler {
  /**
   * @param accounts - Persistent employee account service.
   * @param surfaces - Enterprise conversation-surface registry and inbound delivery.
   * @param security - Existing enterprise authentication and authorization seam.
   */
  constructor(
    private readonly accounts: EmployeeAccounts,
    private readonly surfaces: EnterpriseSurfaces,
    private readonly security: EmployeeHttpSecurity,
  ) {}

  /**
   * Authenticate, authorize, and dispatch one employee route request.
   * @param request - Authenticated Web console request under the mount prefix.
   * @returns Bounded governance response without internal workspace material.
   */
  async fetch(request: Request): Promise<Response> {
    const principal = await this.security.authenticateCookieAsync(request.headers.get('cookie') ?? '')
    if (principal === undefined) return failure(401, 'unauthenticated')
    const segments = new URL(request.url).pathname.split('/').filter(Boolean).slice(2)
    if (segments.length === 0) {
      if (request.method === 'GET') return this.list(principal)
      if (request.method === 'POST') return this.create(request, principal)
      return methodFailure('GET, POST')
    }
    const head = segments[0] as string
    if (segments.length === 1 && head === 'sticky') {
      return request.method === 'GET' ? this.sticky(principal) : methodFailure('GET')
    }
    if (segments.length === 1) {
      return request.method === 'GET'
        ? this.detail(principal, employeeId(head))
        : methodFailure('GET')
    }
    if (segments.length === 2 && segments[1] === 'messages') {
      return request.method === 'POST'
        ? this.deliver(request, principal, employeeId(head))
        : methodFailure('POST')
    }
    return failure(404, 'not-found')
  }

  /** List the caller organization's employee accounts in creation order. */
  private async list(principal: EnterprisePrincipal): Promise<Response> {
    const decision = await this.guard(principal, 'employee.read', 'enterpriseEmployeeAccount.list', 'catalog', {})
    if (!decision.allowed) return failure(403, 'forbidden')
    return Response.json(this.accounts.list(principal.orgId).map(presentAccount))
  }

  /**
   * Create one active employee account owned by the caller organization.
   *
   * Creators are trusted to anchor an employee at any absolute path: P0 has no
   * workspace-root prefix policy, so `isAbsolute` is the only validation.
   */
  private async create(request: Request, principal: EnterprisePrincipal): Promise<Response> {
    const decision = await this.guard(principal, 'employee.create', 'enterpriseEmployeeAccount.create', 'new', {})
    if (!decision.allowed) return failure(403, 'forbidden')
    const body = await jsonObjectBody(request)
    const displayName = body === undefined ? undefined : stringField(body, 'displayName')
    const roleCard = body === undefined ? undefined : stringField(body, 'roleCard')
    const homeWorkspacePath = body === undefined ? undefined : stringField(body, 'homeWorkspacePath')
    const activeReleaseId = body === undefined ? undefined : stringField(body, 'activeReleaseId')
    if (displayName === undefined || roleCard === undefined
      || homeWorkspacePath === undefined || !isAbsolute(homeWorkspacePath)) {
      return failure(400, 'invalid-payload')
    }
    const account = this.accounts.create({
      orgId: principal.orgId, displayName, roleCard, homeWorkspacePath,
      ...(activeReleaseId === undefined ? {} : { activeReleaseId }),
    })
    return Response.json(presentAccount(account), { status: 201 })
  }

  /** Read one employee's governance detail; missing and cross-organization ids both answer 404. */
  private async detail(principal: EnterprisePrincipal, id: EmployeeId): Promise<Response> {
    const decision = await this.guard(principal, 'employee.read', 'enterpriseEmployeeAccount.get', id, {})
    if (!decision.allowed) return failure(403, 'forbidden')
    const account = this.requireOwnEmployee(principal, id)
    return account === undefined ? failure(404, 'employee-not-found') : Response.json(presentAccount(account))
  }

  /** Resolve the authenticated user's sticky employee, or 404 while unbound. */
  private async sticky(principal: EnterprisePrincipal): Promise<Response> {
    const decision = await this.guard(principal, 'employee.read', 'enterpriseEmployeeAccount.sticky', 'sticky', {})
    if (!decision.allowed) return failure(403, 'forbidden')
    const id = this.accounts.resolveSticky(principal.orgId, principal.userId)
    const account = id === undefined ? undefined : this.requireOwnEmployee(principal, id)
    return account === undefined ? failure(404, 'sticky-unbound') : Response.json(presentAccount(account))
  }

  /** Deliver one dm text into the employee's anchored session and bind the sticky employee. */
  private async deliver(
    request: Request,
    principal: EnterprisePrincipal,
    id: EmployeeId,
  ): Promise<Response> {
    const decision = await this.guard(
      principal, 'employee.execute', 'enterpriseEmployeeAccount.deliverMessage', id, { employeeId: id },
    )
    if (!decision.allowed) return failure(403, 'forbidden')
    const body = await jsonObjectBody(request)
    const text = body === undefined ? undefined : stringField(body, 'text')
    if (text === undefined) return failure(400, 'invalid-text')
    const account = this.requireOwnEmployee(principal, id)
    if (account === undefined) return failure(404, 'employee-not-found')
    if (account.state !== 'active') return failure(409, 'employee-inactive')
    try {
      const surface = await this.surfaces.ensureDm({
        orgId: principal.orgId, userId: principal.userId, employeeId: id,
      })
      const inboxItemId = await this.surfaces.deliverToEmployee(surface, principal.userId, text)
      this.accounts.bindSticky(principal.orgId, principal.userId, id)
      return Response.json({ employeeId: id, inboxItemId })
    } catch (error: unknown) {
      return this.surfaceFailure(error)
    }
  }

  /** Read one employee account the caller organization owns, or `undefined` behind a shared 404. */
  private requireOwnEmployee(principal: EnterprisePrincipal, id: EmployeeId): EmployeeAccount | undefined {
    const account = this.accounts.get(id)
    return account === undefined || account.orgId !== principal.orgId ? undefined : account
  }

  /** Map one delivery failure to its transport status without exposing internals. */
  private surfaceFailure(error: unknown): Response {
    if (error instanceof EnterpriseSurfaceError) {
      /* v8 ignore next -- reachable only when the account vanishes after the active-state pre-check;
         the pre-check tests own the 404 behavior. */
      if (EMPLOYEE_NOT_FOUND_CODES.has(error.code)) return failure(404, 'employee-not-found')
      return failure(502, 'delivery-failed')
    }
    return failure(500, 'internal-error')
  }

  /**
   * Authorize one employee-plane operation through the shared policy and audit the decision.
   *
   * `input` mirrors the security seam's audit signature; today it carries
   * nothing beyond what `resourceId` already holds.
   */
  private async guard(
    principal: EnterprisePrincipal,
    action: EnterpriseAction,
    endpoint: string,
    resourceId: string,
    input: Record<string, unknown>,
  ): Promise<EnterpriseAuthorizationDecision> {
    const resource: EnterpriseResource = { orgId: principal.orgId, visibility: 'organization' }
    const decision = await this.security.authorizeResourceAsync(principal, action, resource)
    await this.security.auditApiResourceAsync(
      principal, endpoint, input, decision, randomUUID(), { type: 'employee-account', id: resourceId },
    )
    return decision
  }
}
