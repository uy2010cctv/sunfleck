/**
 * Authenticated collaboration-surface and project endpoints for the enterprise
 * Web console, plus the token-authenticated channel inbound route, mounted by
 * the enterprise controller. The surface and project routes sit behind the
 * existing enterprise cookie authentication and the shared authorization
 * policy; this module adds no authentication mechanism of its own. The
 * channel inbound route authenticates one already-normalized envelope with a
 * deployment token instead: no enterprise principal exists on that transport,
 * so the shared authorization and audit seam does not run there, and the
 * resolved surface's organization scopes every store write.
 *
 * Routes (mounted under the `/enterprise/surfaces`, `/enterprise/channels`,
 * and `/enterprise/projects` prefixes):
 * - `POST /surfaces/groups` creates one group surface (name required;
 *   external key, project reference, and chartered team optional).
 * - `POST /surfaces/channels` creates one channel surface (name, topic
 *   policy, respond policy, and duty roster required).
 * - `GET /surfaces?kind=group|channel|dm` lists the caller organization's
 *   surfaces with their governance fields.
 * - `POST /surfaces/:id/messages` dispatches one message by surface kind to
 *   the dm, group, or channel delivery contract; structured not-delivered
 *   results answer 200 so transports can render them without catching.
 * - `POST /surfaces/:id/topics/:topicId/settle` settles one interactive
 *   channel topic through the same `/done` contract the channel serves.
 * - `POST /channels/:channelId/inbound` accepts one normalized envelope
 *   `{channelId, actorKey, text, messageId?, mentionedEmployeeIds?}` from the
 *   deployment bridge. The envelope's message id is accepted for transport
 *   fidelity but channel delivery does not consume it — the channel contract
 *   carries no message id, so transports own dedup.
 * - `POST /projects` creates one project (creator = authenticated user).
 * - `GET /projects` lists the projects visible to the caller.
 * - `GET /projects/:id` reads one project behind the member gate.
 * - `POST /projects/:id/members` adds one member.
 * - `POST /projects/:id/archive` archives one project and fires the memory
 *   distillation hook without awaiting it — the archive response never waits
 *   on or fails with distillation.
 * - `POST /projects/:id/distill` runs project-archival distillation now and
 *   returns its report; requires the memory-consolidation plane.
 *
 * Authorization reuses the existing `EnterpriseAction` values — the union has
 * no surface- or project-specific members. Surfaces are conversation
 * channels, so listing reuses `channel.read` and delivery reuses
 * `employee.execute` like the employee dm routes; surface creation reuses
 * `employee.create`, the creator-role act of binding organization employees
 * into durable structures. Projects are team-collaboration spaces, so reads
 * reuse `team.read` and writes reuse `team.manage`. Audit endpoint names are
 * `enterpriseSurface.*`, `enterpriseProject.*`, and the un-audited token
 * inbound route.
 *
 * Status mapping: 401 unauthenticated (or inbound token mismatch), 503
 * inbound token unconfigured, 403 denied by the shared policy, 400 invalid
 * body or member reference, 404 missing or cross-organization surface,
 * project, or topic (existence is not revealed; project non-members fold
 * here too), 409 project state conflict or settled topic, 502
 * enterprise-surface delivery failure, 500 other failures.
 *
 * Responses carry governance fields only: anchored session ids, delivery
 * error chains, workspace paths, and member allowlists stay internal.
 *
 * @module @deepseek-ai/dsh-api-enterprise-controller/surfaces-http
 */

import { isAbsolute } from 'node:path'
import { employeeId, surfaceId } from '@deepseek-ai/dsh-employee-account'
import type { EmployeeId, InboxItemId, SurfaceId } from '@deepseek-ai/dsh-employee-account'
import { EnterpriseSurfaceError } from '@deepseek-ai/dsh-enterprise-surface'
import type {
  ChannelDeliveryResult,
  EnterpriseSurfaces,
  GroupDeliveryResult,
  Surface,
  SurfaceListEntry,
} from '@deepseek-ai/dsh-enterprise-surface'
import type { ProjectDistillReport } from '@deepseek-ai/dsh-enterprise-memory-context'
import { EnterpriseProjectError, projectId } from '@deepseek-ai/dsh-enterprise-project'
import type {
  EnterpriseProjects, Project, ProjectId, ProjectVisibility,
} from '@deepseek-ai/dsh-enterprise-project'
import type {
  EnterpriseAction, EnterprisePrincipal,
} from '@deepseek-ai/dsh-enterprise-governance'
import type { PostgresSurfaceDirectory, SurfaceDirectoryKind } from '@deepseek-ai/dsh-enterprise-postgres'
import type { EmployeeHttpSecurity } from './employee-http.ts'
import {
  authenticatedSegments, cookiePrincipal, failure, guardResource, jsonObjectBody, methodFailure,
  optionalStringArrayField, optionalStringField, stringArrayField, stringField, timingSafeTokenMatches,
} from './http.ts'

