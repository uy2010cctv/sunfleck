/** Cookie-authenticated collaboration endpoints; all native Session ids remain member- and workspace-scoped. */
import type { EmployeeHttpSecurity } from './employee-http.ts'
import { CollaborationError, type CollaborationService } from './collaboration-service.ts'
import { authenticatedSegments, failure, guardResource, jsonObjectBody, optionalStringArrayField, optionalStringField,
  stringArrayField, stringField } from './http.ts'
export type { CollaborationDetail, CollaborationOpenResult, CollaborationDelivery, CollaborationRoomEvent } from './collaboration-service.ts'

/** HTTP transport for the PostgreSQL collaboration service. */
export class CollaborationHttpHandler {
  /** @param service - Conversation coordinator. @param security - Shared cookie and policy services. */
  constructor(readonly service: CollaborationService, private readonly security: EmployeeHttpSecurity) {}

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
        if (target === undefined && operation === 'events') {
          const params = new URL(request.url).searchParams
          const after = params.get('after'), before = params.get('before')
          const limitText = params.get('limit'), threadRoot = params.get('threadRoot')
          const limit = limitText === null ? 50 : Number(limitText)
          if ((after !== null && !/^(0|[1-9][0-9]*)$/u.test(after))
            || (before !== null && !/^[1-9][0-9]*$/u.test(before)) || (after !== null && before !== null)
            || !Number.isSafeInteger(limit)
            || limit < 1 || limit > 100 || (threadRoot !== null && (threadRoot.trim() === '' || threadRoot.length > 200))) {
            return failure(400, 'invalid-room-page')
          }
          return Response.json(await this.service.events(principal, id, {
            ...(after === null ? {} : { after }), ...(before === null ? {} : { before }), limit,
            ...(threadRoot === null ? {} : { threadRoot }),
          }))
        }
        if (target === undefined && operation === 'search') {
          const query = new URL(request.url).searchParams.get('q')
          if (query === null) return failure(400, 'invalid-search')
          return Response.json(await this.service.search(principal, id, query))
        }
        if (operation === 'attachments' && target !== undefined) {
          const stored = await this.service.attachment(principal, id, target)
          return new Response(new Uint8Array(stored.data), { headers: {
            'content-type': stored.mimeType,
            'content-length': String(stored.size),
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(stored.name)}`,
            'cache-control': 'private, immutable',
          } })
        }
        return failure(404, 'not-found')
      }
      if (request.method !== 'POST') return failure(405, 'method-not-allowed')
      // The room upload route consumes a raw binary body, so it dispatches
      // before the JSON-object parse the other operations share.
      if (id !== undefined && operation === 'attachments' && target === undefined) {
        const name = new URL(request.url).searchParams.get('name') ?? ''
        const mimeType = new URL(request.url).searchParams.get('type') ?? 'application/octet-stream'
        const data = Buffer.from(await request.arrayBuffer())
        return Response.json(await this.service.uploadAttachment(principal, id, { name, mimeType, data }), { status: 201 })
      }
      const body = await jsonObjectBody(request)
      if (body === undefined) return failure(400, 'invalid-body')
      if (body['content'] !== undefined) return failure(400, 'text-only-collaboration')
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
      if (id === undefined || (target !== undefined && operation !== 'members')) return failure(404, 'not-found')
      if (operation === 'read') {
        const sequence = stringField(body, 'sequence')
        if (sequence === undefined || !/^[1-9][0-9]*$/u.test(sequence)
          || BigInt(sequence) > 9_223_372_036_854_775_807n) return failure(400, 'invalid-room-read-cursor')
        await this.service.markRead(principal, id, sequence)
        return Response.json({ sequence })
      }
      if (operation === 'prefs') {
        const flag = (field: string): boolean | undefined => {
          const value = body[field]
          if (value === undefined) return undefined
          if (typeof value !== 'boolean') throw new CollaborationError('invalid-prefs')
          return value
        }
        const patch: { pinned?: boolean; starred?: boolean; muted?: boolean } = {}
        const pinned = flag('pinned'), starred = flag('starred'), muted = flag('muted')
        if (pinned !== undefined) patch.pinned = pinned
        if (starred !== undefined) patch.starred = starred
        if (muted !== undefined) patch.muted = muted
        return Response.json(await this.service.setPrefs(principal, id, patch))
      }
      if (operation === 'rename') {
        const name = stringField(body, 'name')
        if (name === undefined) return failure(400, 'invalid-body')
        return Response.json(await this.service.rename(principal, id, name))
      }
      if (operation === 'announcement') {
        const text = body['text']
        if (typeof text !== 'string') return failure(400, 'invalid-body')
        return Response.json(await this.service.setAnnouncement(principal, id, text))
      }
      if (operation === 'members' && (target === 'add' || target === 'remove')) {
        const memberEmployeeIds = optionalStringArrayField(body, 'memberEmployeeIds')
        const memberUserIds = optionalStringArrayField(body, 'memberUserIds')
        if (memberEmployeeIds === null || memberUserIds === null
          || (memberEmployeeIds?.length ?? 0) + (memberUserIds?.length ?? 0) === 0) return failure(400, 'invalid-body')
        const change = { ...(memberEmployeeIds === undefined ? {} : { employeeIds: memberEmployeeIds }),
          ...(memberUserIds === undefined ? {} : { userIds: memberUserIds }) }
        return Response.json(await (target === 'add'
          ? this.service.addMembers(principal, id, change)
          : this.service.removeMembers(principal, id, change)))
      }
      const topicId = optionalStringField(body, 'topicId')
      if (topicId === null) return failure(400, 'invalid-topic')
      if (operation === 'open') {
        const employeeId = optionalStringField(body, 'employeeId')
        if (employeeId === null) return failure(400, 'invalid-employee')
        return Response.json(await this.service.open(principal, id, { ...(topicId === undefined ? {} : { topicId }),
          ...(employeeId === undefined ? {} : { employeeId }) }))
      }
      if (operation === 'messages') {
        const text = typeof body['text'] === 'string' ? body['text'] : undefined
        const mentionedEmployeeIds = optionalStringArrayField(body, 'mentionedEmployeeIds')
        const mentionedUserIds = optionalStringArrayField(body, 'mentionedUserIds')
        const messageId = optionalStringField(body, 'messageId')
        const threadRoot = optionalStringField(body, 'threadRoot')
        const rawAttachments = body['attachments']
        const attachments = rawAttachments === undefined ? undefined
          : Array.isArray(rawAttachments) ? rawAttachments.map((value) => {
            const row = typeof value === 'object' && value !== null && !Array.isArray(value)
              ? value as Record<string, unknown> : undefined
            return typeof row?.['attachmentId'] === 'string' ? { attachmentId: row['attachmentId'] } : undefined
          }).filter((value): value is { attachmentId: string } => value !== undefined) : null
        if (attachments === null || (text === undefined && (attachments?.length ?? 0) === 0)
          || mentionedEmployeeIds === null || mentionedUserIds === null || messageId === null || threadRoot === null) {
          return failure(400, 'invalid-body')
        }
        return Response.json(await this.service.message(principal, id, { text: text ?? '',
          ...(topicId === undefined ? {} : { topicId }), ...(messageId === undefined ? {} : { messageId }),
          ...(threadRoot === undefined ? {} : { threadRoot }),
          ...(attachments === undefined || attachments.length === 0 ? {} : { attachments }),
          ...(mentionedEmployeeIds === undefined ? {} : { mentionedEmployeeIds }),
          ...(mentionedUserIds === undefined ? {} : { mentionedUserIds }) }))
      }
      if (operation === 'reactions') {
        const eventId = stringField(body, 'eventId'), emoji = stringField(body, 'emoji'), requestId = stringField(body, 'requestId')
        if (eventId === undefined || emoji === undefined || requestId === undefined) return failure(400, 'invalid-body')
        return Response.json(await this.service.react(principal, id, { eventId, emoji, requestId }))
      }
      return failure(404, 'not-found')
    } catch (error) {
      if (error instanceof CollaborationError) return failure(error.status, error.code)
      throw error
    }
  }
}
