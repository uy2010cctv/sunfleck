/** Workspace candidate menu restricted to file upload for a room composer. */
import { useId, useLayoutEffect, useMemo } from 'react'
import { IconPaperclipOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputTriggerCrumb, MenuState } from '@deepseek-ai/dsh-client-ui-input-trigger/client'

/**
 * Render the existing workspace menu with one room-owned file action.
 * @param props - open state, translated labels, file picker and menu dismissal.
 * @returns the workspace menu factory, or a file action when that plugin is absent.
 */
export function RoomAttachmentMenu({ open, fileLabel, sectionLabel, onPick, onDismiss, renderFactorySlot }: {
  readonly open: boolean
  readonly fileLabel: string
  readonly sectionLabel: string
  readonly onPick: () => void
  readonly onDismiss: () => void
  readonly renderFactorySlot?: PropsRenderFactories['renderFactorySlot'] | undefined
}) {
  const source = useId()
  const menu = useMemo(() => createSnapshotStore<MenuState>({ open: false, hit: null, generation: 0,
    groups: [], highlight: null }, { flush: 'sync' }), [])
  const headers = useMemo(() => createSnapshotStore<ReadonlyMap<string, readonly InputTriggerCrumb[]>>(new Map()), [])
  useLayoutEffect(() => {
    menu.set({ open, hit: null, generation: 0,
      groups: [{ source, status: 'ready', showGroupTitle: false,
        items: [{ name: 'file', label: fileLabel, icon: IconPaperclipOutlineRegular, section: sectionLabel }] }],
      highlight: { source, index: 0 } })
  }, [open, fileLabel, sectionLabel, source, menu])
  if (!open) return null
  const fallback = <div role="listbox"><button type="button" role="option" aria-selected
    onMouseDown={(event) => { event.preventDefault(); onPick() }}>{fileLabel}</button></div>
  return renderFactorySlot === undefined ? fallback : renderFactorySlot('input-trigger.menu', {
    menu, headers, onPick, onDismiss, onHover: () => {}, onCrumb: () => {},
  }, { fallback })
}
