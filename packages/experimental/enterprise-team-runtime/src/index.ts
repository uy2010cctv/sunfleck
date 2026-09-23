/** Enterprise TeamRun driver over the existing Agent Teams Session domain. */

import { createHash } from 'node:crypto'
import type { Agent, AgentHandle, AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type { Context } from '@deepseek-ai/cordis'
import type { EmployeeReleaseView } from '@deepseek-ai/dsh-enterprise-catalog'
import type {} from '@deepseek-ai/dsh-enterprise-auth-web'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type {} from '@deepseek-ai/dsh-enterprise-postgres'
import {
  EnterpriseTeamRuntimeError,
  type EnterpriseTeamRuntimeDriver,
  type EnterpriseTeamRuntimeMutation,
  type EnterpriseTeamRuntimeReconciliation,
  type EnterpriseTeamRuntimeStart,
  type EnterpriseTeamRunSubmission,
} from '@deepseek-ai/dsh-enterprise-operations'
import type { TeamReleaseSnapshot } from '@deepseek-ai/dsh-experimental-agent-team'
import { teamProjectionDefinition } from '@deepseek-ai/dsh-experimental-agent-team/src/projection.ts'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session'
import { SessionPersistenceNotFoundError } from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-subagent'
import { PERSONA_PREFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'

declare module '@deepseek-ai/cordis' {
  interface Context {
    enterpriseTeamRuntimeDriver: EnterpriseTeamRuntimeDriver
  }
}

/** Source of a user message injected into a chartered TeamRun from one conversation surface. */
export interface TeamRunMessageSource {
  readonly kind: 'team-run-message'
  /** Run the input was submitted to. */
  readonly runId: string
  /** Conversation surface the message arrived on. */
  readonly originSurfaceId: string
  /** Enterprise user that originated the message. */
  readonly actorUserId: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'team-run-message': TeamRunMessageSource
  }
}

/** Services required before the runtime driver can admit enterprise work. */
export const inject = [
  'agents',
  'agentTeams',
  'agentPresets',
  'enterprisePostgres',
  'enterpriseRequestContext',
  'sessionPersistence',
  'sessions',
  'subagents',
  'workspaceRegistry',
]

interface ResolvedRelease {
  readonly durable: TeamReleaseSnapshot
  readonly agentOptions: AgentOptions
  readonly persona: string
  readonly presetId: string
}

/** Fold durable Team events through the public Team projection contract. */
function projectTeam(header: SessionHeader, events: readonly SessionEvent[]) {
  let state = teamProjectionDefinition.init(header)
  for (const event of events) state = teamProjectionDefinition.apply(state, event)
  return state
}

function deterministicRootSessionId(runId: string): SessionId {
  const digest = createHash('sha256').update(`dsh-enterprise-team-run\0${runId}`).digest('hex').slice(0, 32)
  return SessionId(`enterprise-team-${digest}`)
}

function requiredProfileText(release: EmployeeReleaseView, field: string): string {
  const value = release.snapshot.profile[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new EnterpriseTeamRuntimeError('deterministic', 'invalid-release-profile', `employee release ${release.releaseId} has no ${field}`)
  }
  return value.trim()
}

function modelRoute(release: EmployeeReleaseView): { provider: string; model: string } {
  const value = release.snapshot.profile['modelRef']
  if (typeof value === 'string') {
    const separator = value.indexOf('/')
    if (separator > 0 && separator < value.length - 1) {
      return { provider: value.slice(0, separator), model: value.slice(separator + 1) }
    }
  } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const route = value as Record<string, unknown>
    if (typeof route['provider'] === 'string' && route['provider'].trim() !== ''
      && typeof route['model'] === 'string' && route['model'].trim() !== '') {
      return { provider: route['provider'].trim(), model: route['model'].trim() }
    }
  }
  throw new EnterpriseTeamRuntimeError(
    'deterministic',
    'unsupported-model-binding',
    `employee release ${release.releaseId} does not carry a configured provider/model route`,
  )
}

