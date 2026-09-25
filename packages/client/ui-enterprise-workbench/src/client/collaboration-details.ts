/** Optional collaboration tab registration in the native Session Sidebar. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { CollaborationDetailsTitle } from './CollaborationDetails.tsx'
import { NativeSessionDetails, NativeSessionDetailsAction } from './SessionContextDetails.tsx'
import { SessionContextController } from './session-context-store.ts'
import type { CollaborationController } from './collaboration-store.ts'
import { NS, en, zh, type CollaborationDetailsKey } from './collaboration-details-locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Collaboration metadata attached to a native Session. */
    'enterprise.collaborationDetails': CollaborationDetailsKey
  }
}
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    /** Session-derived collaboration page; no navigation arguments. */
    'enterprise-collaboration': undefined
  }
}
const KIND = 'enterprise-collaboration'
const ID = 'enterprise-collaboration-details'

/** Install details when the optional native Sidebar services are available.
 * @param ctx - Owning plugin scope with slots and locale services.
 * @param controller - Shared authorized collaboration selection.
 */
export function applyCollaborationDetails(ctx: Context, controller: CollaborationController): void {
  ctx.inject(['sidebarRightTabs', 'sidebarRight', 'slots', 'locale'], (scope) => {
    const contextController = new SessionContextController((url, init) => fetch(url, init))
    scope.effect(() => {
      const mounted = scope.sidebarRight.mounted
      const sync = (): void => { void contextController.load(mounted.getSnapshot()) }
      const unsubscribe = mounted.subscribe(sync)
      const reset = scope.on('connection/reset', sync)
      sync()
      return () => { reset(); unsubscribe(); contextController.dispose() }
    })
    scope.effect(() => scope.locale.register(NS, { zh, en }))
    scope.effect(() => scope.sidebarRightTabs.register({ id: ID, kind: KIND, priority: 'builtin', title: () => scope.locale.bind(NS)('title') }))
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
      name: 'sidebar.right.pane.tab', key: ID, locale: NS, inject: () => ({ controller, contextController }),
    }, NativeSessionDetails)))
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
      name: 'sidebar.right.pane.tab.title', key: ID, locale: NS,
    }, CollaborationDetailsTitle)))
    scope.effect(() => scope.slots.inject('conversation.session.header.actions', () => scope.slots.register({
      name: 'conversation.session.header.actions', id: ID, order: -5, locale: NS,
      inject: sessionId => ({ controller, contextController, openDetails: () => {
        if (scope.sidebarRight.mounted.getSnapshot() !== sessionId) return
        void contextController.load(sessionId)
        void controller.refreshCurrent()
        scope.sidebarRight.openTab(KIND)
      } }),
    }, NativeSessionDetailsAction)))
  })
}
