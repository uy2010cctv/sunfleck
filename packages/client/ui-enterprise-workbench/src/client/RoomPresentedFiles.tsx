/** Collaboration reply deliveries rendered through the shared file-card factory. */
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-deliverables/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RoomPresentedFile } from './collaboration-store.ts'
import css from './CollaborationRoom.module.css'

/**
 * Render source-Session file cards with an authenticated download fallback when the factory is absent.
 * @param props - recorded files, their source Session, framework renderer and localized fallback label.
 * @returns independent file cards, or nothing when the reply declares no files.
 */
export function RoomPresentedFiles({ files, sessionId, renderFactorySlot, downloadLabel }: {
  readonly files: readonly RoomPresentedFile[]
  readonly sessionId: string
  readonly downloadLabel: string
} & Partial<Pick<PropsRenderFactories, 'renderFactorySlot'>>) {
  if (files.length === 0) return null
  return <div className={css.fileCards}>{files.map((file) => {
    const fallback = <a href={file.downloadUrl} download aria-label={`${downloadLabel} ${file.path}`}>
      {file.path.split(/[\\/]/u).pop() ?? file.path}
    </a>
    return <div key={`${file.seq}:${file.index}`}>
      {renderFactorySlot === undefined ? fallback : renderFactorySlot('deliverables.presented-card', {
        sessionId: SessionId(sessionId), file, downloadUrl: file.downloadUrl,
      }, { fallback })}
    </div>
  })}</div>
}