function employeePersona(release: EmployeeReleaseView): string {
  const name = requiredProfileText(release, 'name')
  const prompt = requiredProfileText(release, 'prompt')
  return `You are the immutable enterprise digital employee "${name}" from release ${release.releaseId}.\n\n${prompt}`
}

function safeMemberName(roleId: string, index: number): string {
  const normalized = roleId.trim().toLowerCase().replaceAll(/[^a-z0-9]+/gu, '-').replaceAll(/^-|-$/gu, '')
  const base = normalized === '' || normalized === 'lead' ? `member-${String(index + 1)}` : normalized
  return `${base}-${String(index + 1)}`.slice(0, 64).replace(/-$/u, '')
}

/** Runtime provider retaining only process-local Agent handles; Session logs own durable state. */
export class EnterpriseTeamRuntimeAdapter implements EnterpriseTeamRuntimeDriver {
  private readonly handles = new Map<SessionId, AgentHandle>()

  constructor(private readonly ctx: Context) {}

  async startRun(input: Parameters<EnterpriseTeamRuntimeDriver['startRun']>[0]): Promise<EnterpriseTeamRuntimeStart> {
    this.assertOrganization(input.actor, input.orgId, input.definition.orgId)
    if (input.definition.state !== 'active') this.fail('team-definition-inactive')
    const rootId = deterministicRootSessionId(input.runId)
    const persisted = await this.inspect(rootId)
    if (persisted !== undefined) {
      const folded = projectTeam(persisted.header, persisted.events)
      if (folded.run?.runId !== input.runId || folded.run.operationId !== input.operationId) {
        this.fail('team-run-identity-conflict')
      }
      const receipt = folded.operations.get(input.operationId)
      if (receipt !== undefined && folded.run.state !== 'starting') {
        return { rootSessionId: rootId, ...receipt }
      }
    }

    const workspace = await this.resolveWorkspace(input.workspaceId, input.orgId)
    const releases = await this.resolveRosterReleases(input.definition, input.orgId)
    const leader = releases.get(input.definition.leaderEmployeeReleaseId)
    if (leader === undefined) this.fail('leader-release-not-in-roster')
    const users = await this.ctx.enterprisePostgres.identity.listUsers(input.orgId)
    const actorUser = users.find(user => user.id === input.actor.userId)
    if (actorUser === undefined) this.fail('actor-user-not-found')

    let root: Agent | undefined
    let createdHandle: AgentHandle | undefined
    let startCommitted = false
    try {
      if (persisted === undefined) {
        const composition = await this.composition(leader)
        createdHandle = await this.ctx.enterpriseRequestContext.withoutPrincipal(() => this.ctx.agents.create({
          sessionId: rootId,
          meta: { cwd: workspace.path, agentPreset: leader.presetId },
          agentOptions: leader.agentOptions,
          setup: composition,
        }))
        root = createdHandle.agent
        this.handles.set(rootId, createdHandle)
        await workspace.attachSession(rootId)
        await this.ctx.enterprisePostgres.identity.bindSessionWorkspace({
          sessionId: rootId,
          workspaceId: input.workspaceId,
          orgId: input.orgId,
          ownerUserId: input.actor.userId,
        })
      } else {
        root = await this.ctx.enterpriseRequestContext.withoutPrincipal(() => this.resumeRoot(rootId, leader))
      }
      const runtimeRoot = root

      await this.ctx.enterpriseRequestContext.withoutPrincipal(() => this.ctx.agentTeams.startRun(runtimeRoot, {
        runId: input.runId,
        orgId: input.orgId,
        teamDefinitionRevision: input.definition.revision,
        workspaceId: input.workspaceId,
        operationId: input.operationId,
        actor: { userId: input.actor.userId, displayName: actorUser.displayName },
        leader: {
          sessionId: runtimeRoot.id,
          roleId: this.leaderRole(input.definition),
          release: leader.durable,
        },
      }))
      startCommitted = true

      for (const rosterMember of input.definition.roster) {
        const memberActor = rosterMember.actor
        if (memberActor.kind !== 'human') continue
        const user = users.find(candidate => candidate.id === memberActor.userId)
        if (user === undefined) this.fail('human-roster-user-not-found')
        await this.ctx.enterpriseRequestContext.withoutPrincipal(() => this.ctx.agentTeams.registerHuman(runtimeRoot, {
          userId: user.id, displayName: user.displayName, roleId: rosterMember.roleId,
        }))
      }

      let agentIndex = 0
      for (const rosterMember of input.definition.roster) {
        const memberActor = rosterMember.actor
        if (memberActor.kind !== 'agent'
          || memberActor.employeeReleaseId === input.definition.leaderEmployeeReleaseId) continue
        const resolved = releases.get(memberActor.employeeReleaseId)
        if (resolved === undefined) this.fail('agent-release-not-found')
        const current = projectTeam(root.session.header, root.session.snapshotEvents())
        const existing = [...current.members.values()].find(member =>
          member.employeeReleaseId === memberActor.employeeReleaseId && member.roleId === rosterMember.roleId)
        if (existing !== undefined) { agentIndex++; continue }
        await this.ctx.enterpriseRequestContext.withoutPrincipal(() => this.ctx.agentTeams.spawnTeammate(runtimeRoot, {
          name: safeMemberName(rosterMember.roleId, agentIndex++),
          description: this.roleResponsibility(input.definition, rosterMember.roleId),
          prompt: [{ type: 'text', text: this.rolePrompt(input.prompt, rosterMember.roleId, resolved.persona) }],
          context: 'fresh',
          provider: 'spawn',
          agentOptions: resolved.agentOptions,
          persona: resolved.persona,
          employeeReleaseId: resolved.durable.releaseId,
          roleId: rosterMember.roleId,
          release: resolved.durable,
          signal: new AbortController().signal,
        }))
      }

      const active = await this.ctx.enterpriseRequestContext.withoutPrincipal(() => this.ctx.agentTeams.setRunState(runtimeRoot, {
        operationId: input.operationId,
        state: 'active',
        actor: { userId: input.actor.userId, displayName: actorUser.displayName },
      }))
      const activeRoot = runtimeRoot
      this.ctx.enterpriseRequestContext.withoutPrincipal(() => {
        activeRoot.followup(createUserMessage({
          content: [{ type: 'text', text: input.prompt }],
          source: { kind: 'plugin', plugin: 'enterprise-team-runtime' },
        }))
      })
      await this.ctx.sessions.flush(root.session)
      return { rootSessionId: root.id, ...active }
    } catch (error: unknown) {
      if (startCommitted && root !== undefined) {
        const failedRoot = root
        try {
          const failure = error instanceof EnterpriseTeamRuntimeError ? error.code : 'team-member-start-failed'
          await this.ctx.enterpriseRequestContext.withoutPrincipal(() => this.ctx.agentTeams.setRunState(failedRoot, {
            operationId: input.operationId,
            state: 'failed',
            actor: { userId: input.actor.userId, displayName: actorUser.displayName },
            failure: { code: failure },
          }))
          const children = projectTeam(failedRoot.session.header, failedRoot.session.snapshotEvents()).members.map(member => member.id)
          await this.ctx.enterpriseRequestContext.withoutPrincipal(() =>
            this.ctx.subagents.drainContinuableChildren(failedRoot, children))
        } catch {
          throw new EnterpriseTeamRuntimeError('unknown', 'team-start-cleanup-failed')
        }
      }
      const ownedHandle = this.handles.get(rootId)
      if (ownedHandle !== undefined) {
        await ownedHandle.dispose().catch(() => undefined)
        this.handles.delete(rootId)
      }
      if (error instanceof EnterpriseTeamRuntimeError) throw error
      throw new EnterpriseTeamRuntimeError('deterministic', 'team-member-start-failed')
    }
  }

