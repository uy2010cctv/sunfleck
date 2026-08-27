import { randomBytes, randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createEnterprisePostgresComposition } from '@deepseek-ai/dsh-enterprise-postgres'
import { EnterpriseSecurity } from '@deepseek-ai/dsh-enterprise-auth-web'
import { createApiProxy } from '../src/api-proxy.ts'
import { InProcessApiClient } from '../src/fetch/client.ts'
import { toFetchHandler } from '../src/fetch/handler.ts'

const databaseUrl = process.env.DSH_TEST_POSTGRES_URL
const closes: (() => Promise<void>)[] = []
afterEach(async () => { await Promise.all(closes.splice(0).map(close => close())) })

describe.skipIf(databaseUrl === undefined)('enterprise ApiProxy with PostgreSQL', () => {
  it('carries all enterprise domains through the wire with RBAC, replay, and events', { timeout: 60_000 }, async () => {
    const composition = await createEnterprisePostgresComposition({
      connectionString: databaseUrl!, cursorSigningKey: randomBytes(32),
    })
    closes.push(composition.close)
    const suffix = randomUUID()
    const orgId = `api-org-${suffix}`
    const adminId = `api-admin-${suffix}`
    const memberId = `api-member-${suffix}`
    await composition.identity.createOrganization({ id: orgId, name: orgId })
    await composition.identity.createUser({ id: adminId, orgId, username: adminId, displayName: adminId, disabled: false })
    await composition.identity.createUser({ id: memberId, orgId, username: memberId, displayName: memberId, disabled: false })
    await composition.identity.setRoles(adminId, ['administrator'])
    await composition.identity.setRoles(memberId, ['member'])
    let principal = { userId: adminId, orgId, roles: ['administrator'] as readonly ('administrator' | 'member')[] }
    const security = new EnterpriseSecurity(composition.identity, {
      organizationId: orgId, sessionCookieName: 'test', sessionTtlMs: 60_000,
      secureCookies: false, autoProvisionSsoUsers: false,
    }, {
      resourcePolicyResolver: async (resourceType, resourceId, current) => {
        if (resourceType !== 'employee') return undefined
        const draft = await composition.catalog.getDraft(resourceId, current.orgId)
        return draft === undefined ? null : {
          orgId: draft.orgId, creatorUserId: draft.ownerUserId, visibility: draft.visibility,
        }
      },
    })
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(AgentRegistry)
    ctx.provide('enterprisePostgres' as never, composition as never)
    ctx.provide('enterpriseRequestContext' as never, {
      requirePrincipal: () => principal, current: () => principal,
    } as never)
    ctx.provide('enterpriseSecurity' as never, security as never)
    const events: unknown[] = []
    ctx.on('enterprise/employee-updated', (event) => { events.push(event) })
    const client = new InProcessApiClient(toFetchHandler(createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp',
    })))
    const presetId = `preset-${suffix}`
    const employeePayload = {
      presetId, expectedRevision: 0, idempotencyKey: `employee-${suffix}`,
      visibility: 'private' as const, profile: {}, bindings: [],
    }
    const draft = await client.enterpriseEmployees.saveDraft(employeePayload)
    if (!draft.result.ok) throw new Error(`employee draft save failed: ${draft.result.error.code}`)
    await client.enterpriseEmployees.saveDraft(employeePayload)
    expect(draft.result).toMatchObject({ ok: true, value: { presetId, ownerUserId: adminId } })
    expect((await client.enterpriseEmployees.list({})).result)
      .toMatchObject({ ok: true, value: { items: [{ presetId }] } })
    expect(events).toHaveLength(1)
    const releaseResponse = await client.enterpriseEmployees.publish({
      presetId, expectedRevision: 1, idempotencyKey: `publish-${suffix}`,
    })
    if (!releaseResponse.result.ok) throw new Error('employee publish failed')
    const releaseId = releaseResponse.result.value.releaseId

    const assetId = `asset-${suffix}`
    expect((await client.enterpriseAssets.saveVersion({
      assetId, kind: 'sop', name: 'SOP', content: {}, expectedRevision: 0, idempotencyKey: `asset-${suffix}`,
    })).result.ok).toBe(true)
    expect((await client.enterpriseAssets.get({ assetId })).result)
      .toMatchObject({ ok: true, value: { assetId } })

    const teamId = `team-${suffix}`
    expect((await client.enterpriseTeams.save({
      teamId, leaderEmployeeReleaseId: releaseId, members: [], workflowTemplate: {}, approvalPolicy: {},
      expectedRevision: 0, idempotencyKey: `team-${suffix}`,
    })).result.ok).toBe(true)
    expect((await client.enterpriseTeams.list({})).result)
      .toMatchObject({ ok: true, value: { items: [{ teamId }] } })

    const approvalId = `approval-${suffix}`
    expect((await client.enterpriseOperations.createApproval({
      approvalId, kind: 'business', subjectType: 'test', subjectId: suffix,
      expectedRevision: 0, idempotencyKey: `approval-${suffix}`,
    })).result.ok).toBe(true)
    expect((await client.enterpriseOperations.listApprovals({})).result)
      .toMatchObject({ ok: true, value: { items: [{ approvalId }] } })

    principal = { userId: memberId, orgId, roles: ['member'] }
    expect((await client.enterpriseAssets.archive({
      assetId, expectedRevision: 1, idempotencyKey: `forbidden-${suffix}`,
    })).result).toMatchObject({ ok: false, error: { code: 'enterprise-forbidden' } })
  })
})
