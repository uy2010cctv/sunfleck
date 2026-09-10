/** Driver-neutral delivery loop for scheduled session commands. */
import type { ScheduleFireView } from './types.ts'
import { EnterpriseOperationsError } from './repository.ts'

/** Data used by `ClaimedOperationCommand`. */
export interface ClaimedOperationCommand {
  readonly commandId: string
  readonly attempt: number
  readonly command: ScheduleFireView['command']
}

/** Data used by `OperationCommandFailure`. */
export interface OperationCommandFailure {
  readonly commandId: string
  readonly attempt: number
  readonly error: unknown
  readonly nextAttemptAt: number
  readonly retryable: boolean
}

/** Data used by `EnterpriseOperationsWorkerOptions`. */
export interface EnterpriseOperationsWorkerOptions {
  readonly claimOutbox: (now: number) => Promise<ClaimedOperationCommand | undefined>
  readonly admit: (commandId: string, command: ScheduleFireView['command']) => Promise<void>
  readonly createSession: (command: ScheduleFireView['command']) => Promise<void>
  readonly complete: (commandId: string) => Promise<void>
  readonly fail: (failure: OperationCommandFailure) => Promise<void>
  readonly nextAttemptAt: (now: number, attempt: number, error: unknown) => number
  readonly retryable: (error: unknown) => boolean
}

/** Claims at most one command and publishes its terminal delivery state. */
export class EnterpriseOperationsWorker {
  constructor(private readonly options: EnterpriseOperationsWorkerOptions) {}

  /** Executes `EnterpriseOperationsWorker.runOnce` for this instance.
   * @param now - Input value used by this API.
   * @returns Result produced by this API.
  */
  async runOnce(now: number): Promise<boolean> {
    const claimed = await this.options.claimOutbox(now)
    if (claimed === undefined) return false
    try {
      await this.options.admit(claimed.commandId, claimed.command)
      await this.options.createSession(claimed.command)
      await this.options.complete(claimed.commandId)
      return true
    } catch (error) {
      const deterministicAdmissionFailure = error instanceof EnterpriseOperationsError
        && (error.code === 'admission-rejected'
          || (error.code === 'invalid-state' && error.resourceType === 'team-definition'))
      const retryableFencingFailure = error instanceof EnterpriseOperationsError && error.code === 'fencing-lost'
      if (retryableFencingFailure) throw error
      await this.options.fail({
        commandId: claimed.commandId,
        attempt: claimed.attempt,
        error,
        nextAttemptAt: this.options.nextAttemptAt(now, claimed.attempt, error),
        retryable: deterministicAdmissionFailure ? false : this.options.retryable(error),
      })
      throw error
    }
  }
}
