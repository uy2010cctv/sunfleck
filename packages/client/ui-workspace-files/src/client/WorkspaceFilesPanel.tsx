/**
 * Workspace file-directory panel: a right-side drawer over the conversation
 * showing the file tree of the current session's workspace directory.
 * @module @deepseek-ai/dsh-client-ui-workspace-files/client/WorkspaceFilesPanel
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  IconChevronRightOutlineMedium,
  IconCloseOutlineRegular,
  IconCodeOutlineRegular,
  IconFolderCloseRegular,
  IconFolderOpenRegular,
  IconRefreshOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import type { WorkspaceFilesState } from './WorkspaceFilesTrigger.tsx'
import css from './WorkspaceFilesPanel.module.css'

/** Injected business face: the shared open-state hook, close, and the level listing call. */
export interface WorkspaceFilesPanelInjected {
  hooks: { workspaceFiles: SnapshotStore<WorkspaceFilesState> }
  close: () => void
  /** List one directory level of the session cwd (query '' = the workspace root). */
  listLevel: (sessionId: SessionId, query: string, signal: AbortSignal) => Promise<FileReferenceCandidate[]>
}

/** Full props: runtime share + locale + injected face (hooks compartment bound). */
export type WorkspaceFilesPanelProps =
  PropsRuntime<'shell.overlay'> & PropsLocale<typeof NS> & InjectFace<WorkspaceFilesPanelInjected>

/** Display name of one candidate: the path segment after the last separator. */
function displayName(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(cut + 1)
}

/**
 * Sort one level dirs-first, then by display name — the same ordering the
 * reference menu shows, so the tree and the `@` menu never disagree.
 */
function sortLevel(entries: readonly FileReferenceCandidate[]): FileReferenceCandidate[] {
  return [...entries].sort((left, right) =>
    (left.kind === right.kind ? 0 : left.kind === 'directory' ? -1 : 1)
    || displayName(left.path).localeCompare(displayName(right.path)))
}

/**
 * Render the workspace file-directory drawer.
 * @param props - injected panel props.
 * @returns the drawer element (null while closed).
 */
