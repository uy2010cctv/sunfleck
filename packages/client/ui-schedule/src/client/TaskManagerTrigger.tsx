/** Sidebar footer entry for the automation task manager. */
import { IconClockOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './TaskManagerTrigger.module.css'

/** Footer navigation values supplied by the task manager plugin. */
export interface TaskManagerTriggerInjected {
  readonly openTasks: () => void
}

/**
 * Open the automation manager from the sidebar footer.
 * @param props - sidebar width, localized copy, and navigation action.
 * @returns the accessible task manager entry.
 */
export function TaskManagerTrigger({ wide, openTasks, t }: PropsRuntime<'sidebar.footer.action'> & PropsLocale<'schedule.manager'> & TaskManagerTriggerInjected) {
  const label = t('panel')
  return <Tooltip label={label} delayMs={500} disabled={wide}>
    <button type="button" className={css.trigger} data-dsh-schedule-trigger="" aria-label={label} onClick={openTasks}>
      <IconClockOutlineRegular size={wide ? 16 : 18} />
      {wide && <span>{label}</span>}
    </button>
  </Tooltip>
}
