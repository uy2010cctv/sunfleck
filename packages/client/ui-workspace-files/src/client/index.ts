/**
 * Workspace file-directory plugin, browser half. Registers two entries:
 *
 * - WorkspaceFilesTrigger fills the sidebar shell's `sidebar.footer.action`
 *   hole — a folder trigger that toggles the drawer.
 * - WorkspaceFilesPanel fills the frame-wide `shell.overlay` layer — a
 *   right-side drawer listing the current session's workspace file tree,
 *   lazily loaded one level at a time through the Host file-reference
 *   discovery service (the same relative-path vocabulary the `@` menu uses).
 *
 * Both share one open-state SnapshotStore through the inject `hooks`
 * compartment, so the trigger's pressed state and the drawer's visibility
 * can never disagree.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
// Type-only: pulls the generated Remote API and ctx.remote merge through the
// Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the slots registry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the sidebar footer-action and shell.overlay slot contracts.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the GlobalStandardProps merge (useSessions) for the panel.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { en, NS, zh, type WorkspaceFilesKey } from './locales.ts'
import { WorkspaceFilesTrigger, type WorkspaceFilesState } from './WorkspaceFilesTrigger.tsx'
import { WorkspaceFilesPanel } from './WorkspaceFilesPanel.tsx'

export type { WorkspaceFilesKey } from './locales.ts'
export type { WorkspaceFilesState } from './WorkspaceFilesTrigger.tsx'
export { WorkspaceFilesTrigger } from './WorkspaceFilesTrigger.tsx'
export type { WorkspaceFilesTriggerProps } from './WorkspaceFilesTrigger.tsx'
export { WorkspaceFilesPanel } from './WorkspaceFilesPanel.tsx'
export type { WorkspaceFilesPanelInjected, WorkspaceFilesPanelProps } from './WorkspaceFilesPanel.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workspace file-directory drawer copy. */
    'workspace.files': WorkspaceFilesKey
  }
}

/** Required browser services: slots, locale, and the file-discovery remote. */
export const inject = ['slots', 'locale', 'remote', 'remote.fileReferences']

/**
 * Client plugin body: register the dictionaries, the shared open-state store,
 * and both slot entries.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workspace-files: dictionaries')
  const store = createSnapshotStore<WorkspaceFilesState>({ open: false })

  const listLevel = async (
    sessionId: SessionId,
    query: string,
    signal: AbortSignal,
  ): Promise<FileReferenceCandidate[]> => {
    const result = await ctx.remote.fileReferences.list(sessionId, query, signal)
    return result.ok ? result.value : []
  }

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'workspace-files',
    order: -20,
    locale: NS,
    inject: () => ({
      hooks: { workspaceFiles: store },
      toggle: () => store.set({ open: !store.getSnapshot().open }),
    }),
  }, WorkspaceFilesTrigger))

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'workspace-files',
    order: 0,
    locale: NS,
    inject: () => ({
      hooks: { workspaceFiles: store },
      close: () => store.set({ open: false }),
      listLevel,
    }),
  }, WorkspaceFilesPanel))
}
