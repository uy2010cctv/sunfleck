/** Browser plugin wiring login and governance surfaces into DSH slots. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { EnterpriseGovernanceController } from './controller.ts'
import { GovernanceAuthGateSlot, GovernanceSettingsSlot } from './slots.tsx'
import { EnterpriseAccountCard } from './EnterpriseAccountCard.tsx'
import { en, NS, zh } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Enterprise identity, organization, access, workspace, memory, and audit copy. */
    'enterprise.governance': string
  }
}

export const inject = ['slots', 'locale', 'remote', 'remote.cordisGovernance']

export function apply(ctx: Context): void {
  const controller = new EnterpriseGovernanceController(undefined, ctx.remote.cordisGovernance)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'enterprise-governance: dictionaries')
  const t = ctx.locale.bind(NS)
  void controller.refreshAuth()
  ctx.slots.inject('settings.section', () => {
    let disposeSection: (() => void) | undefined
    const synchronize = (): void => {
      const principal = controller.store.getSnapshot().auth?.principal
      const isAdministrator = principal?.roles.includes('administrator') === true
      if (isAdministrator && disposeSection === undefined) {
        disposeSection = ctx.slots.register({
          name: 'settings.section', id: 'enterprise-governance', order: 100, label: () => t('settings.label'),
          locale: NS,
          inject: () => ({ hooks: { governance: controller.store }, controller }),
        }, GovernanceSettingsSlot)
      } else if (!isAdministrator && disposeSection !== undefined) {
        disposeSection()
        disposeSection = undefined
      }
    }
    const unsubscribe = controller.store.subscribe(synchronize)
    synchronize()
    return () => {
      unsubscribe()
      disposeSection?.()
    }
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'enterprise-auth-gate', order: 100,
    locale: NS,
    inject: () => ({ hooks: { governance: controller.store }, controller }),
  }, GovernanceAuthGateSlot))
  ctx.slots.inject('sidebar.account', () => {
    let disposeAccount: (() => void) | undefined
    const synchronize = (): void => {
      const principal = controller.store.getSnapshot().auth?.principal
      if (principal !== undefined && disposeAccount === undefined) {
        disposeAccount = ctx.slots.register({
          name: 'sidebar.account',
          locale: NS,
          inject: () => ({ principal, logout: () => controller.logout() }),
        }, EnterpriseAccountCard)
      } else if (principal === undefined && disposeAccount !== undefined) {
        disposeAccount()
        disposeAccount = undefined
      }
    }
    const unsubscribe = controller.store.subscribe(synchronize)
    synchronize()
    return () => {
      unsubscribe()
      disposeAccount?.()
    }
  })
}

export { EnterpriseGovernanceController, type EnterpriseGovernanceState } from './controller.ts'
export {
  EnterpriseGovernanceSettingsSection, EnterpriseGovernanceSurface,
} from './EnterpriseGovernanceSurface.tsx'
export { EnterpriseAccountCard, type EnterpriseAccountCardProps } from './EnterpriseAccountCard.tsx'
