/**
 * Group-surface delivery in two modes. Federated groups route the message to
 * the @-mentioned member employees and steer each one's durable per-employee
 * group session directly — group delivery never enqueues employee inbox rows,
 * which stay dm-specific. Chartered groups (a surface carrying a
 * `teamDefinitionId`) submit the message into the team's active TeamRun
 * through the runtime's run-input seam, starting one run with a stable
 * idempotency key when none is active.
 *
 * @module @deepseek-ai/dsh-enterprise-surface/group
 */

import { randomUUID } from 'node:crypto'
import { pendingInboxMessages } from '@deepseek-ai/dsh-agent-loop/inbox'
import { brandString } from '@deepseek-ai/dsh-brand'
import { employeeId, surfaceId, type EmployeeAccount, type EmployeeId } from '@deepseek-ai/dsh-employee-account'
import {
  attachGroupSurfaceSession,
  ensureGroupSurface as ensureGroupSurfaceRow,
  groupSurfaceSession,
  setSurfaceMembers,
  surfaceMembers,
} from '@deepseek-ai/dsh-enterprise-identity'
import type { GroupSurfaceRow } from '@deepseek-ai/dsh-enterprise-identity'
import { createUserMessage, errorChain, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { EnterpriseTeamRuntimeDriver } from '@deepseek-ai/dsh-enterprise-operations'
import { DmSurfaceRegistry } from './dm.ts'
import {
  EnterpriseSurfaceError,
  type GroupDeliveryResult,
  type GroupDeliveryTarget,
  type GroupSurface,
  type GroupTeamControl,
  type Surface,
} from './types.ts'

/** Runtime driver surface group delivery submits run inputs through. */
type GroupRunInputDriver = Pick<EnterpriseTeamRuntimeDriver, 'submitRunInput'>

/** Match one @-token in inbound text; the captured name excludes whitespace and further @. */
const MENTION_TOKEN = /@([^\s@]+)/gu

/** Strip trailing punctuation and symbols so "@Support," still resolves the name. */
function mentionNames(text: string): Set<string> {
  const names = new Set<string>()
  text.replace(MENTION_TOKEN, (token: string, name: string) => {
    const stripped = name.replace(/[^\p{L}\p{N}]+$/u, '')
    if (stripped !== '') names.add(stripped.toLowerCase())
    return token
  })
  return names
}

/** Parse one stored group-surface row into its surface value. */
function groupSurfaceFromRow(row: GroupSurfaceRow): GroupSurface {
  return {
    id: surfaceId(row.id),
    kind: 'group',
    orgId: row.orgId,
    name: row.name,
    ...(row.teamDefinitionId === undefined ? {} : { teamDefinitionId: row.teamDefinitionId }),
    ...(row.projectId === undefined ? {} : { projectId: row.projectId }),
  }
}

/** Registry adding group surfaces and two-mode group delivery to the dm registry. The channel registry completes the surface interface. */
export class GroupSurfaceRegistry extends DmSurfaceRegistry {
  /** Swallowed steering tails per employee, serializing group steering passes in queued order. */
  private readonly groupDeliveryTails = new Map<string, Promise<void>>()

  async ensureGroupSurface(input: {
    orgId: string
    name: string
    externalKey?: string
    memberEmployeeIds: readonly EmployeeId[]
    teamDefinitionId?: string
    projectId?: string
  }): Promise<GroupSurface> {
    const members = [...new Set(input.memberEmployeeIds)]
    if (input.teamDefinitionId === undefined && members.length === 0) {
      throw new EnterpriseSurfaceError(
        'group-members-missing',
        `enterprise group surface ${input.name} in ${input.orgId} needs a team definition or at least one member employee`,
      )
    }
    for (const member of members) this.requireEmployeeInOrg(member, input.orgId)
    const row = ensureGroupSurfaceRow(this.database, {
      id: surfaceId(randomUUID()),
      orgId: input.orgId,
      name: input.name,
      ...(input.externalKey === undefined ? {} : { externalKey: input.externalKey }),
      ...(input.teamDefinitionId === undefined ? {} : { teamDefinitionId: input.teamDefinitionId }),
      ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
      createdAt: Date.now(),
    })
    // The stored member set always mirrors the latest ensure call, so roster
    // updates ride the same idempotent creation path.
    setSurfaceMembers(
      this.database,
      row.id,
      members.map(member => ({ principalType: 'employee' as const, principalId: member })),
    )
    return groupSurfaceFromRow(row)
  }

  async deliverToGroup(
    surface: Surface,
    input: { originUserId: string; text: string; mentionedEmployeeIds?: readonly EmployeeId[]; messageId?: string },
  ): Promise<GroupDeliveryResult> {
    if (surface.kind !== 'group') {
      throw new EnterpriseSurfaceError(
        'surface-kind-mismatch',
        `enterprise surface ${surface.id} is a ${surface.kind} surface, not a group surface`,
      )
    }
    if (surface.teamDefinitionId !== undefined) return this.deliverToTeam(surface, surface.teamDefinitionId, input)
    return this.deliverToFederated(surface, input)
  }

  /** Resolve the lazily mounted team control plane and run-input driver; absent means team-mode cannot serve. */
  private teamServices(): { control: GroupTeamControl; driver: GroupRunInputDriver } | undefined {
    const get = this.ctx.get.bind(this.ctx) as (name: string) => unknown
    const control = get('enterpriseTeamControl')
    const driver = get('enterpriseTeamRuntimeDriver')
    if (control === undefined || driver === undefined) return undefined
    return { control: control as GroupTeamControl, driver: driver as GroupRunInputDriver }
  }

  /**
   * Submit the text into the team's active run, starting one chartered run
   * when none is active. The start key carries the message id when the caller
   * supplies one, so a retried envelope reuses its run while a new message
   * starts a new one after the previous run goes terminal.
   */
  private async deliverToTeam(
    surface: GroupSurface,
    teamId: string,
    input: { originUserId: string; text: string; messageId?: string },
  ): Promise<GroupDeliveryResult> {
    const services = this.teamServices()
    if (services === undefined) return { delivered: false, reason: 'team-runtime-unavailable' }
    const { control, driver } = services
    try {
      const active = (await control.listTeamRuns({
        orgId: surface.orgId, teamId, state: 'active',
      }))[0]
      const run = active ?? await control.startRun({
        orgId: surface.orgId,
        teamId,
        userId: input.originUserId,
        prompt: input.text,
        source: 'channel',
        idempotencyKey: `${surface.id}:${input.originUserId}:${input.messageId ?? randomUUID()}`,
      })
      await driver.submitRunInput(run.runId, {
        actorUserId: input.originUserId,
        text: input.text,
        originSurfaceId: surface.id,
      })
      return {
        delivered: true,
        mode: 'team',
        targets: [{ kind: 'team-run', runId: run.runId, delivered: true }],
      }
    } catch (error: unknown) {
      return { delivered: false, reason: 'team-run-failed', error: errorChain(error) }
    }
  }

  /**
   * Route the text to the mentioned member employees and steer each one's
   * group session. Explicitly mentioned ids win when they name members;
   * otherwise members whose display name appears as an @-token are targeted.
   */
  private async deliverToFederated(
    surface: GroupSurface,
    input: { originUserId: string; text: string; mentionedEmployeeIds?: readonly EmployeeId[] },
  ): Promise<GroupDeliveryResult> {
    const targets = this.mentionedMembers(surface, input.text, input.mentionedEmployeeIds)
    if (targets.length === 0) return { delivered: false, reason: 'no-target' }
    const steered = await Promise.all(targets.map(member =>
      this.runInTail(this.groupDeliveryTails, member.id,
        () => this.steerMember(surface, member, input.originUserId, input.text))))
    return { delivered: true, mode: 'federated', targets: steered }
  }

  /** Read every member employee's account, refusing unknown or cross-org members. */
  protected memberAccounts(surface: Pick<GroupSurface, 'id' | 'orgId'>): EmployeeAccount[] {
    return surfaceMembers(this.database, surface.id)
      .filter(member => member.principalType === 'employee')
      .map(member => this.requireEmployeeInOrg(employeeId(member.principalId), surface.orgId))
  }

  /**
   * Resolve the member accounts the message addresses: explicitly mentioned
   * ids when they name members, otherwise members whose display name appears
   * as an @-token in the text.
   */
  protected mentionedMembers(
    surface: Pick<GroupSurface, 'id' | 'orgId'>,
    text: string,
    mentionedEmployeeIds: readonly EmployeeId[] | undefined,
  ): EmployeeAccount[] {
    const members = this.memberAccounts(surface)
    const mentionedIds = new Set((mentionedEmployeeIds ?? []).map(id => String(id)))
    return mentionedIds.size > 0
      ? members.filter(member => mentionedIds.has(member.id))
      : this.mentionedMembersByDisplayName(members, text)
  }

  /** Resolve member accounts whose display name appears as an @-token in the text. */
  private mentionedMembersByDisplayName(members: EmployeeAccount[], text: string): EmployeeAccount[] {
    const names = mentionNames(text)
    if (names.size === 0) return []
    return members.filter(member => names.has(member.displayName.toLowerCase()))
  }

  /** Steer one member's group session and capture per-target failures on the returned target. */
  private async steerMember(
    surface: GroupSurface,
    account: EmployeeAccount,
    originActor: string,
    text: string,
  ): Promise<GroupDeliveryTarget> {
    try {
      const sessionId = await this.ensureMemberSession(surface, account)
      const agent = this.ctx.agents.get(sessionId)
      if (agent === undefined) {
        throw new EnterpriseSurfaceError(
          'session-not-live',
          `group session ${sessionId} for enterprise surface ${surface.id} is not live`,
        )
      }
      const session: Session = agent.session
      const fromGroup = (message: UserMessage): boolean =>
        message.source.kind === 'surface-message'
        && message.source.surfaceId === surface.id
        && message.source.originActor === originActor
      const landedBefore = landedCount(session, fromGroup)
      agent.steer(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'surface-message', surfaceId: surface.id, originActor },
      }))
      await this.ctx.sessions.flush(session)
      if (landedCount(session, fromGroup) === landedBefore) {
        throw new EnterpriseSurfaceError(
          'delivery-not-landed',
          `enterprise group message from ${originActor} did not land in session ${sessionId}`,
        )
      }
      return { kind: 'employee', employeeId: account.id, sessionId, delivered: true }
    } catch (error: unknown) {
      return { kind: 'employee', employeeId: account.id, delivered: false, error: errorChain(error) }
    }
  }

  /** Reuse the member's stored group session, creating and binding it once per (surface, employee) pair. */
  private async ensureMemberSession(surface: GroupSurface, account: EmployeeAccount): Promise<SessionId> {
    const stored = groupSurfaceSession(this.database, surface.id, account.id)
    if (stored !== undefined) return brandString<SessionId>(stored)
    return this.createAnchoredSession(
      account,
      'employee-group',
      (sessionId) => { attachGroupSurfaceSession(this.database, surface.id, account.id, sessionId) },
    )
  }
}

/**
 * Count the surface messages currently visible in the session log or its
 * pending steering projection. The appended message and the still-pending
 * spliced copy are mutually exclusive states of one steer, so the sum counts
 * each landing once.
 */
export function landedCount(session: Session, matches: (message: UserMessage) => boolean): number {
  const suffix = session.ownEvents()
  return suffix.filter(event => event.type === 'user/message' && matches(event.data)).length
    + pendingInboxMessages(suffix).filter(matches).length
}
