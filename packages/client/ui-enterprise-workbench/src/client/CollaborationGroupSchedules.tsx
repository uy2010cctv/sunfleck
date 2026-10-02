/** Group-local Host reminders in the room detail panel. */
import { useEffect, useState } from 'react'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { Button, IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './CollaborationGroupSchedules.module.css'

type Copy = TranslateNS<'enterprise.collaboration'>
type ScheduleFetch = (url: string, init?: RequestInit) => Promise<Response>

interface GroupSchedule {
  readonly id: string
  readonly title: string
  readonly prompt: string
  readonly scheduledAt: string
  readonly employeeName: string
  readonly timeZone?: string
}

function parseScheduleList(value: unknown): GroupSchedule[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-response')
  const items = (value as Record<string, unknown>)['items']
  if (!Array.isArray(items)) throw new Error('invalid-response')
  return items.map((item: unknown) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error('invalid-response')
    const row = item as Record<string, unknown>
    for (const field of ['id', 'title', 'prompt', 'scheduledAt', 'employeeName']) {
      if (typeof row[field] !== 'string') throw new Error('invalid-response')
    }
    if (row['timeZone'] !== undefined && typeof row['timeZone'] !== 'string') throw new Error('invalid-response')
    return {
      id: row['id'] as string, title: row['title'] as string, prompt: row['prompt'] as string,
      scheduledAt: row['scheduledAt'] as string, employeeName: row['employeeName'] as string,
      ...(row['timeZone'] === undefined ? {} : { timeZone: row['timeZone'] as string }),
    }
  })
}

/** Show active group tasks and let the group administrator remove one explicitly.
 * @param props - Authorized group id, management right, translated copy and transport.
 * @returns The group-only task section.
 */
export function CollaborationGroupSchedules({ groupId, canManage, t, transport = fetch }: {
  readonly groupId: string
  readonly canManage: boolean
  readonly t: Copy
  readonly transport?: ScheduleFetch
}) {
  const [items, setItems] = useState<readonly GroupSchedule[]>([])
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [version, setVersion] = useState(0)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState(false)

  useEffect(() => {
    const request = new AbortController()
    const load = async (): Promise<void> => {
      try {
        const response = await transport(`/enterprise/surfaces/${encodeURIComponent(groupId)}/schedules`, {
          credentials: 'same-origin', signal: request.signal,
        })
        if (!response.ok) throw new Error('request-failed')
        const next = parseScheduleList(await response.json())
        if (!request.signal.aborted) { setItems(next); setPhase('ready') }
      } catch (_error) { if (!request.signal.aborted) setPhase('error') }
    }
    void load()
    const timer = setInterval(() => { void load() }, 10_000)
    return () => { request.abort(); clearInterval(timer) }
  }, [groupId, transport, version])

  const remove = async (id: string): Promise<void> => {
    if (!canManage || busy) return
    setBusy(true); setDeleteError(false)
    try {
      const response = await transport(`/enterprise/surfaces/${encodeURIComponent(groupId)}/schedules/delete`, {
        credentials: 'same-origin', method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!response.ok) throw new Error('request-failed')
      setConfirmId(null)
      setItems(current => current.filter(item => item.id !== id))
      setVersion(value => value + 1)
    } catch (_error) { setDeleteError(true) }
    finally { setBusy(false) }
  }
  return <section className={css.root} aria-label={t('groupSchedules')}>
    <div className={css.heading}><h3>{t('groupSchedules')}</h3><Button size="sm" variant="outline"
      onClick={() => { setVersion(value => value + 1) }}>{t('refresh')}</Button></div>
    <p className={css.help}>{t('groupScheduleHelp')}</p>
    {phase === 'loading' && <div className={css.loading}><IconLoadingOutlineRegular size={18}/></div>}
    {phase === 'error' && <p role="alert" className={css.error}>{t('groupScheduleLoadFailed')}</p>}
    {phase === 'ready' && items.length === 0 && <p className={css.empty}>{t('groupScheduleEmpty')}</p>}
    {phase === 'ready' && items.length > 0 && <ul className={css.list}>{items.map(item => <li key={item.id}>
      <div className={css.task}><strong>{item.title}</strong><span>{item.employeeName}</span></div>
      <p>{item.prompt}</p>
      <time dateTime={item.scheduledAt}>{t('groupScheduleNext', { time: new Date(item.scheduledAt)
        .toLocaleString(t('groupScheduleLocale'), { timeZone: item.timeZone }) })}</time>
      {canManage && (confirmId === item.id ? <div className={css.actions}>
        <span>{t('groupScheduleDeleteQuestion')}</span>
        <Button size="sm" disabled={busy} onClick={() => { setConfirmId(null) }}>{t('cancel')}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => { void remove(item.id) }}>{t('groupScheduleDeleteConfirm')}</Button>
      </div> : <Button size="sm" variant="outline" aria-label={t('groupScheduleDelete', { name: item.title })}
        onClick={() => { setConfirmId(item.id); setDeleteError(false) }}>{t('remove')}</Button>)}
    </li>)}</ul>}
    {deleteError && <p role="alert" className={css.error}>{t('groupScheduleDeleteFailed')}</p>}
  </section>
}
