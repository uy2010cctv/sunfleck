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
 * - `GET /:id/memories` lists one employee's memory view; `?status=` filters
 *   both compartments by one memory status.
 * - `POST /:id/memories/:memoryId/review` approves or rejects one proposed
 *   memory (decision, reason, and the caller's last-seen revision required).
 * - `POST /:id/memories/:memoryId/retire` retires one approved memory; the
 *   body may pin `{revision}`, otherwise the current entry is resolved first.
 *
 * Status mapping: 401 unauthenticated, 403 denied by the shared policy, 400
 * invalid body, 404 missing or cross-organization employee or memory
 * (existence is not revealed), 409 non-active employee or conflicting or
 * illegal memory review, 502 enterprise-surface delivery failure, 500 other
 * failures.
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
import type {
  EnterpriseMemoryEntry, IdentityAwaitable, ReviewEnterpriseMemoryInput,
} from '@deepseek-ai/dsh-enterprise-identity'
import { failure, jsonObjectBody, methodFailure, stringField } from './http.ts'

/** Cordis service keys the employee dm and memory governance endpoints require. */
export const inject: readonly string[] = ['employeeAccounts', 'surfaces', 'enterprisePostgres']

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

/** Memory-plane slice the governance routes read and write; both identity stores satisfy this. */
export interface EmployeeMemoryStore {
  /**
   * List memory entries of one organization under compartment and status filters.
   * @param input - Organization, optional statuses, optional shared scopes, and the agent owner.
   * @returns Matching entries newest-write first.
   */
  listMemories(input: {
    readonly orgId: string
    readonly statuses?: readonly EnterpriseMemoryEntry['status'][]
    readonly scopes?: readonly EnterpriseMemoryEntry['scope'][]
    readonly agentEmployeeId?: string
  }): IdentityAwaitable<EnterpriseMemoryEntry[]>
  /**
   * Apply one review decision behind a revision pin.
   * @param input - Decision, reviewer, required reason, and the expected current revision.
   * @returns The updated entry.
   */
  reviewMemory(input: ReviewEnterpriseMemoryInput): IdentityAwaitable<EnterpriseMemoryEntry>
}

/** Governance projection of one memory entry; the only memory response body.
 * Privacy findings, source digests, and review bookkeeping never leave the store. */
export interface EmployeeMemoryView {
  /** Durable memory identifier. */
  readonly id: string
  /** Compartment the memory lives in. */
  readonly scope: EnterpriseMemoryEntry['scope']
  /** Content classification. */
  readonly kind: EnterpriseMemoryEntry['kind']
  /** Review lifecycle state. */
  readonly status: EnterpriseMemoryEntry['status']
  /** Reviewed memory summary shown to governance viewers. */
  readonly summary: string
  /** Creation timestamp in epoch milliseconds. */
  readonly createdAt: number
  /** Current revision; the client pins it on review and retire requests. */
  readonly revision: number
  /** Reviewer user id, absent while a proposal is unreviewed. */
  readonly reviewedBy?: string
}

/** Memory statuses the `?status=` filter accepts. */
const MEMORY_STATUSES = ['proposed', 'approved', 'rejected', 'retired'] as const

/** Store failure text meaning the memory id is missing or cross-organization. */
const MEMORY_NOT_FOUND_MESSAGE = 'enterprise memory is outside organization or missing'

/** Store failure texts of revision conflicts and illegal transitions; both answer 409. */
const MEMORY_CONFLICT_MESSAGES = [
  'enterprise memory revision conflict: ',
  'enterprise memory is not pending review',
  'only approved enterprise memory can be retired',
] as const

/** Surface error codes that mean the employee does not exist for the caller. */
const EMPLOYEE_NOT_FOUND_CODES: ReadonlySet<EnterpriseSurfaceErrorCode> = new Set([
  'employee-missing', 'employee-cross-org',
])

/** Project one account to its governance fields. */
function presentAccount(account: EmployeeAccount): EmployeeAccountView {
  return { id: account.id, displayName: account.displayName, roleCard: account.roleCard, state: account.state }
}

/** Project one memory entry to its governance fields. */
function presentMemory(entry: EnterpriseMemoryEntry): EmployeeMemoryView {
  return {
    id: entry.id, scope: entry.scope, kind: entry.kind, status: entry.status,
    summary: entry.summary, createdAt: entry.createdAt, revision: entry.revision,
    ...(entry.reviewedBy === undefined ? {} : { reviewedBy: entry.reviewedBy }),
  }
}

/** Employee dm HTTP boundary owned by the enterprise controller. */
export class EmployeeHttpHandler {
  /**
   * @param accounts - Persistent employee account service.
   * @param surfaces - Enterprise conversation-surface registry and inbound delivery.
   * @param memories - Enterprise memory plane behind the governance routes.
   * @param security - Existing enterprise authentication and authorization seam.
   */
  constructor(
    private readonly accounts: EmployeeAccounts,
    private readonly surfaces: EnterpriseSurfaces,
    private readonly memories: EmployeeMemoryStore,
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
    if (segments.length === 2 && segments[1] === 'memories') {
      return request.method === 'GET'
        ? this.listMemories(principal, employeeId(head), new URL(request.url))
        : methodFailure('GET')
    }
    if (segments.length === 4 && segments[1] === 'memories'
      && (segments[3] === 'review' || segments[3] === 'retire')) {
      if (request.method !== 'POST') return methodFailure('POST')
      const memoryId = segments[2] as string
      return segments[3] === 'review'
        ? this.reviewMemory(request, principal, employeeId(head), memoryId)
        : this.retireMemory(request, principal, employeeId(head), memoryId)
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

  /**
   * List one employee's memory view: the employee's own agent-compartment rows
   * in every status, plus the organization-wide shared promotion queue (shared
   * rows with the proposed status). Shared proposals carry no employee
   * attribution — `createdBy` holds the proposing session's user id, never an
   * employee id — so the queue cannot be scoped to one employee in P1; it is
   * the same queue every memory manager sees.
   */
  private async listMemories(
    principal: EnterprisePrincipal,
    id: EmployeeId,
    url: URL,
  ): Promise<Response> {
    const decision = await this.guard(principal, 'memory.read', 'enterpriseEmployeeMemory.list', id, {})
    if (!decision.allowed) return failure(403, 'forbidden')
    const account = this.requireOwnEmployee(principal, id)
    if (account === undefined) return failure(404, 'employee-not-found')
    const status = url.searchParams.get('status')
    if (status !== null && !MEMORY_STATUSES.includes(status as EnterpriseMemoryEntry['status'])) {
      return failure(400, 'invalid-status')
    }
    const statuses = status === null ? undefined : [status as EnterpriseMemoryEntry['status']]
    // Shared proposed rows join the view only while the filter keeps the queue visible.
    const sharedProposed = status === null || status === 'proposed'
      ? await this.memories.listMemories({
        orgId: principal.orgId, scopes: ['organization', 'department'], statuses: ['proposed'],
      })
      : []
    const agentRows = await this.memories.listMemories({
      orgId: principal.orgId, scopes: ['agent'], agentEmployeeId: id,
      ...(statuses === undefined ? {} : { statuses }),
    })
    const entries = [...agentRows, ...sharedProposed]
      .toSorted((left, right) => right.createdAt - left.createdAt || (left.id < right.id ? -1 : 1))
    return Response.json(entries.map(presentMemory))
  }

  /** Approve or reject one proposed memory with the revision pin the client last saw. */
  private async reviewMemory(
    request: Request,
    principal: EnterprisePrincipal,
    id: EmployeeId,
    memoryId: string,
  ): Promise<Response> {
    const decision = await this.guard(
      principal, 'memory.manage', 'enterpriseEmployeeMemory.review', memoryId, { employeeId: id, memoryId },
    )
    if (!decision.allowed) return failure(403, 'forbidden')
    const account = this.requireOwnEmployee(principal, id)
    if (account === undefined) return failure(404, 'employee-not-found')
    const body = await jsonObjectBody(request)
    const review = body?.['decision']
    const reason = body === undefined ? undefined : stringField(body, 'reason')
    const revision = body?.['revision']
    if ((review !== 'approved' && review !== 'rejected') || reason === undefined
      || typeof revision !== 'number' || !Number.isSafeInteger(revision)) {
      return failure(400, 'invalid-payload')
    }
    try {
      const reviewed = await this.memories.reviewMemory({
        id: memoryId, orgId: principal.orgId, decision: review,
        reviewedBy: principal.userId, reason, expectedRevision: revision,
      })
      return Response.json(presentMemory(reviewed))
    } catch (error: unknown) {
      return this.memoryFailure(error)
    }
  }

  /**
   * Retire one approved memory. The body may pin `{revision}`; without a pin
   * the current entry is resolved from the same compartments the list route
   * shows, and the store's compare-and-swap still owns the transition.
   */
  private async retireMemory(
    request: Request,
    principal: EnterprisePrincipal,
    id: EmployeeId,
    memoryId: string,
  ): Promise<Response> {
    const decision = await this.guard(
      principal, 'memory.manage', 'enterpriseEmployeeMemory.retire', memoryId, { employeeId: id, memoryId },
    )
    if (!decision.allowed) return failure(403, 'forbidden')
    const account = this.requireOwnEmployee(principal, id)
    if (account === undefined) return failure(404, 'employee-not-found')
    const body = await jsonObjectBody(request)
    const pinned = body?.['revision']
    if (body !== undefined && (typeof pinned !== 'number' || !Number.isSafeInteger(pinned))) {
      return failure(400, 'invalid-payload')
    }
    let expectedRevision = typeof pinned === 'number' ? pinned : undefined
    if (expectedRevision === undefined) {
      const current = await this.findVisibleMemory(principal.orgId, id, memoryId)
      if (current === undefined) return failure(404, 'memory-not-found')
      expectedRevision = current.revision
    }
    try {
      const retired = await this.memories.reviewMemory({
        id: memoryId, orgId: principal.orgId, decision: 'retired',
        reviewedBy: principal.userId, reason: 'retired by administrator', expectedRevision,
      })
      return Response.json(presentMemory(retired))
    } catch (error: unknown) {
      return this.memoryFailure(error)
    }
  }

  /** Read one memory entry from the compartments this employee's view shows, or `undefined`. */
  private async findVisibleMemory(
    orgId: string,
    id: EmployeeId,
    memoryId: string,
  ): Promise<EnterpriseMemoryEntry | undefined> {
    const [agentRows, sharedRows] = await Promise.all([
      this.memories.listMemories({ orgId, scopes: ['agent'], agentEmployeeId: id }),
      this.memories.listMemories({ orgId, scopes: ['organization', 'department'] }),
    ])
    return [...agentRows, ...sharedRows].find(entry => entry.id === memoryId)
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
   * Map one memory-store failure to its transport status without exposing internals.
   * The store reports failures as plain `Error`s, so the message text is the only
   * transition discriminator; unrecognized failures stay internal.
   */
  private memoryFailure(error: unknown): Response {
    const message = error instanceof Error ? error.message : undefined
    if (message === MEMORY_NOT_FOUND_MESSAGE) return failure(404, 'memory-not-found')
    if (message !== undefined && MEMORY_CONFLICT_MESSAGES.some(prefix => message.startsWith(prefix))) {
      return failure(409, 'memory-conflict')
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
