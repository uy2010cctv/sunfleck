/** Session-scoped collaboration metadata in the existing right Sidebar. */
import { useCallback, useSyncExternalStore, type ReactNode } from 'react'
import { IconUsersOutlineRegular, IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CollaborationController } from './collaboration-store.ts'
import type { CollaborationDetailsKey } from './collaboration-details-locales.ts'
import css from './CollaborationDetails.module.css'

/** Shared injected controller and Session identity supplied by the slot runtime. */
export interface CollaborationDetailsProps {
  readonly controller: CollaborationController
  readonly sessionId: string
  readonly t: (key: CollaborationDetailsKey) => string
}

/** Render names only while the selected collaboration belongs to this Session.
 * @param props - Current Session, controller and localized labels.
 * @returns Authorized details or an empty-context notice.
 */
export function CollaborationDetails({ controller, sessionId, t }: CollaborationDetailsProps): ReactNode {
  const state = useSyncExternalStore(
    useCallback(listener => controller.state.subscribe(listener), [controller]),
    useCallback(() => controller.state.getSnapshot(), [controller]),
  )
  const selection = state.selection
  if (selection?.sessionId !== sessionId) return <p className={css.empty}>{t('unavailable')}</p>
  const detail = selection.detail
  const duty = detail.members.filter(member => detail.dutyEmployeeIds.includes(member.employeeId))
  return <div className={css.root} aria-busy={state.busy}>
    <header className={css.header}><span className={css.muted}>{t(detail.kind)}</span><h2>{detail.name}</h2></header>
    {state.error !== null && <div className={css.notice}><p role="alert">{t('error')}</p><button type="button" disabled={state.busy} onClick={() => { void controller.select(detail.id, {
      ...(selection.topicId === undefined ? {} : { topicId: selection.topicId }),
      ...(selection.employeeId === undefined ? {} : { employeeId: selection.employeeId }),
    }) }}>{t('retry')}</button></div>}
    {state.busy && <div className={css.loading} role="status" aria-label={t('loading')}><IconLoadingOutlineRegular size={16} /></div>}
    {(detail.topicPolicy !== undefined || detail.respondPolicy !== undefined) && <section><h3>{t('policy')}</h3>{detail.topicPolicy !== undefined && <p>{t(detail.topicPolicy)}</p>}{detail.respondPolicy !== undefined && <p>{t(detail.respondPolicy)}</p>}</section>}
    {detail.project !== undefined && <section><h3>{t('project')}</h3><p>{detail.project.name}</p>{detail.project.goal !== '' && <p className={css.muted}>{detail.project.goal}</p>}</section>}
    {detail.team !== undefined && <section><h3>{t('team')}</h3><p>{detail.team.name}</p></section>}
    <section><h3>{t('members')}</h3>{detail.members.length === 0 ? <p className={css.muted}>{t('members.empty')}</p> : <ul>{detail.members.map(member => <li key={member.employeeId}><IconUsersOutlineRegular size={16} /><button className={css.topic} type="button" disabled={state.busy} aria-current={selection.employeeId === member.employeeId ? 'true' : undefined} onClick={() => { void controller.select(detail.id, { employeeId: member.employeeId, ...(selection.topicId === undefined ? {} : { topicId: selection.topicId }) }) }}>{member.displayName}</button></li>)}</ul>}{detail.memberUserIds.length > 0 && <p className={css.muted}>{t('members.people')} · {detail.memberUserIds.length}</p>}</section>
    <section><h3>{t('duty')}</h3>{duty.length === 0 ? <p className={css.muted}>{t('duty.empty')}</p> : <ul>{duty.map(member => <li key={member.employeeId}>{member.displayName}</li>)}</ul>}</section>
    <section><h3>{t('topics')}</h3>{detail.topics.length === 0 ? <p className={css.muted}>{t('topics.empty')}</p> : <ul>{detail.topics.map(topic => <li key={topic.id} className={css.topicGroup}><button className={css.topic} type="button" disabled={state.busy} aria-current={selection.topicId === topic.id ? 'true' : undefined} onClick={() => { void controller.select(detail.id, { topicId: topic.id }) }}><span>{topic.title}</span><span className={css.muted}>{t(topic.state)}</span></button>{topic.destinations?.map((destination) => {
      const member = detail.members.find(item => item.employeeId === destination.employeeId)
      if (member === undefined) return null
      return <button key={destination.sessionId} type="button" className={css.topic} disabled={state.busy} aria-label={`${topic.title} · ${member.displayName}`} aria-current={destination.sessionId === sessionId ? 'true' : undefined} onClick={() => { void controller.select(detail.id, { topicId: topic.id, employeeId: member.employeeId }) }}>{member.displayName}</button>
    })}</li>)}</ul>}</section>
  </div>
}

/** Open the collaboration tab only from its matching Session header.
 * @param props - Session-scoped details and the native Sidebar action.
 * @returns The details button, or nothing for unrelated Sessions.
 */
export function CollaborationDetailsAction(
  { controller, sessionId, t, openDetails }: CollaborationDetailsProps & { readonly openDetails: () => void },
): ReactNode {
  const state = useSyncExternalStore(
    useCallback(listener => controller.state.subscribe(listener), [controller]),
    useCallback(() => controller.state.getSnapshot(), [controller]),
  )
  if (state.selection?.sessionId !== sessionId) return null
  return <button className={css.action} type="button" onClick={openDetails}><IconUsersOutlineRegular size={16} /><span>{t('title')}</span></button>
}

/** Localized tab title with the shared collaboration icon.
 * @param props - Localized tab labels.
 * @returns The icon and title rendered by the native tab strip.
 */
export function CollaborationDetailsTitle({ t }: Pick<CollaborationDetailsProps, 't'>): ReactNode {
  return <><IconUsersOutlineRegular size={16} />{t('title')}</>
}