/** Cordis service keys the collaboration surface and project endpoints require. */
export const inject: readonly string[] = ['surfaces', 'enterpriseProjects']

/** Deployment options for the surface HTTP boundary. */
export interface SurfaceHttpOptions {
  /**
   * Deployment token the channel inbound route compares against the
   * `x-dsh-channel-token` header; when omitted the `DSH_CHANNEL_INBOUND_TOKEN`
   * environment value is used. Unset or empty means the route is not
   * configured and answers 503.
   */
  readonly channelInboundToken?: string
}

/** Channel topic policies the create route accepts. */
const TOPIC_POLICIES = ['thread', 'command', 'lane'] as const
/** Channel respond policies the create route accepts. */
const RESPOND_POLICIES = ['mention_duty', 'ingest_only'] as const
/** Project visibilities the create route accepts. */
const PROJECT_VISIBILITIES: readonly ProjectVisibility[] = ['organization', 'private', 'restricted']
/** Surface kinds the `?kind=` filter accepts. */
const SURFACE_KINDS = ['dm', 'group', 'channel'] as const

/** Authenticated read boundary for the PostgreSQL surface roster while delivery is not composed. */
export class SurfaceDirectoryHttpHandler {
  /** @param directory - PostgreSQL roster reader.
   * @param security - Cookie authentication and authorization service.
   */
  constructor(
    private readonly directory: Pick<PostgresSurfaceDirectory, 'list'>,
    private readonly security: EmployeeHttpSecurity,
  ) {}

  /** List stored rows; mutation routes continue to report the absent surface plane.
   * @param request - Incoming enterprise surface request.
   * @returns Authenticated roster or an authorization, validation, or unavailable response.
   */
  async fetch(request: Request): Promise<Response> {
    const principal = await cookiePrincipal(this.security, request)
    if (principal instanceof Response) return principal
    const url = new URL(request.url)
    const segments = url.pathname.split('/').filter(Boolean).slice(2)
    if (request.method !== 'GET' || segments.length !== 0) return failure(503, 'surface-plane-unavailable')
    const decision = await guardResource(
      this.security, principal, 'channel.read', 'enterpriseSurface.list', 'enterprise-surface', 'catalog',
    )
    if (!decision.allowed) return failure(403, 'forbidden')
    const kind = url.searchParams.get('kind')
    if (kind !== null && !SURFACE_KINDS.includes(kind as SurfaceDirectoryKind)) {
      return failure(400, 'invalid-kind')
    }
    return Response.json(await this.directory.list(principal.orgId, kind === null ? undefined : kind as SurfaceDirectoryKind))
  }
}

/** Surface error codes that mean the create payload names an unusable member employee. */
const MEMBER_VALIDATION_CODES: ReadonlySet<EnterpriseSurfaceError['code']> = new Set([
  'employee-missing', 'employee-cross-org', 'group-members-missing',
])

/** Surface error codes that mean the addressed employee does not exist for the caller. */
const EMPLOYEE_NOT_FOUND_CODES: ReadonlySet<EnterpriseSurfaceError['code']> = new Set([
  'employee-missing', 'employee-cross-org',
])

/** Governance projection of one member destination of a group delivery. */
export type SurfaceDeliveryTargetView =
  | { readonly kind: 'employee'; readonly employeeId: EmployeeId; readonly delivered: boolean }
  | { readonly kind: 'team-run'; readonly runId: string; readonly delivered: boolean }

/** Governance projection of one surface delivery outcome; the only delivery response body.
 * Per-target session ids and error chains stay internal. */
