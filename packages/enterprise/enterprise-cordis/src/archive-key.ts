import type { CordisPluginArchive } from './types.ts'

/** Stable private scope key independent of JSONB property order.
 * @param scope - private Workspace scope.
 * @returns key used by archive persistence.
 */
export function archiveScopeKey(scope: CordisPluginArchive['scope']): string {
  return JSON.stringify({ type: 'personal-workspace', workspaceId: scope.workspaceId, ownerUserId: scope.ownerUserId })
}
