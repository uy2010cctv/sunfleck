/** Sidebar entry for the enterprise digital-employee workbench. */

import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { EnterpriseWorkbenchKey } from './locales.ts'
import type { EnterpriseWorkbenchState } from './store.ts'
import css from './EnterpriseTrigger.module.css'
import { EnterpriseBrand } from './EnterpriseBrand.tsx'

/** Props accepted by the sidebar action and its direct component tests. */
export interface EnterpriseTriggerProps {
  readonly wide: boolean
  readonly open?: boolean
  readonly useEnterprise?: SnapshotSelectorHook<EnterpriseWorkbenchState>
  readonly toggle: () => void
  readonly t: (key: EnterpriseWorkbenchKey, params?: Record<string, string | number>) => string
}

/** Open or close the enterprise workbench from the persistent DSH sidebar. */
export function EnterpriseTrigger({ wide, open, useEnterprise, toggle, t }: EnterpriseTriggerProps) {
  const workbenchOpen = open ?? useEnterprise?.(state => state.open) ?? false
  const label = workbenchOpen ? t('trigger.close') : t('trigger.open')
  return (
    <Tooltip label={label} delayMs={500} disabled={wide}>
      <button
        type="button"
        className={css.trigger}
        aria-label={label}
        aria-pressed={workbenchOpen}
        onClick={toggle}
      >
        <EnterpriseBrand {...(wide ? { label: t('trigger.label') } : {})} />
      </button>
    </Tooltip>
  )
}
