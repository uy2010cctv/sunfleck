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
import { employeePresetDefinition } from './employee-preset.ts'
import { failure, methodFailure } from './http.ts'

/** Published employee metadata, without runtime prompts or internal paths. */
export interface SessionContextEmployee {
  readonly id: string
  readonly displayName: string
  readonly role: string
  readonly releaseVersion?: number
  readonly capabilities: readonly string[]
}

/** Read-only sources used after Session and Workspace authorization. */
export interface SessionContextDependencies {
  identity: Pick<EnterpriseIdentityStore, 'sessionWorkspaceGrant' | 'listWorkspaceGrants' | 'listMemories'>
  security: Pick<EnterpriseSecurity, 'authenticateCookieAsync' | 'sessionAccessibleBy' | 'authorizeApiAsync' | 'authorizeResourceAsync'>
  /** Reads the current preset projection without activating a Session. */
  sessionPreset?: (sessionId: string) => Promise<string | undefined>
  /** Resolves visible published metadata for the preset. */
  employee: (principal: EnterprisePrincipal, presetId: string) => Promise<SessionContextEmployee | undefined>
  /** Returns only a durable account anchor whose active release matches the native preset. */
  privateActor: (orgId: string, sessionId: string, presetId: string) => Promise<Pick<SessionMemoryActor, 'employeeId' | 'userId'> | undefined>
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
    if (this.deps.sessionPreset === undefined) return failure(503, 'session-context-unavailable')
    const presetId = await this.deps.sessionPreset(sessionId)
    const employee = presetId === undefined ? undefined : await this.deps.employee(principal, presetId)
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
      const actor = employee === undefined || presetId === undefined ? undefined
        : await this.deps.privateActor(principal.orgId, sessionId, presetId)
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
    ...(query === undefined ? {} : { sessionPreset: async (id: string) => {
      using observation = await query.observeSession(brandString<SessionId>(id))
      if (observation.projections === undefined) throw new Error('session context requires current Session projections')
      return observation.projections.values.agentPreset ?? undefined
    } }),
    employee: async (principal, presetId) => {
      if (!(await security.authorizeApiAsync(principal, 'enterpriseEmployee.getDraft', { presetId })).allowed) return undefined
      const draft = await postgres.catalog.getDraft(presetId, principal.orgId)
      if (draft?.status !== 'published') return undefined
      const release = (await postgres.catalog.listReleases(presetId, principal.orgId)).toSorted((a, b) => b.version - a.version)[0]
      if (release === undefined) return undefined
      const definition = employeePresetDefinition(release)
      return { id: presetId, displayName: definition.name, role: [definition.position, definition.description].filter(Boolean).join('\n'),
        releaseVersion: definition.releaseVersion, capabilities: definition.capabilities ?? [] }
    },
    privateActor: async (orgId, sessionId, presetId) => {
      const accounts = ctx.get('employeeAccounts')
      const actor = accounts?.resolveSessionActor(sessionId)
      if (actor?.orgId !== orgId || actor.employeeId === undefined) return undefined
      const account = accounts?.get(employeeId(actor.employeeId))
      if (account?.orgId !== orgId || account.activeReleaseId === undefined || account.state === 'archived') return undefined
      const release = await postgres.catalog.getRelease(account.activeReleaseId, orgId)
      return release?.presetId === presetId ? actor : undefined
    },
  })
}
