/** Verified room uploads admitted through the native Workspace attachment provider. */
import type { Context } from '@deepseek-ai/cordis'
import { verifyEvent } from 'nostr-tools/pure'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { isImageAdmissionError } from '@deepseek-ai/dsh-attachment'
import type { AttachmentAdmissionPart, AdmittedPromptContentPart } from '@deepseek-ai/dsh-attachment'
import type { CollaborationRecord } from '@deepseek-ai/dsh-enterprise-postgres'
import type { EnterprisePrincipal } from '@deepseek-ai/dsh-enterprise-governance'
import { CollaborationError } from './collaboration-service.ts'

/** Admit only attachments named by the exact signed source event in the current room.
 * @param ctx - Native Host services.
 * @param agent - Destination Agent whose selected model receives images.
 * @param actor - Current authorized member.
 * @param row - Current room.
 * @param messageId - Signed source event identity, also the native request identity.
 * @param text - Bounded room prompt.
 * @param readAttachment - Membership-checked room upload reader.
 * @returns Native content with stored file and validated image references.
 */
export async function admitRoomPrompt(ctx: Context, agent: Agent, actor: EnterprisePrincipal,
  row: CollaborationRecord, messageId: string, text: string,
  readAttachment: (id: string) => Promise<{ name: string; mimeType: string; size: number; data: Buffer }>,
): Promise<readonly AdmittedPromptContentPart[]> {
  const content: AttachmentAdmissionPart[] = [{ type: 'text', text }]
  if (actor.orgId !== row.orgId || !row.memberUserIds.includes(actor.userId)) {
    throw new CollaborationError('room-event-forbidden', 403)
  }
  const source = await ctx.enterprisePostgres.roomEvents.getByEventId(row.orgId, row.id, messageId)
  if (source === undefined || source.orgId !== row.orgId || source.surfaceId !== row.id
    || source.event.id !== messageId
    || !source.event.tags.some(tag => tag[0] === 'h' && tag[1] === row.id)
    || !verifyEvent({ id: source.event.id, pubkey: source.event.pubkey, created_at: source.event.created_at,
      kind: source.event.kind, content: source.event.content, sig: source.event.sig,
      tags: source.event.tags.map(tag => [...tag]) })) {
    throw new CollaborationError('room-event-forbidden', 403)
  }
  for (const tag of source.event.tags.filter(value => value[0] === 'attachment')) {
    const attachmentId = tag[1]
    if (attachmentId === undefined) throw new CollaborationError('invalid-attachment')
    const stored = await readAttachment(attachmentId)
    if (tag.length !== 5 || tag[2] !== stored.name || tag[3] !== stored.mimeType || tag[4] !== String(stored.size)) {
      throw new CollaborationError('invalid-attachment')
    }
    const mediaType = stored.mimeType
    if (mediaType === 'image/png' || mediaType === 'image/jpeg' || mediaType === 'image/webp' || mediaType === 'image/gif') {
      const selection = ctx.sessionProjections.stateOf(agent.session, 'modelSelection')
      if (selection === undefined) throw new Error('required modelSelection projection is not registered')
      const defaultModel = ctx.get('agentDefaultModel')
      if (defaultModel === undefined) throw new Error('required Agent default model service is unavailable')
      const current = selection.pending ?? agent.session.requestHeader()?.config ?? defaultModel.currentSelection()
      const model = await ctx.llm.resolveModelInfo(current.provider, current.model)
      if (model.inputModalities !== undefined && !model.inputModalities.includes('image')) {
        throw new CollaborationError('model-does-not-support-images', 409)
      }
      content.push({ type: 'image', mediaType,
        data: stored.data.toString('base64'), name: stored.name })
    } else {
      content.push({ type: 'file', attachment: await ctx.attachments.saveFile({ data: stored.data, name: stored.name }) })
    }
  }
  return ctx.attachments.admitPromptContent(content)
}

/** Classify rejected attachment input separately from retryable storage and transport failures.
 * @param error - Attachment admission failure.
 * @returns Stable rejection code for input the sender must correct, otherwise undefined.
 */
export function roomAttachmentFailureCode(error: unknown): string | undefined {
  if (isImageAdmissionError(error)) return error.code
  if (error instanceof CollaborationError
    && (error.code === 'invalid-attachment' || error.code === 'model-does-not-support-images')) return error.code
  return undefined
}
