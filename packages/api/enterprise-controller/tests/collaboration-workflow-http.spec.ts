import { describe, expect, it, vi } from 'vitest'
import { ChannelWorkflowHttpHandler } from '../src/collaboration-workflow-http.ts'
import { CollaborationError } from '../src/collaboration-service.ts'

const actor = { orgId: 'org', userId: 'alice', roles: ['administrator'] as const }
const validYaml = 'version: 1\nname: Review\non:\n  - type: message\n    contains: review\nsteps:\n  - type: room_post\n    text: Ready'

function setup(member = true, canManage = true) {
  const save = vi.fn(async () => ({ id: 'release', revision: 1, yaml: validYaml }))
  const list = vi.fn(async () => [{ id: 'release', revision: 1, yaml: validYaml }])
  const pendingDecisions = vi.fn(async () => [{ approvalId: 'approval-1', revision: 1,
    yaml: 'version: 1\nname: Review\non:\n  - type: message\n    contains: review\nsteps:\n  - type: approval_request\n    summary: Approve release',
    nextStep: 1, requestedBy: 'alice', createdAt: 100, state: 'pending' as const }])
  const detail = vi.fn(async () => {
    if (!member) throw new CollaborationError('not-found', 404)
    return { kind: 'channel' as const, id: 'channel' }
  })
  const resolveDecision = vi.fn(async () => ({ state: 'approved' as const }))
  const handler = new ChannelWorkflowHttpHandler({
    security: {
      authenticateCookieAsync: async () => actor,
      authorizeResourceAsync: async (_actor: unknown, action: string) => ({ allowed: action === 'channel.read' || canManage, reason: 'role' }),
      auditApiResourceAsync: async () => {},
    },
    detail, ledger: () => ({ save, list, pendingDecisions }), resolveDecision,
  })
  const request = (method: string, path = '/enterprise/channel-workflows/channel/release', body?: unknown) =>
    handler.fetch(new Request(`https://dsh${path}`, { method, headers: { cookie: 'session=local' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) }))
  return { request, detail, save, list, pendingDecisions, resolveDecision }
}

describe('authenticated channel workflow configuration', () => {
  it('saves validated YAML with an explicit revision and reads only its channel', async () => {
    const app = setup()
    const saved = await app.request('PUT', undefined, { yaml: validYaml, expectedRevision: 0 })
    expect(saved.status).toBe(200)
    expect(app.save).toHaveBeenCalledWith({ channelId: 'channel', id: 'release', yaml: validYaml,
      expectedRevision: 0, createdBy: 'alice' })
    const listed = await app.request('GET', '/enterprise/channel-workflows/channel')
    expect(await listed.json()).toEqual({ items: [{ id: 'release', revision: 1, yaml: validYaml }], canManage: true })
  })

  it('persists a concrete scheduled trigger at save time', async () => {
    const app = setup()
    const yaml = 'version: 1\nname: Morning review\non:\n  - type: schedule\n    scheduleId: morning\n    at: "2026-09-26T08:00:00Z"\nsteps:\n  - type: room_post\n    text: Morning review'
    expect((await app.request('PUT', undefined, { yaml, expectedRevision: 0 })).status).toBe(200)
    expect(app.save).toHaveBeenCalledWith(expect.objectContaining({ schedules: [{ triggerIndex: 0,
      scheduleId: 'morning', nextDueAt: Date.parse('2026-09-26T08:00:00Z') }] }))
  })

  it('rejects executable YAML and nonmembers before storage', async () => {
    const app = setup()
    const invalid = await app.request('PUT', undefined, { yaml: validYaml.replace('room_post', 'shell'), expectedRevision: 0 })
    expect(invalid.status).toBe(400)
    expect(app.save).not.toHaveBeenCalled()
    const outsider = setup(false)
    expect((await outsider.request('GET', '/enterprise/channel-workflows/channel')).status).toBe(404)
    expect(outsider.list).not.toHaveBeenCalled()
  })
  it('keeps workflow YAML read-only when manager authorization is absent', async () => {
    const app = setup(true, false)
    expect(await (await app.request('GET', '/enterprise/channel-workflows/channel')).json())
      .toMatchObject({ canManage: false })
    expect((await app.request('PUT', undefined, { yaml: validYaml, expectedRevision: 0 })).status).toBe(403)
    expect(app.save).not.toHaveBeenCalled()
  })
  it('returns actionable pending decision summaries in the channel', async () => {
    const app = setup()
    const response = await app.request('GET', '/enterprise/channel-workflows/channel/decisions')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [{ approvalId: 'approval-1',
      summary: 'Approve release', state: 'pending', revision: 1, requestedBy: 'alice', createdAt: 100 }],
    canDecide: true })
  })

  it('passes a channel-scoped human decision through the authorized decision service', async () => {
    const app = setup()
    const response = await app.request('POST', '/enterprise/channel-workflows/channel/decisions/approval-1',
      { approved: true, expectedRevision: 1, idempotencyKey: 'approve-1' })
    expect(response.status).toBe(200)
    expect(app.resolveDecision).toHaveBeenCalledWith(actor, 'channel', 'approval-1', {
      approved: true, expectedRevision: 1, idempotencyKey: 'approve-1',
    })
    const outsider = setup(false)
    expect((await outsider.request('POST', '/enterprise/channel-workflows/channel/decisions/approval-1',
      { approved: true, expectedRevision: 1, idempotencyKey: 'approve-1' })).status).toBe(404)
    expect(outsider.resolveDecision).not.toHaveBeenCalled()
  })
  it('accepts an opaque channel id beginning with a digit', async () => {
    const app = setup()
    expect((await app.request('GET', '/enterprise/channel-workflows/9a1-room')).status).toBe(200)
  })
  it('accepts a generated workflow approval id', async () => {
    const app = setup()
    const approvalId = `channel-workflow-${'a'.repeat(64)}`
    expect((await app.request('POST', `/enterprise/channel-workflows/channel/decisions/${approvalId}`,
      { approved: true, expectedRevision: 1, idempotencyKey: 'approve-generated' })).status).toBe(200)
  })
  it('returns a missing decision without a generic transport failure', async () => {
    const app = setup()
    app.resolveDecision.mockRejectedValueOnce(new CollaborationError('approval-not-found', 404))
    expect((await app.request('POST', '/enterprise/channel-workflows/channel/decisions/missing',
      { approved: true, expectedRevision: 1, idempotencyKey: 'approve-1' })).status).toBe(404)
  })
})
