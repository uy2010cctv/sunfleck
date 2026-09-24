import { authorizeEnterprise } from '@deepseek-ai/dsh-enterprise-governance'
import type {
  EnterpriseAction, EnterpriseAuthorizationDecision, EnterprisePrincipal, EnterpriseResource, EnterpriseRole,
} from '@deepseek-ai/dsh-enterprise-governance'
import {
  ConsolidationRunningError, type ConsolidationCompartment, type ConsolidationReport,
  type MemoryConsolidationRuntime,
} from '@deepseek-ai/dsh-enterprise-memory-context'
import { describe, expect, it } from 'vitest'
import { serveConsolidation } from '../src/consolidation-http.ts'
import type { EmployeeHttpSecurity } from '../src/employee-http.ts'

/** Authentication and authorization seam double that delegates to the real shared policy. */
class RecordingSecurity implements EmployeeHttpSecurity {
  readonly audited: Array<{
    endpoint: string
    decision: EnterpriseAuthorizationDecision
    resource: { type: string; id: string }
  }> = []

  constructor(readonly principal: EnterprisePrincipal | undefined) {}

  async authenticateCookieAsync(cookieHeader: string): Promise<EnterprisePrincipal | undefined> {
    return this.principal === undefined || cookieHeader === '' ? undefined : this.principal
  }

  async authorizeResourceAsync(
    principal: EnterprisePrincipal,
    action: EnterpriseAction,
    resource?: EnterpriseResource,
  ): Promise<EnterpriseAuthorizationDecision> {
    return authorizeEnterprise({ principal, action, ...(resource === undefined ? {} : { resource }) })
  }

  async auditApiResourceAsync(
    _principal: EnterprisePrincipal,
    endpoint: string,
    _input: unknown,
    decision: EnterpriseAuthorizationDecision,
    _correlationId: string,
    resource: { type: string; id: string },
  ): Promise<void> {
    this.audited.push({ endpoint, decision, resource })
  }
}

function principalOf(roles: EnterpriseRole[] = ['administrator']): EnterprisePrincipal {
  return { orgId: 'org-1', userId: 'user-1', roles }
}

/** A captured-compartment fake of the runtime with one canned report. */
function fakeRuntime(
  behavior: {
    compartments?: ConsolidationCompartment[]
    failure?: (orgId: string, compartment: ConsolidationCompartment) => Error
  } = {},
): MemoryConsolidationRuntime {
  const report: ConsolidationReport = {
    orgId: 'org-1',
    compartment: { kind: 'shared', scope: 'organization' },
    superseded: 2, retired: 1, importanceUpdates: 5, digest: 'written',
    reflections: { proposed: 1, droppedPrivacy: 1, failed: 0 },
    at: 1_700_000_000_000,
  }
  return {
    runCompartment: async (orgId: string, compartment: ConsolidationCompartment) => {
      behavior.compartments?.push(compartment)
      if (behavior.failure !== undefined) throw behavior.failure(orgId, compartment)
      return { ...report, compartment }
    },
  } as unknown as MemoryConsolidationRuntime
}

/** Send one request to the consolidation routes. */
async function call(
  runtime: MemoryConsolidationRuntime | undefined,
  security: EmployeeHttpSecurity,
  body?: unknown,
  cookie = 'dsh_enterprise_session=ticket',
): Promise<Response> {
  return serveConsolidation(runtime, security, new Request('http://dsh/enterprise/consolidation/run', {
    method: 'POST',
    headers: {
      ...(cookie === '' ? {} : { cookie }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }))
}

describe('consolidation trigger endpoint', () => {
  it('fails loud with a 503 while the consolidation plane is unmounted', async () => {
    const response = await call(undefined, new RecordingSecurity(principalOf()), { orgId: 'org-1' })
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'consolidation-plane-unavailable' })
  })

  it('rejects unauthenticated requests with a 401', async () => {
    const unauthenticated = new RecordingSecurity(undefined)
    await expect(call(fakeRuntime(), unauthenticated, { orgId: 'org-1' }, '')).resolves.toMatchObject({ status: 401 })
    await expect(call(fakeRuntime(), unauthenticated, { orgId: 'org-1' })).resolves.toMatchObject({ status: 401 })
  })

  it('denies non-administrators and cross-organization triggers with a 403', async () => {
    const security = new RecordingSecurity(principalOf(['member']))
    const response = await call(fakeRuntime(), security, { orgId: 'org-1' })
    expect(response.status).toBe(403)
    expect(security.audited).toEqual([{
      endpoint: 'enterpriseConsolidation.run',
      decision: { allowed: false, reason: 'insufficient-role' },
      resource: { type: 'enterprise-memory-consolidation', id: 'org-1' },
    }])

    const foreign = await call(fakeRuntime(), new RecordingSecurity(principalOf()), { orgId: 'org-2' })
    expect(foreign.status).toBe(403)
    const body = (await foreign.json()) as { error: string }
    expect(body.error).toBe('forbidden')
  })

  it('rejects an invalid body or compartment with a 400', async () => {
    const security = new RecordingSecurity(principalOf())
    for (const body of [
      undefined,
      {},
      { orgId: 'org-1', compartment: { kind: 'shared', scope: 'pair' } },
      { orgId: 'org-1', compartment: { kind: 'shared', scope: 'department' } },
      { orgId: 'org-1', compartment: { kind: 'shared', scope: 'organization', departmentId: 'd1' } },
      { orgId: 'org-1', compartment: { kind: 'project' } },
      { orgId: 'org-1', compartment: 'organization' },
    ]) {
      await expect(call(fakeRuntime(), security, body)).resolves.toMatchObject({ status: 400 })
    }
  })

  it('runs the requested compartment and returns the report', async () => {
    const security = new RecordingSecurity(principalOf())
    const compartments: ConsolidationCompartment[] = []
    const response = await call(fakeRuntime({ compartments }), security, {
      orgId: 'org-1',
      compartment: { kind: 'shared', scope: 'department', departmentId: 'dept-ops' },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      orgId: 'org-1',
      compartment: { kind: 'shared', scope: 'department', departmentId: 'dept-ops' },
      superseded: 2, retired: 1, importanceUpdates: 5, digest: 'written',
      reflections: { proposed: 1, droppedPrivacy: 1, failed: 0 },
      at: 1_700_000_000_000,
    })
    expect(compartments).toEqual([{ kind: 'shared', scope: 'department', departmentId: 'dept-ops' }])
    expect(security.audited[0]).toMatchObject({
      endpoint: 'enterpriseConsolidation.run',
      decision: { allowed: true, reason: 'administrator' },
    })

    // Omitting the compartment runs the shared organization compartment.
    await expect(call(fakeRuntime(), security, { orgId: 'org-1' })).resolves.toMatchObject({ status: 200 })
  })

  it('answers 409 while the compartment already has a run in flight', async () => {
    const security = new RecordingSecurity(principalOf())
    const response = await call(fakeRuntime({
      failure: () => new ConsolidationRunningError('org-1:organization'),
    }), security, { orgId: 'org-1' })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'consolidation-running' })
  })

  it('folds other run failures to a 500 without exposing internals', async () => {
    const security = new RecordingSecurity(principalOf())
    const response = await call(fakeRuntime({
      failure: () => new Error('enterprise memory consolidation actor is unavailable or disabled in org-1'),
    }), security, { orgId: 'org-1' })
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'internal-error' })
  })
})
