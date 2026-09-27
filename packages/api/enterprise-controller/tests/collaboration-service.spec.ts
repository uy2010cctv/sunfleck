import { describe, expect, it } from 'vitest'
import { CollaborationService } from '../src/collaboration-service.ts'
import type { CollaborationRecord, CollaborationSession, CollaborationTopic } from '@deepseek-ai/dsh-enterprise-postgres'

const actor = { orgId: 'org', userId: 'alice', roles: ['administrator'] as const }
function setup(overrides: Partial<CollaborationRecord> = {}, room?: Record<string, unknown>) {
  const record: CollaborationRecord = { id: 'surface', orgId: 'org', kind: 'group', name: 'Support', workspaceId: 'shared', memberUserIds: ['alice', 'bob'], memberEmployeeIds: ['a', 'b'], dutyEmployeeIds: [], ...overrides }
  const sessions: CollaborationSession[] = []
  const topics: CollaborationTopic[] = []
  const prompted: string[] = []
  const recorded: string[] = []
  const publications: string[][] = []
  const stored = record as { -readonly [K in keyof CollaborationRecord]: CollaborationRecord[K] }
  let creates = 0
  let memberVisible = true
  const store = {
    list: async () => [record], get: async (orgId: string) => orgId === record.orgId ? record : undefined,
    sessions: async () => sessions, topics: async () => topics,
    bind: async (value: CollaborationSession) => { sessions.push(value) },
    ensureTopic: async (_surface: string, id: string, title: string) => { if (!topics.some(t => t.id === id)) topics.push({ id, title, state: 'open' }) },
    settle: async () => true,
    rename: async (orgId: string, id: string, name: string) => {
      if (orgId !== record.orgId || id !== record.id) return false
      stored.name = name
      return true
    },
    setAnnouncement: async (_surfaceId: string, announcement: string | undefined) => {
      if (announcement === undefined) delete stored.announcement
      else stored.announcement = announcement
    },
    addMembers: async (_surfaceId: string, input: { readonly userIds: readonly string[]; readonly employeeIds: readonly string[] }) => {
      stored.memberUserIds = [...new Set([...record.memberUserIds, ...input.userIds])]
      stored.memberEmployeeIds = [...new Set([...record.memberEmployeeIds, ...input.employeeIds])]
    },
    removeMembers: async (_surfaceId: string, input: { readonly userIds: readonly string[]; readonly employeeIds: readonly string[] }) => {
      const users = new Set(input.userIds), employees = new Set(input.employeeIds)
      stored.memberUserIds = record.memberUserIds.filter(id => !users.has(id))
      stored.memberEmployeeIds = record.memberEmployeeIds.filter(id => !employees.has(id))
    },
    putAttachment: async (value: { attachmentId: string; name: string; mimeType: string; uploaderUserId: string }) => {
      attachments.set(value.attachmentId, { ...value, size: 2048 })
    },
    getAttachment: async (_surfaceId: string, attachmentId: string) => attachments.get(attachmentId),
  }
  const attachments = new Map<string, { attachmentId: string; name: string; mimeType: string; uploaderUserId: string; size: number }>()
  const service = new CollaborationService(store as never, {
    refreshWorkspace: () => { publications.push(sessions.map(value => value.sessionId)) },
    workspaceVisible: async () => true,
    memberWorkspaceVisible: async () => memberVisible,
    employee: async (_actor: unknown, id: string) => id === 'ghost' ? undefined
      : { employeeId: id, displayName: id === 'a' ? 'Alpha' : id === 'sales' ? 'Sales' : id === 'analyst' ? 'Sales Analyst' : 'Beta', releaseId: `release-${id}` },
    projectActive: async () => false,
    createSession: async (_actor: unknown, input: { sessionId: string }) => { creates++; return input.sessionId },
    record: async (_actor: unknown, sessionId: string) => { recorded.push(sessionId) },
    ingest: async () => ({ delivered: true, targets: [] }),
    prompt: async (_actor: unknown, sessionId: string) => { prompted.push(sessionId) },
    ...(room === undefined ? {} : { room }),
  } as never)
  return { service, sessions, prompted, recorded, publications, get creates() { return creates },
    setMemberVisible: (value: boolean) => { memberVisible = value } }
}

