/** Shared pending-file presentation for composers outside Session conversations. */
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import { FileCard } from '../FileCard.tsx'
import { fileCardLabels } from './labels.ts'

/** File metadata and upload gestures; browser File objects remain with the composer owner. */
export type PendingFileCardInput = Omit<Parameters<typeof FileCard>[0], 'labels'>

/**
 * Render the workspace pending-file card with the shared conversation labels.
 * @param props - owner metadata, upload state, remove/retry callbacks and the framework translator.
 * @returns the shared file card.
 */
export function PendingFileCard({ name, bytes, state, progress, onRemove, onRetry, t }:
Pick<FactoryComponentPropsOf<'attachments.pending-file-card'>, keyof PendingFileCardInput | 't'>) {
  return <FileCard name={name} bytes={bytes} state={state}
    {...progress === undefined ? {} : { progress }}
    labels={fileCardLabels(t, name)} onRemove={onRemove} onRetry={onRetry} />
}