export type SurfaceDeliveryView =
  | { readonly delivered: true; readonly kind: 'dm'; readonly inboxItemId: InboxItemId }
  | {
    readonly delivered: true
    readonly mode: 'federated' | 'team'
    readonly targets: readonly SurfaceDeliveryTargetView[]
  }
  | {
    readonly delivered: true
    readonly mode: 'routed'
    readonly topicId: string
    readonly employeeIds: readonly EmployeeId[]
  }
  | { readonly delivered: true; readonly mode: 'settled'; readonly topicId: string }
  | {
    readonly delivered: true
    readonly mode: 'ingested'
    readonly proposedMemoryIds: readonly string[]
    readonly droppedPrivacy: number
  }
  | {
    readonly delivered: false
    readonly reason:
      | Extract<GroupDeliveryResult, { delivered: false }>['reason']
      | Extract<ChannelDeliveryResult, { delivered: false }>['reason']
  }

/** Governance projection of one stored conversation surface; the only surface response body. */
export interface SurfaceView {
  /** Durable surface identifier. */
  readonly id: SurfaceId
  /** Conversation kind the surface serves. */
  readonly kind: Surface['kind']
  /** Human-facing name stored on group and channel surfaces. */
  readonly name?: string
  /** Stored member principals; dm surfaces store no member rows and omit the count. */
  readonly memberCount?: number
}

/** Governance projection of one project; the workspace path and allowlist stay internal. */
export interface ProjectView {
  /** Durable project identifier. */
  readonly id: ProjectId
  /** Human-readable project name. */
  readonly name: string
  /** Project goal statement. */
  readonly goal: string
  /** Team definition owning the project's execution, when one is bound. */
  readonly teamDefinitionId?: string
  /** Current lifecycle state. */
  readonly state: Project['state']
  /** Listing visibility inside the organization. */
  readonly visibility: Project['visibility']
  /** Actor id that created the project and its first membership. */
  readonly createdBy: string
  /** Creation timestamp in epoch milliseconds. */
  readonly createdAt: number
  /** Archival timestamp in epoch milliseconds, present once archived. */
  readonly archivedAt?: number
}

/** Project one stored surface to its governance fields. */
function presentSurface(entry: SurfaceListEntry): SurfaceView {
  const { surface } = entry
  if (surface.kind === 'dm') return { id: surface.id, kind: surface.kind }
  return { id: surface.id, kind: surface.kind, name: surface.name, memberCount: entry.memberCount }
}

/** Project one project to its governance fields. */
function presentProject(project: Project): ProjectView {
  return {
    id: project.projectId, name: project.name, goal: project.goal,
    ...(project.teamDefinitionId === undefined ? {} : { teamDefinitionId: project.teamDefinitionId }),
    state: project.state, visibility: project.visibility, createdBy: project.createdBy,
    createdAt: project.createdAt,
    ...(project.archivedAt === undefined ? {} : { archivedAt: project.archivedAt }),
  }
}

/** Project one group delivery outcome to its governance fields. */
function presentGroupDelivery(result: GroupDeliveryResult): SurfaceDeliveryView {
  if (!result.delivered) return { delivered: false, reason: result.reason }
  return {
    delivered: true,
    mode: result.mode,
    targets: result.targets.map(target => target.kind === 'employee'
      ? { kind: target.kind, employeeId: target.employeeId, delivered: target.delivered }
      : { kind: target.kind, runId: target.runId, delivered: target.delivered }),
  }
}

/** Project one channel delivery outcome to its governance fields. */
function presentChannelDelivery(result: ChannelDeliveryResult): SurfaceDeliveryView {
  if (!result.delivered) return { delivered: false, reason: result.reason }
  if (result.mode === 'routed') {
    return {
      delivered: true, mode: 'routed', topicId: result.topicId, employeeIds: result.employeeIds,
    }
  }
  if (result.mode === 'settled') return { delivered: true, mode: 'settled', topicId: result.topicId }
  return {
    delivered: true, mode: 'ingested',
    proposedMemoryIds: result.proposedMemoryIds, droppedPrivacy: result.droppedPrivacy,
  }
}

/** Outcome of one guarded write route: the parsed body, or the denial response to return. */
type GuardedBody =
  | { readonly body: Record<string, unknown>; readonly denial?: undefined }
  | { readonly body?: undefined; readonly denial: Response }

