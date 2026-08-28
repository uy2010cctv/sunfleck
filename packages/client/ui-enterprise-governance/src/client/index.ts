/** Browser plugin wiring login and governance surfaces into DSH slots. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { EnterpriseGovernanceController } from './controller.ts'
import { GovernanceAuthGateSlot, GovernanceSettingsSlot } from './slots.tsx'

export const inject = ['slots']

export function apply(ctx: Context): void {
  const controller = new EnterpriseGovernanceController()
  void controller.refreshAuth()
  ctx.slots.inject('settings.section', () => {
    let disposeSection: (() => void) | undefined
    const synchronize = (): void => {
      const principal = controller.store.getSnapshot().auth?.principal
      const isAdministrator = principal?.roles.includes('administrator') === true
      if (isAdministrator && disposeSection === undefined) {
        disposeSection = ctx.slots.register({
          name: 'settings.section', id: 'enterprise-governance', order: 100, label: '企业管理',
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
    inject: () => ({ hooks: { governance: controller.store }, controller }),
  }, GovernanceAuthGateSlot))
}

export { EnterpriseGovernanceController, type EnterpriseGovernanceState } from './controller.ts'
export {
  EnterpriseGovernanceSettingsSection, EnterpriseGovernanceSurface,
} from './EnterpriseGovernanceSurface.tsx'
