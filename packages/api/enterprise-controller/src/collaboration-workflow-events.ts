/** Signed channel workflow facts and governed Bot requests after durable triggers. */
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type { CollaborationRecord, RoomEvent, RoomNostrEvent } from '@deepseek-ai/dsh-enterprise-postgres'
import { ChannelWorkflowController, type ChannelWorkflowLedger } from './collaboration-workflow-controller.ts'
import type { ChannelWorkflowActions, ChannelWorkflowTrigger } from './collaboration-workflows.ts'

/** Signed room actions and approval creation owned by the Enterprise Host. */
export interface ChannelWorkflowEventDependencies {
  readonly workflowLeaseMs: number
  ledger(orgId: string): ChannelWorkflowLedger
  sign(actor: EnterprisePrincipal, room: CollaborationRecord, content: string, stepId: string,
    sourceEventId?: string, targetEmployeeIds?: readonly string[]): Promise<RoomNostrEvent>
  append(actor: EnterprisePrincipal, room: CollaborationRecord, event: RoomNostrEvent,
    requestId: string): Promise<RoomEvent>
  dispatchBot(actor: EnterprisePrincipal, room: CollaborationRecord, event: RoomEvent, employeeId: string): Promise<void>
  createApproval(actor: EnterprisePrincipal, room: CollaborationRecord, summary: string,
    idempotencyKey: string): Promise<{ readonly decisionId: string }>
}

/** Executes channel YAML on signed member events, using the same room log for every action. */
export class ChannelWorkflowEventService {
  /** @param deps - Durable ledger, service signer, room append, Bot routing, and approval provider. */
  constructor(private readonly deps: ChannelWorkflowEventDependencies) {}

  /** React only to a signed human room event after its append commits.
   * @param actor - Authenticated sender.
   * @param room - Authorized channel.
   * @param event - Persisted member event.
   */
  async onRoomEvent(actor: EnterprisePrincipal, room: CollaborationRecord, event: RoomEvent,
    revisions?: readonly { readonly id: string; readonly revision: number }[]): Promise<boolean> {
    if (room.kind !== 'channel' || event.authorKind !== 'human') return true
    if (event.orgId !== actor.orgId || event.surfaceId !== room.id || event.authorId !== actor.userId) {
      throw new Error('workflow source room mismatch')
    }
    const trigger: ChannelWorkflowTrigger | undefined = event.event.kind === 9
      ? { type: 'message', text: event.event.content }
      : event.event.kind === 7 ? { type: 'reaction', emoji: event.event.content } : undefined
    if (trigger === undefined) return true
    return this.dispatch(actor, room, trigger, event.event.id, revisions)
  }

  /** Apply an authenticated scheduler, Git adapter, or webhook event.
   * @param actor - Authorized workflow initiator.
   * @param room - Current channel membership and Workspace grant.
   * @param trigger - Verified external trigger.
   * @param sourceEventId - Stable signed or provider event identity.
   */
  async onExternal(actor: EnterprisePrincipal, room: CollaborationRecord, trigger: ChannelWorkflowTrigger,
    sourceEventId: string,
    revisions?: readonly { readonly id: string; readonly revision: number }[]): Promise<boolean> {
    if (room.kind !== 'channel' || room.orgId !== actor.orgId) throw new Error('workflow source room mismatch')
    return this.dispatch(actor, room, trigger, sourceEventId, revisions)
  }

  /** Continue a human-approved request using its immutable workflow revision.
   * @param actor - Authenticated reviewer, already checked by the approval service.
   * @param room - Authorized channel.
   * @param decisionId - Persisted approval decision.
   * @param approved - Recorded human verdict.
   */
  async onDecision(actor: EnterprisePrincipal, room: CollaborationRecord, decisionId: string,
    approved: boolean): Promise<void> {
    if (room.kind !== 'channel' || room.orgId !== actor.orgId) throw new Error('workflow decision room mismatch')
    await new ChannelWorkflowController(this.deps.ledger(actor.orgId), this.deps.workflowLeaseMs)
      .resume(room.id, decisionId, approved,
        this.actions(actor, room))
  }

  private async dispatch(actor: EnterprisePrincipal, room: CollaborationRecord, trigger: ChannelWorkflowTrigger,
    sourceEventId: string,
    revisions?: readonly { readonly id: string; readonly revision: number }[]): Promise<boolean> {
    return new ChannelWorkflowController(this.deps.ledger(actor.orgId), this.deps.workflowLeaseMs)
      .dispatch(room.id, trigger, sourceEventId,
        this.actions(actor, room, sourceEventId), revisions)
  }

  private actions(actor: EnterprisePrincipal, room: CollaborationRecord, sourceEventId?: string): ChannelWorkflowActions {
    const post = async (content: string, stepId: string,
      targetEmployeeIds?: readonly string[]): Promise<RoomEvent> => {
      const event = await this.deps.sign(actor, room, content, stepId, sourceEventId, targetEmployeeIds)
      return this.deps.append(actor, room, event, stepId)
    }
    return {
      bot: async ({ employeeId, prompt, idempotencyKey }) => {
        if (!room.memberEmployeeIds.includes(employeeId)) throw new Error('workflow employee is not a room member')
        const message = await post(`@${employeeId} ${prompt}`, idempotencyKey, [employeeId])
        await this.deps.dispatchBot(actor, room, message, employeeId)
      },
      approval: async ({ summary, idempotencyKey }) => {
        const decision = await this.deps.createApproval(actor, room, summary, idempotencyKey)
        await post(`Approval requested: ${summary} (${decision.decisionId})`, idempotencyKey)
        return decision
      },
      post: async ({ text, idempotencyKey }) => { await post(text, idempotencyKey) },
    }
  }
}
