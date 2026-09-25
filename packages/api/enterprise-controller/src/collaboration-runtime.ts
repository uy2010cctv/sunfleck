/** Native Session and TeamRun adapters for PostgreSQL conversations; no separate employee runtime is created. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { hasSessionPromptRequest } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { classifyPrivacyForScope, inspectEnterpriseMemory, memorySourceDigest } from '@deepseek-ai/dsh-enterprise-identity'
import { MEMORY_ANNOUNCEMENT_SUMMARY_CHARS } from '@deepseek-ai/dsh-enterprise-surface'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type { EnterpriseOperationsService, EnterpriseTeamControlService } from '@deepseek-ai/dsh-enterprise-operations'
import { projectId } from '@deepseek-ai/dsh-enterprise-project'
import type { CollaborationRecord } from '@deepseek-ai/dsh-enterprise-postgres'
import { CollaborationService, CollaborationError, type CollaborationMessageInput } from './collaboration-service.ts'
import { findCollaborationRequest } from './collaboration-receipt.ts'
import { CollaborationHttpHandler } from './collaboration-http.ts'

declare module '@deepseek-ai/dsh-api-session-controller/types' {
  interface UserRpcMessageSource {
    /** Conversation that routed this authenticated message. */
    readonly surfaceId?: string
    /** Authenticated human sender of the collaboration message. */
    readonly originActor?: string
    /** Channel topic selected by the Host. */
    readonly topicId?: string
  }
}

/** Compose authenticated collaboration HTTP and native composer routing.
 * @param ctx - Existing enterprise Host context.
 * @param services - Existing authorized operations and team control services.
 * @returns HTTP handler over the same routing coordinator as native prompts.
 */