/** Run one write route's preamble: authorize plus audit, then parse the JSON object body. */
async function guardedBody(
  security: EmployeeHttpSecurity,
  request: Request,
  principal: EnterprisePrincipal,
  action: EnterpriseAction,
  endpoint: string,
  resourceType: string,
  resourceId: string,
): Promise<GuardedBody> {
  const decision = await guardResource(security, principal, action, endpoint, resourceType, resourceId)
  if (!decision.allowed) return { denial: failure(403, 'forbidden') }
  const body = await jsonObjectBody(request)
  return body === undefined ? { denial: failure(400, 'invalid-payload') } : { body }
}

/** Collaboration surface HTTP boundary owned by the enterprise controller. */
export class SurfaceHttpHandler {
  private readonly channelInboundToken: string | undefined

  /**
   * @param surfaces - Enterprise conversation-surface registry and inbound delivery.
   * @param security - Existing enterprise authentication and authorization seam.
   * @param options - deployment options; the inbound token falls back to the environment.
   */
  constructor(
    private readonly surfaces: EnterpriseSurfaces,
    private readonly security: EmployeeHttpSecurity,
    options: SurfaceHttpOptions = {},
  ) {
    this.channelInboundToken = options.channelInboundToken ?? process.env['DSH_CHANNEL_INBOUND_TOKEN']
  }

  /**
   * Authenticate, authorize, and dispatch one surface request; message delivery
   * dispatches on the stored surface kind and topic settle serves channel surfaces.
   */
  async fetch(request: Request): Promise<Response> {
    const principal = await cookiePrincipal(this.security, request)
    if (principal instanceof Response) return principal
    const url = new URL(request.url)
    const segments = url.pathname.split('/').filter(Boolean).slice(2)
    if (segments.length === 0) {
      return request.method === 'GET' ? this.list(principal, url.searchParams) : methodFailure('GET')
    }
    const head = segments[0] as string
    if (segments.length === 1 && head === 'groups') {
      return request.method === 'POST' ? this.createGroup(request, principal) : methodFailure('POST')
    }
    if (segments.length === 1 && head === 'channels') {
      return request.method === 'POST' ? this.createChannel(request, principal) : methodFailure('POST')
    }
    if (segments.length === 2 && segments[1] === 'messages') {
      return request.method === 'POST'
        ? this.deliverMessage(request, principal, surfaceId(head))
        : methodFailure('POST')
    }
    if (segments.length === 4 && segments[1] === 'topics' && segments[3] === 'settle') {
      if (request.method !== 'POST') return methodFailure('POST')
      return this.settleTopic(principal, surfaceId(head), segments[2] as string)
    }
    return failure(404, 'not-found')
  }

  /**
   * Serve the token-authenticated channel inbound route.
   * @param request - Deployment bridge request under the mount prefix.
   * @returns The projected delivery outcome without internal delivery material.
   */
  async fetchInbound(request: Request): Promise<Response> {
    if (request.method !== 'POST') return methodFailure('POST')
    const segments = new URL(request.url).pathname.split('/').filter(Boolean).slice(2)
    if (segments.length !== 2 || segments[1] !== 'inbound') return failure(404, 'not-found')
    return this.channelInbound(request, segments[0] as string)
  }

  /** List the caller organization's surfaces, optionally narrowed by the `?kind=` filter. */
  private async list(principal: EnterprisePrincipal, searchParams: URLSearchParams): Promise<Response> {
    const decision = await guardResource(
      this.security, principal, 'channel.read', 'enterpriseSurface.list', 'enterprise-surface', 'catalog',
    )
    if (!decision.allowed) return failure(403, 'forbidden')
    const kind = searchParams.get('kind')
    if (kind !== null && !SURFACE_KINDS.includes(kind as Surface['kind'])) {
      return failure(400, 'invalid-kind')
    }
    const entries = await this.surfaces.listSurfaces({
      orgId: principal.orgId,
      ...(kind === null ? {} : { kind: kind as Surface['kind'] }),
    })
    return Response.json(entries.map(presentSurface))
  }

