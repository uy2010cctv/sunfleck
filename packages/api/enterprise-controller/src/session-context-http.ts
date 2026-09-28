/** Read-only native Session employee, member-project, and authorized memory context. */
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { employeeId } from '@deepseek-ai/dsh-employee-account'
import type { SessionMemoryActor } from '@deepseek-ai/dsh-employee-account'
import type { EnterpriseSecurity } from '@deepseek-ai/dsh-enterprise-auth-web'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type { EnterpriseIdentityStore, EnterpriseMemoryEntry } from '@deepseek-ai/dsh-enterprise-identity'
import { projectId } from '@deepseek-ai/dsh-enterprise-project'
import type { EnterpriseProjects, Project, ProjectId } from '@deepseek-ai/dsh-enterprise-project'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-tool-present/types'
import { roomTurnPost, type RoomTurnEvent } from './collaboration-room-delivery.ts'
import { employeePresetDefinition } from './employee-preset.ts'
import { employeeReleaseProjectionDefinition } from './employee-session.ts'
import type { EmployeeReleaseSelection } from './contract/work.ts'
import { failure, methodFailure } from './http.ts'

/** One file a session presented, addressable through the download route. */
export interface PresentedFileEntry {
  readonly path: string
  readonly description?: string
  readonly seq: number
  readonly index: number
  /** Native source sequence of the completed turn's room reply, when available. */
  readonly replySourceSeq?: number
}

/** Published employee metadata, without runtime prompts or internal paths. */
export interface SessionContextEmployee {
  readonly id: string
  readonly displayName: string
  readonly role: string
  readonly releaseVersion?: number
  readonly capabilities: readonly string[]
  readonly avatarSeed?: string
}

/** Read-only sources used after Session and Workspace authorization. */
export interface SessionContextDependencies {
  identity: Pick<EnterpriseIdentityStore, 'sessionWorkspaceGrant' | 'sessionOwnerUserId' | 'listWorkspaceGrants' | 'listMemories'>
  security: Pick<EnterpriseSecurity, 'authenticateCookieAsync' | 'sessionAccessibleBy' | 'authorizeApiAsync' | 'authorizeResourceAsync'>
  /** Reads the full pinned employee projection without activating a Session. */
  sessionEmployee?: (sessionId: string) => Promise<EmployeeReleaseSelection | undefined>
  /** Resolves visible metadata from the exact pinned release. */
  employee: (principal: EnterprisePrincipal, selected: EmployeeReleaseSelection) => Promise<SessionContextEmployee | undefined>
  /** Lists the files the session presented, for room members reading an agent reply. */
  presentedFiles?: (sessionId: string) => Promise<readonly PresentedFileEntry[]>
  /** Whether the principal is a member of the room that bound this Session. */
  roomMember?: (principal: EnterprisePrincipal, sessionId: string) => Promise<boolean>
  /** Resolves private memory only for an ordinary owned Session with a matching employee selection. */
  privateActor: (principal: EnterprisePrincipal, sessionId: string, selected: EmployeeReleaseSelection) => Promise<Pick<SessionMemoryActor, 'employeeId' | 'userId'> | undefined>
  projects?: Pick<EnterpriseProjects, 'list' | 'requireMember'>
  /** Undefined denotes an ordinary Session; an object denotes an explicit collaboration binding. */
  sessionProject?: (principal: EnterprisePrincipal, sessionId: string) => Promise<{ projectId?: string } | undefined>
}

/** Cookie-authenticated details for one native Session. */
export class SessionContextHttpHandler {
  /** @param deps - Identity, policy, and read-only native Session providers. */
  constructor(private readonly deps: SessionContextDependencies) {}

