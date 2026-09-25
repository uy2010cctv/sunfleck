/** Register shared room navigation beside native Workspace Sessions. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { CollaborationController } from './collaboration-store.ts'
import { CollaborationSetup, CollaborationSidebar, type CollaborationChoices, type CollaborationInjected } from './CollaborationNavigation.tsx'
import { COLLABORATION_NS, en, zh } from './collaboration-locales.ts'
import { applyCollaborationDetails } from './collaboration-details.ts'

const PANEL_ID = 'enterprise-collaboration' as MainPanelId

function rows(value: unknown): readonly { id: string; name: string }[] {
  if (!Array.isArray(value)) throw new Error('invalid collaboration choices')
  return value.map((item: unknown) => {
    if (item === null || typeof item !== 'object') throw new Error('invalid collaboration choice')
    const row = item as Record<string, unknown>
    const id = row['id']
    const name = row['displayName'] ?? row['name']
    if (typeof id !== 'string' || typeof name !== 'string') throw new Error('invalid collaboration choice')
    return { id, name }
  })
}

/** Extend the existing shell without requiring collaboration on non-enterprise hosts.
 * @param ctx - Browser plugin scope owning the navigation registration.
 */
export function applyCollaboration(ctx: Context): void {
  ctx.inject(['layout', 'slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'remote', 'remote.agentPresets', 'remote.enterpriseTeamDefinition'], (scope) => {
    const controller = new CollaborationController(
      (url, init) => fetch(url, init),
      async (id, signal) => {
        await scope.sessions.refresh()
        if (!signal.aborted) scope.uiWorkspace.openSession(id as SessionId)
      },
      () => { scope.layout.selectPanel(PANEL_ID) },
    )
    scope.effect(() => () => { controller.dispose() }, 'enterprise collaboration navigation')
    scope.effect(() => scope.locale.register(COLLABORATION_NS, { zh, en }), 'enterprise collaboration copy')
    const loadChoices = async (): Promise<CollaborationChoices> => {
      const [presets, teams, peopleResponse, projectsResponse] = await Promise.all([
        scope.remote.agentPresets.list(), scope.remote.enterpriseTeamDefinition.list({ limit: 100 }),
        fetch('/auth/admin/users', { credentials: 'same-origin' }),
        fetch('/enterprise/projects', { credentials: 'same-origin' }),
      ])
      if (!presets.ok) throw new Error('employee directory unavailable')
      const peopleAvailable = peopleResponse.ok
      return {
        workspaces: scope.workspaces.list.getSnapshot().items.map(item => ({ id: item.workspaceId, name: item.title })),
        employees: presets.value.presets.filter(row => row.kind === 'employee' && row.broken === undefined).map(row => ({ id: row.id, name: row.name ?? row.id })),
        people: peopleAvailable ? rows(await peopleResponse.json()) : [], peopleAvailable,
        teams: teams.ok ? teams.value.items.filter(row => row.state === 'active').map(row => ({ id: row.teamId, name: row.name })) : [],
        projects: projectsResponse.ok ? rows(await projectsResponse.json()) : [],
      }
    }
    const inject = (): CollaborationInjected => ({ hooks: { collaboration: controller.state }, controller, loadChoices })
    scope.slots.inject('main', () => scope.slots.register({ name: 'main', key: PANEL_ID, locale: COLLABORATION_NS, inject }, CollaborationSetup))
    scope.slots.inject('sidebar.sections', () => scope.slots.register({ name: 'sidebar.sections', id: 'enterprise-collaboration', order: 100, locale: COLLABORATION_NS, inject }, CollaborationSidebar))
    applyCollaborationDetails(scope, controller)
    scope.effect(() => {
      const reset = scope.on('connection/reset', () => { controller.clearSelection(); void controller.refresh() })
      return () => { reset() }
    }, 'enterprise collaboration room context')
  })
}
