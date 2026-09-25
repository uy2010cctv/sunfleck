import { describe, expect, it, vi } from 'vitest'
import { ChannelWorkflowController, type ChannelWorkflowLedger } from '../src/collaboration-workflow-controller.ts'
import type { ChannelWorkflowActions } from '../src/collaboration-workflows.ts'

const yaml = 'version: 1\nname: Release review\non:\n  - type: git\n    event: tag_pushed\n    source: primary-github\n    repository: company/product\nsteps:\n  - type: bot_request\n    employeeId: editor\n    prompt: Draft release notes\n  - type: approval_request\n    summary: Approve publication\n  - type: room_post\n    text: Release approved'

function setup() {
  const keys = new Set<string>()
  const resolvedDecisions = new Set<string>()
  const results = new Map<string, { state: string; decisionId?: string; nextStep?: number }>()
  const key = (run: { channelId: string; workflowId: string; revision: number; sourceEventId: string }) =>
    JSON.stringify([run.channelId, run.workflowId, run.revision, run.sourceEventId])
  const ledger: ChannelWorkflowLedger = {
    list: async () => [{ id: 'release', revision: 2, yaml }],
    listRevisions: async () => [{ id: 'release', revision: 2, yaml }],
    reserve: async (run) => {
      const address = key(run)
      if (keys.has(address)) return undefined
      keys.add(address)
      return 'claim-1'
    },
    state: async run => results.get(key(run))?.state === 'completed' ? 'completed'
      : keys.has(key(run)) ? 'reserved' : undefined,
    record: async (run, result) => { results.set(key(run), result) },
    release: async (run) => { keys.delete(key(run)) },
    takeDecision: async (channelId, decisionId) => {
      if (channelId !== 'channel' || decisionId !== 'decision' || resolvedDecisions.has(decisionId)) return undefined
      resolvedDecisions.add(decisionId)
      return { workflow: { id: 'release', revision: 2, yaml }, run: {
        channelId: 'channel', workflowId: 'release', revision: 2, sourceEventId: 'tag-1', leaseToken: 'decision-claim',
      }, nextStep: 2 }
    },
    releaseDecision: async () => { resolvedDecisions.delete('decision') },
  }
  const bot = vi.fn(async () => undefined)
  const approval = vi.fn(async () => ({ decisionId: 'decision' }))
  const post = vi.fn(async () => undefined)
  const actions: ChannelWorkflowActions = { bot, approval, post }
  return { controller: new ChannelWorkflowController(ledger, 60_000), actions, bot, approval, post, results }
}

describe('durable channel workflow dispatch', () => {
  it('executes a Git tag once, leaves approval pending, then continues only after approval', async () => {
    const app = setup()
    await app.controller.dispatch('channel', { type: 'git', event: 'tag_pushed', source: 'primary-github', repository: 'company/product' }, 'tag-1', app.actions)
    await app.controller.dispatch('channel', { type: 'git', event: 'tag_pushed', source: 'primary-github', repository: 'company/product' }, 'tag-1', app.actions)
    expect(app.bot).toHaveBeenCalledOnce()
    expect(app.approval).toHaveBeenCalledOnce()
    expect(app.post).not.toHaveBeenCalled()
    await app.controller.resume('channel', 'decision', true, app.actions)
    expect(app.post).toHaveBeenCalledWith({ text: 'Release approved', idempotencyKey: 'channel:release:2:tag-1:2' })
    await expect(app.controller.resume('channel', 'decision', true, app.actions)).rejects.toThrow('workflow decision not found')
  })

  it('ignores an unmatched event and refuses another channel decision', async () => {
    const app = setup()
    await app.controller.dispatch('channel', { type: 'git', event: 'patch_merged', source: 'primary-github', repository: 'company/product' }, 'merge-1', app.actions)
    expect(app.bot).not.toHaveBeenCalled()
    await expect(app.controller.resume('other', 'decision', true, app.actions)).rejects.toThrow('workflow decision not found')
  })
  it('allows a failed approved continuation to retry with the same step key', async () => {
    const app = setup()
    await app.controller.dispatch('channel', { type: 'git', event: 'tag_pushed', source: 'primary-github', repository: 'company/product' }, 'tag-1', app.actions)
    app.post.mockRejectedValueOnce(new Error('temporary room write failure'))
    await expect(app.controller.resume('channel', 'decision', true, app.actions)).rejects.toThrow('temporary')
    await expect(app.controller.resume('channel', 'decision', true, app.actions)).resolves.toBeUndefined()
    expect(app.post).toHaveBeenCalledTimes(2)
  })
  it('closes a rejected human decision without publishing later workflow steps', async () => {
    const app = setup()
    await app.controller.dispatch('channel', { type: 'git', event: 'tag_pushed',
      source: 'primary-github', repository: 'company/product' }, 'tag-1', app.actions)
    await app.controller.resume('channel', 'decision', false, app.actions)
    expect(app.post).not.toHaveBeenCalled()
    expect([...app.results.values()]).toEqual([{ state: 'rejected' }])
    await expect(app.controller.resume('channel', 'decision', true, app.actions)).rejects.toThrow('not found')
  })
  it('keeps a trigger retryable while another worker owns its workflow run', async () => {
    const app = setup()
    const event = { type: 'git' as const, event: 'tag_pushed' as const,
      source: 'primary-github', repository: 'company/product' }
    expect(await app.controller.dispatch('channel', event, 'tag-1', app.actions)).toBe(true)
    const first = app.results.keys().next().value
    if (first === undefined) throw new Error('workflow result missing')
    app.results.delete(first)
    expect(await app.controller.dispatch('channel', event, 'tag-1', app.actions)).toBe(false)
  })
  it('replays a room message against the revision captured when that message committed', async () => {
    const oldYaml = 'version: 1\nname: Reply\non:\n  - type: message\n    contains: release\nsteps:\n  - type: room_post\n    text: Old approved action'
    const newYaml = oldYaml.replace('Old approved action', 'New unsafe action')
    const post = vi.fn(async () => undefined)
    const ledger: ChannelWorkflowLedger = {
      list: async () => [{ id: 'review', revision: 2, yaml: newYaml }],
      listRevisions: async () => [{ id: 'review', revision: 1, yaml: oldYaml }],
      reserve: async () => 'captured-claim', state: async () => undefined,
      record: async () => {}, release: async () => {}, takeDecision: async () => undefined,
      releaseDecision: async () => {},
    }
    const controller = new ChannelWorkflowController(ledger, 60_000)
    await controller.dispatch('channel', { type: 'message', text: 'release' }, 'signed-1',
      { bot: async () => {}, approval: async () => ({ decisionId: 'unused' }), post },
      [{ id: 'review', revision: 1 }])
    expect(post).toHaveBeenCalledWith({ text: 'Old approved action',
      idempotencyKey: 'channel:review:1:signed-1:0' })
  })
})
