/** Browser attachment plugin: fills conversation's composer and image slots. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { PendingFileCard, type PendingFileCardInput } from './PendingFileCard.tsx'
import { ComposerAttachments, type AttachmentComposerInput } from './ComposerAttachments.tsx'
import { MessageImages } from './MessageImages.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotFactoryMap {
    /** Full workspace attachment rail, previews and scoped drag intake for other composers. */
    'attachments.composer': {
      scope: 'root'
      props: AttachmentComposerInput
      locale: 'conversation'
    }
    /** Shared pending-file card available to any composer with owner-managed uploads. */
    'attachments.pending-file-card': {
      scope: 'root'
      props: PendingFileCardInput
      locale: 'conversation'
    }
  }
}

/** Slot registry required by this presentation plugin. */
export const inject = ['slots']

/** Register attachment presentation without exporting React components as package values. */
export function apply(ctx: ClientContext): void {
  ctx.slots.registerFactory({ name: 'attachments.composer', scope: 'root', locale: 'conversation' }, ComposerAttachments)
  ctx.slots.registerFactory({
    name: 'attachments.pending-file-card', scope: 'root', locale: 'conversation',
  }, PendingFileCard)
  ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
    name: 'conversation.input.attachments',
    locale: 'conversation',
  }, ComposerAttachments))
  ctx.slots.inject('conversation.message.images', () => ctx.slots.register({
    name: 'conversation.message.images',
    locale: 'conversation',
  }, MessageImages))
  ctx.slots.inject('conversation.trajectory.images', () => ctx.slots.register({
    name: 'conversation.trajectory.images',
    locale: 'conversation',
  }, MessageImages))
  // The tool image gallery reuses the message gallery renderer: its owner
  // carries the same images/loadImage/align share the message arm does.
  ctx.slots.inject('tool.call.images', () => ctx.slots.register({
    name: 'tool.call.images',
    locale: 'conversation',
  }, MessageImages))
}
