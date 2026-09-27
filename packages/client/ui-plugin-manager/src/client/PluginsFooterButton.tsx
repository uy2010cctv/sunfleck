/** The sidebar-foot Plugins button: sits beside the settings launcher and opens the management panel. */
import { IconPluginPinwheelOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './PluginsFooterButton.module.css'

/** Full component props: the trigger-row share + the open action + locale. */
export type PluginsFooterButtonProps = PropsRuntime<'settings.aux'>
  & PropsLocale<'pluginManager'>
  & { readonly open: () => void }

/** Open or close the plugin management main panel from the sidebar foot.
 * @param props - the trigger-row state, the panel open action, and copy.
 * @returns the footer button.
 */
export function PluginsFooterButton({ wide, open, t }: PluginsFooterButtonProps): ReactNode {
  return (
    <button type="button" className={wide ? css.button : css.rail} aria-label={t('panel')} onClick={open}>
      <IconPluginPinwheelOutlineRegular size={wide ? 16 : 18} />
      {wide && <span>{t('panel')}</span>}
    </button>
  )
}

export type { MainPanelId }
