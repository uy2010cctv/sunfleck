/** Reusable delivered-file card for surfaces outside the owning Session conversation. */
import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './Deliverables.module.css'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DeliverablesInjected } from './Deliverables.tsx'
import type { PresentedPath } from './turn-deliverables.ts'
import { presentedDownloadUrl, presentedFileUrl } from '../presented.ts'
import { PresentedFileCard } from './PresentedFileCard.tsx'

/** Recorded file coordinates and optional authenticated download route supplied by the host surface. */
export interface PresentedCardInput {
  readonly sessionId: SessionId
  readonly file: PresentedPath
  readonly downloadUrl?: string
}

/** Shared native action state and scoped Sidebar preview callback. */
export interface PresentedCardInjected extends Pick<DeliverablesInjected,
  'reloadPresentedHost' | 'openPresented'> {
  readonly hooks: Pick<DeliverablesInjected['hooks'], 'presentedOpen' | 'presentedHost'>
  /** Open a file using its source Session filesystem and the existing preview plugins. */
  readonly openPreview: (sessionId: SessionId, cwd: string | undefined, path: string) => void
}

/**
 * Render the shared delivered-file card and contributed native/download controls.
 * @param props - source Session, file coordinates, shared operation state and framework-bound renderers.
 * @returns one independently actionable file card.
 */
export function PresentedCardFactory({
  sessionId, file, downloadUrl, useSessions, usePresentedOpen, usePresentedHost,
  reloadPresentedHost, openPresented, openPreview, renderSlot, t,
}: FactoryComponentPropsOf<'deliverables.presented-card'>) {
  const cwd = useSessions(state => state.byId[sessionId]?.cwd)
  const actionUrl = presentedFileUrl(sessionId, file.seq, file.index)
  const phase = usePresentedOpen(state => state[actionUrl])
  const host = usePresentedHost(value => value)
  useEffect(() => {
    if (host === null) void reloadPresentedHost()
  }, [host, reloadPresentedHost])
  return <div className={css.root}>
    {host === 'error' && <div className={css.hostStatus}>
      <span>{t('presented.hostError')}</span>
      <Button size="sm" onClick={() => { void reloadPresentedHost() }}>{t('presented.retry')}</Button>
    </div>}
    <PresentedFileCard file={file} cwd={cwd} phase={phase} host={host === 'error' ? null : host} t={t}
      onPreview={() => { openPreview(sessionId, cwd, file.path) }}
      actions={renderSlot('deliverables.presented-card.actions', {
        actionUrl,
        downloadUrl: downloadUrl ?? presentedDownloadUrl(sessionId, file.seq, file.index),
        available: host !== null && host !== 'error' && host.available,
        pending: phase === 'opening' || phase === 'revealing',
        onAction: (action, application) => openPresented(sessionId, file.seq, file.index, action, application),
      })} />
  </div>
}
