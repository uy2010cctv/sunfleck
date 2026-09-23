/**
 * Authenticated manual memory-consolidation endpoint for the enterprise Web
 * console, mounted by the enterprise controller under the
 * `/enterprise/consolidation` prefix. The route sits behind the existing
 * enterprise cookie authentication and the shared authorization policy; this
 * module adds no authentication mechanism of its own.
 *
 * Routes:
 * - `POST /consolidation/run` runs one consolidation pass now. The body names
 *   `{orgId}` and optionally one `compartment`; omitting the compartment runs
 *   the shared organization compartment only, which carries the structure,
 *   digest, and reflection passes. A named compartment is
 *   `{kind:"shared", scope:"organization"}`,
 *   `{kind:"shared", scope:"department", departmentId}`, or
 *   `{kind:"project", projectId}`. The response is the run's `ConsolidationReport`.
 *
 * Authorization reuses the existing `memory.manage` `EnterpriseAction`. The guard presents the
 * resource organization-visible and scope-free, so under the shared policy the action is
 * effectively administrator-gated — plain role holders fall through to `insufficient-role`,
 * and the union's department-manager delegation never applies on this route. A body
 * `orgId` outside the caller's organization answers 403 like any other
 * cross-organization denial. Audit endpoint name is
 * `enterpriseConsolidation.run`.
 *
 * Status mapping: 401 unauthenticated, 403 denied by the shared policy or
 * cross-organization `orgId`, 400 invalid body, 409 a consolidation run is
 * already in flight for the compartment, 503 the memory-consolidation plane
 * is unmounted, 500 other failures.
 *
 * @module @deepseek-ai/dsh-api-enterprise-controller/consolidation-http
 */

import {
  ConsolidationRunningError, type ConsolidationCompartment, type MemoryConsolidationRuntime,
} from '@deepseek-ai/dsh-enterprise-memory-context'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type { EmployeeHttpSecurity } from './employee-http.ts'
import { cookiePrincipal, failure, guardResource, jsonObjectBody, methodFailure, stringField } from './http.ts'

/** Cordis service keys the consolidation trigger endpoint requires. */
export const inject: readonly string[] = ['memoryConsolidation']

/** Parse one request compartment value: `undefined` when absent (the default organization run),
 * the parsed compartment, or `null` when present but invalid. */
function parseCompartment(value: unknown): ConsolidationCompartment | undefined | null {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (item['kind'] === 'project') {
    const projectId = item['projectId']
    return typeof projectId === 'string' && projectId.trim() !== ''
      ? { kind: 'project', projectId }
      : null
  }
  if (item['kind'] === 'shared') {
    if (item['scope'] === 'organization') {
      return item['departmentId'] === undefined ? { kind: 'shared', scope: 'organization' } : null
    }
    if (item['scope'] === 'department') {
      const departmentId = item['departmentId']
      return typeof departmentId === 'string' && departmentId.trim() !== ''
        ? { kind: 'shared', scope: 'department', departmentId }
        : null
    }
  }
  return null
}

/** Serve one consolidation request; an absent runtime answers the fail-loud 503 so a
 * composition without the memory-context plugin keeps every route loud. */
export async function serveConsolidation(
  consolidation: MemoryConsolidationRuntime | undefined,
  security: EmployeeHttpSecurity,
  request: Request,
): Promise<Response> {
  if (consolidation === undefined) return failure(503, 'consolidation-plane-unavailable')
  return new ConsolidationHttpHandler(consolidation, security).fetch(request)
}

/** Memory-consolidation trigger HTTP boundary owned by the enterprise controller. */
export class ConsolidationHttpHandler {
  /**
   * @param consolidation - the mounted memory-consolidation runtime.
   * @param security - Existing enterprise authentication and authorization seam.
   */
  constructor(
    private readonly consolidation: MemoryConsolidationRuntime,
    private readonly security: EmployeeHttpSecurity,
  ) {}

  /** Authenticate, authorize, and dispatch one consolidation request. */
  async fetch(request: Request): Promise<Response> {
    const principal = await cookiePrincipal(this.security, request)
    if (principal instanceof Response) return principal
    const segments = new URL(request.url).pathname.split('/').filter(Boolean).slice(2)
    if (segments.length === 1 && segments[0] === 'run') {
      return request.method === 'POST' ? this.run(request, principal) : methodFailure('POST')
    }
    return failure(404, 'not-found')
  }

  /** Run one consolidation pass and return its report; an in-flight run answers 409. */
  private async run(request: Request, principal: EnterprisePrincipal): Promise<Response> {
    const body = await jsonObjectBody(request)
    if (body === undefined) return failure(400, 'invalid-payload')
    const orgId = stringField(body, 'orgId')
    if (orgId === undefined) return failure(400, 'invalid-payload')
    const compartment = parseCompartment(body['compartment'])
    if (compartment === null) return failure(400, 'invalid-payload')
    const decision = await guardResource(
      this.security, principal, 'memory.manage', 'enterpriseConsolidation.run',
      'enterprise-memory-consolidation', orgId,
    )
    if (!decision.allowed) return failure(403, 'forbidden')
    if (orgId !== principal.orgId) return failure(403, 'forbidden')
    try {
      const report = await this.consolidation.runCompartment(
        orgId, compartment ?? { kind: 'shared', scope: 'organization' },
      )
      return Response.json(report)
    } catch (error: unknown) {
      if (error instanceof ConsolidationRunningError) return failure(409, 'consolidation-running')
      return failure(500, 'internal-error')
    }
  }
}
