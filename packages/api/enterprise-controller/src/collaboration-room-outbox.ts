/** Leased signed-room dispatch with native landing before durable acknowledgement. */
import type { RoomDispatchClaim } from '@deepseek-ai/dsh-enterprise-postgres'

/** Fenced PostgreSQL claim operations. */
export interface CollaborationRoomOutboxStore {
  claimDispatch(now: number, limit: number, leaseMs: number): Promise<readonly RoomDispatchClaim[]>
  claimEventDispatch(orgId: string, surfaceId: string, eventId: string, now: number,
    leaseMs: number): Promise<readonly RoomDispatchClaim[]>
  completeDispatch(claim: RoomDispatchClaim): Promise<boolean>
  releaseDispatch(claim: RoomDispatchClaim): Promise<boolean>
}

/** Authorized native dispatch outcome for one signed destination. */
export interface CollaborationRoomDispatchOutcome {
  readonly outcome: 'delivered' | 'skipped'
  readonly targets: readonly { readonly sessionId: string
    readonly employeeId?: string }[]
}

/** Process claims obtained by an immediate request or a restart-safe polling worker. */
export class CollaborationRoomOutbox {
  /** @param store - Durable signed-event outbox.
   * @param dispatch - Current ACL and native Session delivery.
   */
  constructor(private readonly store: CollaborationRoomOutboxStore,
    private readonly dispatch: (claim: RoomDispatchClaim) => Promise<CollaborationRoomDispatchOutcome>) {}

  /** Claim and deliver one newly accepted event before returning its native destinations.
   * @param orgId - Authorized organization.
   * @param surfaceId - Authorized room.
   * @param eventId - Persisted signed event id.
   * @param leaseMs - Validated deployment lease.
   * @returns Native destinations that landed during this request.
   */
  async immediate(orgId: string, surfaceId: string, eventId: string,
    leaseMs: number): Promise<readonly CollaborationRoomDispatchOutcome['targets'][number][]> {
    const claims = await this.store.claimEventDispatch(orgId, surfaceId, eventId, Date.now(), leaseMs)
    return this.process(claims, true)
  }

  /** Recover pending or expired claims, rechecking authorization at delivery time.
   * @param leaseMs - Validated deployment lease.
   * @returns Native destinations that landed during this poll.
   */
  async poll(leaseMs: number): Promise<readonly CollaborationRoomDispatchOutcome['targets'][number][]> {
    const claims = await this.store.claimDispatch(Date.now(), 100, leaseMs)
    return this.process(claims, false)
  }

  private async process(claims: readonly RoomDispatchClaim[], throwOnFailure: boolean): Promise<
    readonly CollaborationRoomDispatchOutcome['targets'][number][]> {
    const targets: CollaborationRoomDispatchOutcome['targets'][number][] = []
    for (const claim of claims) {
      try {
        const outcome = await this.dispatch(claim)
        if (!await this.store.completeDispatch(claim)) throw new Error('room dispatch lease lost before acknowledgement')
        if (outcome.outcome === 'delivered') targets.push(...outcome.targets)
      } catch (error) {
        await this.store.releaseDispatch(claim)
        if (throwOnFailure) throw error
      }
    }
    return targets
  }
}
