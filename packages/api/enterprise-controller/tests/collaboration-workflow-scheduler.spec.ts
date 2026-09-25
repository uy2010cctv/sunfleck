import { describe, expect, it, vi } from 'vitest'
import { ChannelWorkflowScheduler } from '../src/collaboration-workflow-scheduler.ts'

describe('durable channel workflow schedule polling', () => {
  it('acks only delivered occurrences and leaves failures for a later lease retry', async () => {
    const due = [{ channelId: 'channel', workflowId: 'morning', revision: 1,
      sourceEventId: 'scheduled-1', triggerIndex: 0, scheduleId: 'daily', scheduledAt: 1, createdBy: 'manager' }]
    const stageDue = vi.fn(async () => 1)
    const takeDue = vi.fn(async () => due)
    const completeDue = vi.fn(async () => undefined)
    const deliver = vi.fn(async () => { throw new Error('temporary delivery') })
    const scheduler = new ChannelWorkflowScheduler({ dueOrganizations: async () => ['org'],
      ledger: () => ({ stageDue, takeDue, completeDue }), deliver })
    expect(await scheduler.tick(2, 10)).toEqual({ delivered: 0, failed: 1 })
    expect(completeDue).not.toHaveBeenCalled()
    deliver.mockImplementation(async () => undefined)
    expect(await scheduler.tick(62_000, 10)).toEqual({ delivered: 1, failed: 0 })
    expect(completeDue).toHaveBeenCalledWith('scheduled-1')
  })
})