describe('collaboration routing through native Sessions', () => {
  it('lists the project and charter relationships needed to organize member rooms', async () => {
    const fixture = setup({ projectId: 'project-q4', teamDefinitionId: 'charter-q4' })
    expect(await fixture.service.list(actor)).toEqual([{
      id: 'surface', kind: 'group', name: 'Support', memberCount: 4,
      projectId: 'project-q4', teamDefinitionId: 'charter-q4', workspaceId: 'shared', executionSessionIds: [],
      attention: { newMessages: false, mentions: false },
    }])
  })
  it('lists native execution Session ids for hiding duplicate Workspace rows', async () => {
    const fixture = setup()
    fixture.sessions.push({ surfaceId: 'surface', topicId: '', employeeId: 'a', sessionId: 'execution-1' })
    expect(await fixture.service.list(actor)).toMatchObject([{ executionSessionIds: ['execution-1'] }])
  })
  it('refuses to link a new room to an archived project', async () => {
    const fixture = setup()
    await expect(fixture.service.create(actor, { kind: 'group', name: 'Late group', workspaceId: 'shared',
      memberUserIds: ['alice'], memberEmployeeIds: ['a'], dutyEmployeeIds: [], projectId: 'archived',
    })).rejects.toMatchObject({ code: 'project-unavailable', status: 404 })
  })
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

  it('uploads room attachments, signs them into the message, and names them in employee prompts', async () => {
    const committed: { readonly text: string; readonly attachments?: unknown }[] = []
    const fixture = setup({ adminUserId: 'alice' }, {
      appendHuman: async (_actor: unknown, _row: unknown, input: { text: string }, _dispatch: unknown,
        attachments?: readonly unknown[]) => {
        committed.push({ text: input.text, attachments })
        const tags = (attachments ?? []).map((file: { attachmentId: string; name: string; mimeType: string; size: number }) =>
          ['attachment', file.attachmentId, file.name, file.mimeType, String(file.size)])
        return { event: { id: 'evt-1', kind: 9, content: input.text, tags }, sequence: '1' }
      },
      present: async (_actor: unknown, _row: unknown, value: {
        event: { tags: string[][]; content: string; id: string }
        sequence: string }) =>
        ({ ...value.event, sequence: value.sequence, author: { kind: 'human' as const, id: 'alice', displayName: 'Alice' } }),
    })
    const ref = await fixture.service.uploadAttachment(actor, 'surface',
      { name: '报价.pdf', mimeType: 'application/pdf', data: Buffer.alloc(2048) })
    expect(ref).toMatchObject({ name: '报价.pdf', mimeType: 'application/pdf', size: 2048 })
    const detail = await fixture.service.message(actor, 'surface', { text: '见附件', attachments: [ref] })
    expect(detail.delivered).toBe(true)
    if (!detail.delivered || detail.event === undefined) throw new Error('expected committed event')
    const tag = detail.event.tags.find(candidate => candidate[0] === 'attachment')
    expect(tag?.slice(1)).toEqual([ref.attachmentId, '报价.pdf', 'application/pdf', '2048'])
    expect(committed[0]).toMatchObject({ text: '见附件' })
    await expect(fixture.service.message(actor, 'surface', { text: 'x',
      attachments: [{ attachmentId: 'missing' }] })).rejects.toMatchObject({ code: 'attachment-not-found', status: 404 })
    await expect(fixture.service.uploadAttachment(actor, 'surface', { name: 'big.bin', mimeType: 'application/octet-stream',
      data: Buffer.alloc(21 * 1024 * 1024) })).rejects.toMatchObject({ code: 'attachment-too-large', status: 413 })
  })

  it('matches a full employee name with spaces and prefers the longest roster name', async () => {
    const fixture = setup({ memberEmployeeIds: ['sales', 'analyst'] })
    const result = await fixture.service.message(actor, 'surface', { text: '@Sales Analyst, review this' })
    expect(result).toMatchObject({ delivered: true, targets: [{ employeeId: 'analyst' }] })
    expect(await fixture.service.message(actor, 'surface', { text: '@Salesperson review this' })).toEqual({ delivered: false, reason: 'no-target' })
  })

})

