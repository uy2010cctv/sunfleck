import { describe, expect, it } from 'vitest'
import { EnterpriseOperationsWorker, type ClaimedOperationCommand } from '../src/index.ts'

const claimed: ClaimedOperationCommand = {
  commandId: 'command-a',
  attempt: 2,
  command: { kind: 'start-session', sessionId: 'session-a', employeeReleaseId: 'release-a' },
}

describe('EnterpriseOperationsWorker', () => {
  it('claims, creates the native session, and completes the outbox command', async () => {
    const events: string[] = []
    const worker = new EnterpriseOperationsWorker({
      claimOutbox: async () => {
        events.push('claim')
        return claimed
      },
      createSession: async () => {
        events.push('create')
      },
      complete: async (commandId) => {
        events.push(`complete:${commandId}`)
      },
      fail: async () => {
        throw new Error('unexpected failure callback')
      },
      nextAttemptAt: () => 0,
    })

    await expect(worker.runOnce(100)).resolves.toBe(true)
    expect(events).toEqual(['claim', 'create', 'complete:command-a'])
  })

  it('records failure with caller-controlled exponential backoff', async () => {
    const failures: unknown[] = []
    const worker = new EnterpriseOperationsWorker({
      claimOutbox: async () => claimed,
      createSession: async () => {
        throw new Error('session unavailable')
      },
      complete: async () => {
        throw new Error('unexpected completion')
      },
      fail: async (failure) => {
        failures.push(failure)
      },
      nextAttemptAt: (now, attempt) => now + 1_000 * 2 ** attempt,
    })

    await expect(worker.runOnce(100)).rejects.toThrow('session unavailable')
    expect(failures).toEqual([expect.objectContaining({ commandId: 'command-a', nextAttemptAt: 4_100 })])
  })
})
