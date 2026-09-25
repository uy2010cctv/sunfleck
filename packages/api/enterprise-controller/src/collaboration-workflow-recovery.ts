/** Recover an already committed human approval without impersonating a revoked reviewer. */
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import type { CollaborationRecord, ReadyChannelWorkflowDecision } from '@deepseek-ai/dsh-enterprise-postgres'

/** Current principal and channel binding used only while still authorized. */
export interface WorkflowDecisionActor {
  readonly actor: EnterprisePrincipal
  readonly room: CollaborationRecord
}
/** Verified actor lookup and signed fact writers supplied by the Host. */
export interface WorkflowDecisionRecoveryDependencies {
  reviewer(decision: ReadyChannelWorkflowDecision): Promise<WorkflowDecisionActor | undefined>
  manager(decision: ReadyChannelWorkflowDecision): Promise<WorkflowDecisionActor | undefined>
  hasHumanRecord(decision: ReadyChannelWorkflowDecision): Promise<boolean>
  recordHuman(value: WorkflowDecisionActor, decision: ReadyChannelWorkflowDecision): Promise<void>
  recordService(value: WorkflowDecisionActor, decision: ReadyChannelWorkflowDecision): Promise<void>
  resume(value: WorkflowDecisionActor, decision: ReadyChannelWorkflowDecision): Promise<void>
}

/** Continue a durable verdict with truthful authorship after a process interruption.
 * @param decision - Committed Enterprise approval and its recorded reviewer.
 * @param deps - Current membership, signed event publication, and workflow continuation.
 * @returns How the verdict was represented in the room.
 */
export async function recoverCommittedWorkflowDecision(decision: ReadyChannelWorkflowDecision,
  deps: WorkflowDecisionRecoveryDependencies): Promise<'human' | 'service'> {
  const reviewer = await deps.reviewer(decision)
  if (reviewer !== undefined) {
    await deps.recordHuman(reviewer, decision)
    await deps.resume(reviewer, decision)
    return 'human'
  }
  const manager = await deps.manager(decision)
  if (manager === undefined) throw new Error('workflow continuation manager unavailable')
  if (!await deps.hasHumanRecord(decision)) await deps.recordService(manager, decision)
  await deps.resume(manager, decision)
  return 'service'
}