  /** Read context after authenticating the Session and its current Workspace grant.
   * @param request - GET request under /enterprise/session-context/:sessionId.
   * @returns Visible employee, explicit-member project, and approved memory summaries.
   */
  async fetch(request: Request): Promise<Response> {
    const { security, identity } = this.deps
    const principal = await security.authenticateCookieAsync(request.headers.get('cookie') ?? '')
    if (principal === undefined) return failure(401, 'unauthenticated')
    if (request.method !== 'GET') return methodFailure('GET')
    const parts = new URL(request.url).pathname.split('/').filter(Boolean)
    if (parts.length === 4 && parts[0] === 'enterprise' && parts[1] === 'session-context' && parts[2] === 'presented'
      && parts[3] !== undefined) {
      return this.fetchPresented(principal, decodeURIComponent(parts[3]))
    }
    const encodedSessionId = parts[2]
    if (parts.length !== 3 || parts[0] !== 'enterprise' || parts[1] !== 'session-context' || encodedSessionId === undefined) return failure(404, 'not-found')
    const sessionId = decodeURIComponent(encodedSessionId)
    if (!await security.sessionAccessibleBy(principal, sessionId)) return failure(403, 'forbidden')
    const workspace = await identity.sessionWorkspaceGrant(sessionId)
    if (workspace === undefined || workspace.orgId !== principal.orgId) return failure(403, 'forbidden')
    const currentGrants = await identity.listWorkspaceGrants({ orgId: principal.orgId, userId: principal.userId })
    if (!currentGrants.some(grant => grant.workspaceId === workspace.workspaceId)
      || !(await security.authorizeApiAsync(principal, 'workspace.list', { workspaceId: workspace.workspaceId })).allowed) {
      return failure(403, 'forbidden')
    }
    if (this.deps.sessionEmployee === undefined) return failure(503, 'session-context-unavailable')
    const selected = await this.deps.sessionEmployee(sessionId)
    if (selected !== undefined && (selected.orgId !== principal.orgId
      || selected.ownerUserId !== await identity.sessionOwnerUserId(sessionId))) return failure(403, 'forbidden')
    const employee = selected === undefined ? undefined : await this.deps.employee(principal, selected)
    let project: Project | undefined
    if (this.deps.projects !== undefined) {
      const explicit = await this.deps.sessionProject?.(principal, sessionId)
      let candidateId: ProjectId | undefined
      if (explicit !== undefined) candidateId = explicit.projectId === undefined ? undefined : projectId(explicit.projectId)
      else {
        const candidates = (await this.deps.projects.list(principal.orgId, principal))
          .filter(candidate => candidate.workspacePath === workspace.rootPath)
        if (candidates.length === 1) candidateId = candidates[0]?.projectId
      }
      if (candidateId !== undefined) {
        const candidate = await this.deps.projects.requireMember(principal.orgId, candidateId, { userId: principal.userId })
        if (candidate?.workspacePath === workspace.rootPath) project = candidate
      }
    }
    const memoryAvailable = (await security.authorizeResourceAsync(principal, 'memory.read', {
      orgId: principal.orgId, visibility: 'organization', scope: { type: 'organization' },
    })).allowed
    const memories: EnterpriseMemoryEntry[] = []
    if (memoryAvailable) {
      const shared = await identity.listMemories({ orgId: principal.orgId, statuses: ['approved'],
        departmentIds: workspace.departmentId === undefined ? [] : [workspace.departmentId] })
      for (const memory of shared) {
        if (memory.scope !== 'organization' && memory.scope !== 'department') continue
        if (memory.scope === 'department' && memory.departmentId !== workspace.departmentId) continue
        const decision = await security.authorizeResourceAsync(principal, 'memory.read', {
          orgId: principal.orgId, visibility: 'organization', scope: memory.scope === 'department' && memory.departmentId !== undefined
            ? { type: 'department', departmentId: memory.departmentId } : { type: 'organization' },
        })
        if (decision.allowed) memories.push(memory)
      }
      if (project !== undefined) memories.push(...await identity.listMemories({
        orgId: principal.orgId, statuses: ['approved'], scopes: ['project'], projectId: project.projectId,
      }))
      const actor = employee === undefined || selected === undefined ? undefined
        : await this.deps.privateActor(principal, sessionId, selected)
      if (actor?.employeeId !== undefined) {
        memories.push(...await identity.listMemories({ orgId: principal.orgId, statuses: ['approved'], scopes: ['agent'], agentEmployeeId: actor.employeeId }))
        if (actor.userId === undefined || actor.userId === principal.userId) {
          memories.push(...await identity.listMemories({ orgId: principal.orgId, statuses: ['approved'], scopes: ['pair'],
            agentEmployeeId: actor.employeeId, pairUserId: principal.userId }))
        }
      }
    }
    return Response.json({
      ...(employee === undefined ? {} : { employee }),
      ...(project === undefined ? {} : { project: {
        id: project.projectId, name: project.name, goal: project.goal, state: project.state,
      } }),
      memoryAvailable,
      memories: memories.map(({ id, scope, summary, status, createdAt, revision }) => ({
        id, scope, summary, status, createdAt, revision,
      })),
    })
  }

