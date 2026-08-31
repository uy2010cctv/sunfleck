import { describe, expect, it } from 'vitest'
import { EnterpriseOperationsError, EnterpriseOperationsWorker, type ClaimedOperationCommand } from '../src/index.ts'

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
      admit: async () => { events.push('revalidate') },
      complete: async (commandId) => {
        events.push(`complete:${commandId}`)
      },
      fail: async () => {
        throw new Error('unexpected failure callback')
      },
      retryable: () => true,
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
      admit: async () => undefined,
      complete: async () => {
        throw new Error('unexpected completion')
      },
      fail: async (failure) => {
        failures.push(failure)
      },
      retryable: () => true,
      nextAttemptAt: (now, attempt) => now + 1_000 * 2 ** attempt,
    })

    await expect(worker.runOnce(100)).rejects.toThrow('session unavailable')
    expect(failures).toEqual([expect.objectContaining({
      commandId: 'command-a', nextAttemptAt: 4_100, retryable: true,
    })])
  })

  it('revalidates a team command before session creation and releases the claim through failure handling', async () => {
    const events: string[] = []
    let claims = 0
    const worker = new EnterpriseOperationsWorker({
      claimOutbox: async () => ++claims === 1
        ? ({ ...claimed, command: { ...claimed.command, teamId: 'team-a' } }) : undefined,
      admit: async () => {
        events.push('revalidate')
        throw new EnterpriseOperationsError('invalid-state', 'team-definition', 'team-a')
      },
      createSession: async () => { events.push('create') },
      complete: async () => { events.push('complete') },
      fail: async (failure) => { events.push(`fail:${failure.nextAttemptAt}:${String(failure.retryable)}`) },
      retryable: () => true,
      nextAttemptAt: now => now + 500,
    })

    await expect(worker.runOnce(100)).rejects.toMatchObject({ code: 'invalid-state' })
    expect(events).toEqual(['revalidate', 'fail:600:false'])
    await expect(worker.runOnce(101)).resolves.toBe(false)
  })

  it('classifies lost fencing as retryable even when the fallback classifier says no', async () => {
    let claims = 0
    const failures: Array<{ retryable: boolean }> = []
    const worker = new EnterpriseOperationsWorker({
      claimOutbox: async () => ++claims <= 2 ? claimed : undefined,
      admit: async () => {
        if (claims === 1) throw new EnterpriseOperationsError('fencing-lost', 'operation-outbox', 'command-a')
      },
      createSession: async () => undefined,
      complete: async () => undefined,
      fail: async (failure) => { failures.push(failure) },
      retryable: () => false,
      nextAttemptAt: now => now + 1,
    })
    await expect(worker.runOnce(100)).rejects.toMatchObject({ code: 'fencing-lost' })
    await expect(worker.runOnce(101)).resolves.toBe(true)
    expect(failures).toEqual([expect.objectContaining({ retryable: true })])
  })

  it.each(['revision mismatch', 'leader mismatch', 'missing revision'])('dead-letters deterministic %s once', async () => {
    let claims = 0
    const failures: Array<{ retryable: boolean }> = []
    const worker = new EnterpriseOperationsWorker({
      claimOutbox: async () => ++claims === 1 ? claimed : undefined,
      admit: async () => { throw new EnterpriseOperationsError('admission-rejected', 'team-definition', 'team-a') },
      createSession: async () => undefined,
      complete: async () => undefined,
      fail: async (failure) => { failures.push(failure) },
      retryable: () => true,
      nextAttemptAt: now => now + 1,
    })
    await expect(worker.runOnce(100)).rejects.toMatchObject({ code: 'admission-rejected' })
    await expect(worker.runOnce(101)).resolves.toBe(false)
    expect(failures).toEqual([expect.objectContaining({ retryable: false })])
  })
})
