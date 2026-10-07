/** Revision-scoped replay of durable room projections. */
import type { CollaborationRecord, CollaborationSession } from '@deepseek-ai/dsh-enterprise-postgres'

/** Serialize room recovery and retain only successful revision observations. */
export class CollaborationRoomRecovery {
  private readonly completed = new Map<string, { fingerprint: string; children: readonly string[] }>()
  private readonly pending = new Map<string, Promise<void>>()
  private generation = 0

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
    const key = JSON.stringify([row.orgId, row.id])
    const previous = this.pending.get(key)
    const run = () => this.run(key, row)
    const operation = (previous ?? Promise.resolve()).then(run, run)
    this.pending.set(key, operation)
    try { await operation } finally { if (this.pending.get(key) === operation) this.pending.delete(key) }
  }

  /** Release retained metadata when the owning composition is disposed. */
  clear(): void { this.generation += 1; this.completed.clear(); this.pending.clear() }

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
    const complete = await this.recover(row, bindings, async (id) => {
      children.add(id)
      if (!revisions.has(id)) await observe(id)
    })
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