  /** Create one group surface, replacing the stored member set when the external key repeats. */
  private async createGroup(request: Request, principal: EnterprisePrincipal): Promise<Response> {
    const { body, denial } = await guardedBody(
      this.security, request, principal, 'employee.create', 'enterpriseSurface.createGroup', 'enterprise-surface', 'new',
    )
    if (denial !== undefined) return denial
    const name = stringField(body, 'name')
    const externalKey = stringField(body, 'externalKey')
    const memberEmployeeIds = stringArrayField(body, 'memberEmployeeIds')
    const teamDefinitionId = stringField(body, 'teamDefinitionId')
    const projectId = stringField(body, 'projectId')
    if (name === undefined || memberEmployeeIds === undefined) return failure(400, 'invalid-payload')
    const members = [...new Set(memberEmployeeIds)].map(employeeId)
    return this.createSurface(
      this.surfaces.ensureGroupSurface({
        orgId: principal.orgId, name, memberEmployeeIds: members,
        ...(externalKey === undefined ? {} : { externalKey }),
        ...(teamDefinitionId === undefined ? {} : { teamDefinitionId }),
        ...(projectId === undefined ? {} : { projectId }),
      }),
      members.length,
    )
  }

  /** Await one surface creation and project it to its 201 view; unusable members answer 400. */
  private async createSurface(create: Promise<Surface>, memberCount: number): Promise<Response> {
    try {
      return Response.json(presentSurface({ surface: await create, memberCount }), { status: 201 })
    } catch (error: unknown) {
      return this.createSurfaceFailure(error)
    }
  }

  /** Create one channel surface with its policies and duty roster. */
  private async createChannel(request: Request, principal: EnterprisePrincipal): Promise<Response> {
    const { body, denial } = await guardedBody(
      this.security, request, principal, 'employee.create', 'enterpriseSurface.createChannel', 'enterprise-surface', 'new',
    )
    if (denial !== undefined) return denial
    const name = stringField(body, 'name')
    const externalKey = stringField(body, 'externalKey')
    const dutyEmployeeIds = stringArrayField(body, 'dutyEmployeeIds')
    const memberIds = optionalStringArrayField(body, 'memberEmployeeIds')
    const topicPolicy = body['topicPolicy']
    const respondPolicy = body['respondPolicy']
    const projectId = stringField(body, 'projectId')
    const topic = TOPIC_POLICIES.find(policy => policy === topicPolicy)
    const respond = RESPOND_POLICIES.find(policy => policy === respondPolicy)
    if (name === undefined || dutyEmployeeIds === undefined || memberIds === null
      || topic === undefined || respond === undefined) {
      return failure(400, 'invalid-payload')
    }
    // Members fall back to the duty roster so a duty-only channel still carries a member set.
    const members = [...new Set(memberIds ?? dutyEmployeeIds)].map(employeeId)
    return this.createSurface(
      this.surfaces.ensureChannelSurface({
        orgId: principal.orgId, name, memberEmployeeIds: members,
        topicPolicy: topic,
        respondPolicy: respond,
        dutyEmployeeIds: [...new Set(dutyEmployeeIds)].map(employeeId),
        ...(externalKey === undefined ? {} : { externalKey }),
        ...(projectId === undefined ? {} : { projectId }),
      }),
      members.length,
    )
  }

  /** Dispatch one inbound message to the surface's delivery contract by kind. */
  private async deliverMessage(
    request: Request,
    principal: EnterprisePrincipal,
    id: SurfaceId,
  ): Promise<Response> {
    const decision = await guardResource(
      this.security, principal, 'employee.execute', 'enterpriseSurface.deliverMessage', 'enterprise-surface', id,
    )
    if (!decision.allowed) return failure(403, 'forbidden')
    const body = await jsonObjectBody(request)
    if (body === undefined) return failure(400, 'invalid-payload')
    const text = stringField(body, 'text')
    if (text === undefined) return failure(400, 'invalid-text')
    const mentioned = optionalStringArrayField(body, 'mentionedEmployeeIds')
    const messageId = optionalStringField(body, 'messageId')
    const topicId = optionalStringField(body, 'topicId')
    if (mentioned === null || messageId === null || topicId === null) {
      return failure(400, 'invalid-payload')
    }
    const surface = await this.surfaces.findSurface({ orgId: principal.orgId, surfaceId: id })
    if (surface === undefined) return failure(404, 'surface-not-found')
    const mentionedIds = [...new Set(mentioned)].map(employeeId)
    try {
      if (surface.kind === 'dm') {
        const inboxItemId = await this.surfaces.deliverToEmployee(surface, principal.userId, text)
        return Response.json({ delivered: true, kind: 'dm', inboxItemId } satisfies SurfaceDeliveryView)
      }
      if (surface.kind === 'group') {
        const result = await this.surfaces.deliverToGroup(surface, {
          originUserId: principal.userId, text,
          ...(mentionedIds.length === 0 ? {} : { mentionedEmployeeIds: mentionedIds }),
          ...(messageId === undefined ? {} : { messageId }),
        })
        return Response.json(presentGroupDelivery(result))
      }
      const result = await this.surfaces.deliverToChannel(surface, {
        originUserId: principal.userId, text,
        ...(mentionedIds.length === 0 ? {} : { mentionedEmployeeIds: mentionedIds }),
        ...(topicId === undefined ? {} : { topicId }),
      })
      return Response.json(presentChannelDelivery(result))
    } catch (error: unknown) {
      return this.surfaceFailure(error)
    }
  }

