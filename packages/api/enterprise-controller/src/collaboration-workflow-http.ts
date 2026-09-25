/** Authenticated, member-scoped channel workflow definitions. */
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type { PostgresChannelWorkflowLedger } from '@deepseek-ai/dsh-enterprise-postgres'
import type { EmployeeHttpSecurity } from './employee-http.ts'
import { CollaborationError, type CollaborationService } from './collaboration-service.ts'
import { authenticatedSegments, failure, guardResource, jsonObjectBody, stringField } from './http.ts'
import { parseChannelWorkflow } from './collaboration-workflows.ts'

const WORKFLOW_ID = /^[a-z][a-z0-9-]{0,79}$/u
const CHANNEL_ID = /^[A-Za-z0-9-]{1,128}$/u
const APPROVAL_ID = /^[A-Za-z0-9-]{1,128}$/u

/** Host services used to authorize and persist channel YAML. */
export interface ChannelWorkflowHttpDependencies {
  readonly security: EmployeeHttpSecurity
  readonly detail: Pick<CollaborationService, 'detail'>['detail']
  readonly ledger: (orgId: string) => Pick<PostgresChannelWorkflowLedger, 'list' | 'save' | 'pendingDecisions'>
  readonly resolveDecision: (principal: EnterprisePrincipal, channelId: string, decisionId: string,
    input: { readonly approved: boolean
      readonly expectedRevision: number
      readonly idempotencyKey: string }) => Promise<{ readonly state: string }>
}

/** Read and write bounded YAML definitions for authorized channel members. */
export class ChannelWorkflowHttpHandler {
  /** @param deps - Shared authorization and versioned PostgreSQL workflow store. */
  constructor(private readonly deps: ChannelWorkflowHttpDependencies) {}

  /** Handle one authenticated channel workflow request.
   * @param request - Request under /enterprise/channel-workflows.
   * @returns Current definitions, saved revision, or an explicit failure.
   */
  async fetch(request: Request): Promise<Response> {
    const auth = await authenticatedSegments(this.deps.security, request)
    if (auth instanceof Response) return auth
    const { principal, segments } = auth
    const [channelId, workflowId, extra] = segments
    const decisionPath = request.method === 'POST' && workflowId === 'decisions' && extra !== undefined
      && segments.length === 3
    const decisionList = request.method === 'GET' && workflowId === 'decisions' && extra === undefined
    if (channelId === undefined || !CHANNEL_ID.test(channelId)
      || (decisionPath ? !APPROVAL_ID.test(extra) : extra !== undefined || workflowId !== undefined && !WORKFLOW_ID.test(workflowId))) {
      return failure(404, 'not-found')
    }
    if (request.method !== 'GET' && request.method !== 'PUT' && !decisionPath) return failure(405, 'method-not-allowed')
    if (request.method === 'GET' && workflowId !== undefined && !decisionList
      || request.method === 'PUT' && workflowId === undefined) {
      return failure(404, 'not-found')
    }
    const decision = await guardResource(this.deps.security, principal,
      request.method === 'PUT' ? 'employee.create' : 'channel.read',
      'enterpriseChannelWorkflow.configuration', 'enterprise-surface', channelId)
    if (!decision.allowed) return failure(403, 'forbidden')
    const detail = await this.visibleChannel(principal, channelId)
    if (detail instanceof Response) return detail
    if (decisionPath) {
      const body = await jsonObjectBody(request)
      const approved = body?.['approved'], expectedRevision = body?.['expectedRevision']
      const idempotencyKey = body === undefined ? undefined : stringField(body, 'idempotencyKey')
      if (typeof approved !== 'boolean' || typeof expectedRevision !== 'number'
        || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1
        || idempotencyKey === undefined || idempotencyKey.length > 256) return failure(400, 'invalid-body')
      try {
        return Response.json(await this.deps.resolveDecision(principal, channelId, extra, {
          approved, expectedRevision, idempotencyKey,
        }))
      } catch (error) {
        if (error instanceof CollaborationError) return failure(error.status, error.code)
        throw error
      }
    }
    const ledger = this.deps.ledger(principal.orgId)
    if (decisionList) {
      const allowed = await this.deps.security.authorizeResourceAsync(principal, 'approval.manage',
        { orgId: principal.orgId, visibility: 'organization' })
      const items = (await ledger.pendingDecisions(channelId)).map((value) => {
        const workflow = parseChannelWorkflow(value.yaml)
        const step = workflow.steps[value.nextStep - 1]
        if (step?.type !== 'approval_request') throw new Error('invalid stored workflow decision step')
        return { approvalId: value.approvalId, summary: step.summary, state: value.state,
          revision: value.revision, requestedBy: value.requestedBy, createdAt: value.createdAt }
      })
      return Response.json({ items, canDecide: allowed.allowed })
    }
    if (request.method === 'GET') {
      const manage = await this.deps.security.authorizeResourceAsync(principal, 'employee.create',
        { orgId: principal.orgId, visibility: 'organization' })
      return Response.json({ items: await ledger.list(channelId), canManage: manage.allowed })
    }
    const body = await jsonObjectBody(request)
    if (body === undefined) return failure(400, 'invalid-body')
    const yaml = stringField(body, 'yaml')
    const expectedRevision = body['expectedRevision']
    if (yaml === undefined || typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision)
      || expectedRevision < 0) return failure(400, 'invalid-body')
    if (workflowId === undefined) return failure(404, 'not-found')
    let workflow: ReturnType<typeof parseChannelWorkflow>
    try { workflow = parseChannelWorkflow(yaml) } catch { return failure(400, 'invalid-workflow') }
    const schedules = workflow.on.flatMap((trigger, triggerIndex) => {
      if (trigger.type !== 'schedule') return []
      const nextDueAt = trigger.at !== undefined ? Date.parse(trigger.at)
        : trigger.everySeconds !== undefined ? Date.now() + trigger.everySeconds * 1000 : Number.NaN
      if (!Number.isSafeInteger(nextDueAt)) throw new Error('invalid workflow schedule time')
      return [{ triggerIndex, scheduleId: trigger.scheduleId, nextDueAt,
        ...(trigger.everySeconds === undefined ? {} : { intervalSeconds: trigger.everySeconds }) }]
    })
    try {
      return Response.json(await ledger.save({ channelId, id: workflowId, yaml,
        expectedRevision, createdBy: principal.userId,
        ...(schedules.length === 0 ? {} : { schedules }) }))
    } catch (error) {
      if (error instanceof Error && error.message.includes('revision conflict')) return failure(409, 'revision-conflict')
      throw error
    }
  }

  private async visibleChannel(principal: EnterprisePrincipal, id: string): Promise<true | Response> {
    try {
      const detail = await this.deps.detail(principal, id)
      return detail.kind === 'channel' ? true : failure(404, 'not-found')
    } catch (error) {
      if (error instanceof CollaborationError) return failure(error.status, error.code)
      throw error
    }
  }
}
