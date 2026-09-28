/**
 * Sidebar trigger for the workspace file-directory panel.
 * @module @deepseek-ai/dsh-client-ui-workspace-files/client/WorkspaceFilesTrigger
 */

import { IconFolderOpenOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkspaceFilesKey } from './locales.ts'
import css from './WorkspaceFilesTrigger.module.css'

/** Open-state snapshot shared between the trigger and the panel. */
export interface WorkspaceFilesState {
  readonly open: boolean
}

/** Props accepted by the sidebar action and its direct component tests. */
export interface WorkspaceFilesTriggerProps {
  readonly wide: boolean
  readonly useWorkspaceFiles?: SnapshotSelectorHook<WorkspaceFilesState>
  readonly toggle: () => void
  readonly t: (key: WorkspaceFilesKey, params?: Record<string, string | number>) => string
}

/** Open or close the workspace file-directory panel from the DSH sidebar. */
export function WorkspaceFilesTrigger({ wide, useWorkspaceFiles, toggle, t }: WorkspaceFilesTriggerProps) {
  const open = useWorkspaceFiles?.(state => state.open) ?? false
  const label = open ? t('trigger.close') : t('trigger.open')
  return (
    <Tooltip label={label} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={css.trigger}
        aria-label={label}
        aria-pressed={open}
        onClick={toggle}
      >
        <IconFolderOpenOutlineRegular size={wide ? 16 : 18} />
        {wide && <span>{t('trigger.open')}</span>}
      </button>
    </Tooltip>
  )
}
