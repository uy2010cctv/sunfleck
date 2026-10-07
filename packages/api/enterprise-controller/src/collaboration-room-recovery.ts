/** Revision-scoped replay of durable room projections. */
import type { CollaborationRecord, CollaborationSession } from '@deepseek-ai/dsh-enterprise-postgres'

/** Serialize room recovery and retain only successful revision observations. */
export class CollaborationRoomRecovery {
  private readonly completed = new Map<string, { fingerprint: string; children: readonly string[] }>()
  private readonly pending = new Map<string, Promise<void>>()
  private readonly repairing = new Set<string>()
  private generation = 0
  private closed = false

  /** @param bindings - Read current room destinations. @param revision - Observe a Session without loading its log.
   * @param recover - Replay all destinations; return false if any projection fails. */
  constructor(private readonly bindings: (id: string) => Promise<readonly CollaborationSession[]>,
    private readonly revision: (id: string) => Promise<string | undefined>,
    private readonly recover: (row: CollaborationRecord, bindings: readonly CollaborationSession[],
      observeChild: (id: string) => Promise<void>) => Promise<boolean>) {}

  /** Reconcile current destinations after earlier recovery callers finish.
   * @param row - Fresh authorized room configuration.
   * @returns Completion of this room's recovery observation.
   */
  async reconcile(row: CollaborationRecord): Promise<void> {
    await this.enqueue(row)
  }

  /** Start at most one asynchronous repair for a room.
   * @param row - Fresh authorized room configuration.
   * @param failed - Report a failed repair; later reads may retry it.
   */
  start(row: CollaborationRecord, failed: (error: unknown) => void): void {
    if (this.closed) throw new Error('room recovery is disposed')
    if (this.isPending(row)) return
    void this.enqueue(row, failed)
  }

  /** Observe whether this room still has owned recovery work.
   * @param row - Authorized room identity.
   * @returns Whether a repair or revision check is running.
   */
  isPending(row: CollaborationRecord): boolean { return this.pending.has(JSON.stringify([row.orgId, row.id])) }

  /** Observe whether native history is being replayed into signed room facts.
   * @param row - Authorized room identity.
   * @returns Whether the room's actual replay callback is active.
   */
  isRepairing(row: CollaborationRecord): boolean { return this.repairing.has(JSON.stringify([row.orgId, row.id])) }

  /** Reject new recovery work and await accepted repairs before releasing metadata.
   * @returns Completion of every accepted repair.
   */
  async dispose(): Promise<void> {
    this.closed = true
    await Promise.allSettled([...this.pending.values()])
    this.clear()
  }

  private enqueue(row: CollaborationRecord, failed?: (error: unknown) => void): Promise<void> {
    if (this.closed) throw new Error('room recovery is disposed')
    const key = JSON.stringify([row.orgId, row.id])
    const previous = this.pending.get(key)
    const run = () => this.run(key, row)
    const operation = (previous ?? Promise.resolve()).then(run, run).catch((error: unknown) => {
      if (failed === undefined) throw error
      try { failed(error) } catch (_reporterError: unknown) {
        // Repair diagnostics cannot prevent settlement of owned background work.
      }
    }).finally(() => { if (this.pending.get(key) === operation) this.pending.delete(key) })
    this.pending.set(key, operation)
    return operation
  }

  /** Release retained metadata when the owning composition is disposed. */
  clear(): void { this.generation += 1; this.completed.clear() }

  private async run(key: string, row: CollaborationRecord): Promise<void> {
    const generation = this.generation
    const bindings = await this.bindings(row.id)
    const previous = this.completed.get(key)
    const revisions = new Map<string, string | undefined>()
    const children = new Set<string>()
    const observe = async (id: string): Promise<void> => { revisions.set(id, await this.revision(id)) }
    await Promise.all([...new Set([...bindings.map(binding => binding.sessionId), ...(previous?.children ?? [])])].map(observe))
    const fingerprint = () => JSON.stringify([row, bindings, [...revisions].sort(([a], [b]) => a.localeCompare(b))])
    if (previous?.fingerprint === fingerprint()) return
    let complete: boolean
    this.repairing.add(key)
    try {
      complete = await this.recover(row, bindings, async (id) => {
        children.add(id)
        if (!revisions.has(id)) await observe(id)
      })
    } finally { this.repairing.delete(key) }
    if (!complete) { this.completed.delete(key); return }
    for (const id of revisions.keys()) {
      if (revisions.get(id) !== await this.revision(id)) { this.completed.delete(key); return }
    }
    for (const id of previous?.children ?? []) {
      if (!children.has(id) && !bindings.some(binding => binding.sessionId === id)) revisions.delete(id)
    }
    if (generation === this.generation) this.completed.set(key, { fingerprint: fingerprint(), children: [...children] })
  }
}