  /** Settle one interactive channel topic through the channel `/done` contract. */
  private async settleTopic(
    principal: EnterprisePrincipal,
    id: SurfaceId,
    topicId: string,
  ): Promise<Response> {
    const decision = await guardResource(
      this.security, principal, 'employee.execute', 'enterpriseSurface.settleTopic', 'enterprise-surface', id,
    )
    if (!decision.allowed) return failure(403, 'forbidden')
    const surface = await this.surfaces.findSurface({ orgId: principal.orgId, surfaceId: id })
    // Topics exist only on interactive channel surfaces, so every other kind folds to the same
    // missing-topic answer as an unknown topic id.
    if (surface === undefined || surface.kind !== 'channel' || surface.respondPolicy === 'ingest_only') {
      return failure(404, 'topic-not-found')
    }
    try {
      const result = await this.surfaces.deliverToChannel(surface, {
        originUserId: principal.userId, text: '/done', topicId,
      })
      if (result.delivered && result.mode === 'settled') {
        return Response.json({ topicId, state: 'settled' })
      }
      if (!result.delivered && result.reason === 'no-topic') return failure(404, 'topic-not-found')
      if (!result.delivered && result.reason === 'already-settled') {
        return failure(409, 'topic-already-settled')
      }
      return failure(500, 'internal-error')
    } catch (error: unknown) {
      return this.surfaceFailure(error)
    }
  }

  /**
   * Serve one already-normalized channel envelope. The deployment token is the
   * only authentication: the envelope's actor key scopes memory attribution,
   * and the resolved surface's organization scopes every store write.
   */
  private async channelInbound(request: Request, channelId: string): Promise<Response> {
    if (this.channelInboundToken === undefined || this.channelInboundToken === '') {
      return failure(503, 'configuration-required')
    }
    if (!timingSafeTokenMatches(request.headers.get('x-dsh-channel-token'), this.channelInboundToken)) {
      return failure(401, 'unauthenticated')
    }
    const body = await jsonObjectBody(request)
    if (body === undefined) return failure(400, 'invalid-payload')
    const envelopeChannelId = stringField(body, 'channelId')
    const actorKey = stringField(body, 'actorKey')
    const text = stringField(body, 'text')
    const messageId = optionalStringField(body, 'messageId')
    const mentioned = optionalStringArrayField(body, 'mentionedEmployeeIds')
    if (envelopeChannelId !== channelId || actorKey === undefined || text === undefined
      || messageId === null || mentioned === null) {
      return failure(400, 'invalid-payload')
    }
    try {
      // Inside the try: the ambiguous-external-key throw is a deployment
      // misconfiguration and must answer 500, not the transport's client-fault 400.
      const surface = await this.surfaces.findChannelByExternalKey({ externalKey: channelId })
      if (surface === undefined) return failure(404, 'surface-not-found')
      const result = await this.surfaces.deliverToChannel(surface, {
        originUserId: actorKey, text,
        ...(mentioned === undefined || mentioned.length === 0
          ? {}
          : { mentionedEmployeeIds: mentioned.map(id => employeeId(id)) }),
      })
      return Response.json(presentChannelDelivery(result))
    } catch (error: unknown) {
      return this.surfaceFailure(error)
    }
  }

  /** Map one surface-creation failure to its transport status without exposing internals. */
  private createSurfaceFailure(error: unknown): Response {
    if (error instanceof EnterpriseSurfaceError && MEMBER_VALIDATION_CODES.has(error.code)) {
      return failure(400, 'invalid-member')
    }
    return failure(500, 'internal-error')
  }

