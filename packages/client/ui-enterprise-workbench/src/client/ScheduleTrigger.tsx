/** Sidebar shortcut to the existing scheduled-task management page. */

import { IconAlarmClockOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { EnterpriseWorkbenchKey } from './locales.ts'
import css from './EnterpriseTrigger.module.css'

/** Props for the scheduled-task sidebar action. */
export interface ScheduleTriggerProps {
  readonly wide: boolean
  readonly openSchedules: () => void
  readonly t: (key: EnterpriseWorkbenchKey, params?: Record<string, string | number>) => string
}

/** Open scheduled-task creation and management in the enterprise workbench. */
export function ScheduleTrigger({ wide, openSchedules, t }: ScheduleTriggerProps) {
  const label = t('nav.schedules')
  return <Tooltip label={label} delayMs={500} disabled={wide}>
    <button type="button" className={css.trigger} data-dsh-schedule-trigger="" aria-label={label} onClick={openSchedules}>
      <IconAlarmClockOutlineRegular size={wide ? 16 : 18}/>
      {wide && <span>{label}</span>}
    </button>
  </Tooltip>
}
