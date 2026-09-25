import { describe, expect, it, vi } from 'vitest'
import { ChannelWorkflowEventService } from '../src/collaboration-workflow-events.ts'
import type { ChannelWorkflowLedger } from '../src/collaboration-workflow-controller.ts'
import type { RoomEvent, RoomNostrEvent } from '@deepseek-ai/dsh-enterprise-postgres'

const yaml = 'version: 1\nname: Review\non:\n  - type: message\n    contains: release\nsteps:\n  - type: bot_request\n    employeeId: editor\n    prompt: Draft release notes\n  - type: approval_request\n    summary: Approve release\n  - type: room_post\n    text: Approved'
const actor = { orgId: 'org', userId: 'alice', roles: ['administrator'] as const }
const room = { id: 'channel', orgId: 'org', kind: 'channel' as const, name: 'Releases', workspaceId: 'workspace',
  memberEmployeeIds: ['editor'], memberUserIds: ['alice'], dutyEmployeeIds: [] }
const sourceEvent: RoomEvent = { orgId: 'org', surfaceId: 'channel', authorKind: 'human', authorId: 'alice', sequence: '1',
  event: { id: 'a'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128), created_at: 1,
    kind: 9, tags: [['h', 'channel']], content: 'Please review this release' } }

describe('signed channel workflow events', () => {
  it('signs service steps and routes a Bot request before waiting for human approval', async () => {
    const receipts = new Set<string>()
    const ledger: ChannelWorkflowLedger = {
      list: async () => [{ id: 'release', revision: 1, yaml }],
      listRevisions: async () => [{ id: 'release', revision: 1, yaml }],
      reserve: async (run) => { const key = JSON.stringify(run); if (receipts.has(key)) return undefined; receipts.add(key); return 'claim-1' },
      state: async () => 'waiting-human',
      record: async () => {}, release: async () => {}, takeDecision: async () => undefined,
    }
    const sign = vi.fn(async (_actor: unknown, _room: unknown, _content: string, _stepId: string,
      _source?: string, _targets?: readonly string[]): Promise<RoomNostrEvent> => ({
      ...sourceEvent.event, id: 'd'.repeat(64), kind: 41000,
    }))
    const append = vi.fn(async (_actor: unknown, _room: unknown, event: RoomNostrEvent): Promise<RoomEvent> => ({ ...sourceEvent,
      event, authorKind: 'service', authorId: 'channel-workflow', sequence: '2' }))
    const dispatchBot = vi.fn(async () => undefined)
    const createApproval = vi.fn(async () => ({ decisionId: 'approval-1' }))
    const service = new ChannelWorkflowEventService({
      workflowLeaseMs: 60_000,
      ledger: () => ledger, sign, append, dispatchBot, createApproval,
    })
    await service.onRoomEvent(actor, room, sourceEvent)
    await service.onRoomEvent(actor, room, sourceEvent)
    expect(sign).toHaveBeenCalledTimes(2)
    expect(sign).toHaveBeenCalledWith(actor, room, '@editor Draft release notes',
      'channel:release:1:' + sourceEvent.event.id + ':0', sourceEvent.event.id, ['editor'])
    expect(append).toHaveBeenCalledTimes(2)
    expect(dispatchBot).toHaveBeenCalledWith(actor, room, expect.objectContaining({ authorKind: 'service' }), 'editor')
    expect(createApproval).toHaveBeenCalledWith(actor, room, 'Approve release',
      'channel:release:1:' + sourceEvent.event.id + ':1')
  })

  it('does not start a workflow from its own service posts', async () => {
    const ledger = { list: vi.fn(async () => []) }
    const service = new ChannelWorkflowEventService({ workflowLeaseMs: 60_000, ledger: () => ledger as never,
      sign: vi.fn(), append: vi.fn(), dispatchBot: vi.fn(), createApproval: vi.fn() })
    await service.onRoomEvent(actor, room, { ...sourceEvent, authorKind: 'service', authorId: 'channel-workflow' })
    expect(ledger.list).not.toHaveBeenCalled()
  })
})
