// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { applyCollaboration } from '../src/client/collaboration.ts'
import type { CollaborationInjected } from '../src/client/CollaborationNavigation.tsx'

afterEach(() => { vi.unstubAllGlobals() })

it('refreshes the Host-born Session roster before native retain and disposes its sidebar contribution', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.slots.register({ name: 'root', children: { main: { kind: 'keyed', scope: 'root' }, 'sidebar.sections': { kind: 'list', scope: 'root' } } }, () => null)
  let known = false
  const order: string[] = []
  ctx.provide('layout', { selectPanel: () => {} } as never)
  ctx.provide('sessions', {
    list: createSnapshotStore({ ids: [], byId: {}, phase: 'ready', projectionsBySession: {} }),
    refresh: async () => { order.push('refresh'); known = true },
  } as never)
  ctx.provide('workspaces', { list: createSnapshotStore({ items: [] }) } as never)
  ctx.provide('uiWorkspace', { openSession: (id: string) => {
    if (!known) throw new Error(`sessions.retain: unknown session ${id}`)
    order.push(id)
  } } as never)
  ctx.provide('remote', {} as never)
  ctx.provide('remote.agentPresets', {} as never)
  ctx.provide('remote.enterpriseTeamDefinition', {} as never)
  const detail = { id: 'g', kind: 'group', name: 'Review', memberCount: 1, workspaceId: 'w', members: [], memberUserIds: [], topics: [], dutyEmployeeIds: [] }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/open') ? { opened: true, sessionId: 'host-session' } : detail)))
  const fiber = ctx.plugin({ apply: applyCollaboration })
  await fiber.await()
  const factory = ctx.slots.entriesOfSlot('sidebar.sections')[0]?.inject
  if (typeof factory !== 'function') throw new Error('sidebar injector missing')
  const injected = (factory as () => CollaborationInjected)()
  await injected.controller.select('g')
  expect(order).toEqual(['refresh', 'host-session'])
  expect(injected.controller.state.getSnapshot().error).toBeNull()
  await fiber.dispose()
  expect(ctx.slots.entriesOfSlot('sidebar.sections')).toHaveLength(0)
  await ctx.fiber.dispose()
})