  async cancelRun(input: Parameters<EnterpriseTeamRuntimeDriver['cancelRun']>[0]): Promise<EnterpriseTeamRuntimeMutation> {
    this.assertOrganization(input.actor, input.run.orgId, input.run.orgId)
    const rootId = this.rootIdFor(input.run.runId, input.run.rootSessionId)
    const root = await this.ctx.enterpriseRequestContext.withoutPrincipal(() => this.resumeFromLog(rootId))
    const before = projectTeam(root.session.header, root.session.snapshotEvents())
    const repeated = before.operations.get(input.operationId)
    if (repeated !== undefined) return repeated
    const user = await this.requireUser(input.actor)
    const receipt = await this.ctx.enterpriseRequestContext.withoutPrincipal(() => this.ctx.agentTeams.setRunState(root, {
      operationId: input.operationId,
      state: 'cancelled',
      actor: { userId: input.actor.userId, displayName: user.displayName },
    }))
    this.ctx.enterpriseRequestContext.withoutPrincipal(() => {
      root.cancel({ kind: 'user' }, { keepInbox: true })
    })
    const children = projectTeam(root.session.header, root.session.snapshotEvents()).members.map(member => member.id)
    for (const childId of children) {
      this.ctx.enterpriseRequestContext.withoutPrincipal(() => {
        this.ctx.subagents.interrupt(childId, { kind: 'user', parentSessionId: root.id })
      })
    }
    await Promise.all([
      root.whenIdle(),
      ...children.flatMap((childId) => {
        const child = this.ctx.agents.get(childId)
        return child === undefined ? [] : [child.whenIdle()]
      }),
    ])
    await this.ctx.sessions.flush(root.session)
    return receipt
  }

