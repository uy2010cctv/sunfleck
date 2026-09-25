/** Drain durable channel schedule occurrences through the workflow event dispatcher. */
import type { ChannelWorkflowDue, PostgresChannelWorkflowLedger } from '@deepseek-ai/dsh-enterprise-postgres'

/** Persisted queue and authorized action needed by one scheduler tick. */
export interface ChannelWorkflowSchedulerDependencies {
  dueOrganizations(now: number): Promise<readonly string[]>
  ledger(orgId: string): Pick<PostgresChannelWorkflowLedger, 'stageDue' | 'takeDue' | 'completeDue'>
  deliver(orgId: string, due: ChannelWorkflowDue): Promise<void>
  onError?(error: unknown, orgId: string, due: ChannelWorkflowDue): void
}

/** Recoverable schedule worker; leases and receipts live in PostgreSQL. */
export class ChannelWorkflowScheduler {
  /** @param deps - Due organization resolver, durable ledger, and delivery action. */
  constructor(private readonly deps: ChannelWorkflowSchedulerDependencies) {}

  /** Stage, claim, deliver, and acknowledge due occurrences once per poll.
   * @param now - Unix epoch milliseconds.
   * @param limit - Bounded work per organization.
   * @returns Count of successful and failed attempts.
   */
  async tick(now: number, limit: number): Promise<{ readonly delivered: number; readonly failed: number }> {
    let delivered = 0, failed = 0
    for (const orgId of await this.deps.dueOrganizations(now)) {
      const ledger = this.deps.ledger(orgId)
      await ledger.stageDue(now, limit)
      for (const due of await ledger.takeDue(now, limit)) {
        try {
          await this.deps.deliver(orgId, due)
          await ledger.completeDue(due.sourceEventId)
          delivered += 1
        } catch (error) {
          failed += 1
          this.deps.onError?.(error, orgId, due)
        }
      }
    }
    return { delivered, failed }
  }
}
