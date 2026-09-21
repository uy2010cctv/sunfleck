/** Browser registration for the Recorder settings section. */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { RecorderSettingsSection, type RecorderSettingsInjected } from './RecorderSettingsSection.tsx'
import { RecorderSettingsStore, type RecorderRuntimeRemote } from './store.ts'
import { en, zh, type RecorderSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Recorder inference runtime settings copy. */
    'settings.recorder': RecorderSettingsKey
  }
}

const NS = 'settings.recorder'
export const inject = ['slots', 'locale', 'remote', 'remote.enterpriseDevice']

/** Register the Recorder settings page and its observable runtime controller. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-settings-recorder: dictionaries')
  const remote = ctx.remote.enterpriseDevice as unknown as RecorderRuntimeRemote
  const controller = new RecorderSettingsStore(remote)
  const t = ctx.locale.bind(NS) as RecorderSettingsInjected['t']
  const injected = (): RecorderSettingsInjected => ({ controller, hooks: { snapshot: controller.store }, t })
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'recorder-models', order: 15, label: () => t('nav'), inject: injected,
  }, RecorderSettingsSection))
}

export { RecorderSettingsSection, RecorderSettingsStore }
export type { RecorderRuntimeRemote, RecorderSettingsInjected, RecorderSettingsKey }