  async respondDecision(
    input: Parameters<EnterpriseTeamRuntimeDriver['respondDecision']>[0],
  ): Promise<EnterpriseTeamRuntimeMutation> {
    this.assertOrganization(input.actor, input.decision.orgId, input.decision.orgId)
    const root = await this.ctx.enterpriseRequestContext.withoutPrincipal(() =>
      this.resumeFromLog(deterministicRootSessionId(input.decision.runId)))
    const before = projectTeam(root.session.header, root.session.snapshotEvents())
    const repeated = before.operations.get(input.operationId)
    if (repeated !== undefined) return repeated
    const user = await this.requireUser(input.actor)
    const receipt = await this.ctx.enterpriseRequestContext.withoutPrincipal(() => this.ctx.agentTeams.respondDecision(root, {
      operationId: input.operationId,
      decisionId: input.decision.decisionId,
      expectedRevision: input.decision.revision,
      answer: input.answer,
      actor: { userId: input.actor.userId, displayName: user.displayName },
    }))
    this.ctx.enterpriseRequestContext.withoutPrincipal(() => {
      root.followup(createUserMessage({
        content: [{ type: 'text', text: `Human decision ${input.decision.decisionId}: ${input.answer}` }],
        source: { kind: 'plugin', plugin: 'enterprise-team-runtime' },
      }))
    })
    await this.ctx.sessions.flush(root.session)
    return receipt
  }

  async reconcileRun(
    input: Parameters<EnterpriseTeamRuntimeDriver['reconcileRun']>[0],
  ): Promise<EnterpriseTeamRuntimeReconciliation> {
    const rootId = this.rootIdFor(input.run.runId, input.run.rootSessionId)
    const stored = await this.inspect(rootId)
    if (stored === undefined) return { state: 'starting', runtimeRevision: 0 }
    const state = projectTeam(stored.header, stored.events)
    if (state.run === undefined || state.run.runId !== input.run.runId) {
      throw new EnterpriseTeamRuntimeError('deterministic', 'team-run-log-mismatch')
    }
    const receipt = state.operations.get(state.run.operationId)
    return {
      rootSessionId: rootId,
      state: state.run.state,
      runtimeRevision: state.run.runtimeRevision,
      ...(receipt === undefined ? {} : { sourceEventSeq: receipt.sourceEventSeq }),
      ...(state.run.failure === undefined ? {} : { failure: state.run.failure }),
    }
  }

