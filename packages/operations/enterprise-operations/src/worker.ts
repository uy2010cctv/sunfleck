/** Driver-neutral delivery loop for scheduled session commands. */
import type { ScheduleFireView } from './types.ts'

export interface ClaimedOperationCommand {
  readonly commandId: string
  readonly attempt: number
  readonly command: ScheduleFireView['command']
}

export interface OperationCommandFailure {
  readonly commandId: string
  readonly attempt: number
  readonly error: unknown
  readonly nextAttemptAt: number
}

export interface EnterpriseOperationsWorkerOptions {
  readonly claimOutbox: (now: number) => Promise<ClaimedOperationCommand | undefined>
  readonly withActiveCommand: (
    command: ScheduleFireView['command'],
    start: () => Promise<void>,
  ) => Promise<void>
  readonly createSession: (command: ScheduleFireView['command']) => Promise<void>
  readonly complete: (commandId: string) => Promise<void>
  readonly fail: (failure: OperationCommandFailure) => Promise<void>
  readonly nextAttemptAt: (now: number, attempt: number, error: unknown) => number
}

/** Claims at most one command and publishes its terminal delivery state. */
export class EnterpriseOperationsWorker {
  constructor(private readonly options: EnterpriseOperationsWorkerOptions) {}

  async runOnce(now: number): Promise<boolean> {
    const claimed = await this.options.claimOutbox(now)
    if (claimed === undefined) return false
    try {
      await this.options.withActiveCommand(claimed.command, () => this.options.createSession(claimed.command))
      await this.options.complete(claimed.commandId)
      return true
    } catch (error) {
      await this.options.fail({
        commandId: claimed.commandId,
        attempt: claimed.attempt,
        error,
        nextAttemptAt: this.options.nextAttemptAt(now, claimed.attempt, error),
      })
      throw error
    }
  }
}
