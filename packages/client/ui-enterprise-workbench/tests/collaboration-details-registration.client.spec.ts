import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as applyLocale, inject as localeInject } from '@deepseek-ai/dsh-client-locale/client'
import { stubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import { SidebarRightTabRegistry } from '../../ui-sidebar-right/src/client/tab-registry.ts'
import { CollaborationController } from '../src/client/collaboration-store.ts'
import { SessionContextController } from '../src/client/session-context-store.ts'
import { applyCollaborationDetails } from '../src/client/collaboration-details.ts'

const Empty = () => null
afterEach(() => { vi.restoreAllMocks() })

describe('optional collaboration details registration', () => {
  it('waits for native Sidebar services and removes tab, title and action on disposal', async () => {
    const contextLoad = vi.spyOn(SessionContextController.prototype, 'load')
    const ctx = new Context()
    await ctx.plugin(SlotRegistry).await()
    ctx.provide('connection', { api: { settings: {} }, isLoopback: false } as never)
    ctx.provide('remote', { $on: () => () => {} } as never)
    ctx.provide('configForms', { developerTools: { enabled: createSnapshotStore(true) }, get: () => stubConfigForm().scope } as never)
    await ctx.plugin({ inject: localeInject, apply: applyLocale }).await()
    ctx.slots.register({ name: 'root', children: {
      'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' },
      'sidebar.right.pane.tab.title': { kind: 'keyed', scope: 'session' },
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
    } } as never, Empty)
    const controller = new CollaborationController(vi.fn(), vi.fn(), vi.fn())
    const fiber = ctx.plugin({ apply: (scope: Context) => applyCollaborationDetails(scope, controller) })
    await fiber.await()
    expect(ctx.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    const tabs = new SidebarRightTabRegistry(ctx)
    await ctx.plugin({ apply: (scope: Context) => {
      scope.reflect.provide('sidebarRightTabs', tabs)
      scope.reflect.provide('sidebarRight', { mounted: createSnapshotStore(undefined), openTab: vi.fn() } as never)
    } }).await()
    await vi.waitFor(() => { expect(tabs.get('enterprise-collaboration')).toBeDefined() })
    expect(tabs.get('enterprise-collaboration')).toBeDefined()
    expect(ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(1)
    expect(ctx.slots.entries('sidebar.right.pane.tab.title')).toHaveLength(1)
    expect(ctx.slots.entries('conversation.session.header.actions')).toHaveLength(1)
    const loadsBeforeReset = contextLoad.mock.calls.length
    ctx.emit('connection/reset')
    expect(contextLoad).toHaveBeenCalledTimes(loadsBeforeReset + 1)
    await fiber.dispose()
    ctx.emit('connection/reset')
    expect(contextLoad).toHaveBeenCalledTimes(loadsBeforeReset + 1)
    expect(tabs.get('enterprise-collaboration')).toBeUndefined()
    expect(ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
    expect(ctx.slots.entries('sidebar.right.pane.tab.title')).toHaveLength(0)
    expect(ctx.slots.entries('conversation.session.header.actions')).toHaveLength(0)
    await ctx.fiber.dispose()
  })
})
