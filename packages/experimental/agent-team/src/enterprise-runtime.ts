/** Enterprise TeamRun and Human decision mutations over the existing Team journal. */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { TeamError } from './error.ts'
import type { TeamJournal } from './journal.ts'
import { TeamId } from './types.ts'
import type {
  TeamDecisionProjectRequest,
  TeamDecisionResponseRequest,
  TeamDecisionSnapshot,
  TeamHumanMemberSnapshot,
  TeamRunSnapshot,
  TeamRunStartRequest,
  TeamRunStateRequest,
  TeamRuntimeMutationReceipt,
} from './types.ts'

/** Owns Host-only TeamRun, Human roster, and TeamDecision journal mutations. */
export class TeamEnterpriseRuntime {
  constructor(private readonly journal: TeamJournal) {}

  /** Append the starting TeamRun edge or return the receipt committed by a retry.
   * @param request - Input value used by this API.
   * @param root - Input value used by this API.
   * @returns Result produced by this API.
   */
  start(root: Agent, request: TeamRunStartRequest): Promise<TeamRuntimeMutationReceipt> {
    return this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      const repeated = state.operations.get(request.operationId)
      if (repeated !== undefined) {
        if (state.run?.runId !== request.runId || state.run.operationId !== request.operationId) {
          throw new TeamError(`TeamRun operation "${request.operationId}" is already used`, 'TEAM_OPERATION_CONFLICT')
        }
        return repeated
      }
      if (state.run !== undefined) {
        throw new TeamError(`root Session already owns TeamRun "${state.run.runId}"`, 'TEAM_RUN_CONFLICT')
      }
      if (request.leader.sessionId !== root.id) {
        throw new TeamError('TeamRun leader Session must be the authoritative root', 'TEAM_RUN_CONFLICT')
      }
      return this.appendRun(root, { ...request, state: 'starting', runtimeRevision: 1 })
    })
  }

  /** Add one immutable Human row without granting Agent membership or mailbox access.
   * @param member - Input value used by this API.
   * @param root - Input value used by this API.
   */
  registerHuman(root: Agent, member: TeamHumanMemberSnapshot): Promise<void> {
    return this.journal.transact(root.id, async () => {
      const prior = this.journal.state(root).humans.get(member.userId)
      if (prior !== undefined) {
        if (JSON.stringify(prior) !== JSON.stringify(member)) {
          throw new TeamError(`Human member "${member.userId}" changed immutable identity`, 'TEAM_MEMBER_CONFLICT')
        }
        return
      }
      await this.journal.appendAndFlush(root, 'team/human-member', {
        version: 1, teamId: TeamId(root.id), member,
      })
    })
  }

  /** Apply one TeamRun transition with root-wide runtime revision assignment.
   * @param request - Input value used by this API.
   * @param root - Input value used by this API.
   * @returns Result produced by this API.
   */
  setState(root: Agent, request: TeamRunStateRequest): Promise<TeamRuntimeMutationReceipt> {
    return this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      const current = state.run
      if (current === undefined) throw new TeamError('root Session has no TeamRun', 'TEAM_RUN_NOT_FOUND')
      if (current.state === request.state && current.operationId === request.operationId) {
        return this.receipt(state, request.operationId)
      }
      const used = state.operations.get(request.operationId)
      const startContinuation = current.state === 'starting'
        && current.operationId === request.operationId
        && (request.state === 'active' || request.state === 'failed' || request.state === 'cancelled')
      if (used !== undefined && !startContinuation) {
        throw new TeamError(`TeamRun operation "${request.operationId}" is already used`, 'TEAM_OPERATION_CONFLICT')
      }
      const { failure: _priorFailure, ...withoutPriorFailure } = current
      return this.appendRun(root, {
        ...withoutPriorFailure,
        operationId: request.operationId,
        state: request.state,
        runtimeRevision: state.runtimeRevision + 1,
        actor: request.actor,
        ...request.failure === undefined ? {} : { failure: request.failure },
      })
    })
  }

  /** Append one open Human decision with service-owned revisions.
   * @param request - Input value used by this API.
   * @param root - Input value used by this API.
   * @returns Result produced by this API.
   */
  projectDecision(root: Agent, request: TeamDecisionProjectRequest): Promise<TeamRuntimeMutationReceipt> {
    return this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      const repeated = state.operations.get(request.operationId)
      if (repeated !== undefined) {
        if (state.decisions.get(request.decisionId)?.operationId !== request.operationId) {
          throw new TeamError(`decision operation "${request.operationId}" is already used`, 'TEAM_OPERATION_CONFLICT')
        }
        return repeated
      }
      if (state.run?.runId !== request.runId || state.decisions.has(request.decisionId)) {
        throw new TeamError(`decision "${request.decisionId}" conflicts with the TeamRun`, 'TEAM_DECISION_CONFLICT')
      }
      const decision: TeamDecisionSnapshot = {
        ...request,
        state: 'open',
        revision: 1,
        runtimeRevision: state.runtimeRevision + 1,
      }
      return this.appendDecision(root, decision)
    })
  }

  /** Answer one open decision with revision CAS and operation idempotency.
   * @param request - Input value used by this API.
   * @param root - Input value used by this API.
   * @returns Result produced by this API.
   */
  respondDecision(root: Agent, request: TeamDecisionResponseRequest): Promise<TeamRuntimeMutationReceipt> {
    return this.journal.transact(root.id, async () => {
      const state = this.journal.state(root)
      const repeated = state.operations.get(request.operationId)
      if (repeated !== undefined) {
        const decision = state.decisions.get(request.decisionId)
        if (decision?.operationId !== request.operationId || decision.answer !== request.answer) {
          throw new TeamError(`decision operation "${request.operationId}" is already used`, 'TEAM_OPERATION_CONFLICT')
        }
        return repeated
      }
      const current = state.decisions.get(request.decisionId)
      if (current === undefined || current.state !== 'open' || current.revision !== request.expectedRevision) {
        throw new TeamError(`decision "${request.decisionId}" revision or state changed`, 'TEAM_DECISION_CONFLICT')
      }
      return this.appendDecision(root, {
        ...current,
        operationId: request.operationId,
        state: 'answered',
        answer: request.answer,
        respondedBy: request.actor,
        revision: current.revision + 1,
        runtimeRevision: state.runtimeRevision + 1,
      })
    })
  }

  private receipt(
    state: ReturnType<TeamJournal['state']>,
    operationId: string,
  ): TeamRuntimeMutationReceipt {
    const receipt = state.operations.get(operationId)
    if (receipt === undefined) throw new TeamError(`operation "${operationId}" has no receipt`, 'TEAM_OPERATION_CONFLICT')
    return receipt
  }

  private async appendRun(root: Agent, run: TeamRunSnapshot): Promise<TeamRuntimeMutationReceipt> {
    await this.journal.appendAndFlush(root, 'team/run', { version: 1, teamId: TeamId(root.id), run })
    return { runtimeRevision: run.runtimeRevision, sourceEventSeq: Number(root.session.seq) - 1 }
  }

  private async appendDecision(root: Agent, decision: TeamDecisionSnapshot): Promise<TeamRuntimeMutationReceipt> {
    await this.journal.appendAndFlush(root, 'team/decision', {
      version: 1, teamId: TeamId(root.id), decision,
    })
    return { runtimeRevision: decision.runtimeRevision, sourceEventSeq: Number(root.session.seq) - 1 }
  }
}
