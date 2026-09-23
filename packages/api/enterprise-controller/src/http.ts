/**
 * Helpers shared by the enterprise controller's HTTP boundaries: bounded JSON
 * request bodies, transport failure responses, the cookie authentication
 * preamble, constant-time deployment-token comparison, and the shared
 * authorize-and-audit resource guard.
 *
 * @module @deepseek-ai/dsh-api-enterprise-controller/http
 */

import { randomUUID, timingSafeEqual } from 'node:crypto'
import type {
  EnterpriseAction, EnterpriseAuthorizationDecision, EnterprisePrincipal, EnterpriseResource,
} from '@deepseek-ai/dsh-enterprise-governance'
import type { EmployeeHttpSecurity } from './employee-http.ts'

/** Build one JSON failure response carrying the machine-readable error code. */
export function failure(status: number, code: string): Response {
  return Response.json({ error: code }, { status })
}

/** Reject one unsupported method while advertising the methods the route accepts. */
export function methodFailure(allow: string): Response {
  return Response.json({ error: 'method-not-allowed' }, { status: 405, headers: { allow } })
}

/** Authenticate one cookie-carried request; a `Response` result is the shared 401 failure. */
export async function cookiePrincipal(
  security: EmployeeHttpSecurity,
  request: Request,
): Promise<EnterprisePrincipal | Response> {
  const principal = await security.authenticateCookieAsync(request.headers.get('cookie') ?? '')
  return principal === undefined ? failure(401, 'unauthenticated') : principal
}

/** Compare one supplied bearer token against the deployment token without early-exit timing. */
export function timingSafeTokenMatches(supplied: string | null, expected: string | undefined): boolean {
  if (supplied === null || expected === undefined || expected === '') return false
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Read one non-empty trimmed string field from a parsed request body. */
export function stringField(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

/** Read one non-empty string-array field from a parsed request body. */
export function stringArrayField(body: Record<string, unknown>, field: string): readonly string[] | undefined {
  const value = body[field]
  if (!Array.isArray(value)) return undefined
  const items: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item.trim() === '') return undefined
    items.push(item)
  }
  return items
}

/**
 * Read one optional string field from a parsed request body: `undefined` when
 * the field is absent, `null` when it is present but not a non-empty string.
 */
export function optionalStringField(body: Record<string, unknown>, field: string): string | null | undefined {
  if (body[field] === undefined) return undefined
  return stringField(body, field) ?? null
}

/**
 * Read one optional string-array field from a parsed request body: `undefined`
 * when the field is absent, `null` when it is present but not a string array
 * of non-empty entries.
 */
export function optionalStringArrayField(
  body: Record<string, unknown>,
  field: string,
): readonly string[] | null | undefined {
  if (body[field] === undefined) return undefined
  return stringArrayField(body, field) ?? null
}

/** Parse one JSON object request body; `undefined` for absent, malformed, or non-object bodies. */
export async function jsonObjectBody(request: Request): Promise<Record<string, unknown> | undefined> {
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

/** Authorize one enterprise operation through the shared policy and audit the decision.
 *
 * Actions reuse the existing `EnterpriseAction` values — the union has no member per HTTP
 * plane; the handler module JSDoc records the reuse choice per plane. `input` mirrors the
 * security seam's audit signature; today it carries nothing beyond what `resourceId` already
 * holds.
 */
export async function guardResource(
  security: EmployeeHttpSecurity,
  principal: EnterprisePrincipal,
  action: EnterpriseAction,
  endpoint: string,
  resourceType: string,
  resourceId: string,
): Promise<EnterpriseAuthorizationDecision> {
  const resource: EnterpriseResource = { orgId: principal.orgId, visibility: 'organization' }
  const decision = await security.authorizeResourceAsync(principal, action, resource)
  await security.auditApiResourceAsync(
    principal, endpoint, { id: resourceId }, decision, randomUUID(), { type: resourceType, id: resourceId },
  )
  return decision
}
