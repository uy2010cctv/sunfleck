/** Cookie-authenticated collaboration endpoints; all native Session ids remain member- and workspace-scoped. */
import type { EmployeeHttpSecurity } from './employee-http.ts'
import { CollaborationError, type CollaborationService } from './collaboration-service.ts'
import { authenticatedSegments, failure, guardResource, jsonObjectBody, optionalStringArrayField, optionalStringField,
  stringArrayField, stringField } from './http.ts'
export type { CollaborationDetail, CollaborationOpenResult, CollaborationDelivery } from './collaboration-service.ts'

/** HTTP transport for the PostgreSQL collaboration service. */
export class CollaborationHttpHandler {
  /** @param service - Conversation coordinator. @param security - Shared cookie and policy services. */
  constructor(private readonly service: CollaborationService, private readonly security: EmployeeHttpSecurity) {}

  /** Serve an authenticated conversation request.
   * @param request - Request under /enterprise/surfaces.
   * @returns Governance data, durable routing receipt, or explicit failure.
   */
  async fetch(request: Request): Promise<Response> {
    const auth = await authenticatedSegments(this.security, request)
    if (auth instanceof Response) return auth
    const { principal, segments } = auth
    const [id, operation, target] = segments
    const create = request.method === 'POST' && (id === 'groups' || id === 'channels') && segments.length === 1
    const decision = await guardResource(this.security, principal,
      request.method === 'GET' ? 'channel.read' : create ? 'employee.create' : 'employee.execute',
      `enterpriseCollaboration.${operation ?? 'list'}`, 'enterprise-surface', id ?? 'catalog')
    if (!decision.allowed) return failure(403, 'forbidden')
    try {
      if (request.method === 'GET') {
        if (id === undefined) {
          const kind = new URL(request.url).searchParams.get('kind')
          if (kind !== null && kind !== 'group' && kind !== 'channel' && kind !== 'dm') return failure(400, 'invalid-kind')
          const rows = await this.service.list(principal)
          return Response.json(kind === null ? rows : rows.filter(row => row.kind === kind))
        }
        if (id === 'by-session' && operation !== undefined && target === undefined) {
          const value = await this.service.bySession(principal, operation)
          return value === undefined ? failure(404, 'not-found') : Response.json(value)
        }
        if (operation === undefined) return Response.json(await this.service.detail(principal, id))
        return failure(404, 'not-found')
      }
      if (request.method !== 'POST') return failure(405, 'method-not-allowed')
      const body = await jsonObjectBody(request)
      if (body === undefined) return failure(400, 'invalid-body')
      if (body['attachments'] !== undefined || body['content'] !== undefined) return failure(400, 'text-only-collaboration')
      if (create) {
        const name = stringField(body, 'name'), workspaceId = stringField(body, 'workspaceId')
        const idempotencyKey = optionalStringField(body, 'idempotencyKey')
        if (idempotencyKey === null) return failure(400, 'invalid-idempotency-key')
        const memberEmployeeIds = stringArrayField(body, 'memberEmployeeIds'), memberUserIds = stringArrayField(body, 'memberUserIds')
        const dutyEmployeeIds = optionalStringArrayField(body, 'dutyEmployeeIds')
        const teamDefinitionId = optionalStringField(body, 'teamDefinitionId'), projectId = optionalStringField(body, 'projectId')
        if (name === undefined || workspaceId === undefined || memberEmployeeIds === undefined || memberUserIds === undefined || dutyEmployeeIds === null || teamDefinitionId === null || projectId === null) return failure(400, 'invalid-body')
        const topicPolicy = body['topicPolicy'], respondPolicy = body['respondPolicy']
        if (id === 'channels' && teamDefinitionId !== undefined) return failure(400, 'channel-team-not-supported')
        if (id === 'groups' && (topicPolicy !== undefined || respondPolicy !== undefined || (dutyEmployeeIds?.length ?? 0) > 0)) {
          return failure(400, 'group-channel-policy')
        }
        if (id === 'channels' && ((topicPolicy !== 'thread' && topicPolicy !== 'command' && topicPolicy !== 'lane') || (respondPolicy !== 'mention_duty' && respondPolicy !== 'ingest_only'))) return failure(400, 'invalid-policy')
        return Response.json(await this.service.create(principal, {
          kind: id === 'groups' ? 'group' : 'channel', name, workspaceId, memberEmployeeIds, memberUserIds,
          ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
          dutyEmployeeIds: dutyEmployeeIds ?? [],
          ...(teamDefinitionId === undefined ? {} : { teamDefinitionId }), ...(projectId === undefined ? {} : { projectId }),
          ...(topicPolicy === 'thread' || topicPolicy === 'command' || topicPolicy === 'lane' ? { topicPolicy } : {}),
          ...(respondPolicy === 'mention_duty' || respondPolicy === 'ingest_only' ? { respondPolicy } : {}),
        }), { status: 201 })
      }
      if (id === undefined || target !== undefined) return failure(404, 'not-found')
      const topicId = optionalStringField(body, 'topicId')
      if (topicId === null) return failure(400, 'invalid-topic')
      if (operation === 'open') {
        const employeeId = optionalStringField(body, 'employeeId')
        if (employeeId === null) return failure(400, 'invalid-employee')
        return Response.json(await this.service.open(principal, id, { ...(topicId === undefined ? {} : { topicId }),
          ...(employeeId === undefined ? {} : { employeeId }) }))
      }
      if (operation === 'messages') {
        const text = stringField(body, 'text'), mentionedEmployeeIds = optionalStringArrayField(body,
            'mentionedEmployeeIds'), messageId = optionalStringField(body, 'messageId')
        if (text === undefined || mentionedEmployeeIds === null || messageId === null) return failure(400, 'invalid-body')
        return Response.json(await this.service.message(principal, id, { text,
          ...(topicId === undefined ? {} : { topicId }), ...(messageId === undefined ? {} : { messageId }),
          ...(mentionedEmployeeIds === undefined ? {} : { mentionedEmployeeIds }) }))
      }
      return failure(404, 'not-found')
    } catch (error) {
      if (error instanceof CollaborationError) return failure(error.status, error.code)
      throw error
    }
  }
}