  /** Serve the presented-file list for one Session after member or session access.
   * @param principal - Authenticated principal.
   * @param sessionId - Native Session whose agent reply is being rendered.
   * @returns The presented files with their download coordinates.
   */
  private async fetchPresented(principal: EnterprisePrincipal, sessionId: string): Promise<Response> {
    if (this.deps.presentedFiles === undefined) return failure(503, 'session-context-unavailable')
    const accessible = await this.deps.security.sessionAccessibleBy(principal, sessionId)
    if (!accessible && !(this.deps.roomMember !== undefined && await this.deps.roomMember(principal, sessionId))) {
      return failure(403, 'forbidden')
    }
    return Response.json({ sessionId, files: await this.deps.presentedFiles(sessionId) })
  }
}

/** Compose read-only Session context from the mounted native and enterprise services.
 * @param ctx - Enterprise Host context; optional account/project providers remain optional.
 * @returns Handler with no Agent activation or mutation path.
 */
export function composeSessionContext(ctx: Context): SessionContextHttpHandler {
  const postgres = ctx.enterprisePostgres
  const security = ctx.enterpriseSecurity
  const query = ctx.get('sessionQuery')
  const projects = ctx.get('enterpriseProjects')
  return new SessionContextHttpHandler({
    identity: postgres.identity, security,
    sessionProject: async (principal, id) => {
      const binding = await postgres.collaboration.bySession(id)
      if (binding === undefined) return undefined
      const surface = await postgres.collaboration.get(principal.orgId, binding.surfaceId)
      return surface?.projectId === undefined ? {} : { projectId: surface.projectId }
    },
    ...(projects === undefined ? {} : { projects }),
    ...(query === undefined ? {} : { sessionEmployee: async (id: string) => {
      using observation = await query.observeSession(brandString<SessionId>(id))
      let selected: EmployeeReleaseSelection | null = null
      for (const event of observation.events) selected = employeeReleaseProjectionDefinition.apply(selected, event)
      return selected ?? undefined
    } }),
    ...(query === undefined ? {} : { presentedFiles: async (id: string) => {
      using observation = await query.observeSession(brandString<SessionId>(id))
      const files: PresentedFileEntry[] = []
      const turns = new Map<number, RoomTurnEvent[]>()
      for (const event of observation.events) {
        if (event.type !== 'assistant/message' && event.type !== 'turn/end') continue
        const records = turns.get(event.data.turn) ?? []
        records.push(event)
        turns.set(event.data.turn, records)
      }
      for (const event of observation.events) {
        if (event.type !== 'deliverables/presented') continue
        const replySourceSeq = roomTurnPost(turns.get(event.data.turn) ?? [], event.data.turn)?.sourceSeq
        event.data.files.forEach((file, index) => {
          files.push({ ...file, seq: event.seq, index, ...(replySourceSeq === undefined ? {} : { replySourceSeq }) })
        })
      }
      return files
    } }),
    roomMember: async (principal, id) => {
      const binding = await postgres.collaboration.bySession(id)
      if (binding === undefined) return false
      const room = await postgres.collaboration.get(principal.orgId, binding.surfaceId)
      return room !== undefined && room.memberUserIds.includes(principal.userId)
    },
    employee: async (principal, selected) => {
      if (!(await security.authorizeApiAsync(principal, 'enterpriseEmployee.getDraft', { presetId: selected.employeeId })).allowed) return undefined
      const release = await postgres.catalog.getRelease(selected.releaseId, principal.orgId)
      if (release?.orgId !== selected.orgId || release.presetId !== selected.employeeId
        || (selected.releaseVersion !== undefined && release.version !== selected.releaseVersion)) return undefined
      const definition = employeePresetDefinition(release)
      return { id: selected.employeeId, displayName: definition.name, role: [definition.position, definition.description].filter(Boolean).join('\n'),
        releaseVersion: definition.releaseVersion, capabilities: definition.capabilities ?? [],
        ...(definition.avatarSeed === undefined ? {} : { avatarSeed: definition.avatarSeed }) }
    },
    privateActor: async (principal, sessionId, selected) => {
      if (selected.ownerUserId !== principal.userId || await postgres.collaboration.bySession(sessionId) !== undefined) return undefined
      const accounts = ctx.get('employeeAccounts')
      const actor = accounts?.resolveSessionActor(sessionId)
      if (actor === undefined) return { employeeId: selected.employeeId, userId: principal.userId }
      if (actor.orgId !== principal.orgId || actor.employeeId === undefined
        || actor.userId !== principal.userId) return undefined
      const account = accounts?.get(employeeId(actor.employeeId))
      if (account?.orgId !== principal.orgId || account.activeReleaseId !== selected.releaseId || account.state === 'archived') return undefined
      return actor
    },
  })
}