export function WorkspaceFilesPanel({
  useWorkspaceFiles, useSessions, close, listLevel, t,
}: WorkspaceFilesPanelProps) {
  const open = useWorkspaceFiles(state => state.open)
  const session = useSessions(state => Object.values(state.byId).find(row => (row.retainedBy.mainView ?? 0) > 0))
  const sessionId = session?.id
  const cwd = session?.cwd
  // Tree state: expanded directory keys (relative to cwd, '' = root), the
  // children cache per key, and which keys are mid-scan.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [children, setChildren] = useState<ReadonlyMap<string, readonly FileReferenceCandidate[]>>(new Map())
  const [loadingKeys, setLoadingKeys] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  // Generation guard: a settlement from a closed (or superseded) tree must
  // not mutate the fresh one.
  const generation = useRef(0)
  // The in-flight level scan's controller: superseding intent aborts the wire
  // request too — the Host stops scanning instead of discarding a late result.
  const scanController = useRef<AbortController | null>(null)

  /** Invalidate every in-flight settlement and start a fresh tree generation. */
  const resetTree = useCallback((): void => {
    generation.current += 1
    scanController.current?.abort()
    scanController.current = null
    setExpanded(new Set())
    setChildren(new Map())
    setLoadingKeys(new Set())
    setError(null)
  }, [])

  /** Load one level's children, guarded against duplicate and stale scans. */
  const loadLevel = useCallback((key: string, signal: AbortSignal): void => {
    if (sessionId === undefined) return
    const gen = generation.current
    const target = sessionId
    setLoadingKeys(prev => new Set(prev).add(key))
    setError(null)
    const query = key === '' ? '' : `${key}/`
    listLevel(target, query, signal).then((entries) => {
      if (gen !== generation.current) return
      setChildren(prev => new Map(prev).set(key, sortLevel(entries)))
      setLoadingKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }, (reason: unknown) => {
      if (gen !== generation.current) return
      setLoadingKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [listLevel, sessionId])

  /** Toggle one directory: expand lazily loads its level, collapse drops children. */
  const toggleDir = useCallback((key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    if (!children.has(key) && !loadingKeys.has(key)) {
      const controller = new AbortController()
      scanController.current = controller
      loadLevel(key, controller.signal)
    }
  }, [children, loadingKeys, loadLevel])

  // Open, session, or workspace change resets the tree; the root level loads
  // once a session with a cwd is present. Closing invalidates in-flight scans.
  useEffect(() => {
    resetTree()
    if (!open || sessionId === undefined || cwd === undefined) return
    const controller = new AbortController()
    scanController.current = controller
    loadLevel('', controller.signal)
  }, [open, sessionId, cwd, resetTree, loadLevel])

  // Unmount/remount invalidation: never mutate a dead component.
  useEffect(() => () => {
    generation.current += 1
    scanController.current?.abort()
  }, [])

  if (!open) return null

  const renderRow = (entry: FileReferenceCandidate, depth: number) => {
    const name = displayName(entry.path)
    const key = entry.path
    if (entry.kind === 'directory') {
      const isExpanded = expanded.has(key)
      const loading = loadingKeys.has(key)
      return (
        <div key={key} className={css.row} style={{ paddingInlineStart: `${8 + depth * 14}px` }}>
          <button
            type="button"
            className={css.dirRow}
            aria-expanded={isExpanded}
            onClick={() => { toggleDir(key) }}
          >
            <IconChevronRightOutlineMedium size={12} className={clsx(css.chevron, isExpanded && css.chevronOpen)} />
            {isExpanded ? <IconFolderOpenRegular size={16} /> : <IconFolderCloseRegular size={16} />}
            <span className={css.name}>{name}</span>
            {loading && <span className={css.loading}>{t('panel.loading')}</span>}
          </button>
          {isExpanded && (children.get(key) ?? []).map(child => renderRow(child, depth + 1))}
        </div>
      )
    }
    return (
      <div key={key} className={css.row} style={{ paddingInlineStart: `${24 + depth * 14}px` }}>
        <IconCodeOutlineRegular size={16} className={css.fileIcon} />
        <span className={css.name}>{name}</span>
      </div>
    )
  }

  const rootLevel = children.get('') ?? []
  const basename = cwd === undefined ? '' : displayName(cwd.replace(/[\\/]+$/, ''))

  return (
    <div className={css.drawer}>
      <div className={css.header}>
        <div className={css.titleBlock}>
          <h2 className={css.title}>{t('panel.title')}</h2>
          <p className={css.workspace} title={cwd}>{basename}{cwd ? ` · ${cwd}` : ''}</p>
        </div>
        <div className={css.actions}>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('panel.refresh')}
            title={t('panel.refresh')}
            onClick={() => {
              resetTree()
              if (sessionId !== undefined && cwd !== undefined) {
                const controller = new AbortController()
                scanController.current = controller
                loadLevel('', controller.signal)
              }
            }}
          >
            <IconRefreshOutlineRegular size={16} />
          </button>
          <button
            type="button"
            className={css.iconButton}
            aria-label={t('panel.close')}
            title={t('panel.close')}
            onClick={close}
          >
            <IconCloseOutlineRegular size={16} />
          </button>
        </div>
      </div>
      <div className={css.body}>
        {sessionId === undefined || cwd === undefined
          ? <p className={css.empty}>{t('panel.noSession')}</p>
          : loadingKeys.has('') && rootLevel.length === 0
            ? <p className={css.empty}>{t('panel.loading')}</p>
            : rootLevel.length === 0 && error === null
              ? <p className={css.empty}>{t('panel.empty')}</p>
              : (
                <>
                  {error !== null && <p className={css.error} role="alert">{error}</p>}
                  {rootLevel.map(entry => renderRow(entry, 0))}
                </>
              )}
      </div>
    </div>
  )
}