  /** Map one delivery failure to its transport status without exposing internals. */
  private surfaceFailure(error: unknown): Response {
    if (error instanceof EnterpriseSurfaceError) {
      return EMPLOYEE_NOT_FOUND_CODES.has(error.code)
        ? failure(404, 'employee-not-found')
        : failure(502, 'delivery-failed')
    }
    return failure(500, 'internal-error')
  }
}

/** Distillation seam of the project routes, supplied by the composition. Absent means the
 * memory-consolidation plane is unmounted: the manual distill route answers 503 and the
 * post-archive hook skips. */
export interface ProjectDistillationSeam {
  /** Run one project distillation and resolve its report; the implementation owns the audit. */
  distillProject(input: { orgId: string; projectId: string; actorUserId: string }): Promise<ProjectDistillReport>
}

export interface ProjectHttpOptions {
  /** Distillation seam; the mounted memory-consolidation runtime satisfies it structurally. */
  readonly consolidation?: ProjectDistillationSeam | undefined
}

/** Project governance HTTP boundary owned by the enterprise controller. */
export class ProjectHttpHandler {
  /**
   * @param projects - Enterprise project governance service.
   * @param security - Existing enterprise authentication and authorization seam.
   * @param options - distillation seam; optional.
   */
  constructor(
    private readonly projects: EnterpriseProjects,
    private readonly security: EmployeeHttpSecurity,
    private readonly options: ProjectHttpOptions = {},
  ) {}

  /**
   * Authenticate, authorize, and dispatch one project request. Non-member reads
   * fold to 404 inside the detail route; every id reaches the store org-scoped.
   */
  async fetch(request: Request): Promise<Response> {
    const resolved = await authenticatedSegments(this.security, request)
    if (resolved instanceof Response) return resolved
    const { principal, segments } = resolved
    if (segments.length === 0) {
      if (request.method === 'POST') return this.create(request, principal)
      return request.method === 'GET' ? this.list(principal) : methodFailure('GET, POST')
    }
    const head = segments[0] as string
    const second = segments.length > 1 ? segments[1] : undefined
    if (second === undefined) {
      return request.method === 'GET' ? this.detail(principal, projectId(head)) : methodFailure('GET')
    }
    if (second === 'members') {
      return request.method === 'POST' ? this.addMember(request, principal, projectId(head)) : methodFailure('POST')
    }
    if (second === 'archive') {
      return request.method === 'POST' ? this.archive(principal, projectId(head)) : methodFailure('POST')
    }
    if (second === 'distill') {
      return request.method === 'POST' ? this.distill(principal, projectId(head)) : methodFailure('POST')
    }
    return failure(404, 'not-found')
  }

  /** List the projects the caller's visibility rules expose inside the organization. */
  private async list(principal: EnterprisePrincipal): Promise<Response> {
    const decision = await guardResource(
      this.security, principal, 'team.read', 'enterpriseProject.list', 'enterprise-project', 'catalog',
    )
    if (!decision.allowed) return failure(403, 'forbidden')
    const projects = await this.projects.list(principal.orgId, {
      userId: principal.userId, roles: principal.roles,
    })
    return Response.json(projects.map(presentProject))
  }

  /** Create one active project owned by the authenticated user as its creator and first member. */
  private async create(request: Request, principal: EnterprisePrincipal): Promise<Response> {
    const { body, denial } = await guardedBody(
      this.security, request, principal, 'team.manage', 'enterpriseProject.create', 'enterprise-project', 'new',
    )
    if (denial !== undefined) return denial
    const name = stringField(body, 'name')
    const goal = stringField(body, 'goal')
    const workspacePath = stringField(body, 'workspacePath')
    const teamDefinitionId = stringField(body, 'teamDefinitionId')
    const allowedUserIds = optionalStringArrayField(body, 'allowedUserIds')
    const visibility = PROJECT_VISIBILITIES.find(value => value === body['visibility'])
    if (name === undefined || goal === undefined || workspacePath === undefined
      || !isAbsolute(workspacePath) || allowedUserIds === null) {
      return failure(400, 'invalid-payload')
    }
    try {
      const project = await this.projects.create({
        orgId: principal.orgId, name, goal, workspacePath, createdBy: principal.userId,
        ...(teamDefinitionId === undefined ? {} : { teamDefinitionId }),
        ...(visibility === undefined ? {} : { visibility }),
        ...(allowedUserIds === undefined || allowedUserIds.length === 0 ? {} : { allowedUserIds }),
      })
      return Response.json(presentProject(project), { status: 201 })
    } catch (error: unknown) {
      return this.projectFailure(error)
    }
  }