export function composeCollaboration(ctx: Context, services: {
  operations: () => EnterpriseOperationsService
  teams: () => EnterpriseTeamControlService
}): CollaborationHttpHandler {
  const database = ctx.enterprisePostgres
  const security = ctx.enterpriseSecurity
  const store = database.collaboration
  const scoped = <T>(actor: EnterprisePrincipal,
    operation: () => Promise<T>): Promise<T> => ctx.enterpriseRequestContext.run(actor, operation)
  const employee = async (actor: EnterprisePrincipal, id: string) => {
    if (!(await security.authorizeApiAsync(actor, 'enterpriseEmployee.getDraft', { presetId: id })).allowed) return undefined
    const draft = await database.catalog.getDraft(id, actor.orgId)
    if (draft?.status !== 'published') return undefined
    const release = (await database.catalog.listReleases(id, actor.orgId)).toSorted((a, b) => b.version - a.version)[0]
    if (release === undefined) return undefined
    const displayName = draft.profile['displayName'] ?? draft.profile['name'] ?? id
    return { employeeId: id, displayName: typeof displayName === 'string' ? displayName : id, releaseId: release.releaseId }
  }
  const resume = async (actor: EnterprisePrincipal, id: string, row: CollaborationRecord) => {
    const binding = (await store.sessions(row.id)).find(value => value.sessionId === id)
    if (binding === undefined) throw new CollaborationError('session-unavailable', 409)
    if (!await security.sessionAccessibleBy(actor, id)) throw new CollaborationError('session-forbidden', 403)
    await scoped(actor, () => ctx.sessionController.create({ sessionId: brandString<SessionId>(id),
      workspaceId: brandString<WorkspaceId>(row.workspaceId), ...(binding.employeeId === '' ? {} : { agentPreset: binding.employeeId }) }))
    const agent = ctx.agents.get(brandString<SessionId>(id))
    if (agent === undefined) throw new CollaborationError('session-unavailable', 503)
    return agent
  }
  const deliver = async (actor: EnterprisePrincipal, id: string, row: CollaborationRecord, input: CollaborationMessageInput,
    run: boolean) => {
    const agent = await resume(actor, id, row)
    const rpcId = brandString<SessionRequestId>(input.messageId ?? randomUUID())
    const landed = () => hasSessionPromptRequest(agent, rpcId)
    if (landed()) return
    const message = createUserMessage({ content: [{ type: 'text', text: input.text }], source: {
      kind: 'user', rpcId, surfaceId: row.id, originActor: actor.userId,
      ...(input.topicId === undefined ? {} : { topicId: input.topicId }),
    } })
    if (run) agent.steer(message)
    else agent.session.append('user/message', message, { surfaceOp: 'append' })
    await ctx.sessions.flush(agent.session)
    if (!landed()) throw new CollaborationError('delivery-not-landed', 502)
  }
  const service = new CollaborationService(store, {
    refreshWorkspace: (workspaceId) => { ctx.emit('workspace/visibility-changed', brandString<WorkspaceId>(workspaceId)) },
    workspaceVisible: async (actor, id) => (await security.authorizeApiAsync(actor, 'session.create', { workspaceId: id })).allowed,
    memberWorkspaceVisible: async (orgId, userId, workspaceId) => (await database.identity.listWorkspaceGrants({ orgId,
      userId })).some(grant => grant.workspaceId === workspaceId),
    employee,
    project: async (actor, id) => {
      const project = await database.projects.requireMember(actor.orgId, projectId(id), { userId: actor.userId })
      if (project === undefined) return undefined
      return { id, name: project.name, goal: project.goal }
    },
    team: async (actor, id) => {
      const team = await services.operations().getTeamDefinition(actor, { teamId: id })
      return team === undefined ? undefined : { id, name: team.name }
    },
    createSession: async (actor, input) => scoped(actor, async () => {
      const value = await ctx.sessionController.create({ sessionId: brandString<SessionId>(input.sessionId),
        workspaceId: brandString<WorkspaceId>(input.workspaceId), agentPreset: input.employee.employeeId })
      await security.bindSessionWorkspaceAsync(actor, value.sessionId, input.workspaceId)
      await services.operations().upsertWorkRecord(actor, {
        sessionId: value.sessionId, employeeReleaseId: input.employee.releaseId, source: 'console', businessState: 'active',
        sourceReferences: { employeeReleaseId: input.employee.releaseId, releasePresetId: input.employee.employeeId },
        expectedRevision: 0, idempotencyKey: input.sessionId,
      })
      return value.sessionId
    }),
    prompt: (actor, id, row, input) => deliver(actor, id, row, input, true),
    record: (actor, id, row, input) => deliver(actor, id, row, input, false),
    ingest: async (actor, row, input) => {
      const summary = input.text.trim().slice(0, MEMORY_ANNOUNCEMENT_SUMMARY_CHARS)
      if (summary === '') return { delivered: false, reason: 'invalid-text' }
      if (!classifyPrivacyForScope(inspectEnterpriseMemory(summary).findings,
        'organization').allowed) return { delivered: false, reason: 'privacy-gated' }
      const id = memorySourceDigest(JSON.stringify([row.id, actor.userId, input.messageId ?? summary]))
      const sourceDigest = memorySourceDigest(JSON.stringify([row.id, actor.userId, summary]))
      const storedDigest = async () => (await database.database.query<{ source_digest: string }>(
        'SELECT source_digest FROM enterprise_memories WHERE id=$1 AND org_id=$2', [id, actor.orgId],
      )).rows[0]?.source_digest
      const prior = await storedDigest()
      if (prior !== undefined && prior !== sourceDigest) throw new CollaborationError('message-id-conflict', 409)
      if (prior === undefined) {
        try {
          await database.identity.proposeMemory({ id, orgId: actor.orgId, scope: 'organization', kind: 'business-fact',
            summary, sourceDigest, createdBy: actor.userId })
        } catch (error) {
          // Concurrent retries can commit the same proposal before this insert.
          if (await storedDigest() !== sourceDigest) throw error
        }
      }
      return { delivered: true, targets: [] }
    },
    teamSession: async (actor, row, runId) => {
      if (row.teamDefinitionId === undefined || ctx.get('enterpriseTeamRuntimeDriver') === undefined) return undefined
      const bound = await store.sessions(row.id)
      const runs = (await services.teams().listRuns(actor, { teamId: row.teamDefinitionId })).items
        .filter(run => bound.some(value => value.sessionId === run.rootSessionId))
        .toSorted((a, b) => b.createdAt - a.createdAt || b.runId.localeCompare(a.runId))
      const selected = runId === undefined
        ? runs.find(run => run.state === 'active' || run.state === 'starting' || run.state === 'waiting-human' || run.state === 'verifying') ?? runs[0]
        : runs.find(run => run.runId === runId)
      return selected === undefined ? undefined : bound.find(value => value.sessionId === selected.rootSessionId)
    },
    teamMessage: async (actor, row, input) => {
      if (row.teamDefinitionId === undefined) throw new CollaborationError('team-required')
      const runtime = ctx.get('enterpriseTeamRuntimeDriver')
      if (runtime === undefined) return { delivered: false, reason: 'team-runtime-unavailable' }
      const bound = await store.sessions(row.id)
      if (input.messageId !== undefined) {
        const priorTarget = await findCollaborationRequest(bound, {
          surfaceId: row.id, actorUserId: actor.userId, requestId: input.messageId,
        }, async function* (id) {
          const handle = await ctx.sessionPersistence.open(brandString<SessionId>(id), 'read')
          try {
            for (let offset = 0; ; offset += 256) {
              const { events } = await handle.read(offset, 256)
              for (const event of events) yield event
              if (events.length < 256) break
            }
          } finally { await handle.close() }
        })
        if (priorTarget !== undefined) {
          if (input.sourceSessionId !== undefined && input.sourceSessionId !== priorTarget) {
            await deliver(actor, input.sourceSessionId, row, input, false)
          }
          return { delivered: true, targets: [{ sessionId: priorTarget }] }
        }
      }
      const definition = await services.operations().getTeamDefinition(actor, { teamId: row.teamDefinitionId })
      if (definition === undefined || definition.state !== 'active') return { delivered: false, reason: 'team-inactive' }
      const control = services.teams()
      const prior = (await control.listRuns(actor, { teamId: row.teamDefinitionId })).items.find(run =>
        run.workspaceId === row.workspaceId && bound.some(value => value.sessionId === run.rootSessionId)
        && run.state !== 'completed' && run.state !== 'failed' && run.state !== 'cancelled')
      if (prior !== undefined && prior.state !== 'active') return { delivered: false, reason: 'team-run-not-active' }
      const active = prior
      const run = active ?? await control.startRun(actor, { teamId: row.teamDefinitionId,
        expectedTeamRevision: definition.revision, workspaceId: row.workspaceId, prompt: input.text, source: 'channel',
        idempotencyKey: `${row.id}:${input.messageId ?? randomUUID()}`,
        ...(input.messageId === undefined ? {} : { surfaceMessage: { requestId: input.messageId, originSurfaceId: row.id } }) })
      if (run.rootSessionId === undefined) return { delivered: false, reason: 'team-not-started' }
      // startRun submits the first prompt; only reused runs need another input.
      if (active !== undefined) await runtime.submitRunInput(run.runId, { actorUserId: actor.userId, text: input.text,
        originSurfaceId: row.id, ...(input.messageId === undefined ? {} : { requestId: input.messageId }) })
      await store.bind({ surfaceId: row.id, topicId: run.runId, employeeId: '', sessionId: run.rootSessionId })
      ctx.emit('workspace/visibility-changed', brandString<WorkspaceId>(row.workspaceId))
      if (input.sourceSessionId !== undefined && input.sourceSessionId !== run.rootSessionId) {
        await deliver(actor, input.sourceSessionId, row, input, false)
      }
      return { delivered: true, targets: [{ sessionId: run.rootSessionId }] }
    },
  })
  ctx.on('api/session-prompt', async (request, next) => {
    const binding = await store.bySession(request.sessionId)
    if (binding === undefined) return next()
    const actor = ctx.enterpriseRequestContext.requirePrincipal()
    if (request.content.some(part => part.type !== 'text')) throw new CollaborationError('text-only-collaboration')
    const text = request.content.map(part => part.type === 'text' ? part.text : '').join('\n')
    const result = await service.message(actor, binding.surfaceId, {
      text, messageId: request.requestId, sourceSessionId: request.sessionId,
      ...(binding.topicId === '' ? {} : { topicId: binding.topicId }),
    })
    if (!result.delivered) throw new CollaborationError(result.reason, 409)
    return { accepted: true, routedSessionIds: result.targets.map(target => brandString<SessionId>(target.sessionId)) }
  })
  return new CollaborationHttpHandler(service, security)
}
