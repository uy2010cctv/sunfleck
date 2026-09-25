import { describe, expect, it, vi } from 'vitest'
import { ChannelGitWorkflowBridge, parseGitTagDelivery } from '../src/collaboration-git-workflow.ts'

const yaml = 'version: 1\nname: Release notes\non:\n  - type: git\n    event: tag_pushed\n    source: primary-github\n    repository: company/product\nsteps:\n  - type: bot_request\n    employeeId: editor\n    prompt: Draft release notes'
const delivery = { kind: 'github', source: 'primary-github', deliveryId: 'github-delivery-1',
  event: { name: 'push', payload: { ref: 'refs/tags/v1.2.3', deleted: false,
    repository: { full_name: 'company/product' } } } }

describe('verified Git webhook channel workflow bridge', () => {
  it('accepts a tag push and rejects a branch push or deleted tag', () => {
    expect(parseGitTagDelivery(delivery)).toMatchObject({ source: 'primary-github',
      repository: 'company/product', tag: 'v1.2.3' })
    expect(parseGitTagDelivery({ ...delivery, event: { ...delivery.event,
      payload: { ...delivery.event.payload, ref: 'refs/heads/main' } } })).toBeUndefined()
    expect(parseGitTagDelivery({ ...delivery, event: { ...delivery.event,
      payload: { ...delivery.event.payload, deleted: true } } })).toBeUndefined()
  })

  it('creates one signed channel ingress for multiple matching workflow revisions', async () => {
    const publish = vi.fn(async () => 'signed-room-event-id')
    const run = vi.fn(async () => undefined)
    const bridge = new ChannelGitWorkflowBridge({
      subscriptions: async () => [
        { orgId: 'org', channelId: 'channel', workflowId: 'release-a', revision: 1, yaml, createdBy: 'manager' },
        { orgId: 'org', channelId: 'channel', workflowId: 'release-b', revision: 1, yaml, createdBy: 'manager' },
        { orgId: 'org', channelId: 'unrelated', workflowId: 'release-c', revision: 1,
          yaml: yaml.replace('company/product', 'other/repo'), createdBy: 'manager' },
      ], publish, run,
    })
    expect(await bridge.onVerifiedDelivery(delivery)).toBe(1)
    expect(publish).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'channel' }),
      expect.objectContaining({ type: 'git', event: 'tag_pushed', repository: 'company/product' }), 'signed-room-event-id')
  })
  it('lets a verified non-tag GitHub webhook trigger an exact channel hook', async () => {
    const publish = vi.fn(async () => 'signed-webhook-event')
    const run = vi.fn(async () => undefined)
    const bridge = new ChannelGitWorkflowBridge({ subscriptions: async () => [{
      orgId: 'org', channelId: 'channel', workflowId: 'webhook', revision: 1, createdBy: 'manager',
      yaml: 'version: 1\nname: Build notice\non:\n  - type: webhook\n    hookId: primary-github\nsteps:\n  - type: room_post\n    text: Build received',
    }], publish, run })
    const branch = { ...delivery, event: { ...delivery.event,
      payload: { ...delivery.event.payload, ref: 'refs/heads/main' } } }
    expect(await bridge.onVerifiedDelivery(branch)).toBe(1)
    expect(publish).toHaveBeenCalledOnce()
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ channelId: 'channel' }),
      { type: 'webhook', hookId: 'primary-github' }, 'signed-webhook-event')
  })
  it('projects verified code reviews and merged pull requests to their channel', async () => {
    const publish = vi.fn(async () => 'signed-git-event')
    const run = vi.fn(async () => undefined)
    const makeYaml = (event: string) => `version: 1\nname: Review\non:\n  - type: git\n    event: ${event}\n    source: primary-github\n    repository: company/product\nsteps:\n  - type: room_post\n    text: Logged`
    const bridge = new ChannelGitWorkflowBridge({ subscriptions: async () => [
      { orgId: 'org', channelId: 'channel', workflowId: 'review', revision: 1,
        yaml: makeYaml('review_submitted'), createdBy: 'manager' },
      { orgId: 'org', channelId: 'channel', workflowId: 'merge', revision: 1,
        yaml: makeYaml('patch_merged'), createdBy: 'manager' },
    ], publish, run })
    const review = { ...delivery, deliveryId: 'review-1', event: { name: 'pull_request_review',
      payload: { action: 'submitted', repository: { full_name: 'company/product' }, review: { id: 42 } } } }
    const merge = { ...delivery, deliveryId: 'merge-1', event: { name: 'pull_request',
      payload: { action: 'closed', repository: { full_name: 'company/product' },
        pull_request: { merged: true, number: 17 } } } }
    expect(await bridge.onVerifiedDelivery(review)).toBe(1)
    expect(await bridge.onVerifiedDelivery(merge)).toBe(1)
    expect(run).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'git',
      event: 'review_submitted' }), 'signed-git-event')
    expect(run).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: 'git',
      event: 'patch_merged' }), 'signed-git-event')
  })
})
