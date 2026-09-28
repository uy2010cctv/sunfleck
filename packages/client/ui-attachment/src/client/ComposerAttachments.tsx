import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type {
  ComposerAttachment, ComposerAttachmentsProps, ComposerAttachmentsOwnerProps, ComposerImageAttachment,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconCloseFillRegular, IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { AttachmentRail } from '../AttachmentRail.tsx'
import type { AttachmentRailItem } from '../AttachmentRail.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { FileCard } from '../FileCard.tsx'
import { ImageLightbox } from '@deepseek-ai/dsh-client-ui-primitives'
import { attachmentRailLabels, dropOverlayLabels, fileCardLabels, lightboxLabels } from './labels.ts'
import { installDocumentDropEvents } from './drop-events.ts'
import css from './ComposerAttachments.module.css'

/** Rail item retaining its browser-owned attachment for callbacks. */
interface ComposerRailItem extends AttachmentRailItem {
  attachment: ComposerAttachment
}

/** Shared attachment presentation with owner-managed upload state and optional local drop area. */
export interface AttachmentComposerInput extends Omit<ComposerAttachmentsOwnerProps, 'uploads'> {
  /** Upload presentation keyed by draft id; receipts remain with the upload owner. */
  uploads: Readonly<Record<string, { readonly status: 'uploading' | 'ready' | 'error'; readonly loaded?: number; readonly total?: number }>>
  /** Limit drag intake to this composer when several composers are visible. */
  dropTarget?: RefObject<HTMLElement> | undefined
}

/** Draft image previews, pending-file cards, drop target, and original-image preview. */
export function ComposerAttachments({
  attachments, canAcceptDrop, onAddFiles, onRemoveAttachment, uploads, onRetryFile, dropLimits, dropTarget, t,
}: AttachmentComposerInput & Pick<ComposerAttachmentsProps, 't'>) {
  const [preview, setPreview] = useState<ComposerImageAttachment | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const closePreview = useCallback(() => { setPreview(null) }, [])
  useEffect(() => {
    if (preview !== null && !attachments.some(attachment => attachment.id === preview.id)) setPreview(null)
  }, [attachments, preview])

  useEffect(() => {
    return installDocumentDropEvents(canAcceptDrop, onAddFiles, dragDepth, setDragActive, dropTarget)
  }, [canAcceptDrop, onAddFiles, dropTarget])

  const railItems = useMemo<ComposerRailItem[]>(() => attachments.map(attachment => ({
    id: attachment.id,
    attachment,
  })), [attachments])

  return (
    <>
      {dragActive && (
        <DropOverlay
          disabled={!canAcceptDrop}
          labels={dropOverlayLabels(t, canAcceptDrop, dropLimits)}
        />
      )}
      {railItems.length > 0 && (
        <div className={css.rail}>
          <AttachmentRail
            items={railItems}
            labels={attachmentRailLabels(t)}
            renderItem={(item) => {
              const attachment = item.attachment
              if (attachment.kind === 'file') {
                const upload = uploads[attachment.id]
                return (
                  <FileCard
                    name={attachment.file.name || t('file.label')}
                    bytes={attachment.file.size}
                    state={upload === undefined || upload.status === 'uploading'
                      ? 'uploading'
                      : upload.status === 'ready' ? 'ready' : 'error'}
                    {...upload?.status === 'uploading' && upload.total !== undefined && upload.total > 0
                      ? { progress: (upload.loaded ?? 0) / upload.total }
                      : {}}
                    labels={fileCardLabels(t, attachment.file.name)}
                    onRemove={() => { onRemoveAttachment(attachment.id) }}
                    onRetry={() => { onRetryFile(attachment.id) }}
                  />
                )
              }
              return (
                <div className={css.imageItem}>
                  <button
                    type="button"
                    className={css.thumbnail}
                    title={t('image.openOriginal')}
                    onClick={() => { setPreview(attachment) }}
                  >
                    <img src={attachment.previewUrl} alt={attachment.file.name || t('image.pending')} />
                  </button>
                  {uploads[attachment.id]?.status === 'uploading' && <span className={css.imageStatus}
                    role="status" aria-label={t('file.uploading')}><IconLoadingOutlineRegular size={16} /></span>}
                  {uploads[attachment.id]?.status === 'error' && <button type="button" className={css.imageStatus}
                    aria-label={t('file.retry', { name: attachment.file.name })}
                    onClick={() => { onRetryFile(attachment.id) }}>{t('file.uploadFailed')}</button>}
                  <button
                    type="button"
                    className={css.remove}
                    aria-label={t('image.remove', { name: attachment.file.name })}
                    onClick={() => { onRemoveAttachment(attachment.id) }}
                  >
                    <IconCloseFillRegular size={12} />
                  </button>
                </div>
              )
            }}
          />
        </div>
      )}
      {preview !== null && (
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name || t('image.original')}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}
