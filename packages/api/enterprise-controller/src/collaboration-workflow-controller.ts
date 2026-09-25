/** Durable trigger reservations around bounded channel workflow execution. */
import { executeChannelWorkflow, parseChannelWorkflow, workflowMatches,
  type ChannelWorkflowActions, type ChannelWorkflowResult, type ChannelWorkflowRun,
  type ClaimedChannelWorkflowRun,
  type ChannelWorkflowTrigger } from './collaboration-workflows.ts'

/** One immutable channel workflow revision. */
export interface StoredChannelWorkflow {
  readonly id: string
  readonly revision: number
  readonly yaml: string
}
/** The storage operations required for exactly-once trigger reservation. */
export interface ChannelWorkflowLedger {
  list(channelId: string): Promise<readonly StoredChannelWorkflow[]>
  listRevisions(channelId: string,
    refs: readonly { readonly id: string; readonly revision: number }[]): Promise<readonly StoredChannelWorkflow[]>
  reserve(run: ChannelWorkflowRun, leaseMs: number): Promise<string | undefined>
  state(run: ChannelWorkflowRun): Promise<'reserved' | 'resuming' | 'waiting-human' | 'completed' | 'rejected' | undefined>
  record(run: ClaimedChannelWorkflowRun, result: ChannelWorkflowResult | { readonly state: 'rejected' }): Promise<void>
  release(run: ClaimedChannelWorkflowRun): Promise<void>
  takeDecision(channelId: string, decisionId: string, leaseMs: number): Promise<{
    readonly workflow: StoredChannelWorkflow
    readonly run: ClaimedChannelWorkflowRun
    readonly nextStep: number
  } | undefined>
  releaseDecision(run: ClaimedChannelWorkflowRun): Promise<void>
}

/** Matches trusted room events and records each workflow's execution cursor. */
export class ChannelWorkflowController {
  /** @param ledger - Durable definitions, trigger receipts, and decision reservations.
   * @param leaseMs - Validated worker lease duration.
   */
  constructor(private readonly ledger: ChannelWorkflowLedger, private readonly leaseMs: number) {}

  /** Dispatch a scoped, authenticated event at most once per workflow revision.
   * @param channelId - Authorized channel identity.
   * @param event - Trusted trigger fields.
   * @param sourceEventId - Durable room or provider event id.
   * @param actions - Host-authorized actions.
   */
  async dispatch(channelId: string, event: ChannelWorkflowTrigger, sourceEventId: string,
    actions: ChannelWorkflowActions,
    revisions?: readonly { readonly id: string; readonly revision: number }[]): Promise<boolean> {
    let pending = false
    const failures: unknown[] = []
    const definitions = revisions === undefined ? await this.ledger.list(channelId)
      : await this.ledger.listRevisions(channelId, revisions)
    for (const stored of definitions) {
      const workflow = parseChannelWorkflow(stored.yaml)
      if (!workflowMatches(workflow, event)) continue
      const run = { channelId, workflowId: stored.id, revision: stored.revision, sourceEventId }
      const token = await this.ledger.reserve(run, this.leaseMs)
      if (token === undefined) {
        const state = await this.ledger.state(run)
        if (state === undefined || state === 'reserved' || state === 'resuming') pending = true
        continue
      }
      const claimed = { ...run, leaseToken: token }
      try {
        await this.ledger.record(claimed, await executeChannelWorkflow(workflow, run, actions))
      } catch (error) {
        await this.ledger.release(claimed)
        failures.push(error)
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'channel workflow trigger failed')
    return !pending
  }

  /** Resolve one human decision and resume only an approved workflow.
   * @param channelId - Authorized channel identity.
   * @param decisionId - Existing Enterprise decision identity.
   * @param approved - Human's recorded decision.
   * @param actions - Host-authorized actions.
   */
  async resume(channelId: string, decisionId: string, approved: boolean,
    actions: ChannelWorkflowActions): Promise<void> {
    const pending = await this.ledger.takeDecision(channelId, decisionId, this.leaseMs)
    if (pending === undefined) throw new Error('workflow decision not found')
    if (!approved) {
      await this.ledger.record(pending.run, { state: 'rejected' })
      return
    }
    try {
      const workflow = parseChannelWorkflow(pending.workflow.yaml)
      await this.ledger.record(pending.run, await executeChannelWorkflow(workflow, pending.run,
        actions, pending.nextStep))
    } catch (error) {
      await this.ledger.releaseDecision(pending.run)
      throw error
    }
  }
}
