import { describe, expect, it } from 'vitest'
import { CollaborationService } from '../src/collaboration-service.ts'
import type { CollaborationRecord, CollaborationSession, CollaborationTopic } from '@deepseek-ai/dsh-enterprise-postgres'

const actor = { orgId: 'org', userId: 'alice', roles: ['administrator'] as const }
function setup(overrides: Partial<CollaborationRecord> = {}) {
  const record: CollaborationRecord = { id: 'surface', orgId: 'org', kind: 'group', name: 'Support', workspaceId: 'shared', memberUserIds: ['alice', 'bob'], memberEmployeeIds: ['a', 'b'], dutyEmployeeIds: [], ...overrides }
  const sessions: CollaborationSession[] = []
  const topics: CollaborationTopic[] = []
  const prompted: string[] = []
  const recorded: string[] = []
  const publications: string[][] = []
  let creates = 0
  const store = {
    list: async () => [record], get: async (orgId: string) => orgId === record.orgId ? record : undefined,
    sessions: async () => sessions, topics: async () => topics,
    bind: async (value: CollaborationSession) => { sessions.push(value) },
    ensureTopic: async (_surface: string, id: string, title: string) => { if (!topics.some(t => t.id === id)) topics.push({ id, title, state: 'open' }) },
    settle: async () => true,
  }
  const service = new CollaborationService(store as never, {
    refreshWorkspace: () => { publications.push(sessions.map(value => value.sessionId)) },
    workspaceVisible: async () => true,
    employee: async (_actor: unknown, id: string) => ({ employeeId: id, displayName: id === 'a' ? 'Alpha' : 'Beta', releaseId: `release-${id}` }),
    createSession: async (_actor: unknown, input: { sessionId: string }) => { creates++; return input.sessionId },
    record: async (_actor: unknown, sessionId: string) => { recorded.push(sessionId) },
    ingest: async () => ({ delivered: true, targets: [] }),
    prompt: async (_actor: unknown, sessionId: string) => { prompted.push(sessionId) },
  } as never)
  return { service, sessions, prompted, recorded, publications, get creates() { return creates } }
}

describe('collaboration routing through native Sessions', () => {
  it('publishes workspace visibility only after the native destination binding is persisted', async () => {
    const fixture = setup()
    const opened = await fixture.service.open(actor, 'surface', { employeeId: 'a' })
    if (!opened.opened) throw new Error('expected native Session')
    expect(fixture.publications).toEqual([[opened.sessionId]])
  })
  it('opens one shared member destination for different authorized humans', async () => {
    const fixture = setup()
    const first = await fixture.service.open(actor, 'surface', { employeeId: 'a' })
    const second = await fixture.service.open({ ...actor, userId: 'bob' }, 'surface', { employeeId: 'a' })
    expect(first).toMatchObject({ opened: true })
    expect(second).toEqual(first)
    expect(fixture.creates).toBe(1)
  })
  it('rejects humans outside the explicit membership even with workspace access', async () => {
    await expect(setup().service.open({ ...actor, userId: 'eve' }, 'surface', { employeeId: 'a' })).rejects.toMatchObject({ code: 'not-found' })
  })
  it('requires a mention in federated groups and routes only mentioned members', async () => {
    const fixture = setup()
    expect(await fixture.service.message(actor, 'surface', { text: 'Hello' })).toEqual({ delivered: false, reason: 'no-target' })
    expect(await fixture.service.message(actor, 'surface', { text: '@Alpha hello' })).toMatchObject({ delivered: true, targets: [{ employeeId: 'a' }] })
    expect(fixture.prompted).toHaveLength(1)
  })
  it('uses channel duty for an unaddressed message and reuses its topic transcript', async () => {
    const fixture = setup({ kind: 'channel', topicPolicy: 'lane', respondPolicy: 'mention_duty', dutyEmployeeIds: ['b'] })
    const first = await fixture.service.message(actor, 'surface', { text: 'Hello' })
    const second = await fixture.service.message(actor, 'surface', { text: 'Continue' })
    expect(first).toMatchObject({ delivered: true, topicId: 'lane', targets: [{ employeeId: 'b' }] })
    expect(second).toEqual(first)
    expect(fixture.creates).toBe(1)
  })
  it('records the native source transcript when a mention routes to another employee', async () => {
    const fixture = setup()
    const source = await fixture.service.open(actor, 'surface', { employeeId: 'a' })
    if (!source.opened) throw new Error('expected source Session')
    const result = await fixture.service.message(actor, 'surface', { text: '@Beta hello', sourceSessionId: source.sessionId, messageId: 'request-1' })
    expect(result).toMatchObject({ delivered: true, targets: [{ employeeId: 'b' }] })
    expect(fixture.recorded).toEqual([source.sessionId])
  })
  it('records an unaddressed native group message without scheduling an employee', async () => {
    const fixture = setup()
    const source = await fixture.service.open(actor, 'surface', { employeeId: 'a' })
    if (!source.opened) throw new Error('expected source Session')
    expect(await fixture.service.message(actor, 'surface', { text: 'FYI', sourceSessionId: source.sessionId })).toEqual({ delivered: true, targets: [] })
    expect(fixture.recorded).toEqual([source.sessionId])
    expect(fixture.prompted).toEqual([])
  })
  it('intakes announcements without creating a native Agent', async () => {
    const fixture = setup({ kind: 'channel', topicPolicy: 'thread', respondPolicy: 'ingest_only' })
    expect(await fixture.service.message(actor, 'surface', { text: 'New policy' })).toEqual({ delivered: true, targets: [] })
    expect(fixture.creates).toBe(0)
  })

  it('routes every channel mention and retains each employee preset across later messages', async () => {
    const fixture = setup({ kind: 'channel', topicPolicy: 'lane', respondPolicy: 'mention_duty', dutyEmployeeIds: ['a'] })
    const first = await fixture.service.message(actor, 'surface', { text: '@Alpha @Beta review' })
    expect(first).toMatchObject({ delivered: true, targets: [{ employeeId: 'a' }, { employeeId: 'b' }] })
    const second = await fixture.service.message(actor, 'surface', { text: '@Beta continue' })
    expect(second).toMatchObject({ delivered: true, targets: [{ employeeId: 'b' }] })
    expect(fixture.creates).toBe(2)
  })

  it('opens a fresh command topic from a native composer already pinned to another topic', async () => {
    const fixture = setup({ kind: 'channel', topicPolicy: 'command', respondPolicy: 'mention_duty', dutyEmployeeIds: ['a'] })
    const first = await fixture.service.message(actor, 'surface', { text: '/topic Initial', messageId: 'first' })
    if (!first.delivered || first.topicId === undefined) throw new Error('expected first topic')
    const next = await fixture.service.message(actor, 'surface', { text: '/topic Next', topicId: first.topicId, messageId: 'next' })
    expect(next).toMatchObject({ delivered: true })
    if (!next.delivered) throw new Error('expected new topic')
    expect(next.topicId).not.toBe(first.topicId)
  })

})
