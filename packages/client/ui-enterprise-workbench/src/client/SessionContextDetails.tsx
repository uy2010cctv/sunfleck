/** Employee/project context and authorized scope filtering in the native detail tab. */
import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react'
import { IconLoadingOutlineRegular, IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CollaborationController } from './collaboration-store.ts'
import type { ContextMemoryScope, SessionContextController } from './session-context-store.ts'
import type { CollaborationDetailsKey } from './collaboration-details-locales.ts'
import { dicebearAvatarUrl } from './avatar.ts'
import { CollaborationDetails, CollaborationDetailsAction } from './CollaborationDetails.tsx'
import css from './CollaborationDetails.module.css'

/** Session-bound read-only context view inputs. */
export interface SessionContextDetailsProps {
  readonly contextController: SessionContextController
  readonly sessionId: string
  readonly t: (key: CollaborationDetailsKey) => string
}
const SCOPES: readonly ContextMemoryScope[] = ['organization', 'department', 'project', 'agent', 'pair']

/** Render authorized employee/project names and approved memory summaries.
 * @param props - Current Session and the context request owner.
 * @returns Loading, query feedback or context with memory scope filters.
 */
export function SessionContextDetails({ contextController, sessionId, t }: SessionContextDetailsProps): ReactNode {
  const state = useSyncExternalStore(
    useCallback(listener => contextController.state.subscribe(listener), [contextController]),
    useCallback(() => contextController.state.getSnapshot(), [contextController]),
  )
  const [scope, setScope] = useState<ContextMemoryScope | 'all'>('all')
  if (state.sessionId !== sessionId || state.phase === 'idle' || state.phase === 'unavailable') return <p className={css.empty}>{t('unavailable')}</p>
  if (state.phase === 'loading') return <div className={css.loading} role="status" aria-label={t('loading')}><IconLoadingOutlineRegular size={16} /></div>
  if (state.phase === 'error') return <div className={css.notice}><p role="alert">{t('error')}</p><button type="button" onClick={() => { void contextController.load(sessionId) }}>{t('retry')}</button></div>
  const context = state.context
  if (context === null) return null
  const memories = context.memories.filter(memory => scope === 'all' || memory.scope === scope)
  return <div className={css.root}>
    {context.employee !== undefined && <section><h3>{t('employee')}</h3><p>{context.employee.displayName}</p><p className={css.muted}>{context.employee.role}</p>{context.employee.releaseVersion !== undefined && <p>{t('version')} {context.employee.releaseVersion}</p>}{context.employee.capabilities.length > 0 && <><h3>{t('capabilities')}</h3><ul>{context.employee.capabilities.map(capability => <li key={capability}>{capability}</li>)}</ul></>}</section>}
    {context.project !== undefined && <section><h3>{t('project')}</h3><p>{context.project.name}</p><p className={css.muted}>{context.project.goal}</p><p>{t('project.state')} · {t(context.project.state === 'active' ? 'project.active' : context.project.state === 'archived' ? 'project.archived' : 'project.unknown')}</p></section>}
    <section><h3>{t('memory')}</h3>{!context.memoryAvailable ? <p className={css.muted}>{t('memory.unavailable')}</p> : <><label className={css.filter}>{t('memory.scope')}<select value={scope} onChange={(event) => { const value = event.target.value; setScope(SCOPES.find(item => item === value) ?? 'all') }}><option value="all">{t('memory.all')}</option>{SCOPES.map(item => <option key={item} value={item}>{t(`scope.${item}`)}</option>)}</select></label>{memories.length === 0 ? <p className={css.muted}>{t('memory.empty')}</p> : <ul className={css.memories}>{memories.map(memory => <li key={memory.id}><span className={css.muted}>{t(`scope.${memory.scope}`)}</span><p>{memory.summary}</p></li>)}</ul>}</>}</section>
  </div>
}

/** Choose collaboration details or ordinary employee/project context for the current Session.
 * @param props - Native Session metadata and both authorized readers.
 * @returns Context for this Session only.
 */
export function NativeSessionDetails(
  props: SessionContextDetailsProps & { readonly controller: CollaborationController },
): ReactNode {
  const state = useSyncExternalStore(
    useCallback(listener => props.controller.state.subscribe(listener), [props.controller]),
    useCallback(() => props.controller.state.getSnapshot(), [props.controller]),
  )
  const context = useSyncExternalStore(
    useCallback(listener => props.contextController.state.subscribe(listener), [props.contextController]),
    useCallback(() => props.contextController.state.getSnapshot(), [props.contextController]),
  )
  if (state.selection?.sessionId === props.sessionId) {
    return <>
      <CollaborationDetails {...props} />
      {context.sessionId === props.sessionId && context.context !== null && <SessionContextDetails key={props.sessionId} {...props} />}
    </>
  }
  return <SessionContextDetails key={props.sessionId} {...props} />
}

/** Show the details entry for authorized collaboration, employee or project context.
 * @param props - Native Session context and the Sidebar open action.
 * @returns A Session details button: the pinned employee's avatar and name when one is bound.
 */
export function NativeSessionDetailsAction(
  props: SessionContextDetailsProps & { readonly controller: CollaborationController; readonly openDetails: () => void },
): ReactNode {
  const state = useSyncExternalStore(
    useCallback(listener => props.controller.state.subscribe(listener), [props.controller]),
    useCallback(() => props.controller.state.getSnapshot(), [props.controller]),
  )
  const context = useSyncExternalStore(
    useCallback(listener => props.contextController.state.subscribe(listener), [props.contextController]),
    useCallback(() => props.contextController.state.getSnapshot(), [props.contextController]),
  )
  const current = context.sessionId === props.sessionId ? context.context : null
  const employee = current?.employee
  const hasContext = current !== null && (employee !== undefined || current.project !== undefined)
  if (state.selection?.sessionId === props.sessionId) return <CollaborationDetailsAction {...props} />
  if (!hasContext) return null
  return <button type="button" className={css.action} onClick={props.openDetails}>
    {employee === undefined ? <IconUsersOutlineRegular size={16} />
      : <img className={css.actionAvatar} src={dicebearAvatarUrl(employee.avatarSeed ?? employee.id)} alt=""
        loading="lazy" referrerPolicy="no-referrer" />}
    <span>{employee?.displayName ?? props.t('title')}</span>
  </button>
}