describe('group administration by its recorded creator', () => {
  it('lets the creator rename the group and read back the refreshed detail as administrator', async () => {
    const fixture = setup({ adminUserId: 'alice', announcement: 'Review Friday' })
    const detail = await fixture.service.rename(actor, 'surface', ' Renewed ')
    expect(detail).toMatchObject({ name: 'Renewed', viewerUserId: 'alice', viewerIsAdmin: true, adminUserId: 'alice', announcement: 'Review Friday' })
    expect(await fixture.service.setAnnouncement(actor, 'surface', 'Launch Monday')).toMatchObject({ announcement: 'Launch Monday' })
    expect(await fixture.service.setAnnouncement(actor, 'surface', '')).not.toHaveProperty('announcement')
  })
  it('rejects a rename that is empty or longer than the stored name budget', async () => {
    const fixture = setup({ adminUserId: 'alice' })
    await expect(fixture.service.rename(actor, 'surface', '   ')).rejects.toMatchObject({ code: 'invalid-name' })
    await expect(fixture.service.rename(actor, 'surface', 'x'.repeat(121))).rejects.toMatchObject({ code: 'invalid-name' })
  })
  it('denies administration to other members, strangers, and legacy groups without a recorded creator', async () => {
    await expect(setup({ adminUserId: 'alice' }).service.rename({ ...actor, userId: 'bob' }, 'surface', 'New')).rejects.toMatchObject({ code: 'group-admin-required', status: 403 })
    await expect(setup({ adminUserId: 'alice' }).service.rename({ ...actor, userId: 'eve' }, 'surface', 'New')).rejects.toMatchObject({ code: 'not-found' })
    await expect(setup().service.rename(actor, 'surface', 'New')).rejects.toMatchObject({ code: 'group-admin-required', status: 403 })
    await expect(setup({ adminUserId: 'alice', kind: 'channel' }).service.rename(actor, 'surface', 'New')).rejects.toMatchObject({ code: 'group-only' })
  })
  it('adds visible humans and published employees and reports the enlarged roster', async () => {
    const fixture = setup({ adminUserId: 'alice' })
    const detail = await fixture.service.addMembers(actor, 'surface', { employeeIds: ['a', 'c'], userIds: ['carol'] })
    expect(detail.memberCount).toBe(6)
    expect(detail.members.map(member => member.employeeId)).toContain('c')
    await expect(fixture.service.addMembers(actor, 'surface', { employeeIds: ['ghost'] })).rejects.toMatchObject({ code: 'employee-unavailable', status: 404 })
    fixture.setMemberVisible(false)
    await expect(fixture.service.addMembers(actor, 'surface', { userIds: ['carol'] })).rejects.toMatchObject({ code: 'member-workspace-forbidden', status: 403 })
    await expect(fixture.service.addMembers(actor, 'surface', {})).rejects.toMatchObject({ code: 'invalid-members' })
  })
  it('removes members but never the recorded administrator', async () => {
    const fixture = setup({ adminUserId: 'alice' })
    const detail = await fixture.service.removeMembers(actor, 'surface', { employeeIds: ['b'], userIds: ['bob'] })
    expect(detail).toMatchObject({ memberCount: 2, memberUserIds: ['alice'] })
    await expect(fixture.service.removeMembers(actor, 'surface', { userIds: ['alice'] })).rejects.toMatchObject({ code: 'group-admin-removal' })
    await expect(fixture.service.removeMembers(actor, 'surface', { employeeIds: [] })).rejects.toMatchObject({ code: 'invalid-members' })
  })

})
