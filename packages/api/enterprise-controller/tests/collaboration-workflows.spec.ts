import { describe, expect, it, vi } from 'vitest'
import { executeChannelWorkflow, parseChannelWorkflow, workflowMatches } from '../src/collaboration-workflows.ts'

const source = `
version: 1
name: Release notes review
on:
  - type: git
    event: tag_pushed
    source: primary-github
    repository: company/product
steps:
  - type: bot_request
    employeeId: release-editor
    prompt: Draft release notes from this tag
  - type: approval_request
    summary: Review release notes before publication
  - type: room_post
    text: Release notes were approved
`

describe('channel YAML workflow', () => {
  it('matches only its declared event and pauses before steps after a human decision', async () => {
    const workflow = parseChannelWorkflow(source)
    expect(workflowMatches(workflow, { type: 'git', event: 'tag_pushed', source: 'primary-github',
      repository: 'company/product' })).toBe(true)
    expect(workflowMatches(workflow, { type: 'git', event: 'tag_pushed', source: 'primary-github',
      repository: 'other/repo' })).toBe(false)
    const bot = vi.fn(async () => undefined)
    const approval = vi.fn(async () => ({ decisionId: 'decision-1' }))
    const post = vi.fn(async () => undefined)
    const result = await executeChannelWorkflow(workflow, {
      channelId: 'channel-1', sourceEventId: 'git-event-1', workflowId: 'workflow-1', revision: 3,
    }, { bot, approval, post })
    expect(result).toEqual({ state: 'waiting-human', decisionId: 'decision-1', nextStep: 2 })
    expect(bot).toHaveBeenCalledWith({ employeeId: 'release-editor', prompt: 'Draft release notes from this tag',
      idempotencyKey: 'channel-1:workflow-1:3:git-event-1:0' })
    expect(approval).toHaveBeenCalledWith({ summary: 'Review release notes before publication',
      idempotencyKey: 'channel-1:workflow-1:3:git-event-1:1' })
    expect(post).not.toHaveBeenCalled()
    expect(await executeChannelWorkflow(workflow, {
      channelId: 'channel-1', sourceEventId: 'git-event-1', workflowId: 'workflow-1', revision: 3,
    }, { bot, approval, post }, 2)).toEqual({ state: 'completed' })
    expect(post).toHaveBeenCalledWith({ text: 'Release notes were approved',
      idempotencyKey: 'channel-1:workflow-1:3:git-event-1:2' })
  })

  it('rejects executable, unbounded, and ambiguous YAML', () => {
    expect(() => parseChannelWorkflow(source.replace('bot_request', 'shell'))).toThrow()
    expect(() => parseChannelWorkflow(source.replace('employeeId: release-editor', 'employeeId: release-editor\n    command: rm -rf /'))).toThrow()
    expect(() => parseChannelWorkflow(source.replace('on:\n', 'on:\non: []\n'))).toThrow()
    expect(() => parseChannelWorkflow('x'.repeat(65_537))).toThrow()
  })

  it('matches message, reaction, schedule, and authenticated webhook conditions exactly', () => {
    const workflow = parseChannelWorkflow('version: 1\nname: Triage\non:\n  - type: message\n    contains: urgent\n  - type: reaction\n    emoji: 👍\n  - type: schedule\n    scheduleId: overnight\n    everySeconds: 86400\n  - type: webhook\n    hookId: build\nsteps:\n  - type: room_post\n    text: Seen')
    expect(workflowMatches(workflow, { type: 'message', text: 'This is urgent' })).toBe(true)
    expect(workflowMatches(workflow, { type: 'message', text: 'Normal update' })).toBe(false)
    expect(workflowMatches(workflow, { type: 'reaction', emoji: '👍' })).toBe(true)
    expect(workflowMatches(workflow, { type: 'reaction', emoji: '👎' })).toBe(false)
    expect(workflowMatches(workflow, { type: 'schedule', scheduleId: 'overnight' })).toBe(true)
    expect(workflowMatches(workflow, { type: 'webhook', hookId: 'build' })).toBe(true)
    expect(() => parseChannelWorkflow('version: 1\nname: Unscheduled\non:\n  - type: schedule\n    scheduleId: overnight\nsteps:\n  - type: room_post\n    text: Seen')).toThrow()
  })
})
