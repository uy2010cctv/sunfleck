import { Context } from '@deepseek-ai/cordis'
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure'
import { describe, expect, it, vi } from 'vitest'
import { AttachmentId, AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { AttachmentAdmissionPart } from '@deepseek-ai/dsh-attachment'
import type { CollaborationRecord, RoomEvent } from '@deepseek-ai/dsh-enterprise-postgres'
import { admitRoomPrompt, roomAttachmentFailureCode } from '../src/collaboration-room-attachments.ts'
import { CollaborationError } from '../src/collaboration-service.ts'

const actor = { orgId: 'org', userId: 'alice', roles: ['administrator'] as const }
const row: CollaborationRecord = { id: 'room', orgId: 'org', kind: 'group', name: 'Room', workspaceId: 'workspace',
  memberUserIds: ['alice'], memberEmployeeIds: [], dutyEmployeeIds: [] }

function fixture(mimeType = 'text/plain', modalities: readonly string[] = ['text', 'image']) {
  const data = Buffer.from('original upload')
  const event: RoomEvent = { orgId: 'org', surfaceId: 'room', sequence: '1', authorKind: 'human', authorId: 'alice',
    event: finalizeEvent({ kind: 9, created_at: 1, content: 'read upload',
      tags: [['h', 'room'], ['attachment', 'upload-id', 'notes.txt', mimeType, String(data.length)]] }, generateSecretKey()) }
  const read = vi.fn(async () => ({ data, name: 'notes.txt', mimeType, size: data.length }))
  const get = vi.fn(async () => event)
  const file = { attachmentId: AttachmentId('sha256:' + 'a'.repeat(64)), name: 'notes.txt', bytes: data.length }
  const save = vi.fn(async () => file)
  const admit = vi.fn(async (content: readonly AttachmentAdmissionPart[]) => content)
  const ctx = new Context()
  ctx.provide('enterprisePostgres' as never, { roomEvents: { getByEventId: get } } as never)
  ctx.provide('attachments' as never, { saveFile: save, admitPromptContent: admit } as never)
  ctx.provide('sessionProjections' as never, { stateOf: () => ({ pending: { provider: 'provider', model: 'model' } }) } as never)
  ctx.provide('agentDefaultModel' as never, { currentSelection: () => ({ provider: 'provider', model: 'model' }) } as never)
  ctx.provide('llm' as never, { resolveModelInfo: async () => ({ inputModalities: modalities }) } as never)
  const run = () => admitRoomPrompt(ctx, {} as never, actor, row, event.event.id, 'bounded prompt', read)
  return { ctx, data, event, read, get, save, admit, file, run }
}

describe('signed room attachment admission', () => {
  it('reads only exact signed source uploads and stores their original bytes', async () => {
    const app = fixture()
    try {
      expect(await app.run()).toEqual([{ type: 'text', text: 'bounded prompt' }, { type: 'file', attachment: app.file }])
      expect(app.get).toHaveBeenCalledWith('org', 'room', app.event.event.id)
      expect(app.read).toHaveBeenCalledExactlyOnceWith('upload-id')
      expect(app.save).toHaveBeenCalledExactlyOnceWith({ data: app.data, name: 'notes.txt' })
    } finally { await app.ctx.fiber.dispose() }
  })
  it.each(['org', 'room', 'signature', 'request'] as const)('rejects an inconsistent %s before reading uploads', async (field) => {
    const app = fixture()
    const source = field === 'org' ? { ...app.event, orgId: 'foreign' }
      : field === 'room' ? { ...app.event, surfaceId: 'foreign' }
        : { ...app.event, event: { ...app.event.event,
          ...(field === 'signature' ? { content: 'tampered' } : { id: 'foreign-request' }) } }
    app.get.mockImplementation(async () => source)
    try {
      await expect(app.run()).rejects.toThrow('room-event-forbidden')
      expect(app.read).not.toHaveBeenCalled()
      expect(app.save).not.toHaveBeenCalled()
    } finally { await app.ctx.fiber.dispose() }
  })
  it('rejects changed stored metadata instead of admitting an unrelated upload', async () => {
    const app = fixture()
    app.read.mockImplementation(async () => ({ data: app.data, name: 'changed.txt', mimeType: 'text/plain', size: app.data.length }))
    try {
      await expect(app.run()).rejects.toThrow('invalid-attachment')
      expect(app.save).not.toHaveBeenCalled()
    } finally { await app.ctx.fiber.dispose() }
  })
  it('rejects images for a text model before image admission or file storage', async () => {
    const app = fixture('image/png', ['text'])
    try {
      await expect(app.run()).rejects.toThrow('model-does-not-support-images')
      expect(app.admit).not.toHaveBeenCalled()
      expect(app.save).not.toHaveBeenCalled()
    } finally { await app.ctx.fiber.dispose() }
  })
  it('admits non-raster image media as a generic file', async () => {
    const app = fixture('image/svg+xml')
    try {
      expect(await app.run()).toContainEqual({ type: 'file', attachment: app.file })
      expect(app.save).toHaveBeenCalledExactlyOnceWith({ data: app.data, name: 'notes.txt' })
    } finally { await app.ctx.fiber.dispose() }
  })
  it('passes image bytes to the shared image validator without downgrading them to files', async () => {
    const app = fixture('image/png')
    app.admit.mockRejectedValue(new Error('invalid encoded image'))
    try {
      await expect(app.run()).rejects.toThrow('invalid encoded image')
      expect(app.admit).toHaveBeenCalledWith([{ type: 'text', text: 'bounded prompt' }, {
        type: 'image', mediaType: 'image/png', data: app.data.toString('base64'), name: 'notes.txt' }])
      expect(app.save).not.toHaveBeenCalled()
    } finally { await app.ctx.fiber.dispose() }
  })
})

describe('room attachment rejection classification', () => {
  it.each(['INVALID_IMAGE', 'IMAGE_TOO_LARGE', 'IMAGE_TYPE_MISMATCH'] as const)('settles rejected image input %s', (code) => {
    expect(roomAttachmentFailureCode(new AttachmentError('rejected image', code))).toBe(code)
  })
  it('settles the selected model image rejection', () => {
    expect(roomAttachmentFailureCode(new CollaborationError('model-does-not-support-images', 409)))
      .toBe('model-does-not-support-images')
  })
  it.each(['ATTACHMENT_WRITE_FAILED', 'ATTACHMENT_READ_FAILED'] as const)('keeps storage fault %s retryable', (code) => {
    expect(roomAttachmentFailureCode(new AttachmentError('storage fault', code))).toBeUndefined()
  })
})