  /**
   * Read one project behind the member gate: missing, cross-organization, and
   * non-member ids all answer 404 — projects are member-gated spaces, so
   * visibility never substitutes for a member row and existence stays hidden.
   */
  private async detail(principal: EnterprisePrincipal, id: ProjectId): Promise<Response> {
    const decision = await guardResource(
      this.security, principal, 'team.read', 'enterpriseProject.get', 'enterprise-project', id,
    )
    if (!decision.allowed) return failure(403, 'forbidden')
    const project = await this.projects.requireMember(principal.orgId, id, { userId: principal.userId })
    return project === undefined ? failure(404, 'project-not-found') : Response.json(presentProject(project))
  }

  /** Add one user or employee member to an active project. */
  private async addMember(
    request: Request,
    principal: EnterprisePrincipal,
    id: ProjectId,
  ): Promise<Response> {
    const { body, denial } = await guardedBody(
      this.security, request, principal, 'team.manage', 'enterpriseProject.addMember', 'enterprise-project', id,
    )
    if (denial !== undefined) return denial
    const principalType = body['principalType']
    const principalId = stringField(body, 'principalId')
    if (principalId === undefined || (principalType !== 'user' && principalType !== 'employee')) {
      return failure(400, 'invalid-payload')
    }
    try {
      await this.projects.addMember(principal.orgId, id, { principalType, principalId, addedBy: principal.userId })
      return new Response(null, { status: 204 })
    } catch (error: unknown) {
      return this.projectFailure(error)
    }
  }

  /** Move one active project to its terminal archived state, then fire distillation without awaiting it. */
  private async archive(principal: EnterprisePrincipal, id: ProjectId): Promise<Response> {
    const decision = await guardResource(
      this.security, principal, 'team.manage', 'enterpriseProject.archive', 'enterprise-project', id,
    )
    if (!decision.allowed) return failure(403, 'forbidden')
    try {
      const project = await this.projects.archive(principal.orgId, id, principal.userId)
      this.options.consolidation?.distillProject({
        orgId: principal.orgId, projectId: id, actorUserId: principal.userId,
      }).catch(() => {
        // Swallows the fire-and-forget rejection: the archive is already committed, so
        // distillation must never block or fail the response, and the runtime audits the
        // run either way — nothing else can reach this failure.
      })
      return Response.json({ id: project.projectId, state: project.state })
    } catch (error: unknown) {
      return this.projectFailure(error)
    }
  }

  /**
   * Run one project distillation behind the detail route's member gate and return its report.
   * Repeated runs are safe: a lesson whose deterministic id already stands is skipped and
   * counted, so distilling an already-distilled project re-reports instead of conflicting.
   */
  private async distill(principal: EnterprisePrincipal, id: ProjectId): Promise<Response> {
    const decision = await guardResource(
      this.security, principal, 'team.manage', 'enterpriseProject.distill', 'enterprise-project', id,
    )
    if (!decision.allowed) return failure(403, 'forbidden')
    if (this.options.consolidation === undefined) return failure(503, 'consolidation-plane-unavailable')
    const project = await this.projects.requireMember(principal.orgId, id, { userId: principal.userId })
    if (project === undefined) return failure(404, 'project-not-found')
    try {
      const report = await this.options.consolidation.distillProject({
        orgId: principal.orgId, projectId: id, actorUserId: principal.userId,
      })
      return Response.json(report)
    } catch {
      // The distillation runtime audits its own failure; the response only reports the status.
      return failure(500, 'internal-error')
    }
  }

  /**
   * Map one project-store failure to its transport status without exposing
   * internals. The service reports invalid input as `TypeError`; not-found
   * folds answer 404 while archived and state conflicts answer 409.
   */
  private projectFailure(error: unknown): Response {
    if (error instanceof EnterpriseProjectError) {
      return error.code === 'not-found'
        ? failure(404, 'project-not-found')
        : failure(409, 'project-conflict')
    }
    return error instanceof TypeError ? failure(400, 'invalid-payload') : failure(500, 'internal-error')
  }
}