  /** Dispose process-local handles without deleting any persisted Session state. */
  async dispose(): Promise<void> {
    const failures: unknown[] = []
    for (const [id, handle] of [...this.handles]) {
      try { await handle.dispose() } catch (error: unknown) { failures.push(error) }
      this.handles.delete(id)
    }
    if (failures.length > 0) throw new AggregateError(failures, 'enterprise Team runtime handle disposal failed')
  }

  async submitRunInput(
    runId: string,
    input: Parameters<EnterpriseTeamRuntimeDriver['submitRunInput']>[1],
  ): Promise<EnterpriseTeamRunSubmission> {
    const root = await this.ctx.enterpriseRequestContext.withoutPrincipal(() =>
      this.resumeFromLog(deterministicRootSessionId(runId)))
    const state = projectTeam(root.session.header, root.session.snapshotEvents())
    if (state.run === undefined || state.run.runId !== runId) this.fail('team-run-log-mismatch')
    const matchesSubmission = (message: UserMessage): boolean =>
      message.source.kind === 'team-run-message' && message.source.runId === runId
    const submittedBefore = root.session.snapshotEvents()
      .filter(event => event.type === 'user/message' && matchesSubmission(event.data)).length
    this.ctx.enterpriseRequestContext.withoutPrincipal(() => {
      root.followup(createUserMessage({
        content: [{ type: 'text', text: input.text }],
        source: {
          kind: 'team-run-message',
          runId,
          originSurfaceId: input.originSurfaceId,
          actorUserId: input.actorUserId,
        },
      }))
    })
    await this.ctx.sessions.flush(root.session)
    const events = root.session.snapshotEvents()
    const appended = events.filter(event => event.type === 'user/message' && matchesSubmission(event.data))
    const landed = appended.at(-1)
    if (appended.length === submittedBefore || landed === undefined) {
      throw new EnterpriseTeamRuntimeError('unknown', 'team-run-input-not-landed', `run ${runId} did not record the submitted input in its root session log`)
    }
    return { runtimeRevision: state.run.runtimeRevision, sourceEventSeq: landed.seq }
  }

  private async resolveRosterReleases(
    definition: Parameters<EnterpriseTeamRuntimeDriver['startRun']>[0]['definition'],
    orgId: string,
  ): Promise<Map<string, ResolvedRelease>> {
    const ids = new Set(definition.roster.flatMap(member =>
      member.actor.kind === 'agent' ? [member.actor.employeeReleaseId] : []))
    ids.add(definition.leaderEmployeeReleaseId)
    const result = new Map<string, ResolvedRelease>()
    for (const id of ids) result.set(id, await this.resolveRelease(id, orgId))
    return result
  }

  private async resolveRelease(releaseId: string, orgId: string): Promise<ResolvedRelease> {
    const release = await this.ctx.enterprisePostgres.catalog.getRelease(releaseId, orgId)
    if (release === undefined) this.fail('employee-release-not-found')
    if (release.snapshot.bindings.length > 0) this.fail('unsupported-release-bindings')
    const route = modelRoute(release)
    return {
      durable: {
        releaseId: release.releaseId,
        digest: release.digest,
        presetId: release.presetId,
        modelRef: route,
        capabilityBindings: release.snapshot.bindings,
      },
      agentOptions: route,
      persona: employeePersona(release),
      presetId: release.presetId,
    }
  }

