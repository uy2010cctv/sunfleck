/** Browser plugin wiring the enterprise workbench into DSH's additive slots. */

import type { ConnectionHandle } from '@deepseek-ai/dsh-api-remotes/client'
import type { ClientContext, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { EnterpriseTrigger } from './EnterpriseTrigger.tsx'
import { EnterpriseWorkbench } from './EnterpriseWorkbench.tsx'
import type { EnterpriseWorkbenchInjected } from './EnterpriseWorkbench.tsx'
import { en, NS, zh, type EnterpriseWorkbenchKey } from './locales.ts'
import { EnterpriseWorkbenchController, type EnterpriseWorkbenchState } from './store.ts'
import './tokens.css'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Enterprise digital-employee workbench copy. */
    'enterprise.workbench': EnterpriseWorkbenchKey
  }
}

/** Business face handed to the sidebar trigger. */
interface EnterpriseTriggerInjected {
  hooks: { enterprise: SnapshotStore<EnterpriseWorkbenchState> }
  toggle: () => void
}

/** Required browser services. */
export const inject = ['slots', 'locale', 'connection', 'sessions', 'workspaces']

/** Mount the enterprise trigger, overlay, and live projection subscriptions. */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as ConnectionHandle
  const controller = new EnterpriseWorkbenchController(connection.api, ctx.sessions, ctx.workspaces)

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'enterprise-workbench: dictionaries')

  ctx.effect(() => {
    const recompute = (): void => { controller.recompute() }
    const disposers = [
      ctx.sessions.list.subscribe(recompute),
      ctx.workspaces.list.subscribe(recompute),
      ctx.on('connection/reset', () => {
        if (controller.store.getSnapshot().open) void controller.refresh()
      }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'enterprise-workbench: projection subscriptions')

  const triggerInjected = (): EnterpriseTriggerInjected => ({
    hooks: { enterprise: controller.store },
    toggle: () => { controller.toggle() },
  })
  const workbenchInjected = (): EnterpriseWorkbenchInjected => ({
    hooks: { enterprise: controller.store },
    close: () => { controller.close() },
    refresh: () => controller.refresh(),
    startEmployee: id => controller.startEmployee(id),
    openRecord: (id) => { controller.openRecord(id) },
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'enterprise-workbench',
    order: -20,
    locale: NS,
    inject: triggerInjected,
  }, EnterpriseTrigger))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'enterprise-workbench',
    order: 0,
    locale: NS,
    inject: workbenchInjected,
  }, EnterpriseWorkbench))
}

export type { EnterpriseTriggerProps } from './EnterpriseTrigger.tsx'
export type { EnterpriseWorkbenchProps, EnterpriseWorkbenchInjected } from './EnterpriseWorkbench.tsx'
export {
  deriveEnterpriseView, EnterpriseWorkbenchController,
  type EmployeeOperationalState, type EnterpriseEmployeeView,
  type EnterpriseMetrics, type EnterpriseView, type EnterpriseWorkbenchState,
  type EnterpriseWorkRecord, type WorkRecordState,
} from './store.ts'
