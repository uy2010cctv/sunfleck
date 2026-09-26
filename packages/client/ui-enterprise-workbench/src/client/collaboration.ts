/** Register shared room navigation beside native Workspace Sessions. */
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { IconNewChatOutlineRegular, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { CollaborationController } from './collaboration-store.ts'
import { CollaborationSetup, CollaborationGroupNavigation, CollaborationChannelNavigation, type CollaborationChoices, type CollaborationInjected } from './CollaborationNavigation.tsx'
import { COLLABORATION_NS, en, zh } from './collaboration-locales.ts'
import { applyCollaborationDetails } from './collaboration-details.ts'

const PANEL_ID = 'enterprise-collaboration' as MainPanelId

/** Native room actions shared with the enterprise overview without duplicating its room state. */
export interface CollaborationWorkbenchActions {
  openRoom(id: string): boolean
  createRoom(kind: 'group' | 'channel', projectId?: string): boolean
}

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

function activeProjects(value: unknown): readonly { id: string; name: string }[] {
  if (!Array.isArray(value)) throw new Error('invalid project choices')
  return rows(value.filter((item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid project choice')
    const state = (item as Record<string, unknown>)['state']
    if (state !== 'active' && state !== 'archived') throw new Error('invalid project state')
    return state === 'active'
  }))
}

/** Extend the existing shell without requiring collaboration on non-enterprise hosts.
 * @param ctx - Browser plugin scope owning the navigation registration.
 */
export function applyCollaboration(ctx: Context, roomCreated?: () => void): CollaborationWorkbenchActions {
  let current: CollaborationController | undefined
  ctx.inject(['layout', 'slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace', 'remote', 'remote.agentPresets', 'remote.enterpriseTeamDefinition'], (scope) => {
    const controller = new CollaborationController(
      (url, init) => fetch(url, init),
      async (id, signal) => {
        await scope.sessions.refresh()
        if (!signal.aborted) scope.uiWorkspace.openSession(id as SessionId)
      },
      () => { scope.layout.selectPanel(PANEL_ID) },
      roomCreated,
      (ids) => { scope.uiWorkspace.setHiddenSessions('enterprise-collaboration', ids.map(SessionId)) },
    )
    current = controller
    scope.effect(() => {
      const interval = setInterval(() => { void controller.refreshIfIdle() }, 7500)
      return () => { clearInterval(interval) }
    }, 'enterprise collaboration roster refresh')
    scope.effect(() => () => {
      if (current === controller) current = undefined
      scope.uiWorkspace.setHiddenSessions('enterprise-collaboration', [])
      controller.dispose()
    }, 'enterprise collaboration navigation')
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
        projects: projectsResponse.ok ? activeProjects(await projectsResponse.json()) : [],
      }
    }
    const inject = (): CollaborationInjected => ({ hooks: { collaboration: controller.state }, controller, loadChoices })
    const attentionFor = (kind: 'group' | 'channel'): HostObservable<boolean> => ({
      subscribe: listener => controller.state.subscribe(listener),
      getSnapshot: () => controller.state.getSnapshot().surfaces.some(row => row.kind === kind
        && (row.attention?.newMessages === true || row.attention?.mentions === true)),
    })
    scope.slots.inject('main', () => scope.slots.register({ name: 'main', key: PANEL_ID, locale: COLLABORATION_NS, inject }, CollaborationSetup))
    scope.effect(() => scope.uiWorkspace.navigationTabs.register({ id: 'group', order: 200, title: () => scope.locale.bind(COLLABORATION_NS)('groups'), icon: IconUsersOutlineRegular, attention: attentionFor('group') }), 'enterprise collaboration group tab')
    scope.effect(() => scope.uiWorkspace.navigationTabs.register({ id: 'channel', order: 300, title: () => scope.locale.bind(COLLABORATION_NS)('channels'), icon: IconNewChatOutlineRegular, attention: attentionFor('channel') }), 'enterprise collaboration channel tab')
    scope.slots.inject('sidebar.workspaces.navigation.tab', function* () {
      yield scope.slots.register({ name: 'sidebar.workspaces.navigation.tab', key: 'group', locale: COLLABORATION_NS, inject }, CollaborationGroupNavigation)
      yield scope.slots.register({ name: 'sidebar.workspaces.navigation.tab', key: 'channel', locale: COLLABORATION_NS, inject }, CollaborationChannelNavigation)
    })
    applyCollaborationDetails(scope, controller)
    scope.effect(() => {
      const reset = scope.on('connection/reset', () => {
        controller.clearSelection()
        controller.clearExecutionSessions()
        void controller.refresh()
      })
      return () => { reset() }
    }, 'enterprise collaboration room context')
  })
  return {
    openRoom: (id) => {
      if (current === undefined) return false
      void current.select(id)
      return true
    },
    createRoom: (kind, projectId) => {
      if (current === undefined) return false
      current.beginCreate(kind, projectId)
      return true
    },
  }
}