  private async resolveWorkspace(workspaceId: string, orgId: string) {
    const grant = await this.ctx.enterprisePostgres.identity.workspaceGrant(workspaceId)
    if (grant === undefined || grant.orgId !== orgId) this.fail('workspace-not-found')
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined || workspace.path !== grant.rootPath || await workspace.status() !== 'ok') {
      this.fail('workspace-runtime-mismatch')
    }
    return workspace
  }

  private async composition(release: ResolvedRelease) {
    const preset = await this.ctx.agentPresets.resolve(release.presetId)
    if (preset.id !== release.presetId) this.fail('employee-preset-mismatch')
    return async (agentCtx: Context): Promise<void> => {
      await this.ctx.agentPresets.mount(agentCtx, release.presetId)
      agentCtx.systemPrompt.section({
        name: PERSONA_PREFIX_SECTION,
        order: agentCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
        text: release.persona,
      })
    }
  }

  private async resumeRoot(rootId: SessionId, release: ResolvedRelease): Promise<Agent> {
    const live = this.ctx.agents.get(rootId)
    if (live !== undefined) return live
    const handle = await this.ctx.agents.resume({
      resumeSessionId: rootId,
      agentOptions: release.agentOptions,
      setup: await this.composition(release),
    })
    this.handles.set(rootId, handle)
    return handle.agent
  }

  private async resumeFromLog(rootId: SessionId): Promise<Agent> {
    const live = this.ctx.agents.get(rootId)
    if (live !== undefined) return live
    const stored = await this.inspect(rootId)
    if (stored === undefined) this.fail('team-run-not-found')
    const state = projectTeam(stored.header, stored.events)
    const run = state.run
    if (run === undefined) this.fail('team-run-not-found')
    const release = await this.resolveRelease(run.leader.release.releaseId, run.orgId)
    if (JSON.stringify(release.durable) !== JSON.stringify(run.leader.release)) this.fail('employee-release-drift')
    return this.resumeRoot(rootId, release)
  }

  private async inspect(rootId: SessionId) {
    const live = this.ctx.sessions.get(rootId)
    if (live !== undefined) return { header: live.header, events: live.snapshotEvents() }
    try {
      const handle = await this.ctx.sessionPersistence.open(rootId, 'read')
      try {
        const { events } = await handle.read()
        return { header: handle.header, events }
      } finally {
        await handle.close()
      }
    } catch (error: unknown) {
      if (error instanceof SessionPersistenceNotFoundError) return undefined
      throw error
    }
  }

  private async requireUser(actor: EnterprisePrincipal) {
    const user = (await this.ctx.enterprisePostgres.identity.listUsers(actor.orgId))
      .find(candidate => candidate.id === actor.userId)
    if (user === undefined) this.fail('actor-user-not-found')
    return user
  }

  private rootIdFor(runId: string, projected?: string): SessionId {
    const expected = deterministicRootSessionId(runId)
    if (projected !== undefined && projected !== expected) this.fail('team-run-root-mismatch')
    return expected
  }

  private leaderRole(definition: Parameters<EnterpriseTeamRuntimeDriver['startRun']>[0]['definition']): string {
    const member = definition.roster.find(candidate => candidate.actor.kind === 'agent'
      && candidate.actor.employeeReleaseId === definition.leaderEmployeeReleaseId)
    if (member === undefined) this.fail('leader-release-not-in-roster')
    return member.roleId
  }

  private roleResponsibility(
    definition: Parameters<EnterpriseTeamRuntimeDriver['startRun']>[0]['definition'],
    roleId: string,
  ): string {
    return definition.roles.find(role => role.roleId === roleId)?.responsibility ?? roleId
  }

  private rolePrompt(prompt: string, roleId: string, releasePersona: string): string {
    return `${releasePersona}\n\nTeam role: ${roleId}\n\nTeamRun objective: ${prompt}`
  }

  private assertOrganization(actor: EnterprisePrincipal, expected: string, definitionOrg: string): void {
    if (actor.orgId !== expected || definitionOrg !== expected) this.fail('organization-mismatch')
  }

  private fail(code: string): never {
    throw new EnterpriseTeamRuntimeError('deterministic', code)
  }
}

/** Install the enterprise Team runtime provider after Agent Teams and before controllers. */
export function apply(ctx: Context): void {
  const adapter = new EnterpriseTeamRuntimeAdapter(ctx)
  ctx.provide('enterpriseTeamRuntimeDriver', adapter)
  ctx.effect(() => () => adapter.dispose(), 'enterprise-team-runtime: dispose Agent handles')
}

export { name } from './invariant.ts'
