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
      withActiveCommand: async (_command, start) => { events.push('revalidate'); await start() },
      complete: async (commandId) => {
        events.push(`complete:${commandId}`)
      },
      fail: async () => {
        throw new Error('unexpected failure callback')
      },
      nextAttemptAt: () => 0,
    })

    await expect(worker.runOnce(100)).resolves.toBe(true)
    expect(events).toEqual(['claim', 'revalidate', 'create', 'complete:command-a'])
  })

  it('records failure with caller-controlled exponential backoff', async () => {
    const failures: unknown[] = []
    const worker = new EnterpriseOperationsWorker({
      claimOutbox: async () => claimed,
      createSession: async () => {
        throw new Error('session unavailable')
      },
      withActiveCommand: async (_command, start) => { await start() },
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

  it('revalidates a team command before session creation and releases the claim through failure handling', async () => {
    const events: string[] = []
    const worker = new EnterpriseOperationsWorker({
      claimOutbox: async () => ({ ...claimed, command: { ...claimed.command, teamId: 'team-a' } }),
      withActiveCommand: async () => { events.push('revalidate'); throw new Error('team definition is inactive') },
      createSession: async () => { events.push('create') },
      complete: async () => { events.push('complete') },
      fail: async (failure) => { events.push(`fail:${failure.nextAttemptAt}`) },
      nextAttemptAt: now => now + 500,
    })

    await expect(worker.runOnce(100)).rejects.toThrow('team definition is inactive')
    expect(events).toEqual(['revalidate', 'fail:600'])
  })
})
